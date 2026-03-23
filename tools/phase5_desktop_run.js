"use strict";

// Step 20 diagnostic runner for the Atari XL floppy/XEX desktop bootstrap path.
//
// Loads build/atarixl/phase5_desktop_bootstrap.xex, waits for entry at $0881,
// mounts build/atarixl/geos.atr as D1:, then polls a bootstrap status marker:
//   $04D0 PHASE5_STATUS
//
// Status markers:
//   $10 startup entered
//   $20 OS ROM disabled
//   $30 staged payload copied to runtime addresses
//   $40 hardware init complete
//   $50 GEOS core init complete
//   $60 EnterDeskTop entered
//   $70 DESK TOP file found and accepted
//   $80 StartAppl handoff reached
//   $82 Atari-native desktop is visibly painted
//   $81 Desktop smoke frame is visible (fallback path, not real DESK TOP app rendering)
//   $E1 desktop lookup/open path failed (for example missing DESK TOP on disk)
//
// Exit codes:
//   0  Bootstrap reached desktop handoff ($80), or smoke frame when explicitly allowed
//   1  Bootstrap reached EnterDeskTop but desktop load/render criteria were not met
//   2  TIMEOUT waiting for decisive status
//   3  Fatal (missing files / API errors)

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x0600;
const ADDR_ERROR_X = 0x0601;
const ADDR_SIO_Y = 0x0602;
const ADDR_SIO_DSTATS = 0x0603;
const ADDR_SIO_SECTOR_LO = 0x0604;
const ADDR_SIO_SECTOR_HI = 0x0605;
const ADDR_SIO_CMD = 0x0606;
const ADDR_SIO_RET_A = 0x0607;
const ADDR_DBG_DCB_DDEVIC = 0x0608;
const ADDR_DBG_DCB_DUNIT = 0x0609;
const ADDR_DBG_CURDRIVE = 0x060a;
const ADDR_DBG_CURDEVICE = 0x060b;
const ADDR_DBG_CURTYPE = 0x060c;
const ADDR_DBG_OD_STAGE = 0x060d;
const ADDR_SIO_BRIDGE = 0x0700;
const ADDR_SIO_BRIDGE_SAVED_SSKCTL = 0x07e5;
const ADDR_OS_SSKCTL_SHADOW = 0x0232;
const ADDR_POKEY_SKCTL = 0xd20f;
const ADDR_PORTB = 0xd301;
const ADDR_GETPTR_JUMP = 0xc298;
const ADDR_COPYFSTRING = 0xc268;
const ADDR_COPYFSTRING_IMPL = 0xa421;
const ADDR_GETPTR_IMPL = 0xc30e;
const ADDR_STAGE_COPYFSTRING = 0x3421;
const ADDR_DRV_OPEN_DISK = 0x9014;
const ADDR_DRV_NEW_DISK = 0x900c;
const ADDR_DRV_GET_DIR_HEAD = 0x901a;
const ADDR_VEC_NMI = 0xfffa;
const ADDR_VEC_RESET = 0xfffc;
const ADDR_VEC_IRQ = 0xfffe;
const ADDR_GEOS_R7 = 0x0090;
const ADDR_GEOS_FILEHEADER = 0x8100;
const ADDR_GEOS_APPMAIN = 0x849b;
const OFF_GHST_ADDR = 71;
const OFF_GHEND_ADDR = 73;
const OFF_GHST_VEC = 75;
const ADDR_ANTIC_DMACTL = 0xd400;
const ADDR_ANTIC_DLISTL = 0xd402;
const ADDR_ANTIC_DLISTH = 0xd403;
const ADDR_SCREEN_BASE = 0x4000;
const ADDR_BACK_SCR_BASE = 0x6000;
const ADDR_OS_SDMCTL = 0x022f;
const ADDR_OS_SDLSTL = 0x0230;
const ADDR_OS_SDLSTH = 0x0231;
const ADDR_GTIA_COLBK = 0xd01a;
const ADDR_NMI_ENABLE_MASK = 0x88ab;
const ADDR_NMIEN = 0xd40e;
const ADDR_A914 = 0xa914;
const ADDR_A000 = 0xa000;
const ADDR_APPMAIN_RAW = 0x849b;
const ADDR_USE_SYSTEM_FONT = 0xc14b;
const ADDR_GTIA_COLPF0 = 0xd016;
const ADDR_GTIA_COLPF1 = 0xd017;
const ADDR_GTIA_COLPF2 = 0xd018;
const ADDR_GTIA_COLPF3 = 0xd019;
const ADDR_INIT_RAM = 0xc181;
const ADDR_LOAD_CHAR_SET = 0xc1cc;
const GEOS_ZP_OFFSET = 0x7e;
const ADDR_FONT_CUR_INDEX_TABLE = 0x002a + GEOS_ZP_OFFSET;
const ADDR_FONT_CARD_DATA_PNTR = 0x002c + GEOS_ZP_OFFSET;
const POLL_CHUNK = 20_000;
const MAX_CHUNKS = 500;
const BOOT_TIMEOUT_MS = 30_000;
const FONT_WATCH_POLL_CHUNK = 50_000;

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
    xexPath: resolveInputPath("build/atarixl/phase5_desktop_bootstrap.xex"),
    diskPath: resolveInputPath("build/atarixl/geos.atr"),
    osPath: resolveInputPath("third_party/A8E/ATARIXL.ROM"),
    basicPath: resolveInputPath("third_party/A8E/ATARIBAS.ROM"),
    pollChunk: POLL_CHUNK,
    maxChunks: MAX_CHUNKS,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    postCycles: 0,
    allowSmokeFrame: false,
    nativeDesktop: false,
    screenshotPath: "",
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
    if (arg === "--post-cycles") {
      i++;
      if (i >= argv.length) throw new Error("--post-cycles requires a value");
      options.postCycles = parsePositiveInt(argv[i], "--post-cycles");
      continue;
    }
    if (arg === "--screenshot") {
      i++;
      if (i >= argv.length) throw new Error("--screenshot requires a path");
      options.screenshotPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--allow-smoke-frame") {
      options.allowSmokeFrame = true;
      continue;
    }
    if (arg === "--native-desktop") {
      options.nativeDesktop = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/phase5_desktop_run.js [options]\n" +
        "  --xex <path>             Bootstrap XEX path\n" +
        "  --disk <path>            ATR to mount as D1\n" +
        "  --os-rom <path>          Atari XL OS ROM path\n" +
        "  --basic-rom <path>       Atari BASIC ROM path\n" +
        "  --no-basic               Skip loading BASIC ROM\n" +
        "  --poll-cycles <count>    Cycles per progress poll\n" +
        "  --max-chunks <count>     Poll iterations before timeout\n" +
        "  --boot-timeout-ms <ms>   Entry-breakpoint timeout\n" +
        "  --post-cycles <count>    Extra cycles before pause/artifacts\n" +
        "  --allow-smoke-frame      Treat $81 smoke-frame fallback as success\n" +
        "  --native-desktop         Accept the Atari-native desktop handoff at $80\n" +
        "  --screenshot <path>      Save a PNG screenshot artifact"
      );
      process.exit(0);
    }
    throw new Error("Unknown option: " + arg);
  }

  return options;
}

