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
const BUILD_DIR = path.resolve(REPO_ROOT, "build/atarixl");

const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;

const ADDR_STAGE   = 0x04eb;
const ADDR_STATUS  = 0x04ec;
const ADDR_ERROR   = 0x04ed;
const ADDR_RESULTS = 0x04ee;
const ADDR_DONE    = 0x04ef;
const ADDR_SAVEFILE_JMP = 0xc1ed;
const ADDR_BLKALLOC_JMP = 0xc1fc;
const ADDR_BLKALLOC_PTR = 0x900e;
const ADDR_STAGED_IRQ_SRC = 0x5211;
const ADDR_R2 = 0x84;
const ADDR_R4 = 0x88;
const ADDR_CUR_DIR_HEAD = 0x8200;
const ADDR_DBG_R2L = 0x04e4;
const ADDR_DBG_R2H = 0x04e5;
const ADDR_DBG_STEP = 0x04e6;
const ADDR_DIRCOUNT = 0x04f0;
const ADDR_DIRTYPE = 0x04f1;
const ADDR_DIRNAME0 = 0x04f2;
const ADDR_DIRNAME1 = 0x04f3;
const ADDR_DIRNAME2 = 0x04f4;
const ADDR_DIRNAME3 = 0x04f5;
const ADDR_PHASE4_SMALL_SRC = 0x6000;
const ADDR_PHASE4_SMALL_DST = 0x6400;
const PHASE4_SMALL_LEN = 600;

const PASS_ALL = 0x0f;

const POLL_CHUNK      = 2_000_000;   // cycles per interval
const MAX_CHUNKS      = 120;         // 240 M cycles ≈ ~135 s at 1.77 MHz
const BOOT_TIMEOUT_MS = 30_000;

function resolveInputPath(rawPath) {
  if (!rawPath) {
    return rawPath;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(REPO_ROOT, rawPath);
}

function parsePositiveInt(rawValue, optionName) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(optionName + " requires a positive integer");
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    xexPath: resolveInputPath("build/atarixl/phase4_disk_smoketest.xex"),
    diskPath: resolveInputPath("build/atarixl/phase4_disk_test.atr"),
    osPath: resolveInputPath("third_party/A8E/ATARIXL.ROM"),
    basicPath: resolveInputPath("third_party/A8E/ATARIBAS.ROM"),
    pollChunk: POLL_CHUNK,
    maxChunks: MAX_CHUNKS,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--xex") {
      i++;
      if (i >= argv.length) throw new Error("--xex requires a path");
      options.xexPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--disk") {
      i++;
      if (i >= argv.length) throw new Error("--disk requires a path");
      options.diskPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--os-rom") {
      i++;
      if (i >= argv.length) throw new Error("--os-rom requires a path");
      options.osPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--basic-rom") {
      i++;
      if (i >= argv.length) throw new Error("--basic-rom requires a path");
      options.basicPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--no-basic") {
      options.basicPath = "";
      continue;
    }
    if (arg === "--poll-cycles") {
      i++;
      if (i >= argv.length) throw new Error("--poll-cycles requires a value");
      options.pollChunk = parsePositiveInt(argv[i], "--poll-cycles");
      continue;
    }
    if (arg === "--max-chunks") {
      i++;
      if (i >= argv.length) throw new Error("--max-chunks requires a value");
      options.maxChunks = parsePositiveInt(argv[i], "--max-chunks");
      continue;
    }
    if (arg === "--boot-timeout-ms") {
      i++;
      if (i >= argv.length) throw new Error("--boot-timeout-ms requires a value");
      options.bootTimeoutMs = parsePositiveInt(argv[i], "--boot-timeout-ms");
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/phase4_disk_run.js [options]\n" +
        "  --disk <path>            ATR to mount as D1\n" +
        "  --xex <path>             smoketest XEX path\n" +
        "  --os-rom <path>          Atari XL OS ROM path\n" +
        "  --basic-rom <path>       Atari BASIC ROM path\n" +
        "  --no-basic               Skip loading BASIC ROM\n" +
        "  --poll-cycles <count>    Cycles per progress poll\n" +
        "  --max-chunks <count>     Poll iterations before timeout\n" +
        "  --boot-timeout-ms <ms>   Entry-breakpoint timeout"
      );
      process.exit(0);
    }
    throw new Error("Unknown option: " + arg);
  }

  return options;
}

