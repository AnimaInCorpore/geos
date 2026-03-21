"use strict";

// Use collectArtifacts to get emulator state details.

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

    // Get bank state — this should tell us about memory banking
    const bankState = await api.debug.getBankState();
    console.log("\n=== Bank State ===");
    console.log(JSON.stringify(bankState, null, 2));

    // Get system state
    const sysState = await api.system.getSystemState();
    console.log("\n=== System State ===");
    console.log(JSON.stringify(sysState, null, 2));

    // Get debug state
    const dbgState = await api.debug.getDebugState();
    console.log("\n=== Debug State ===");
    console.log(JSON.stringify(dbgState, null, 2));

    // Try collectArtifacts
    try {
      const artifacts = await api.artifacts.collectArtifacts();
      console.log("\n=== Artifacts ===");
      console.log("Keys:", Object.keys(artifacts));
      for (const [k, v] of Object.entries(artifacts)) {
        if (typeof v === "object" && v !== null) {
          if (v.base64) console.log("  " + k + ": base64 data (" + v.base64.length + " chars)");
          else if (Array.isArray(v)) console.log("  " + k + ": array [" + v.length + "]");
          else console.log("  " + k + ":", JSON.stringify(v).slice(0, 200));
        } else {
          console.log("  " + k + ":", String(v).slice(0, 100));
        }
      }
    } catch (e) {
      console.log("collectArtifacts failed:", e.message);
    }

    // Try getCounters
    try {
      const counters = await api.debug.getCounters();
      console.log("\n=== Counters ===");
      console.log(JSON.stringify(counters, null, 2));
    } catch (e) {
      console.log("getCounters failed:", e.message);
    }

    // KEY TEST: Run a plain Atari OS boot (no GEOS) and verify mode F works
    // Actually, let's check the publishVideoFrame path by looking at video state
    // Use getTraceTail to see recent CPU execution
    try {
      const trace = await api.debug.getTraceTail();
      if (trace && trace.length > 0) {
        console.log("\n=== Trace Tail (last 10 instructions) ===");
        const tail = trace.slice(-10);
        for (const entry of tail) {
          console.log("  PC=$" + hex4(entry.pc) + " A=$" + hex2(entry.a) + " X=$" + hex2(entry.x) + " Y=$" + hex2(entry.y));
        }
      }
    } catch (e) {
      console.log("getTraceTail failed:", e.message);
    }

    // CRITICAL TEST: Directly read sram by using readRange at I/O addresses
    // readRange in memory.js might use the underlying access functions...
    console.log("\n=== I/O Register Reads (readRange) ===");
    // These are READ-SIDE values (not sram)
    try {
      const gtiaRegs = await api.debug.readRange(0xd000, 0x20);
      console.log("GTIA $D000-$D01F read-side:");
      for (let i = 0; i < 0x20; i++) {
        if (gtiaRegs[i] !== 0) {
          console.log("  $" + hex4(0xd000 + i) + " = $" + hex2(gtiaRegs[i]));
        }
      }
    } catch (e) {
      console.log("readRange GTIA failed:", e.message);
    }

    try {
      const anticRegs = await api.debug.readRange(0xd400, 0x10);
      console.log("ANTIC $D400-$D40F read-side:");
      for (let i = 0; i < 0x10; i++) {
        console.log("  $" + hex4(0xd400 + i) + " = $" + hex2(anticRegs[i]));
      }
    } catch (e) {
      console.log("readRange ANTIC failed:", e.message);
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
