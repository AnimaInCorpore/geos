"use strict";

// Trace the Atari XL desktop graphics path after StartAppl so we can see
// which bitmap routines the stock C64 DESK TOP actually exercises.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const DEFAULT_POLL_CYCLES = 20_000;
const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const DEFAULT_TRACE_LIMIT = 24;
const DEFAULT_TRACE_CYCLES = 2_000_000;

const LAB_PATH = path.resolve(REPO_ROOT, "build/atarixl/kernal/phase5_desktop_bootstrap.lab");

const TRACE_SYMBOL_NAMES = [
  "ClrScr",
  "CopyFString",
  "DoMenu",
  "DrawMenu",
  "GetScanLine",
  "BitmapUp",
  "BitmapUpHelp",
  "BitmapClip",
  "BitOtherClip",
  "BitmapDecode",
  "FontPutChar",
  "GraphicsString",
  "HorizontalLine",
  "VerticalLine",
  "Rectangle",
  "InvertRectangle",
  "RecoverRectangle",
  "ImprintRectangle",
  "FrameRectangle",
  "UseSystemFont",
  "LoadCharSet",
  "SetDevice",
  "ChangeDiskDevice",
];

const GEOS_ZP_OFFSET = 0x7e;
const ADDR_CURRENT_MODE = 0x2e + GEOS_ZP_OFFSET;
const ADDR_DISP_BUFFER_ON = 0x2f + GEOS_ZP_OFFSET;
const ADDR_GRAPH_MODE = 0x3f + GEOS_ZP_OFFSET;
const ADDR_R0 = 0x02 + GEOS_ZP_OFFSET;
const ADDR_R1 = 0x04 + GEOS_ZP_OFFSET;
const ADDR_R2 = 0x06 + GEOS_ZP_OFFSET;
const ADDR_R3 = 0x08 + GEOS_ZP_OFFSET;
const ADDR_R4 = 0x0a + GEOS_ZP_OFFSET;
const ADDR_R11 = 0x18 + GEOS_ZP_OFFSET;
const ADDR_R12 = 0x1a + GEOS_ZP_OFFSET;
const ADDR_R13 = 0x1c + GEOS_ZP_OFFSET;
const ADDR_R14 = 0x1e + GEOS_ZP_OFFSET;

function resolveInputPath(rawPath) {
  if (!rawPath) return rawPath;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(REPO_ROOT, rawPath);
}