function hex2(value) {
  return ((value & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(value) {
  return ((value & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function statusLabel(status) {
  switch (status & 0xff) {
    case 0x10: return "STARTUP";
    case 0x20: return "ROM_OFF";
    case 0x30: return "PAYLOAD_COPIED";
    case 0x40: return "HW_INIT_OK";
    case 0x50: return "CORE_INIT_OK";
    case 0x60: return "ENTER_DESKTOP";
    case 0x61: return "SET_DEVICE";
    case 0x62: return "OPEN_DISK";
    case 0x63: return "GET_FILE";
    case 0x6a: return "OPEN_DISK_RET";
    case 0x70: return "DESKTOP_FOUND";
    case 0x80: return "START_APPL";
    case 0x82: return "NATIVE_DESKTOP_VISIBLE";
    case 0x81: return "SMOKE_FRAME_VISIBLE";
    case 0xe1: return "DESKTOP_LOAD_FAILED";
    case 0xe2: return "OPEN_DISK_FAILED";
    case 0xe3: return "GET_FILE_FAILED";
    case 0xe4: return "DESKTOP_VER_A_FAILED";
    case 0xe5: return "DESKTOP_VER_B_FAILED";
    case 0x00: return "NONE";
    default: return "$" + hex2(status);
  }
}

async function readWord(api, addr) {
  const lo = await api.debug.readMemory(addr & 0xffff);
  const hi = await api.debug.readMemory((addr + 1) & 0xffff);
  return ((hi << 8) | lo) & 0xffff;
}

async function readBytes(api, addr, count) {
  const bytes = [];
  for (let i = 0; i < count; i++) {
    bytes.push(await api.debug.readMemory((addr + i) & 0xffff));
  }
  return bytes;
}

async function readFontPointers(api) {
  const curIdxL = await api.debug.readMemory(ADDR_FONT_CUR_INDEX_TABLE);
  const curIdxH = await api.debug.readMemory(ADDR_FONT_CUR_INDEX_TABLE + 1);
  const cardDataL = await api.debug.readMemory(ADDR_FONT_CARD_DATA_PNTR);
  const cardDataH = await api.debug.readMemory(ADDR_FONT_CARD_DATA_PNTR + 1);
  return {
    curIndexTable: ((curIdxH << 8) | curIdxL) & 0xffff,
    cardDataPntr: ((cardDataH << 8) | cardDataL) & 0xffff,
  };
}

function formatFontPointers(fontState) {
  if (!fontState) {
    return "curIndexTable=$???? cardDataPntr=$????";
  }
  return "curIndexTable=$" + hex4(fontState.curIndexTable) +
    " cardDataPntr=$" + hex4(fontState.cardDataPntr);
}

function formatInitRamEntries(bytes) {
  const parts = [];
  let i = 0;
  while (i + 2 < bytes.length) {
    const addr = bytes[i] | (bytes[i + 1] << 8);
    const count = bytes[i + 2] | 0;
    i += 3;
    if (addr === 0 && count === 0) {
      break;
    }
    const values = bytes.slice(i, i + count);
    parts.push(
      "$" + hex4(addr) + " len=" + count +
      " vals=" + values.map(hex2).join(" ")
    );
    i += count;
  }
  return parts;
}

function initRamTouchesFontPointers(bytes) {
  let i = 0;
  while (i + 2 < bytes.length) {
    const addr = bytes[i] | (bytes[i + 1] << 8);
    const count = bytes[i + 2] | 0;
    i += 3;
    if (addr === 0 && count === 0) {
      break;
    }
    if (count > 0) {
      const end = (addr + count - 1) & 0xffff;
      const touches =
        (addr <= ADDR_FONT_CUR_INDEX_TABLE && end >= ADDR_FONT_CUR_INDEX_TABLE) ||
        (addr <= ADDR_FONT_CUR_INDEX_TABLE + 1 && end >= ADDR_FONT_CUR_INDEX_TABLE + 1) ||
        (addr <= ADDR_FONT_CARD_DATA_PNTR && end >= ADDR_FONT_CARD_DATA_PNTR) ||
        (addr <= ADDR_FONT_CARD_DATA_PNTR + 1 && end >= ADDR_FONT_CARD_DATA_PNTR + 1);
      if (touches) return true;
    }
    i += count;
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.nativeDesktop && options.postCycles === 0) {
    options.postCycles = 20_000_000;
  }

  for (const [label, p] of [["XEX", options.xexPath], ["ATR", options.diskPath], ["OS ROM", options.osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      console.error("Run: make atarixl-desktop-bootstrap");
      process.exit(3);
    }
  }

  const runtime = await createHeadlessAutomation({
    roms: {
      os: options.osPath,
      basic: options.basicPath && fs.existsSync(options.basicPath) ? options.basicPath : undefined,
    },
    turbo: true,
    sioTurbo: false,
    frameDelayMs: 0,
  });

  try {
    const api = runtime.api;
    await api.whenReady();

    const xexData = new Uint8Array(fs.readFileSync(options.xexPath));
    const diskData = new Uint8Array(fs.readFileSync(options.diskPath));
    const fontWriteEvents = [];
    let fontWatchArmed = false;

    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({
      bytes: xexData,
      name: path.basename(options.xexPath),
      awaitEntry: false,
      start: true,
      resetOptions: { portB: 0xff },
    });

    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: options.bootTimeoutMs });
    if (!entryEvent || !entryEvent.debugState) {
      console.error("FATAL: XEX did not reach entry breakpoint at $" +
        ENTRY_PC.toString(16).toUpperCase() + " within " + (options.bootTimeoutMs / 1000) + "s");
      process.exit(3);
    }

    await api.media.mountDisk(diskData, { name: path.basename(options.diskPath), slot: 0 });
    await api.debug.setBreakpoints([]);
    if (runtime.app && typeof runtime.app.setMemoryWriteHook === "function") {
      runtime.app.setMemoryWriteHook(function (
        addr,
        value,
        cycleCounter,
        instructionCounter,
        pc,
        opcode,
        ctx
      ) {
        if (!fontWatchArmed) return;
        if (
          addr < ADDR_FONT_CUR_INDEX_TABLE ||
          addr > (ADDR_FONT_CARD_DATA_PNTR + 1) ||
          !ctx ||
          !ctx.ram
        ) {
          return;
        }
        const curIndexTable =
          (ctx.ram[ADDR_FONT_CUR_INDEX_TABLE] & 0xff) |
          ((ctx.ram[ADDR_FONT_CUR_INDEX_TABLE + 1] & 0xff) << 8);
        const cardDataPntr =
          (ctx.ram[ADDR_FONT_CARD_DATA_PNTR] & 0xff) |
          ((ctx.ram[ADDR_FONT_CARD_DATA_PNTR + 1] & 0xff) << 8);
        const pointerName =
          addr <= (ADDR_FONT_CUR_INDEX_TABLE + 1)
            ? "curIndexTable"
            : "cardDataPntr";
        const pointerValue =
          pointerName === "curIndexTable" ? curIndexTable : cardDataPntr;
        if (pointerValue !== 0) return;
        const pcBytes = [];
        const startPc = pc & 0xffff;
        for (let i = 0; i < 8; i++) {
          pcBytes.push(ctx.ram[(startPc + i) & 0xffff] & 0xff);
        }
        fontWriteEvents.push({
          addr: addr & 0xffff,
          value: value & 0xff,
          cycles: cycleCounter >>> 0,
          instructions: instructionCounter >>> 0,
          pc: pc >>> 0,
          opcode: opcode >>> 0,
          a: ctx.cpu ? ctx.cpu.a & 0xff : 0,
          x: ctx.cpu ? ctx.cpu.x & 0xff : 0,
          y: ctx.cpu ? ctx.cpu.y & 0xff : 0,
          sp: ctx.cpu ? ctx.cpu.sp & 0xff : 0,
          p: ctx.cpu ? (ctx.cpu.ps | 0x20) & 0xff : 0,
          pcBytes: pcBytes,
          pointerName: pointerName,
          pointerValue: pointerValue >>> 0,
        });
      });
    }
    await api.system.start();
    await api.debug.setBreakpoints([ADDR_USE_SYSTEM_FONT, ADDR_LOAD_CHAR_SET, ADDR_INIT_RAM]);

    let status = 0;
    let chunks = 0;
    let decisive = false;
    let fontWatchHit = null;
    let seenSystemFontLoad = false;
    let seenUseSystemFont = false;
    for (; chunks < options.maxChunks; chunks++) {
      await api.system.waitForCycles({ count: options.pollChunk });
      status = await api.debug.readMemory(ADDR_STATUS);
      const fontState = await readFontPointers(api);
      if (
        !fontWatchArmed &&
        (fontState.curIndexTable !== 0 || fontState.cardDataPntr !== 0)
      ) {
        fontWatchArmed = true;
        console.log(
          "Font watch armed: " + formatFontPointers(fontState)
        );
      }
      const debugNow = await api.debug.getDebugState();
      if (fontWriteEvents.length) {
        const event = fontWriteEvents.shift();
        fontWatchHit = {
          kind: "FontZero",
          chunk: chunks + 1,
          status: status,
          fontState: fontState,
          write: event,
          traceTail: await api.debug.getTraceTail(128),
        };
        decisive = true;
        break;
      }
      if (debugNow && debugNow.breakpointHit >= 0) {
        if (debugNow.breakpointHit === ADDR_USE_SYSTEM_FONT) {
          if (!seenUseSystemFont && (fontWatchArmed || status >= 0x70)) {
            seenUseSystemFont = true;
            console.log(
              "UseSystemFont hit: status=" + statusLabel(status) +
              " ($" + hex2(status) + ")"
            );
          }
          await api.system.start();
          continue;
        }
        if (debugNow.breakpointHit === ADDR_LOAD_CHAR_SET) {
          const r0addr = await readWord(api, 0x02 + GEOS_ZP_OFFSET);
          const sourceBytes = await readBytes(api, r0addr, 16);
          const isSystemFontLoad =
            r0addr === 0xd800 &&
            sourceBytes[0] === 0x06 &&
            sourceBytes[1] === 0x3c &&
            sourceBytes[2] === 0x00 &&
            sourceBytes[3] === 0x09;
          if (isSystemFontLoad && !seenSystemFontLoad) {
            seenSystemFontLoad = true;
            await api.system.start();
            continue;
          }
          fontWatchHit = {
            kind: "LoadCharSet",
            chunk: chunks + 1,
            status: status,
            pc: debugNow.pc,
            r0addr: r0addr,
            sourceBytes: sourceBytes,
            traceTail: await api.debug.getTraceTail(64),
          };
          console.log(
            "LoadCharSet hit: status=" + statusLabel(status) +
            " ($" + hex2(status) + ") r0=$" + hex4(r0addr) +
            " bytes=" + sourceBytes.map(hex2).join(" ")
          );
          decisive = true;
          break;
        }
        if (debugNow.breakpointHit === ADDR_INIT_RAM) {
          const tableAddr = await readWord(api, 0x02 + GEOS_ZP_OFFSET);
          const tableBytes = await readBytes(api, tableAddr, 256);
          console.log(
            "InitRam hit: status=" + statusLabel(status) +
            " ($" + hex2(status) + ") table=$" + hex4(tableAddr) +
            (initRamTouchesFontPointers(tableBytes) ? " [touches font pointers]" : "")
          );
          const initRamEntries = formatInitRamEntries(tableBytes);
          if (initRamEntries.length) {
            console.log("InitRam entries:");
            initRamEntries.forEach(function (entry, index) {
              console.log("  [" + index + "] " + entry);
            });
          }
          await api.system.start();
          continue;
        }
      }
      if (
        fontWatchArmed &&
        (fontState.curIndexTable === 0 || fontState.cardDataPntr === 0)
      ) {
        fontWatchHit = {
          kind: "FontZero",
          chunk: chunks + 1,
          status: status,
          fontState: fontState,
          traceTail: await api.debug.getTraceTail(128),
        };
        decisive = true;
        break;
      }
      process.stdout.write(
        "  chunk " + (chunks + 1) + "/" + options.maxChunks +
        "  status=" + statusLabel(status) +
        " ($" + hex2(status) + ")\r"
      );
      if (
        !fontWatchArmed &&
        (
          status === 0x80 ||
          status === 0xe1 ||
          status === 0xe2 ||
          status === 0xe3 ||
          status === 0xe4 ||
          status === 0xe5
        )
      ) {
        decisive = true;
        break;
      }
      if (options.nativeDesktop && status >= 0x80 && status <= 0x82) {
        decisive = true;
        break;
      }
      if (options.allowSmokeFrame && status === 0x81) {
        decisive = true;
        break;
      }
    }
    process.stdout.write("\n");

    if (!fontWatchHit && decisive && options.postCycles > 0) {
      await api.system.start();
      const wfcResult = await api.system.waitForCycles({ count: options.postCycles });
      if (wfcResult && !wfcResult.ok) {
        console.log("Post-cycle fault: reason=" + wfcResult.reason +
          " delta=" + wfcResult.delta);
      }
      await api.system.pause();
      const postEndStatus = await api.debug.readMemory(ADDR_STATUS);
      if (postEndStatus >= 0x82) status = postEndStatus;
    }

    if (options.nativeDesktop) {
      await api.system.start();
      await api.system.waitForCycles({ count: options.pollChunk });
    }
    await api.system.pause();
    const debugState = await api.debug.getDebugState();
    const bankState = await api.debug.getBankState();
    const openDiskVec = await readWord(api, ADDR_DRV_OPEN_DISK);
    const newDiskVec = await readWord(api, ADDR_DRV_NEW_DISK);
    const getDirHeadVec = await readWord(api, ADDR_DRV_GET_DIR_HEAD);
    const nmiVec = await readWord(api, ADDR_VEC_NMI);
    const resetVec = await readWord(api, ADDR_VEC_RESET);
    const irqVec = await readWord(api, ADDR_VEC_IRQ);
    const pcBytes = debugState ? await readBytes(api, debugState.pc, 8) : [];
    const stackTop = await readBytes(api, 0x01f0, 16);
    const errorX = await api.debug.readMemory(ADDR_ERROR_X);
    const sioY = await api.debug.readMemory(ADDR_SIO_Y);
    const sioDstats = await api.debug.readMemory(ADDR_SIO_DSTATS);
    const sioSectorLo = await api.debug.readMemory(ADDR_SIO_SECTOR_LO);
    const sioSectorHi = await api.debug.readMemory(ADDR_SIO_SECTOR_HI);
    const sioCmd = await api.debug.readMemory(ADDR_SIO_CMD);
    const sioRetA = await api.debug.readMemory(ADDR_SIO_RET_A);
    const dcbDevic = await api.debug.readMemory(ADDR_DBG_DCB_DDEVIC);
    const dcbUnit = await api.debug.readMemory(ADDR_DBG_DCB_DUNIT);
    const curDriveDbg = await api.debug.readMemory(ADDR_DBG_CURDRIVE);
    const curDeviceDbg = await api.debug.readMemory(ADDR_DBG_CURDEVICE);
    const curTypeDbg = await api.debug.readMemory(ADDR_DBG_CURTYPE);
    const openDiskStage = await api.debug.readMemory(ADDR_DBG_OD_STAGE);
    const bridgeBytes = await readBytes(api, ADDR_SIO_BRIDGE, 8);
    const savedSskctl = await api.debug.readMemory(ADDR_SIO_BRIDGE_SAVED_SSKCTL);
    const osSskctl = await api.debug.readMemory(ADDR_OS_SSKCTL_SHADOW);
    const pokeySkctl = await api.debug.readMemory(ADDR_POKEY_SKCTL);
    const portb = await api.debug.readMemory(ADDR_PORTB);
    const getPtrBytes = await readBytes(api, ADDR_GETPTR_JUMP, 3);
    const copyFStringBytes = await readBytes(api, ADDR_COPYFSTRING, 8);
    const copyFStringImplBytes = await readBytes(api, ADDR_COPYFSTRING_IMPL, 8);
    const getPtrImplBytes = await readBytes(api, ADDR_GETPTR_IMPL, 8);
    const stageCopyFStringBytes = await readBytes(api, ADDR_STAGE_COPYFSTRING, 8);
    const geosR7 = await readWord(api, ADDR_GEOS_R7);
    const geosAppMain = await readWord(api, ADDR_GEOS_APPMAIN);
    const geosStart = await readWord(api, ADDR_GEOS_FILEHEADER + OFF_GHST_ADDR);
    const geosEnd = await readWord(api, ADDR_GEOS_FILEHEADER + OFF_GHEND_ADDR);
    const geosVec = await readWord(api, ADDR_GEOS_FILEHEADER + OFF_GHST_VEC);
    const geosHdr0 = await readBytes(api, ADDR_GEOS_FILEHEADER, 8);
    const geosHdr64 = await readBytes(api, ADDR_GEOS_FILEHEADER + 64, 24);
    const startBytes = await readBytes(api, geosStart, 8);
    const vecBytes = await readBytes(api, geosVec, 8);
    const dmactl = await api.debug.readMemory(ADDR_ANTIC_DMACTL);
    const dlist = await readWord(api, ADDR_ANTIC_DLISTL);
    const sdmctl = await api.debug.readMemory(ADDR_OS_SDMCTL);
    const sdlst = await readWord(api, ADDR_OS_SDLSTL);
    const nmiEnableMask = await api.debug.readMemory(ADDR_NMI_ENABLE_MASK);
    const nmien = await api.debug.readMemory(ADDR_NMIEN);
    const a914bytes = await readBytes(api, ADDR_A914, 8);
    const a000bytes = await readBytes(api, ADDR_A000, 16);
    const appMainRawBytes = await readBytes(api, ADDR_APPMAIN_RAW, 4);
    const screenBytes = await readBytes(api, ADDR_SCREEN_BASE, 16);
    const backScreenBytes = await readBytes(api, ADDR_BACK_SCR_BASE, 16);
    // GEOS zero-page font pointers and BitmapUp state
    const r0L = await api.debug.readMemory(0x02 + GEOS_ZP_OFFSET);
    const r0H = await api.debug.readMemory(0x03 + GEOS_ZP_OFFSET);
    const r3L = await api.debug.readMemory(0x08 + GEOS_ZP_OFFSET);
    const r3H = await api.debug.readMemory(0x09 + GEOS_ZP_OFFSET);
    const r9H = await api.debug.readMemory(0x15 + GEOS_ZP_OFFSET);
    const r14L = await api.debug.readMemory(0x1e + GEOS_ZP_OFFSET);
    const r14H = await api.debug.readMemory(0x1f + GEOS_ZP_OFFSET);
    const r0addr = (r0H << 8) | r0L;
    const r14addr = (r14H << 8) | r14L;
    const r0bytes = await readBytes(api, r0addr, 16);
    const r14bytes = await readBytes(api, r14addr, 4);
    // BSWFont lives at KERNAL_HI $D800 — read its first 8 header bytes
    const bswfontHdr = await readBytes(api, 0xd800, 8);
    const colbk = await api.debug.readMemory(ADDR_GTIA_COLBK);
    const colpf0 = await api.debug.readMemory(ADDR_GTIA_COLPF0);
    const colpf1 = await api.debug.readMemory(ADDR_GTIA_COLPF1);
    const colpf2 = await api.debug.readMemory(ADDR_GTIA_COLPF2);
    const colpf3 = await api.debug.readMemory(ADDR_GTIA_COLPF3);
    const finalFontState = await readFontPointers(api);
    const recentTraceTail = await api.debug.getTraceTail(128);
    const fontTraceTail = fontWatchHit ? recentTraceTail : [];

    console.log("");
    console.log("=== Phase 5 Desktop Bootstrap Status ===");
    console.log("PHASE5_STATUS: " + statusLabel(status) + " ($" + hex2(status) + ")");
    if (debugState) {
      console.log("PC=$" + hex4(debugState.pc) +
        " A=$" + hex2(debugState.a) +
        " X=$" + hex2(debugState.x) +
        " Y=$" + hex2(debugState.y) +
        " SP=$" + hex2(debugState.sp));
      console.log("PC bytes: " + pcBytes.map(hex2).join(" "));
    }
    console.log("Driver vectors: OpenDisk=$" + hex4(openDiskVec) +
      " NewDisk=$" + hex4(newDiskVec) +
      " GetDirHead=$" + hex4(getDirHeadVec));
    console.log("ROM-off vectors: NMI=$" + hex4(nmiVec) +
      " RESET=$" + hex4(resetVec) +
      " IRQ=$" + hex4(irqVec));
    console.log("OpenDisk X=$" + hex2(errorX) +
      " SIO cmd=$" + hex2(sioCmd) +
      " sec=$" + hex4((sioSectorHi << 8) | sioSectorLo) +
      " DSTATS=$" + hex2(sioDstats) +
      " Y=$" + hex2(sioY) +
      " Aret=$" + hex2(sioRetA));
    console.log("DCB DDEVIC=$" + hex2(dcbDevic) + " DUNIT=$" + hex2(dcbUnit));
    console.log("curDrive=$" + hex2(curDriveDbg) + " curDevice=$" + hex2(curDeviceDbg) + " curType=$" + hex2(curTypeDbg));
    console.log("OpenDisk stage=$" + hex2(openDiskStage));
    console.log("SIO bridge @$" + hex4(ADDR_SIO_BRIDGE) + ": " + bridgeBytes.map(hex2).join(" "));
    console.log("SSKCTL saved=$" + hex2(savedSskctl) + " OS=$" + hex2(osSskctl) + " POKEY=$" + hex2(pokeySkctl));
    console.log("PORTB=$" + hex2(portb) + " GetPtrCurDkNm JMP bytes: " + getPtrBytes.map(hex2).join(" "));
    console.log("CopyFString @C268: " + copyFStringBytes.map(hex2).join(" "));
    console.log("CopyFString impl @A421: " + copyFStringImplBytes.map(hex2).join(" "));
    console.log("Staged CopyFString @3421: " + stageCopyFStringBytes.map(hex2).join(" "));
    console.log("GetPtrCurDkNm impl @C30E: " + getPtrImplBytes.map(hex2).join(" "));
    console.log("GEOS file header: start=$" + hex4(geosStart) +
      " end=$" + hex4(geosEnd) +
      " vec=$" + hex4(geosVec) +
      " r7=$" + hex4(geosR7) +
      " appMain=$" + hex4(geosAppMain));
    if (bankState) {
      console.log("BankState: " + JSON.stringify(bankState));
    }
    console.log("GEOS header [00..07]: " + geosHdr0.map(hex2).join(" "));
    console.log("GEOS header [40..57]: " + geosHdr64.map(hex2).join(" "));
    console.log("GEOS start bytes: " + startBytes.map(hex2).join(" "));
    console.log("GEOS vec bytes:   " + vecBytes.map(hex2).join(" "));
    console.log("nmiEnableMask=$" + hex2(nmiEnableMask) + " NMIEN=$" + hex2(nmien) + " @A914: " + a914bytes.map(hex2).join(" "));
    console.log("@A000 (KERNAL_MID/DESK_TOP?): " + a000bytes.map(hex2).join(" "));
    console.log("appMain raw bytes @$849B: " + appMainRawBytes.map(hex2).join(" ") + " (word=$" + hex4((appMainRawBytes[1] << 8) | appMainRawBytes[0]) + ")");
    console.log("SCREEN_BASE @$4000: " + screenBytes.map(hex2).join(" "));
    console.log("BACK_SCR_BASE @$6000: " + backScreenBytes.map(hex2).join(" "));
    // Extra screen memory reads for checkerboard/icon verification
    const screenRow16 = await readBytes(api, ADDR_SCREEN_BASE + 16 * 40, 16);
    const screenRow17 = await readBytes(api, ADDR_SCREEN_BASE + 17 * 40, 16);
    const screenRow48 = await readBytes(api, ADDR_SCREEN_BASE + 48 * 40, 16);
    const screenRow184 = await readBytes(api, ADDR_SCREEN_BASE + 184 * 40, 16);
    const screenRow183 = await readBytes(api, ADDR_SCREEN_BASE + 183 * 40, 16);
    const screenRow185 = await readBytes(api, ADDR_SCREEN_BASE + 185 * 40, 16);
    const backRow184 = await readBytes(api, ADDR_BACK_SCR_BASE + 184 * 40, 16);
    const phase5Status = await api.debug.readMemory(ADDR_STATUS);
    const paintedByte = await api.debug.readMemory(0x0401);
    const r0val = await readWord(api, 0x02 + GEOS_ZP_OFFSET);
    const r1val = await readWord(api, 0x04 + GEOS_ZP_OFFSET);
    console.log("Screen row16 @$4280: " + screenRow16.map(hex2).join(" ") + " (expect checkerboard $55/$AA)");
    console.log("Screen row17 @$42A8: " + screenRow17.map(hex2).join(" ") + " (expect checkerboard $AA/$55)");
    console.log("Screen row48 @$4780: " + screenRow48.map(hex2).join(" ") + " (expect icon area)");
    console.log("Screen row183 @$5C98: " + screenRow183.map(hex2).join(" ") + " (last checkerboard row)");
    console.log("Screen row184 @$5CC0: " + screenRow184.map(hex2).join(" ") + " (expect black $00 bottom bar)");
    console.log("Screen row185 @$5CE8: " + screenRow185.map(hex2).join(" ") + " (expect black $00)");
    console.log("Back  row184 @$7CC0: " + backRow184.map(hex2).join(" ") + " (back buffer, expect $00)");
    console.log("Final PHASE5_STATUS=$" + hex2(phase5Status) + " painted=$" + hex2(paintedByte) + " r0=$" + hex4(r0val) + " r1=$" + hex4(r1val));
    console.log("BitmapUp: r0=$" + hex4(r0addr) + " r3L=$" + hex2(r3L) + " r3H=$" + hex2(r3H) + " r9H=$" + hex2(r9H) + " r14=$" + hex4(r14addr));
    console.log("r0 data: " + r0bytes.map(hex2).join(" "));
    console.log("r14 vec: " + r14bytes.map(hex2).join(" "));
    console.log("Font: " + formatFontPointers(finalFontState));
    console.log("BSWFont hdr @$D800: " + bswfontHdr.map(hex2).join(" ") + " (expected 06 3C 00 09 08 00 CC 00)");
    console.log("Display regs: DMACTL=$" + hex2(dmactl) +
      " DLIST=$" + hex4(dlist) +
      " SDMCTL=$" + hex2(sdmctl) +
      " SDLST=$" + hex4(sdlst) +
      " (use SDLST as authoritative in jsA8E)");
    console.log("Colors: COLBK=$" + hex2(colbk) +
      " PF0=$" + hex2(colpf0) +
      " PF1=$" + hex2(colpf1) +
      " PF2=$" + hex2(colpf2) +
      " PF3=$" + hex2(colpf3));
    console.log("Stack $01F0-$01FF: " + stackTop.map(hex2).join(" "));
    if (!fontWatchHit && recentTraceTail.length) {
      console.log("Recent trace:");
      recentTraceTail.forEach(function (entry, index) {
        console.log(
          "  [" + index + "] PC=$" + hex4(entry.pc) +
          " A=$" + hex2(entry.a) +
          " X=$" + hex2(entry.x) +
          " Y=$" + hex2(entry.y) +
          " SP=$" + hex2(entry.sp) +
          " P=$" + hex2(entry.p) +
          " CYC=" + entry.cycles
        );
      });
    }
    if (fontWatchHit) {
      console.log("");
      console.log(
        "FONT WATCH HIT: chunk " + fontWatchHit.chunk +
        " status=" + statusLabel(fontWatchHit.status) +
        " ($" + hex2(fontWatchHit.status) + ") " +
        formatFontPointers(fontWatchHit.fontState)
      );
      if (debugState) {
        console.log(
          "Watch PC=$" + hex4(debugState.pc) +
          " A=$" + hex2(debugState.a) +
          " X=$" + hex2(debugState.x) +
          " Y=$" + hex2(debugState.y) +
          " SP=$" + hex2(debugState.sp)
        );
      }
      if (fontTraceTail.length) {
        console.log("Recent trace:");
        fontTraceTail.forEach(function (entry, index) {
          console.log(
            "  [" + index + "] PC=$" + hex4(entry.pc) +
            " A=$" + hex2(entry.a) +
            " X=$" + hex2(entry.x) +
            " Y=$" + hex2(entry.y) +
            " SP=$" + hex2(entry.sp) +
            " P=$" + hex2(entry.p) +
            " CYC=" + entry.cycles
          );
        });
      }
    }
    if (fontWatchHit && fontWatchHit.kind === "FontZero" && fontWatchHit.write) {
      console.log("");
      console.log(
        "FONT ZERO WRITE: chunk " + fontWatchHit.chunk +
        " status=" + statusLabel(fontWatchHit.status) +
        " ($" + hex2(fontWatchHit.status) + ") " +
        formatFontPointers(fontWatchHit.fontState)
      );
      console.log(
        "  $" + hex4(fontWatchHit.write.addr) +
        " <- $" + hex2(fontWatchHit.write.value) +
        " pointer=" + fontWatchHit.write.pointerName +
        " value=$" + hex4(fontWatchHit.write.pointerValue) +
        " cycles=" + fontWatchHit.write.cycles +
        " instr=" + fontWatchHit.write.instructions +
        " PC=$" + hex4(fontWatchHit.write.pc) +
        " opcode=$" + hex2(fontWatchHit.write.opcode)
      );
      console.log(
        "  CPU A=$" + hex2(fontWatchHit.write.a) +
        " X=$" + hex2(fontWatchHit.write.x) +
        " Y=$" + hex2(fontWatchHit.write.y) +
        " SP=$" + hex2(fontWatchHit.write.sp) +
        " P=$" + hex2(fontWatchHit.write.p) +
        " bytes=" + fontWatchHit.write.pcBytes.map(hex2).join(" ")
      );
      if (debugState) {
        console.log(
          "Watch PC=$" + hex4(debugState.pc) +
          " A=$" + hex2(debugState.a) +
          " X=$" + hex2(debugState.x) +
          " Y=$" + hex2(debugState.y) +
          " SP=$" + hex2(debugState.sp)
        );
      }
      if (fontWatchHit.traceTail && fontWatchHit.traceTail.length) {
        console.log("Recent trace:");
        fontWatchHit.traceTail.forEach(function (entry, index) {
          console.log(
            "  [" + index + "] PC=$" + hex4(entry.pc) +
            " A=$" + hex2(entry.a) +
            " X=$" + hex2(entry.x) +
            " Y=$" + hex2(entry.y) +
            " SP=$" + hex2(entry.sp) +
            " P=$" + hex2(entry.p) +
            " CYC=" + entry.cycles
          );
        });
      }
    }
    if (fontWatchHit && fontWatchHit.pc) {
      console.log("");
      console.log(
        fontWatchHit.kind + " trap: chunk " + fontWatchHit.chunk +
        " status=" + statusLabel(fontWatchHit.status) +
        " ($" + hex2(fontWatchHit.status) + ") PC=$" + hex4(fontWatchHit.pc) +
        " r0=$" + hex4(fontWatchHit.r0addr) +
        " bytes=" + fontWatchHit.sourceBytes.map(hex2).join(" ")
      );
      if (fontWatchHit.kind === "InitRam") {
        const initRamEntries = formatInitRamEntries(fontWatchHit.sourceBytes);
        if (initRamEntries.length) {
          console.log("InitRam entries:");
          initRamEntries.forEach(function (entry, index) {
            console.log("  [" + index + "] " + entry);
          });
        }
      }
      if (fontWatchHit.traceTail && fontWatchHit.traceTail.length) {
        console.log("Recent trace:");
        fontWatchHit.traceTail.forEach(function (entry, index) {
          console.log(
            "  [" + index + "] PC=$" + hex4(entry.pc) +
            " A=$" + hex2(entry.a) +
            " X=$" + hex2(entry.x) +
            " Y=$" + hex2(entry.y) +
            " SP=$" + hex2(entry.sp) +
            " P=$" + hex2(entry.p) +
            " CYC=" + entry.cycles
          );
        });
      }
    }
    if (
      fontWatchHit &&
      fontWatchHit.kind !== "FontZero" &&
      !fontWatchHit.pc &&
      fontWatchHit.traceTail &&
      fontWatchHit.traceTail.length
    ) {
      console.log("");
      console.log(
        "FONT ZERO: chunk " + fontWatchHit.chunk +
        " status=" + statusLabel(fontWatchHit.status) +
        " ($" + hex2(fontWatchHit.status) + ") " +
        formatFontPointers(fontWatchHit.fontState)
      );
      console.log("Recent trace:");
      fontWatchHit.traceTail.forEach(function (entry, index) {
        console.log(
          "  [" + index + "] PC=$" + hex4(entry.pc) +
          " A=$" + hex2(entry.a) +
          " X=$" + hex2(entry.x) +
          " Y=$" + hex2(entry.y) +
          " SP=$" + hex2(entry.sp) +
          " P=$" + hex2(entry.p) +
          " CYC=" + entry.cycles
        );
      });
    }
    console.log("");

    // Post-cycle status and screen memory verification
    {
      const postStatus = await api.debug.readMemory(ADDR_STATUS);
      const row48post = await readBytes(api, 0x4780, 16);
      const row184post = await readBytes(api, 0x5CC0, 16);
      console.log("Post-cycle PHASE5_STATUS=$" + hex2(postStatus) +
        " row48=" + row48post.map(hex2).join(" ") +
        " row184=" + row184post.map(hex2).join(" "));
      if (postStatus >= 0x82) status = postStatus;
    }

    if (options.screenshotPath) {
      const shot = await api.artifacts.captureScreenshot();
      const png = Buffer.from(shot.base64 || "", "base64");
      fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
      fs.writeFileSync(options.screenshotPath, png);
      console.log("Saved screenshot: " + options.screenshotPath +
        " (" + ((shot.width | 0) + "x" + (shot.height | 0)) + ")");
      console.log("");
    }

    if (!decisive) {
      console.log("TIMEOUT — bootstrap did not reach a decisive desktop status.");
      process.exit(2);
    }

    if (status >= 0xe1 && status <= 0xe5) {
      console.log("Bootstrap reached EnterDeskTop but desktop load failed.");
      console.log("Most common cause: ATR does not contain a compatible DESK TOP file.");
      process.exit(1);
    }

    if (status === 0x81) {
      if (options.nativeDesktop) {
        console.log("Native desktop paint in progress ($81) — blitter not yet complete.");
        console.log("Consider increasing --post-cycles if $82 is not reached.");
      } else if (!options.allowSmokeFrame) {
        console.log("Reached smoke-frame fallback ($81), not real desktop app rendering.");
        console.log("Run with --allow-smoke-frame only for bootstrap diagnostics.");
        process.exit(1);
      } else {
        console.log("Bootstrap reached visible desktop smoke-frame fallback.");
      }
    }
    if (status === 0x82) {
      if (!options.nativeDesktop) {
        console.log("Reached native-desktop visible marker ($82) without --native-desktop.");
        process.exit(1);
      }
      console.log("Bootstrap reached visible Atari-native desktop.");
    }
    if (status === 0x80) {
      console.log("Bootstrap reached desktop handoff status.");
      if (options.nativeDesktop) {
        console.log("Native Atari desktop handoff accepted; waiting for desktop render.");
      }
    }
    if (fontWatchHit) {
      console.log("Font pointer zeroed during desktop handoff; inspect trace above.");
      process.exit(1);
    }
    process.exit(0);
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
