"use strict";

// Directly inspect sram color register values through injected VM code.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

// Expose sram inspection via a global callback set before machine creation
const sramData = {};

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
    globals: { __sramData: sramData },
  });

  try {
    const api = runtime.api;
    const vmCtx = runtime.context;
    await api.whenReady();

    // Inject a function that reads sram from inside the VM context.
    // The app object exposes readRange which accesses memory through the
    // access function. For I/O registers, this goes through the I/O handler.
    // But we need the sram directly. Let's patch the A8EApp module.
    //
    // Actually, we can use the readRange function on the app to read through
    // the access path. But for sram, we need to hook deeper.
    //
    // Alternative: use the app's getBankState and readMemory.
    // readMemory at I/O addresses goes through the access function which
    // returns the read-side register (e.g., TRIG0 instead of COLPF2).
    //
    // The only way to read sram is through the machine context.
    // Let's monkey-patch A8EApp.create to expose sram.

    // First, let's check if the snapshot/saveSnapshot includes sram data
    const snapshot = await api.system.saveSnapshot();
    console.log("Snapshot keys:", Object.keys(snapshot));
    console.log("Snapshot byteLength:", snapshot.byteLength);

    // Load the XEX and boot
    const xexData = new Uint8Array(fs.readFileSync(xexPath));
    const diskData = new Uint8Array(fs.readFileSync(diskPath));

    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({ bytes: xexData, name: "bootstrap.xex", awaitEntry: false, start: true, resetOptions: { portB: 0xff } });
    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    if (!entryEvent || !entryEvent.debugState) { console.error("FATAL: No entry BP"); process.exit(3); }

    await api.media.mountDisk(diskData, { name: "geos.atr", slot: 0 });
    await api.debug.setBreakpoints([]);
    await api.system.start();

    for (let chunk = 0; chunk < 500; chunk++) {
      await api.system.waitForCycles({ count: 20000 });
      const status = await api.debug.readMemory(ADDR_STATUS);
      if (status >= 0x82) break;
    }
    console.log("Desktop painted, running 5M more cycles...");
    await api.system.waitForCycles({ count: 5000000 });

    // Save a snapshot — it contains the full machine state including sram
    const stateSnapshot = await api.system.saveSnapshot();
    console.log("\nSnapshot after desktop paint:");
    console.log("  byteLength:", stateSnapshot.byteLength);

    // The snapshot is a binary blob. Let's try to extract sram from it.
    // Snapshots typically include ram, sram, cpu state, etc.
    // Let's check what format it uses.
    if (stateSnapshot.bytes) {
      const snapBytes = Buffer.from(stateSnapshot.bytes);
      // Look for the snapshot structure
      console.log("  First 32 bytes:", Array.from(snapBytes.subarray(0, 32)).map(b => b.toString(16).padStart(2, "0")).join(" "));
    }

    // Alternative approach: use collectArtifacts with memory ranges
    // that include I/O addresses. If readRange goes through access functions,
    // it will give us read-side register values, but still useful.
    const ioRangeResult = await api.debug.readRange(0xd016, 5);
    console.log("\nreadRange $D016-$D01A:", Array.from(ioRangeResult).map(b => "$" + b.toString(16).padStart(2, "0")).join(" "));

    // Read through access function to see what GTIA returns
    for (let addr = 0xd000; addr <= 0xd01f; addr++) {
      const v = await api.debug.readMemory(addr);
      if (v !== 0) {
        console.log("  $" + addr.toString(16) + " = $" + v.toString(16).padStart(2, "0"));
      }
    }

    // Key test: inject code to read sram directly by hooking writeMemory
    // We can use setMemoryWriteHook to observe writes, or we can
    // try a creative approach:
    //
    // Execute a 6502 program that reads from sram by using the I/O read path.
    // Actually, on real hardware, reading $D018 gives TRIG0, not COLPF2.
    // So we can't read COLPF2 from the CPU side.
    //
    // But we CAN read the OS shadow registers which the CPU writes.
    // COLOR2 ($02C2) should have the value GEOS wrote.
    const color2 = await api.debug.readMemory(0x02c2);
    console.log("\nCOLOR2 (shadow) = $" + color2.toString(16).padStart(2, "0"));

    // The OS VBI should copy COLOR2 -> COLPF2 each frame.
    // But GEOS has OS ROM banked out, so the OS VBI doesn't run.
    // GEOS has its own VBI (MaintainAtariDisplay) that writes directly
    // to COLPF2 hardware register via STA $D018.
    //
    // If MaintainAtariDisplay runs, it should update sram[$D018] through
    // the I/O access function. Let's verify by checking if the NMI handler
    // is actually being called.

    // Check NMI vector
    const nmiLo = await api.debug.readMemory(0xfffa);
    const nmiHi = await api.debug.readMemory(0xfffb);
    const nmien = await api.debug.readMemory(0xd40e); // reads NMIST
    console.log("NMI vector: $" + ((nmiHi << 8) | nmiLo).toString(16).padStart(4, "0"));
    console.log("NMIST (read at $D40E): $" + nmien.toString(16).padStart(2, "0"));

    // Take screenshot
    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_sram_debug.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("\nScreenshot: " + outPath + " (" + png.length + " bytes)");
    }

    // NEW: Try a different approach. Use the app's readRange to read sram
    // by checking if there's a way to access it through the snapshot codec.
    // Load snapshot, inspect, then restore.

    // Actually, the most direct approach: write a tiny 6502 program that
    // writes known values to COLPF2 and take screenshot.
    // Use assembleSource API if available.
    console.log("\n=== Injecting 6502 color test ===");
    try {
      // Build a tiny routine that writes $0E to COLPF2 ($D018) and returns
      const testAsm = await api.dev.assembleSource({
        name: "COLORTEST.ASM",
        text: [
          ".ORG $0600",
          "LDA #$0E",
          "STA $D018  ; COLPF2 = white",
          "LDA #$0E",
          "STA $D01A  ; COLBK = white too (test)",
          "RTS",
          ".RUN $0600",
        ].join("\n"),
      });
      console.log("Assembly result:", testAsm.ok, "runAddr:", testAsm.runAddr);

      if (testAsm.ok && testAsm.bytes) {
        // Load and run the assembled code
        await api.dev.runXex({
          bytes: testAsm.bytes,
          name: "COLORTEST.XEX",
          awaitEntry: false,
          start: true,
        });

        // Wait for it to execute
        await api.system.waitForCycles({ count: 100000 });

        // Take another screenshot
        const shot2 = await api.artifacts.captureScreenshot();
        if (shot2 && shot2.base64) {
          const png2 = Buffer.from(shot2.base64, "base64");
          const outPath2 = path.resolve(REPO_ROOT, "build/geos_after_colortest.png");
          fs.writeFileSync(outPath2, png2);
          console.log("Screenshot after color test: " + outPath2 + " (" + png2.length + " bytes)");
        }
      }
    } catch (err) {
      console.log("Assembly/injection failed:", err.message);
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
