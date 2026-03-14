"use strict";

// Phase 4 step-17a headless runner
//
// Boots tools/siov_minimal_test.xex with OS ROM active and NO SIO bridge.
// Reports whether jsA8E can complete a bare sector-read SIOV call at all.
//
// Usage:
//   make atarixl-siov-minimal-test          # build XEX + ATR first
//   node tools/siov_minimal_test_run.js
//
// Exit codes:
//   0  PASS — SIOV returned Y=1 (success)
//   1  FAIL — SIOV returned Y >= $80 (device error; DSTATS has code)
//   2  TIMEOUT — STATUS stayed $00; SIOV never returned
//   3  Fatal (exception / missing file / XEX preflight failed)

const fs   = require("node:fs");
const path = require("node:path");

const REPO_ROOT  = path.resolve(__dirname, "..");
const JSA8E_DIR  = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const ROM_DIR    = path.resolve(REPO_ROOT, "third_party/A8E");
const BUILD_DIR  = path.resolve(REPO_ROOT, "build/atarixl");

const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

// Result scratchpad written by the test XEX
const ADDR_STATUS = 0x04D0;
const ADDR_YREG   = 0x04D1;
const ADDR_DSTS   = 0x04D2;
const ADDR_BUF0   = 0x04D3;
const ADDR_BUF1   = 0x04D4;

// Entry point of the test code (must not overlap jsA8E's boot loader $0700-$087F)
const ENTRY_PC = 0x0900;

// Cycle budget after entry: 10 million cycles ≈ 5.6 seconds at 1.77 MHz
// Real 1050 drive takes ~2–3 seconds per sector
const POLL_CHUNK   = 1_000_000;   // cycles per polling interval
const MAX_CHUNKS   = 10;          // total = 10 M cycles

// Boot budget: 30 seconds of real time for the OS to boot the XEX via SIOV
const BOOT_TIMEOUT_MS = 30_000;

function hex2(v) {
  return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

async function main() {
  const xexPath  = path.join(BUILD_DIR, "siov_minimal_test.xex");
  const diskPath = path.join(BUILD_DIR, "phase4_disk_test.atr");
  const osPath   = path.join(ROM_DIR,  "ATARIXL.ROM");
  const basPath  = path.join(ROM_DIR,  "ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      console.error("Run: make atarixl-siov-minimal-test");
      process.exit(3);
    }
  }

  const runtime = await createHeadlessAutomation({
    roms: {
      os:    osPath,
      basic: fs.existsSync(basPath) ? basPath : undefined,
    },
    turbo:        true,
    sioTurbo:     false,
    frameDelayMs: 0,
  });

  try {
    const api = runtime.api;
    await api.whenReady();

    const xexData  = new Uint8Array(fs.readFileSync(xexPath));
    const diskData = new Uint8Array(fs.readFileSync(diskPath));

    // Step 1: Set a breakpoint at the XEX entry so we can swap D1: before
    // the test code runs.  Use awaitEntry:false so runXex starts the machine
    // without calling runUntilPc (which has a tight-loop stall detector that
    // fires in the SIOV wait loop at $EA9E).
    await api.debug.setBreakpoints([ENTRY_PC]);
    console.log("Loading siov_minimal_test.xex, waiting for entry at $" +
                ENTRY_PC.toString(16).toUpperCase() + "...");

    await api.dev.runXex({
      bytes:        xexData,
      name:         "siov_minimal_test.xex",
      awaitEntry:   false,
      start:        true,
      resetOptions: { portB: 0xff },   // keep OS ROM visible at reset
    });

    // Step 2: Wait for the breakpoint (OS boots the XEX via SIOV; may take
    // up to BOOT_TIMEOUT_MS of real time in turbo mode).
    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: BOOT_TIMEOUT_MS });
    if (!entryEvent || !entryEvent.debugState) {
      console.error("FATAL: XEX did not reach entry breakpoint at $" +
                    ENTRY_PC.toString(16).toUpperCase() +
                    " within " + (BOOT_TIMEOUT_MS / 1000) + "s");
      process.exit(3);
    }
    const ep = entryEvent.debugState;
    console.log("XEX reached entry: PC=$" +
                ep.pc.toString(16).toUpperCase().padStart(4, "0"));

    // Step 3: Swap D1: to the test disk.  CPU is paused at $0900.
    await api.media.mountDisk(diskData, { name: "phase4_disk_test.atr", slot: 0 });
    console.log("Mounted " + path.basename(diskPath) + " in D1:");

    // Step 4: Clear the breakpoint, resume execution.
    await api.debug.setBreakpoints([]);
    await api.system.start();

    // Step 5: Drive the CPU forward, polling STATUS after each chunk.
    // SIOV needs interrupts enabled (the test does cli before jsr SIOV) and
    // the VBI to fire to decrement CDTMV5.
    console.log("Running up to " + (POLL_CHUNK * MAX_CHUNKS).toLocaleString() +
                " cycles for SIOV to return...");
    let status = 0;
    for (let i = 0; i < MAX_CHUNKS && status === 0; i++) {
      const cycleResult = await api.system.waitForCycles({ count: POLL_CHUNK });
      status = await api.debug.readMemory(ADDR_STATUS);
      const cyclesRun = cycleResult && cycleResult.delta ? cycleResult.delta : POLL_CHUNK;
      process.stdout.write("  chunk " + (i + 1) + "/" + MAX_CHUNKS +
                           " (" + (cyclesRun / 1e6).toFixed(2) + " Mcycles)" +
                           " STATUS=$" + hex2(status) + "\r");
      // waitForCycles returns early if CPU halts; status should be set by then
      if (cycleResult && !cycleResult.ok && cycleResult.reason !== "cycleCounter") break;
    }
    process.stdout.write("\n");

    await api.system.pause();

    const yreg = await api.debug.readMemory(ADDR_YREG);
    const dsts = await api.debug.readMemory(ADDR_DSTS);
    const buf0 = await api.debug.readMemory(ADDR_BUF0);
    const buf1 = await api.debug.readMemory(ADDR_BUF1);

    console.log("STATUS=$" + hex2(status) + "  YREG=$" + hex2(yreg) +
                "  DSTATS=$" + hex2(dsts) +
                "  BUF[0]=$" + hex2(buf0) + "  BUF[1]=$" + hex2(buf1));

    if (status === 0x01) {
      console.log("PASS: SIOV returned successfully (YREG=$01)");
      console.log("  Sector 1 first two bytes: $" + hex2(buf0) + " $" + hex2(buf1));
      process.exit(0);
    } else if (status === 0xFF) {
      console.log("FAIL: SIOV returned an error");
      console.log("  YREG=$" + hex2(yreg) + " DSTATS=$" + hex2(dsts));
      process.exit(1);
    } else {
      console.log("TIMEOUT: STATUS=$00 after " + (POLL_CHUNK * MAX_CHUNKS).toLocaleString() +
                  " cycles — SIOV never returned");
      console.log("  Same stall as existing SIO bridge tests" +
                  " (POKEY XMTDON IRQ not delivered)");
      process.exit(2);
    }

  } finally {
    if (runtime && typeof runtime.dispose === "function") {
      await runtime.dispose();
    }
  }
}

main().catch(function (err) {
  console.error("Fatal:", err && err.message ? err.message : String(err));
  process.exit(3);
});
