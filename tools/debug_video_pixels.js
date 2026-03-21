"use strict";

// Inspect video pixel buffer directly to see what palette indices are written.

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

    // Try to access the video buffer through collectArtifacts or similar API
    // Check what APIs are available
    const apiKeys = Object.keys(api);
    console.log("API namespaces:", apiKeys.join(", "));

    for (const ns of apiKeys) {
      if (typeof api[ns] === "object" && api[ns] !== null) {
        const methods = Object.keys(api[ns]);
        console.log("  " + ns + ":", methods.join(", "));
      }
    }

    // Check if there's a way to read the video buffer
    // Try debug.readRange on the video area
    // Actually, let's check if we can access raw sram values

    // Read sram values for color registers by setting a breakpoint in the
    // mode F renderer and checking register state
    // Alternative: use the snapshot API to get full machine state

    // Let's try: inject a tiny 6502 routine that reads from sram-backed
    // addresses and stores to a RAM buffer we can then read

    // Actually, the simplest approach: write known values to color registers
    // using breakpoint + single-step + register injection

    // BUT FIRST: let me check PRIOR register. If PRIOR bits 6-7 are set,
    // mode F renders differently!
    // We can't read sram[IO_PRIOR] through the API. But we CAN set a breakpoint
    // on the mode F renderer's first instruction and read the sram state...
    // No, breakpoints are CPU-level, not renderer-level.

    // Alternative: check what the GEOS kernal writes to PRIOR
    // Search for STA $D01B in the ROM area
    console.log("\n=== Searching for STA PRIOR ($D01B) writes ===");
    const pattern = [0x8D, 0x1B, 0xD0]; // STA $D01B
    const areas = [[0xC000, 0xD000], [0xD800, 0x10000]];
    const hits = [];
    for (const [start, end] of areas) {
      for (let addr = start; addr < end - 3; addr++) {
        let match = true;
        for (let i = 0; i < 3; i++) {
          const b = await api.debug.readMemory(addr + i);
          if (b !== pattern[i]) { match = false; break; }
        }
        if (match) hits.push(addr);
      }
    }
    console.log("STA PRIOR hits: " + hits.map(a => "$" + hex4(a)).join(", "));

    // Also check what's at the PRIOR shadow register ($026F on Atari OS)
    // OS uses $26F for GPRIOR shadow, but GEOS has OS banked out
    const gprior = await api.debug.readMemory(0x026f);
    console.log("GPRIOR shadow ($026F): $" + hex2(gprior));

    // Dump the first few entries of the sram for GTIA by injecting a test
    // Actually, let me use a different approach:
    // Set a breakpoint right AFTER a STA COLPF2, then read back from
    // the address that mode_8_f.js reads. Since mode_8_f reads sram[],
    // and the I/O handler for COLPF2 writes sram[], the question is whether
    // sram[] is being read correctly.

    // KEY INSIGHT: Maybe the issue isn't sram values, but that the
    // ANTIC renderer never runs for the GEOS display.
    // Let's check by examining the publishVideoFrame path.

    // Actually, let me try writing directly to the color registers by
    // using STA instructions from a breakpoint handler

    // Simpler: set breakpoint on MaintainAtariDisplay (at $F81A) and when
    // it hits, examine the registers being written.
    // We already know from debug_colpf2_breakpoint.js that COLPF2 gets $0F.

    // Let's try a completely different approach: patch the color table to use
    // a very obvious non-zero color
    console.log("\n=== Patching AtariColorTable with bright colors ===");
    // AtariColorTable is at $C558 (from previous debug)
    // Byte 0=COLBK, 1=COLPF0, 2=COLPF1, 3=COLPF2, 4=COLPF3
    // Set COLPF2 to bright blue ($84) and COLPF1 to bright green ($C6)
    // That way "0" bits = $84 (blue), "1" bits = ($80|$06) = $86 (blue-green)
    await api.debug.writeMemory(0xC558, 0x94); // COLBK = bright red
    await api.debug.writeMemory(0xC559, 0xC6); // COLPF0 = bright green
    await api.debug.writeMemory(0xC55A, 0x0E); // COLPF1 = white luminance
    await api.debug.writeMemory(0xC55B, 0x94); // COLPF2 = bright red
    await api.debug.writeMemory(0xC55C, 0x46); // COLPF3

    // Wait for several VBI frames so MaintainAtariDisplay picks up new values
    await api.system.waitForCycles({ count: 2000000 });

    // Verify the color table was updated
    for (let i = 0; i < 5; i++) {
      const v = await api.debug.readMemory(0xC558 + i);
      console.log("AtariColorTable[" + i + "] = $" + hex2(v));
    }

    // Take screenshot
    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_bright_colors.png");
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
