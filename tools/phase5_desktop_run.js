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
const ADDR_STATUS = 0x04d0;
const ADDR_ERROR_X = 0x04d1;
const ADDR_SIO_Y = 0x04d2;
const ADDR_SIO_DSTATS = 0x04d3;
const ADDR_SIO_SECTOR_LO = 0x04d4;
const ADDR_SIO_SECTOR_HI = 0x04d5;
const ADDR_SIO_CMD = 0x04d6;
const ADDR_SIO_RET_A = 0x04d7;
const ADDR_DBG_DCB_DDEVIC = 0x04d8;
const ADDR_DBG_DCB_DUNIT = 0x04d9;
const ADDR_DBG_CURDRIVE = 0x04da;
const ADDR_DBG_CURDEVICE = 0x04db;
const ADDR_DBG_CURTYPE = 0x04dc;
const ADDR_DBG_OD_STAGE = 0x04dd;
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
const ADDR_OS_SDMCTL = 0x022f;
const ADDR_OS_SDLSTL = 0x0230;
const ADDR_OS_SDLSTH = 0x0231;
const ADDR_GTIA_COLBK = 0xd01a;
const ADDR_GTIA_COLPF0 = 0xd016;
const ADDR_GTIA_COLPF1 = 0xd017;
const ADDR_GTIA_COLPF2 = 0xd018;
const ADDR_GTIA_COLPF3 = 0xd019;
const POLL_CHUNK = 20_000;
const MAX_CHUNKS = 500;
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
    xexPath: resolveInputPath("build/atarixl/phase5_desktop_bootstrap.xex"),
    diskPath: resolveInputPath("build/atarixl/geos.atr"),
    osPath: resolveInputPath("third_party/A8E/ATARIXL.ROM"),
    basicPath: resolveInputPath("third_party/A8E/ATARIBAS.ROM"),
    pollChunk: POLL_CHUNK,
    maxChunks: MAX_CHUNKS,
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    postCycles: 0,
    allowSmokeFrame: false,
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

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
    await api.system.start();

    let status = 0;
    let chunks = 0;
    let decisive = false;
    for (; chunks < options.maxChunks; chunks++) {
      await api.system.waitForCycles({ count: options.pollChunk });
      status = await api.debug.readMemory(ADDR_STATUS);
      process.stdout.write(
        "  chunk " + (chunks + 1) + "/" + options.maxChunks +
        "  status=" + statusLabel(status) +
        " ($" + hex2(status) + ")\r"
      );
      if (
        status === 0x80 ||
        status === 0xe1 ||
        status === 0xe2 ||
        status === 0xe3 ||
        status === 0xe4 ||
        status === 0xe5
      ) {
        decisive = true;
        break;
      }
      if (options.allowSmokeFrame && status === 0x81) {
        decisive = true;
        break;
      }
    }
    process.stdout.write("\n");

    if (decisive && options.postCycles > 0) {
      await api.system.waitForCycles({ count: options.postCycles });
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
    const colbk = await api.debug.readMemory(ADDR_GTIA_COLBK);
    const colpf0 = await api.debug.readMemory(ADDR_GTIA_COLPF0);
    const colpf1 = await api.debug.readMemory(ADDR_GTIA_COLPF1);
    const colpf2 = await api.debug.readMemory(ADDR_GTIA_COLPF2);
    const colpf3 = await api.debug.readMemory(ADDR_GTIA_COLPF3);

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
    console.log("");

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
      if (!options.allowSmokeFrame) {
        console.log("Reached smoke-frame fallback ($81), not real desktop app rendering.");
        console.log("Run with --allow-smoke-frame only for bootstrap diagnostics.");
        process.exit(1);
      }
      console.log("Bootstrap reached visible desktop smoke-frame fallback.");
    }
    if (status === 0x80) {
      console.log("Bootstrap reached desktop handoff status.");
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
