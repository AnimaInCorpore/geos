"use strict";

// Step 17 headless runner for the Phase 4 disk smoketest.
//
// Loads build/atarixl/phase4_disk_smoketest.xex, waits for the $0881 entry
// breakpoint, mounts build/atarixl/phase4_disk_test.atr as D1:, then resumes
// and polls the PHASE4_* marker bytes until PHASE4_DONE is set or timeout.
//
// Result layout:
//   $04EB  PHASE4_STAGE    current stage number (1-8)
//   $04EC  PHASE4_STATUS   last status byte from GEOS routines
//   $04ED  PHASE4_ERROR    X register at SmokeFail (error code)
//   $04EE  PHASE4_RESULTS  pass bits (b0=dir b1=read b2=write b3=full)
//   $04EF  PHASE4_DONE     $FF = done (pass or fail)
//
// Exit codes:
//   0  PHASE4_DONE=$FF and PHASE4_RESULTS=$0F (all four sub-tests pass)
//   1  PHASE4_DONE=$FF but results incomplete (see PHASE4_ERROR)
//   2  TIMEOUT — PHASE4_DONE never set
//   3  Fatal (exception / missing file)

const fs   = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const ROM_DIR   = path.resolve(REPO_ROOT, "third_party/A8E");
const BUILD_DIR = path.resolve(REPO_ROOT, "build/atarixl");

const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;

const ADDR_STAGE   = 0x04eb;
const ADDR_STATUS  = 0x04ec;
const ADDR_ERROR   = 0x04ed;
const ADDR_RESULTS = 0x04ee;
const ADDR_DONE    = 0x04ef;

const PASS_ALL = 0x0f;

const POLL_CHUNK      = 2_000_000;   // cycles per interval
const MAX_CHUNKS      = 120;         // 240 M cycles ≈ ~135 s at 1.77 MHz
const BOOT_TIMEOUT_MS = 30_000;

function hex2(v) {
  return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function stageName(s) {
  const names = ["", "PRE_OPEN", "POST_OPEN", "PRE_SAVE", "POST_SAVE",
                 "PRE_FIND", "POST_FIND", "PRE_READ", "POST_READ"];
  return names[s] || ("$" + hex2(s));
}

async function main() {
  const xexPath  = path.join(BUILD_DIR, "phase4_disk_smoketest.xex");
  const diskPath = path.join(BUILD_DIR, "phase4_disk_test.atr");
  const osPath   = path.join(ROM_DIR,  "ATARIXL.ROM");
  const basPath  = path.join(ROM_DIR,  "ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      console.error("Run: make atarixl-disk-smoketest");
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

    await api.debug.setBreakpoints([ENTRY_PC]);
    console.log("Loading phase4_disk_smoketest.xex, waiting for entry at $" +
                ENTRY_PC.toString(16).toUpperCase() + "...");

    await api.dev.runXex({
      bytes:        xexData,
      name:         "phase4_disk_smoketest.xex",
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

    await api.media.mountDisk(diskData, { name: "phase4_disk_test.atr", slot: 0 });
    console.log("Mounted " + path.basename(diskPath) + " as D1:");

    await api.debug.setBreakpoints([]);
    await api.system.start();

    console.log("Running up to " + (POLL_CHUNK * MAX_CHUNKS / 1e6).toFixed(0) +
                " M cycles for PHASE4_DONE...");

    let done = 0;
    let chunks = 0;
    for (; chunks < MAX_CHUNKS && done === 0; chunks++) {
      await api.system.waitForCycles({ count: POLL_CHUNK });
      done    = await api.debug.readMemory(ADDR_DONE);
      const stage  = await api.debug.readMemory(ADDR_STAGE);
      const status = await api.debug.readMemory(ADDR_STATUS);
      const error  = await api.debug.readMemory(ADDR_ERROR);
      const res    = await api.debug.readMemory(ADDR_RESULTS);
      process.stdout.write(
        "  chunk " + (chunks + 1) + "/" + MAX_CHUNKS +
        "  stage=" + stageName(stage) +
        "  status=$" + hex2(status) +
        "  error=$" + hex2(error) +
        "  results=$" + hex2(res) +
        "  done=$" + hex2(done) + "\r"
      );
    }
    process.stdout.write("\n");

    await api.system.pause();

    const stage   = await api.debug.readMemory(ADDR_STAGE);
    const status  = await api.debug.readMemory(ADDR_STATUS);
    const error   = await api.debug.readMemory(ADDR_ERROR);
    const results = await api.debug.readMemory(ADDR_RESULTS);

    console.log("");
    console.log("=== Phase 4 Disk Smoketest Results ===");
    console.log("PHASE4_STAGE:   " + stageName(stage) + " ($" + hex2(stage) + ")");
    console.log("PHASE4_STATUS:  $" + hex2(status));
    console.log("PHASE4_ERROR:   $" + hex2(error));
    console.log("PHASE4_RESULTS: $" + hex2(results) +
                " (dir=" + ((results >> 0) & 1) +
                " read=" + ((results >> 1) & 1) +
                " write=" + ((results >> 2) & 1) +
                " full=" + ((results >> 3) & 1) + ")");
    console.log("PHASE4_DONE:    $" + hex2(done));
    console.log("");

    if (done === 0) {
      console.log("TIMEOUT — PHASE4_DONE never set after " +
                  (POLL_CHUNK * MAX_CHUNKS / 1e6).toFixed(0) + " M cycles");
      console.log("Stalled at stage: " + stageName(stage));
      process.exit(2);
    }

    if ((results & PASS_ALL) === PASS_ALL) {
      console.log("ALL PASS — directory, read, write, and disk-full all verified.");
      process.exit(0);
    }

    const missing = [];
    if (!(results & 0x01)) missing.push("directory");
    if (!(results & 0x02)) missing.push("read");
    if (!(results & 0x04)) missing.push("write");
    if (!(results & 0x08)) missing.push("disk-full");
    console.log("INCOMPLETE — missing: " + missing.join(", "));
    console.log("Failed at stage: " + stageName(stage) + "  error=$" + hex2(error));
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