function hex2(value) {
  return ((value & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(value) {
  return ((value & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0");
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
    bootTimeoutMs: DEFAULT_BOOT_TIMEOUT_MS,
    pollCycles: DEFAULT_POLL_CYCLES,
    traceLimit: DEFAULT_TRACE_LIMIT,
    traceCycles: DEFAULT_TRACE_CYCLES,
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
    if (arg === "--boot-timeout-ms") {
      i++;
      if (i >= argv.length) throw new Error("--boot-timeout-ms requires a value");
      options.bootTimeoutMs = parsePositiveInt(argv[i], "--boot-timeout-ms");
      continue;
    }
    if (arg === "--poll-cycles") {
      i++;
      if (i >= argv.length) throw new Error("--poll-cycles requires a value");
      options.pollCycles = parsePositiveInt(argv[i], "--poll-cycles");
      continue;
    }
    if (arg === "--trace-limit") {
      i++;
      if (i >= argv.length) throw new Error("--trace-limit requires a value");
      options.traceLimit = parsePositiveInt(argv[i], "--trace-limit");
      continue;
    }
    if (arg === "--trace-cycles") {
      i++;
      if (i >= argv.length) throw new Error("--trace-cycles requires a value");
      options.traceCycles = parsePositiveInt(argv[i], "--trace-cycles");
      continue;
    }
    if (arg === "--screenshot") {
      i++;
      if (i >= argv.length) throw new Error("--screenshot requires a path");
      options.screenshotPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/phase5_desktop_draw_trace.js [options]\n" +
        "  --xex <path>             Bootstrap XEX path\n" +
        "  --disk <path>            ATR to mount as D1\n" +
        "  --os-rom <path>          Atari XL OS ROM path\n" +
        "  --basic-rom <path>       Atari BASIC ROM path\n" +
        "  --no-basic               Skip loading BASIC ROM\n" +
        "  --boot-timeout-ms <ms>   Entry-breakpoint timeout\n" +
        "  --poll-cycles <count>    Cycles per trace poll\n" +
        "  --trace-limit <count>    Number of draw breakpoints to log\n" +
        "  --trace-cycles <count>   Total cycles to sample after StartAppl\n" +
        "  --screenshot <path>      Save a PNG screenshot artifact"
      );
      process.exit(0);
    }
    throw new Error("Unknown option: " + arg);
  }

  return options;
}

function parseLabSymbols(text) {
  const symbols = Object.create(null);
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^al\s+([0-9A-Fa-f]{6})\s+(.+)$/);
    if (!match) continue;
    const addr = parseInt(match[1], 16) & 0xffff;
    const rawName = match[2].trim();
    const name = rawName.replace(/^\./, "");
    symbols[name] = addr;
  }
  return symbols;
}

function loadLabSymbols(labPath) {
  if (!fs.existsSync(labPath)) {
    throw new Error("Missing symbol lab file: " + labPath);
  }
  return parseLabSymbols(fs.readFileSync(labPath, "utf8"));
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

async function readAtariState(api) {
  return {
    currentMode: await api.debug.readMemory(ADDR_CURRENT_MODE),
    dispBufferOn: await api.debug.readMemory(ADDR_DISP_BUFFER_ON),
    graphMode: await api.debug.readMemory(ADDR_GRAPH_MODE),
  };
}

async function readBitmapArgs(api) {
  const r0 = await readWord(api, ADDR_R0);
  const r1 = await readWord(api, ADDR_R1);
  const r2 = await readWord(api, ADDR_R2);
  const r3 = await readWord(api, ADDR_R3);
  const r4 = await readWord(api, ADDR_R4);
  const r11 = await readWord(api, ADDR_R11);
  const r12 = await readWord(api, ADDR_R12);
  const r13 = await readWord(api, ADDR_R13);
  const r14 = await readWord(api, ADDR_R14);
  return { r0, r1, r2, r3, r4, r11, r12, r13, r14 };
}

function formatRegs(dbg) {
  return (
    "PC=$" + hex4(dbg.pc) +
    " A=$" + hex2(dbg.a) +
    " X=$" + hex2(dbg.x) +
    " Y=$" + hex2(dbg.y) +
    " SP=$" + hex2(dbg.sp) +
    " P=$" + hex2(dbg.p)
  );
}

function formatBitmapArgs(args) {
  return (
    "r0=$" + hex4(args.r0) +
    " r1=$" + hex4(args.r1) +
    " r2=$" + hex4(args.r2) +
    " r3=$" + hex4(args.r3) +
    " r4=$" + hex4(args.r4) +
    " r11=$" + hex4(args.r11) +
    " r12=$" + hex4(args.r12) +
    " r13=$" + hex4(args.r13) +
    " r14=$" + hex4(args.r14)
  );
}

function formatLabTargets(symbols) {
  return TRACE_SYMBOL_NAMES
    .filter((name) => Object.prototype.hasOwnProperty.call(symbols, name))
    .map((name) => name + "=$" + hex4(symbols[name]));
}

function formatDisassembly(disasm) {
  return disasm.instructions.map((ins) => {
    const bytes = ins.bytes.map((b) => hex2(b)).join(" ");
    const operand = ins.operand ? " " + ins.operand : "";
    return "  $" + hex4(ins.address) + ": " + bytes.padEnd(8) + " " + ins.mnemonic + operand;
  });
}

async function traceDrawCalls(api, symbols, options) {
  const targets = TRACE_SYMBOL_NAMES
    .filter((name) => Object.prototype.hasOwnProperty.call(symbols, name))
    .map((name) => ({ name, addr: symbols[name] & 0xffff }));

  if (!targets.length) {
    console.log("No draw routine symbols were found in " + LAB_PATH);
    return { hits: 0, counts: Object.create(null) };
  }

  console.log("Tracing graphics routines:");
  console.log("  " + formatLabTargets(symbols).join(", "));

  await api.debug.setBreakpoints(targets.map((target) => target.addr));

  const counts = Object.create(null);
  let hits = 0;
  let sampledCycles = 0;

  await api.system.start();
  while (sampledCycles < options.traceCycles && hits < options.traceLimit) {
    await api.system.waitForCycles({ count: options.pollCycles });
    sampledCycles += options.pollCycles;

    const dbg = await api.debug.getDebugState();
    if (!dbg || dbg.breakpointHit < 0) {
      continue;
    }

    const hitAddr = dbg.breakpointHit & 0xffff;
    const target = targets.find((item) => item.addr === hitAddr);
    if (!target) {
      continue;
    }

    hits++;
    counts[target.name] = (counts[target.name] | 0) + 1;

    const state = await readAtariState(api);
    console.log("");
    console.log(
      "[draw " + hits + "] " + target.name +
      " @ $" + hex4(target.addr) +
      "  " + formatRegs(dbg) +
      "  currentMode=$" + hex2(state.currentMode) +
      " dispBufferOn=$" + hex2(state.dispBufferOn) +
      " graphMode=$" + hex2(state.graphMode)
    );

    if (target.name === "BitmapUp" || target.name === "BitmapUpHelp" ||
        target.name === "BitmapClip" || target.name === "BitOtherClip" ||
        target.name === "HorizontalLine" || target.name === "VerticalLine" ||
        target.name === "Rectangle" || target.name === "InvertRectangle" ||
        target.name === "RecoverRectangle" || target.name === "ImprintRectangle" ||
        target.name === "FrameRectangle") {
      const args = await readBitmapArgs(api);
      console.log("  args: " + formatBitmapArgs(args));
      const retLo = await api.debug.readMemory(0x0100 + ((dbg.sp + 1) & 0xff));
      const retHi = await api.debug.readMemory(0x0100 + ((dbg.sp + 2) & 0xff));
      console.log("  caller return: $" + hex4(((retHi << 8) | retLo) & 0xffff));
      if (target.name === "GetScanLine") {
        console.log("  note: GetScanLine is already the Atari row-major address path.");
      }
    }
    if (target.name === "BitmapDecode") {
      const r0addr = await readWord(api, ADDR_R0);
      const r3addr = await readWord(api, ADDR_R3);
      const r4addr = await readWord(api, ADDR_R4);
      const retLo = await api.debug.readMemory(0x0100 + ((dbg.sp + 1) & 0xff));
      const retHi = await api.debug.readMemory(0x0100 + ((dbg.sp + 2) & 0xff));
      const retAddr = ((retHi << 8) | retLo) & 0xffff;
      const sourceBytes = await readBytes(api, r0addr, 16);
      console.log(
        "  bitmap source: r0=$" + hex4(r0addr) +
        " r3=$" + hex4(r3addr) +
        " r4=$" + hex4(r4addr)
      );
      console.log("  caller return: $" + hex4(retAddr));
      console.log("  source bytes: " + sourceBytes.map(hex2).join(" "));
    }

    const disasm = await api.debug.disassemble({ pc: dbg.pc, before: 3, after: 5 });
    const lines = formatDisassembly(disasm);
    console.log("  disassembly:");
    for (const line of lines) {
      console.log(line);
    }

    // Resume execution and keep sampling until the next breakpoint or budget
    // limit.
    await api.system.start();
  }

  await api.debug.setBreakpoints([]);
  return { hits, counts, targets };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const labSymbols = loadLabSymbols(LAB_PATH);

  for (const [label, p] of [["XEX", options.xexPath], ["ATR", options.diskPath], ["OS ROM", options.osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
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
      console.error("FATAL: XEX did not reach entry breakpoint at $" + hex4(ENTRY_PC) + ".");
      process.exit(3);
    }

    await api.media.mountDisk(diskData, { name: path.basename(options.diskPath), slot: 0 });
    await api.debug.setBreakpoints([]);
    await api.system.start();

    let status = 0;
    for (let chunk = 0; chunk < 500; chunk++) {
      await api.system.waitForCycles({ count: options.pollCycles });
      status = await api.debug.readMemory(0x04d0);
      if (status >= 0x80 || status >= 0xe1) {
        break;
      }
    }

    console.log("Bootstrap status: $" + hex2(status));
    if (status >= 0xe1 && status <= 0xe5) {
      console.error("Desktop load failed before any draw tracing could start.");
      process.exit(1);
    }

    if (status < 0x80) {
      console.error("Desktop handoff was not reached; nothing to trace.");
      process.exit(2);
    }

    const traceResult = await traceDrawCalls(api, labSymbols, options);

    console.log("");
    console.log("=== Graphics Trace Summary ===");
    console.log("Hit count: " + traceResult.hits);
    Object.keys(traceResult.counts).sort().forEach((name) => {
      console.log("  " + name + ": " + traceResult.counts[name]);
    });
    if (traceResult.hits === 0) {
      console.log("No draw calls were observed in the sampled window.");
      console.log("Inference: the remaining desktop corruption is likely above the KERNAL bitmap layer.");
    } else {
      const hadAtariBitmapPath =
        Object.prototype.hasOwnProperty.call(traceResult.counts, "GetScanLine") ||
        Object.prototype.hasOwnProperty.call(traceResult.counts, "BitmapUp") ||
        Object.prototype.hasOwnProperty.call(traceResult.counts, "BitmapClip") ||
        Object.prototype.hasOwnProperty.call(traceResult.counts, "HorizontalLine") ||
        Object.prototype.hasOwnProperty.call(traceResult.counts, "Rectangle") ||
        Object.prototype.hasOwnProperty.call(traceResult.counts, "FrameRectangle");
      if (hadAtariBitmapPath) {
        console.log("Inference: the Atari-aware bitmap primitives are being exercised.");
        console.log("Any remaining corruption is more likely caller state or desktop app code than C64 bitmap layout.");
      }
    }

    if (options.screenshotPath) {
      const shot = await api.artifacts.captureScreenshot();
      const png = Buffer.from(shot.base64 || "", "base64");
      fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
      fs.writeFileSync(options.screenshotPath, png);
      console.log("Saved screenshot: " + options.screenshotPath + " (" + ((shot.width | 0) + "x" + (shot.height | 0)) + ")");
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
