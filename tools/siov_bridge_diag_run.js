"use strict";

// Step 17b: SIO bridge diagnostic headless runner
//
// Boots tools/siov_bridge_diag.xex and reads the 8 result bytes at $04D0-$04D7
// to determine which bridge-setup step causes SIOV to fail.
//
// Result layout:
//   $04D0  P1_STAT  $01=pass  $FF=fail  $00=not reached
//   $04D1  P1_YREG  Y register returned by Phase 1 SIOV
//   $04D2  P2_STAT  after PORTB cycle (ROM off→on)
//   $04D3  P2_YREG
//   $04D4  P3_STAT  after full bridge sim (no page-2 swap)
//   $04D5  P3_YREG
//   $04D6  P4_STAT  after full bridge sim + page-2 vector swap
//   $04D7  P4_YREG
//
// Usage:
//   make atarixl-siov-bridge-diag
//   node tools/siov_bridge_diag_run.js
//
// Exit codes:
//   0  all four phases passed
//   1  one or more phases failed (check output for which)
//   2  TIMEOUT — the halt loop was never reached in time
//   3  Fatal (exception / missing file)

const fs   = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const ROM_DIR   = path.resolve(REPO_ROOT, "third_party/A8E");
const BUILD_DIR = path.resolve(REPO_ROOT, "build/atarixl");

const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0A00;

// Result scratchpad
const ADDR_P1_STAT = 0x04D0;
const ADDR_P1_YREG = 0x04D1;
const ADDR_P2_STAT = 0x04D2;
const ADDR_P2_YREG = 0x04D3;
const ADDR_P3_STAT = 0x04D4;
const ADDR_P3_YREG = 0x04D5;
const ADDR_P4_STAT = 0x04D6;
const ADDR_P4_YREG = 0x04D7;

// The test ends in a `jmp @halt` infinite loop — we poll until all four phase
// status bytes are non-zero (or timeout).
const POLL_CHUNK    = 1_000_000;   // cycles per interval
const MAX_CHUNKS    = 60;          // 60 M cycles total ≈ ~33s at 1.77 MHz
const BOOT_TIMEOUT_MS = 30_000;