function hex2(v) {
  return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(v) {
  return ((v & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function stageName(s) {
  const names = ["", "PRE_OPEN", "POST_OPEN", "PRE_SAVE", "POST_SAVE",
                 "PRE_FIND", "POST_FIND", "PRE_READ", "POST_READ"];
  return names[s] || ("$" + hex2(s));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const xexPath = options.xexPath;
  const diskPath = options.diskPath;
  const osPath = options.osPath;
  const basPath = options.basicPath;

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
      basic: basPath && fs.existsSync(basPath) ? basPath : undefined,
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
    console.log("Loading " + path.basename(xexPath) + ", waiting for entry at $" +
                ENTRY_PC.toString(16).toUpperCase() + "...");

    await api.dev.runXex({
      bytes:        xexData,
      name:         path.basename(xexPath),
      awaitEntry:   false,
      start:        true,
      resetOptions: { portB: 0xff },
    });

    const entryTimeout = options.bootTimeoutMs;
    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: entryTimeout });
    if (!entryEvent || !entryEvent.debugState) {
      console.error("FATAL: XEX did not reach entry breakpoint at $" +
                    ENTRY_PC.toString(16).toUpperCase() +
                    " within " + (entryTimeout / 1000) + "s");
      process.exit(3);
    }
    const ep = entryEvent.debugState;
    console.log("XEX reached entry: PC=$" +
                ep.pc.toString(16).toUpperCase().padStart(4, "0"));

    await api.media.mountDisk(diskData, { name: path.basename(diskPath), slot: 0 });
    console.log("Mounted " + path.basename(diskPath) + " as D1:");

    await api.debug.setBreakpoints([]);
    await api.system.start();

    const pollChunk = options.pollChunk;
    const maxChunks = options.maxChunks;
    console.log("Running up to " + (pollChunk * maxChunks / 1e6).toFixed(0) +
                " M cycles for PHASE4_DONE...");

    let done = 0;
    let chunks = 0;
    for (; chunks < maxChunks && done === 0; chunks++) {
      await api.system.waitForCycles({ count: pollChunk });
      done    = await api.debug.readMemory(ADDR_DONE);
      const stage  = await api.debug.readMemory(ADDR_STAGE);
      const status = await api.debug.readMemory(ADDR_STATUS);
      const error  = await api.debug.readMemory(ADDR_ERROR);
      const res    = await api.debug.readMemory(ADDR_RESULTS);
      process.stdout.write(
        "  chunk " + (chunks + 1) + "/" + maxChunks +
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
    const r2Lo = await api.debug.readMemory(ADDR_R2);
    const r2Hi = await api.debug.readMemory(ADDR_R2 + 1);
    const r4Lo = await api.debug.readMemory(ADDR_R4);
    const r4Hi = await api.debug.readMemory(ADDR_R4 + 1);
    const dbgR2Lo = await api.debug.readMemory(ADDR_DBG_R2L);
    const dbgR2Hi = await api.debug.readMemory(ADDR_DBG_R2H);
    const dbgStep = await api.debug.readMemory(ADDR_DBG_STEP);
    const dirCount = await api.debug.readMemory(ADDR_DIRCOUNT);
    const dirType = await api.debug.readMemory(ADDR_DIRTYPE);
    const dirName0 = await api.debug.readMemory(ADDR_DIRNAME0);
    const dirName1 = await api.debug.readMemory(ADDR_DIRNAME1);
    const dirName2 = await api.debug.readMemory(ADDR_DIRNAME2);
    const dirName3 = await api.debug.readMemory(ADDR_DIRNAME3);
    const curDirHead = await api.debug.readRange(ADDR_CUR_DIR_HEAD, 0x80);
    let bamFree = null;
    if (curDirHead && curDirHead.length >= 0x54) {
      let sum = 0;
      for (let track = 1; track <= 20; track++) {
        if (track === 18) {
          continue;
        }
        sum += curDirHead[4 + (track * 4)];
      }
      bamFree = sum;
    }

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
    console.log("R2=$" + hex4((r2Hi << 8) | r2Lo) + "  R4=$" + hex4((r4Hi << 8) | r4Lo));
    console.log("DBG_STEP=$" + hex2(dbgStep) + "  DBG_R2=$" + hex4((dbgR2Hi << 8) | dbgR2Lo));
    console.log("DIRCOUNT=" + dirCount +
                " DIRTYPE=$" + hex2(dirType) +
                " DIRNAME=" +
                String.fromCharCode(dirName0, dirName1, dirName2, dirName3));
    if (bamFree !== null) {
      console.log("curDirHead BAM free sum (tracks 1-20 excl 18): " + bamFree);
      const sig = String.fromCharCode.apply(
        null,
        Array.from(curDirHead.slice(0xAB, 0xAB + 11))
      ).replace(/\u0000/g, ".");
      console.log("curDirHead signature[OFF_GS_ID..+10]: " + sig);
    }
    console.log("");

    if (done === 0) {
      console.log("TIMEOUT — PHASE4_DONE never set after " +
                  (pollChunk * maxChunks / 1e6).toFixed(0) + " M cycles");
      console.log("Stalled at stage: " + stageName(stage));
      try {
        const dbg = await api.debug.getDebugState();
        const bank = await api.debug.getBankState();
        const saveJmp = await api.debug.readRange(ADDR_SAVEFILE_JMP, 3);
        const blkAllocJmp = await api.debug.readRange(ADDR_BLKALLOC_JMP, 3);
        const blkAllocPtr = await api.debug.readRange(ADDR_BLKALLOC_PTR, 2);
        const pcBytes = await api.debug.readRange(dbg.pc, 8);
        const stagedIrqSrcBytes = await api.debug.readRange(ADDR_STAGED_IRQ_SRC, 8);
        const irqVec = await api.debug.readRange(0xfffe, 2);
        const brkPage = await api.debug.readRange(0x0000, 8);
        const stackPage = await api.debug.readRange(0x0100, 0x100);
        let disasm = null;
        let saveTarget = null;
        let saveTargetBytes = null;
        let blkAllocTarget = null;
        let blkAllocTargetBytes = null;
        if (saveJmp && saveJmp.length === 3 && saveJmp[0] === 0x4c) {
          saveTarget = saveJmp[1] | (saveJmp[2] << 8);
          saveTargetBytes = await api.debug.readRange(saveTarget, 8);
        }
        console.log("DebugState: PC=$" + hex4(dbg.pc) +
                    " A=$" + hex2(dbg.a) +
                    " X=$" + hex2(dbg.x) +
                    " Y=$" + hex2(dbg.y) +
                    " SP=$" + hex2(dbg.sp) +
                    " reason=" + String(dbg.reason || ""));
        if (bank) {
          console.log("BankState: " + JSON.stringify(bank));
        }
        if (saveJmp && saveJmp.length === 3) {
          console.log("SaveFile JMP @ $C1ED: $" +
                      hex2(saveJmp[0]) + " $" + hex2(saveJmp[1]) + " $" + hex2(saveJmp[2]));
        }
        if (saveTarget !== null && saveTargetBytes && saveTargetBytes.length) {
          const targetHex = Array.from(saveTargetBytes)
            .map(function (b) { return "$" + hex2(b); })
            .join(" ");
          console.log("SaveFile target bytes @ $" + hex4(saveTarget) + ": " + targetHex);
        }
        if (blkAllocJmp && blkAllocJmp.length === 3) {
          console.log("BlkAlloc JMP @ $C1FC: $" +
                      hex2(blkAllocJmp[0]) + " $" + hex2(blkAllocJmp[1]) + " $" + hex2(blkAllocJmp[2]));
        }
        if (blkAllocPtr && blkAllocPtr.length === 2) {
          blkAllocTarget = blkAllocPtr[0] | (blkAllocPtr[1] << 8);
          blkAllocTargetBytes = await api.debug.readRange(blkAllocTarget, 8);
          console.log("BlkAlloc vector @ $900E: $" + hex4(blkAllocTarget));
        }
        if (blkAllocTarget !== null && blkAllocTargetBytes && blkAllocTargetBytes.length) {
          const blkHex = Array.from(blkAllocTargetBytes)
            .map(function (b) { return "$" + hex2(b); })
            .join(" ");
          console.log("BlkAlloc target bytes @ $" + hex4(blkAllocTarget) + ": " + blkHex);
        }
        if (pcBytes && pcBytes.length) {
          const pcHex = Array.from(pcBytes).map(function (b) { return "$" + hex2(b); }).join(" ");
          console.log("PC bytes @ $" + hex4(dbg.pc) + ": " + pcHex);
        }
        if (stagedIrqSrcBytes && stagedIrqSrcBytes.length) {
          const srcHex = Array.from(stagedIrqSrcBytes).map(function (b) { return "$" + hex2(b); }).join(" ");
          console.log("Staged IRQ src bytes @ $5211: " + srcHex);
        }
        if (irqVec && irqVec.length === 2) {
          const iv = irqVec[0] | (irqVec[1] << 8);
          console.log("IRQ/BRK vector @ $FFFE: $" + hex4(iv));
        }
        if (brkPage && brkPage.length) {
          const brkHex = Array.from(brkPage).map(function (b) { return "$" + hex2(b); }).join(" ");
          console.log("ZeroPage[0..7]: " + brkHex);
        }
        if (stackPage && stackPage.length === 0x100) {
          const top = [];
          const sp = dbg.sp & 0xff;
          for (let i = 0; i < 16; i++) {
            const off = (sp + 1 + i) & 0xff;
            top.push("$" + hex4(0x0100 + off) + "=$" + hex2(stackPage[off]));
          }
          console.log("StackTop: " + top.join(" "));
        }
        try {
          disasm = await api.debug.disassemble({ pc: dbg.pc, before: 3, after: 3 });
        } catch (disErr) {
          disasm = null;
        }
        if (disasm && Array.isArray(disasm.instructions)) {
          const lines = disasm.instructions.map(function (insn) {
            return "$" + hex4(insn.pc) + "  " +
              (insn.bytesHex || "").padEnd(11) + "  " + (insn.text || "");
          });
          if (lines.length) {
            console.log("Disasm:");
            for (const line of lines) {
              console.log("  " + line);
            }
          }
        }
      } catch (diagErr) {
        console.log("Diagnostics unavailable: " +
                    (diagErr && diagErr.message ? diagErr.message : String(diagErr)));
      }
      process.exit(2);
    }

    if ((results & PASS_ALL) === PASS_ALL) {
      console.log("ALL PASS — directory, read, write, and disk-full all verified.");
      process.exit(0);
    }

    if (error === 0x2e) {
      try {
        const src = await api.debug.readRange(ADDR_PHASE4_SMALL_SRC, PHASE4_SMALL_LEN);
        const dst = await api.debug.readRange(ADDR_PHASE4_SMALL_DST, PHASE4_SMALL_LEN);
        let mismatch = -1;
        for (let i = 0; i < PHASE4_SMALL_LEN; i++) {
          if (src[i] !== dst[i]) {
            mismatch = i;
            break;
          }
        }
        if (mismatch >= 0) {
          console.log("BYTE_DEC_ERR first mismatch @" + mismatch +
                      " src=$" + hex2(src[mismatch]) +
                      " dst=$" + hex2(dst[mismatch]));
          const previewLen = 16;
          const srcPreview = Array.from(src.slice(0, previewLen)).map(hex2).join(" ");
          const dstPreview = Array.from(dst.slice(0, previewLen)).map(hex2).join(" ");
          console.log("SRC[0.." + (previewLen - 1) + "]: " + srcPreview);
          console.log("DST[0.." + (previewLen - 1) + "]: " + dstPreview);
        } else {
          console.log("BYTE_DEC_ERR reported but source/destination buffers match over " +
                      PHASE4_SMALL_LEN + " bytes.");
        }
      } catch (cmpErr) {
        console.log("BYTE_DEC_ERR compare diagnostics unavailable: " +
                    (cmpErr && cmpErr.message ? cmpErr.message : String(cmpErr)));
      }
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
