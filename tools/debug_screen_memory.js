"use strict";

// Check screen memory content more thoroughly.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v) { return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0"); }

async function main() {
  const xexPath = path.resolve(REPO_ROOT, "build/atarixl/phase5_desktop_bootstrap.xex");
  const diskPath = path.resolve(REPO_ROOT, "build/atarixl/geos.atr");
  const osPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIXL.ROM");
  const basicPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) { console.error("FATAL: " + label + " not found: " + p); process.exit(3); }
  }

  const runtime = await createHeadlessAutomation({
    roms: { os: osPath, basic: fs.existsSync(basicPath) ? basicPath : undefined },
    turbo: true, sioTurbo: false, frameDelayMs: 0, skipRendering: false,
  });

  try {
    const api = runtime.api;
    await api.whenReady();

    const xexData = new Uint8Array(fs.readFileSync(xexPath));
    const diskData = new Uint8Array(fs.readFileSync(diskPath));

    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({ bytes: xexData, name: "bootstrap.xex", awaitEntry: false, start: true, resetOptions: { portB: 0xff } });
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    await api.media.mountDisk(diskData, { name: "geos.atr", slot: 0 });
    await api.debug.setBreakpoints([]);
    await api.system.start();

    for (let chunk = 0; chunk < 500; chunk++) {
      await api.system.waitForCycles({ count: 20000 });
      const status = await api.debug.readMemory(ADDR_STATUS);
      if (status >= 0x82) break;
    }
    console.log("Desktop painted.");
    await api.system.waitForCycles({ count: 5000000 });

    // Screen is at $4000 (from display list LMS)
    // Mode $0F: 40 bytes per line, 192 lines = 7680 bytes ($4000-$5DFF)
    // But display list has ~46 mode $0F lines, so let's check

    // Sample screen memory at various offsets
    const screenBase = 0x4000;
    const bytesPerLine = 40;

    console.log("\n=== Screen Memory Survey ===");
    const linesToCheck = [0, 1, 2, 10, 20, 50, 95, 96, 100, 150, 190, 191];
    for (const lineNum of linesToCheck) {
      const lineAddr = screenBase + lineNum * bytesPerLine;
      if (lineAddr >= 0x10000) break;
      const lineBytes = [];
      for (let i = 0; i < bytesPerLine; i++) {
        lineBytes.push(await api.debug.readMemory(lineAddr + i));
      }
      const allFF = lineBytes.every(b => b === 0xff);
      const all00 = lineBytes.every(b => b === 0x00);
      const nonZero = lineBytes.filter(b => b !== 0x00).length;
      const nonFF = lineBytes.filter(b => b !== 0xff).length;
      let summary;
      if (allFF) summary = "ALL $FF";
      else if (all00) summary = "ALL $00";
      else summary = nonFF + "/40 non-$FF, " + nonZero + "/40 non-$00";
      console.log("Line " + lineNum + " ($" + hex4(lineAddr) + "): " + summary);
      if (!allFF && !all00) {
        // Print first 20 bytes
        console.log("  " + lineBytes.slice(0, 20).map(b => hex2(b)).join(" ") + " ...");
      }
    }

    // Also check: is there screen data somewhere else?
    // GEOS might use a different screen base. Let's check the display list more carefully.
    const sdlstl = await api.debug.readMemory(0x0230);
    const sdlsth = await api.debug.readMemory(0x0231);
    const dlAddr = (sdlsth << 8) | sdlstl;

    // Re-read display list and find all LMS addresses
    console.log("\n=== LMS addresses in display list ===");
    const dlBytes = [];
    for (let i = 0; i < 200; i++) {
      dlBytes.push(await api.debug.readMemory(dlAddr + i));
    }
    let dlpc = 0;
    let lmsCount = 0;
    while (dlpc < 200) {
      const b = dlBytes[dlpc];
      const mode = b & 0x0f;
      const lms = (b & 0x40) !== 0;
      if (mode >= 2 && lms) {
        const lmsAddr = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
        console.log("  DL@$" + hex4(dlAddr + dlpc) + " MODE $" + mode.toString(16) + " LMS=$" + hex4(lmsAddr));
        lmsCount++;
        dlpc += 3;
      } else if (mode === 1) {
        if (lms) {
          const target = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
          console.log("  DL@$" + hex4(dlAddr + dlpc) + " JVB $" + hex4(target));
          dlpc += 3;
          break;
        } else {
          const target = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
          console.log("  DL@$" + hex4(dlAddr + dlpc) + " JMP $" + hex4(target));
          // Follow the jump if it's within our buffer
          const newDlpc = target - dlAddr;
          if (newDlpc >= 0 && newDlpc < 200) {
            dlpc = newDlpc;
          } else {
            // Need to read from the new address
            console.log("  (Jump outside buffer, stopping)");
            break;
          }
        }
      } else if (mode === 0) {
        dlpc++;
      } else {
        dlpc++;
      }
    }
    console.log("Total LMS entries: " + lmsCount);

    // Check the GEOS foreground/background color convention
    // In GEOS, foreground = 1 bits, background = 0 bits
    // On C64: foreground=dark, background=light
    // So on Atari: 1 bits should be dark (COLPF2_hue | COLPF1_luma), 0 bits should be light (COLPF2)
    //
    // Current state:
    //   COLPF1 = $00 (black)
    //   COLPF2 = $0F -> sram = $0E
    //   1-bit color = ($0E & $F0) | ($00 & $0F) = $00 (black)
    //   0-bit color = $0E (grey, luma 14)
    //
    // If screen is all $FF (all 1-bits), everything is black foreground color.
    // This would make sense if GEOS filled the screen with "foreground" during init.
    //
    // But the GEOS desktop should have mixed content - menu bar, icons, etc.
    // All $FF suggests the bitmap was not properly drawn.

    // Check if maybe the display list wraps or the mode line count differs
    // Count total mode lines
    dlpc = 0;
    let totalModeLines = 0;
    while (dlpc < 200) {
      const b = dlBytes[dlpc];
      const mode = b & 0x0f;
      const lms = (b & 0x40) !== 0;
      if (mode >= 2) {
        totalModeLines++;
        dlpc += lms ? 3 : 1;
      } else if (mode === 1) {
        dlpc += 3;
        break;
      } else {
        dlpc++;
      }
    }
    console.log("\nTotal mode $F scan lines: " + totalModeLines);
    console.log("Screen memory needed: " + (totalModeLines * 40) + " bytes ($" + hex4(totalModeLines * 40) + ")");
    console.log("Screen range: $4000-$" + hex4(0x4000 + totalModeLines * 40 - 1));

    // Check if GEOS status byte indicates desktop is truly painted
    const status = await api.debug.readMemory(ADDR_STATUS);
    console.log("\nGEOS status byte ($04D0): $" + hex2(status));

    // Check some GEOS internal state
    // screenBase is typically stored somewhere in GEOS
    // Check common GEOS zero page vars
    console.log("\n=== GEOS ZP state ===");
    for (let addr = 0x20; addr < 0x80; addr += 2) {
      const lo = await api.debug.readMemory(addr);
      const hi = await api.debug.readMemory(addr + 1);
      const val = (hi << 8) | lo;
      if (val >= 0x3f00 && val <= 0x6000) {
        console.log("  $" + hex2(addr) + ": $" + hex4(val) + " (might be screen pointer)");
      }
    }

    process.exit(0);
  } finally {
    if (runtime && typeof runtime.dispose === "function") await runtime.dispose();
  }
}

main().catch(function (err) {
  console.error("Fatal:", err && err.message ? err.message : String(err));
  if (err.stack) console.error(err.stack);
  process.exit(3);
});