function hex2(v) {
  return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function phaseLabel(stat, yreg) {
  if (stat === 0x01) return "PASS (Y=$" + hex2(yreg) + ")";
  if (stat === 0xFF) return "FAIL (Y=$" + hex2(yreg) + ")";
  return "NOT REACHED";
}

async function main() {
  const xexPath  = path.join(BUILD_DIR, "siov_bridge_diag.xex");
  const diskPath = path.join(BUILD_DIR, "phase4_disk_test.atr");
  const osPath   = path.join(ROM_DIR,  "ATARIXL.ROM");
  const basPath  = path.join(ROM_DIR,  "ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      console.error("Run: make atarixl-siov-bridge-diag");
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

    // Set breakpoint at entry before starting so we can mount disk first
    await api.debug.setBreakpoints([ENTRY_PC]);
    console.log("Loading siov_bridge_diag.xex, waiting for entry at $" +
                ENTRY_PC.toString(16).toUpperCase() + "...");

    await api.dev.runXex({
      bytes:        xexData,
      name:         "siov_bridge_diag.xex",
      awaitEntry:   false,
      start:        true,
      resetOptions: { portB: 0xff },
    });

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

    // Mount the test disk then release the CPU
    await api.media.mountDisk(diskData, { name: "phase4_disk_test.atr", slot: 0 });
    console.log("Mounted " + path.basename(diskPath) + " in D1:");

    await api.debug.setBreakpoints([]);
    await api.system.start();

    // Poll until Phase 4 status is written (or all non-zero), or timeout
    console.log("Running up to " + (POLL_CHUNK * MAX_CHUNKS / 1e6).toFixed(0) +
                " M cycles for all phases to complete...");

    let p4stat = 0;
    let chunks = 0;
    for (; chunks < MAX_CHUNKS && p4stat === 0; chunks++) {
      const cycleResult = await api.system.waitForCycles({ count: POLL_CHUNK });
      p4stat = await api.debug.readMemory(ADDR_P4_STAT);
      // Also check if we're stuck before phase 4 (phase 3 failed = halts early)
      const p1stat = await api.debug.readMemory(ADDR_P1_STAT);
      const p2stat = await api.debug.readMemory(ADDR_P2_STAT);
      const p3stat = await api.debug.readMemory(ADDR_P3_STAT);
      process.stdout.write(
        "  chunk " + (chunks + 1) + "/" + MAX_CHUNKS +
        "  P1=$" + hex2(p1stat) +
        "  P2=$" + hex2(p2stat) +
        "  P3=$" + hex2(p3stat) +
        "  P4=$" + hex2(p4stat) + "\r"
      );
      if (cycleResult && !cycleResult.ok && cycleResult.reason !== "cycleCounter") break;
    }
    process.stdout.write("\n");

    await api.system.pause();

    const p1stat = await api.debug.readMemory(ADDR_P1_STAT);
    const p1yreg = await api.debug.readMemory(ADDR_P1_YREG);
    const p2stat = await api.debug.readMemory(ADDR_P2_STAT);
    const p2yreg = await api.debug.readMemory(ADDR_P2_YREG);
    const p3stat = await api.debug.readMemory(ADDR_P3_STAT);
    const p3yreg = await api.debug.readMemory(ADDR_P3_YREG);
    const p4yreg = await api.debug.readMemory(ADDR_P4_YREG);

    console.log("");
    console.log("=== SIO Bridge Diagnostic Results ===");
    console.log("Phase 1 (plain SIOV):                      " + phaseLabel(p1stat, p1yreg));
    console.log("Phase 2 (PORTB cycle + SIOV):              " + phaseLabel(p2stat, p2yreg));
    console.log("Phase 3 (bridge sim, no page-2 swap):      " + phaseLabel(p3stat, p3yreg));
    console.log("Phase 4 (bridge sim + page-2 swap):        " + phaseLabel(p4stat, p4yreg));
    console.log("");

    const allPass = p1stat === 0x01 && p2stat === 0x01 && p3stat === 0x01 && p4stat === 0x01;
    const anyNotReached = [p1stat, p2stat, p3stat, p4stat].some(s => s === 0x00);

    if (anyNotReached && !allPass) {
      // Find which phase stalled
      if (p1stat === 0x00) {
        console.log("TIMEOUT: Phase 1 SIOV never returned (total stall)");
      } else if (p2stat === 0x00) {
        console.log("TIMEOUT: Halted after Phase 1; Phase 2 never reached");
      } else if (p3stat === 0x00) {
        console.log("TIMEOUT: Halted after Phase 2; Phase 3 never reached (SIOV stalled in Phase 2)");
      } else {
        console.log("TIMEOUT: Halted after Phase 3; Phase 4 never reached (SIOV stalled in Phase 3)");
      }
      process.exit(2);
    }

    if (allPass) {
      console.log("ALL PHASES PASS — bridge sim does not stall SIOV in jsA8E isolation");
      process.exit(0);
    }

    // Report first failure
    const phases = [
      { n: 1, stat: p1stat, yreg: p1yreg, label: "plain SIOV" },
      { n: 2, stat: p2stat, yreg: p2yreg, label: "PORTB cycle + SIOV" },
      { n: 3, stat: p3stat, yreg: p3yreg, label: "bridge sim (no page-2 swap)" },
      { n: 4, stat: p4stat, yreg: p4yreg, label: "bridge sim + page-2 swap" },
    ];
    for (const ph of phases) {
      if (ph.stat === 0xFF) {
        console.log("FIRST FAILURE: Phase " + ph.n + " (" + ph.label + ") — Y=$" + hex2(ph.yreg));
        break;
      }
    }
    process.exit(1);

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
