"use strict";

// Debug ANTIC state: display list, DMACTL, SDMCTL, and verify playfield rendering.

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

    // Run more cycles to let display settle
    await api.system.waitForCycles({ count: 5000000 });

    // Read ANTIC registers
    const sdmctl = await api.debug.readMemory(0x022f); // OS shadow of DMACTL
    const sdlstl = await api.debug.readMemory(0x0230); // OS shadow of DLISTL
    const sdlsth = await api.debug.readMemory(0x0231); // OS shadow of DLISTH
    const dmactl_sram = await api.debug.readMemory(0xd400); // DMACTL (write-only, reads VCOUNT)

    console.log("\n=== ANTIC State ===");
    console.log("SDMCTL (shadow): $" + hex2(sdmctl));
    console.log("SDLSTL/H (shadow): $" + hex4((sdlsth << 8) | sdlstl));
    console.log("DMACTL read (gives VCOUNT): $" + hex2(dmactl_sram));

    // Read the actual DLISTL/H from ANTIC hardware (write-only, but sram may have it)
    // ANTIC registers: $D402=DLISTL, $D403=DLISTH (write), $D40A=WSYNC, etc.

    // Read NMI vector
    const nmiLo = await api.debug.readMemory(0xfffa);
    const nmiHi = await api.debug.readMemory(0xfffb);
    console.log("NMI vector: $" + hex4((nmiHi << 8) | nmiLo));

    // Read display list from SDLST address
    const dlAddr = (sdlsth << 8) | sdlstl;
    console.log("\n=== Display List at $" + hex4(dlAddr) + " ===");
    const dlBytes = [];
    for (let i = 0; i < 128; i++) {
      dlBytes.push(await api.debug.readMemory(dlAddr + i));
    }

    // Decode display list
    let dlpc = 0;
    let lineCount = 0;
    while (dlpc < 128 && lineCount < 50) {
      const b = dlBytes[dlpc];
      const mode = b & 0x0f;
      const dli = (b & 0x80) !== 0;
      const lms = (b & 0x40) !== 0;
      const vscr = (b & 0x20) !== 0;
      const hscr = (b & 0x10) !== 0;

      let line = "$" + hex4(dlAddr + dlpc) + ": $" + hex2(b) + " ";

      if (mode === 0) {
        // Blank lines
        const blanks = ((b >> 4) & 0x07) + 1;
        line += "BLANK x" + blanks;
        if (dli) line += " +DLI";
        dlpc++;
      } else if (mode === 1) {
        if (lms) {
          // JVB (Jump and wait for Vertical Blank)
          const target = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
          line += "JVB $" + hex4(target);
          if (dli) line += " +DLI";
          dlpc += 3;
          console.log(line);
          lineCount++;
          break; // End of display list
        } else {
          // JMP
          const target = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
          line += "JMP $" + hex4(target);
          dlpc += 3;
          // Could follow the jump, but for now just note it
        }
      } else {
        // Display mode
        line += "MODE $" + mode.toString(16).toUpperCase();
        if (lms) {
          const lmsAddr = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
          line += " LMS=$" + hex4(lmsAddr);
          dlpc += 3;
        } else {
          dlpc++;
        }
        if (dli) line += " +DLI";
        if (hscr) line += " +HSCR";
        if (vscr) line += " +VSCR";
      }

      console.log(line);
      lineCount++;
    }

    // Check GEOS screen memory - read first 40 bytes of screen data
    // GEOS bitmap typically at some address, let's check the LMS addresses from the display list
    console.log("\n=== Color register state (from shadow registers) ===");
    for (let i = 0; i < 5; i++) {
      const shadow = await api.debug.readMemory(0x02c0 + i);
      console.log("COLOR" + i + " ($" + hex4(0x02c0 + i) + "): $" + hex2(shadow));
    }

    // Check PORTB state
    const portb = await api.debug.readMemory(0xd301);
    console.log("\nPORTB: $" + hex2(portb) + " (bit0=" + (portb & 1) + " OS ROM)");

    // Check the first few bytes of screen memory from the first LMS address
    // Re-parse to find it
    dlpc = 0;
    let firstLmsAddr = null;
    while (dlpc < 128) {
      const b = dlBytes[dlpc];
      const mode = b & 0x0f;
      const lms = (b & 0x40) !== 0;
      if (mode >= 2 && lms) {
        firstLmsAddr = dlBytes[dlpc + 1] | (dlBytes[dlpc + 2] << 8);
        break;
      }
      if (mode === 0) { dlpc++; }
      else if (mode === 1 || lms) { dlpc += 3; }
      else { dlpc++; }
    }

    if (firstLmsAddr !== null) {
      console.log("\n=== First screen data at $" + hex4(firstLmsAddr) + " ===");
      const screenBytes = [];
      for (let i = 0; i < 40; i++) {
        screenBytes.push(await api.debug.readMemory(firstLmsAddr + i));
      }
      console.log("First 40 bytes: " + screenBytes.map(b => hex2(b)).join(" "));
      const nonZero = screenBytes.filter(b => b !== 0).length;
      console.log("Non-zero bytes: " + nonZero + "/40");
    }

    // Take screenshot
    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_antic_debug.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("\nScreenshot: " + outPath + " (" + png.length + " bytes)");
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
