"use strict";

// Dialog-focused runner for the Atari XL desktop bootstrap path.
//
// This expects a non-smoke phase 5 desktop bootstrap build. The stock smoke
// build intentionally bypasses the desktop loader dialog, so this script uses
// the regular EnterDeskTop path to prove DoDlgBox + keyboard dismissal.
// The --native-desktop mode instead patches the Atari-native desktop into a
// dialog trampoline once the visible desktop marker is reached.
//
// Flow:
//   1. Boot phase5_desktop_bootstrap.xex to its $0881 entry breakpoint.
//   2. Mount build/atarixl/geos.atr as D1:.
//   3. Wait for DoDlgBox to be entered.
//   4. Wait for the dialog to reach MainLoop, capture a screenshot.
//   5. Press Return to dismiss the OK dialog.
//   6. Wait for StartAppl to confirm boot continues after dismissal.
//
// Exit codes:
//   0  Dialog appeared, was dismissed, and boot continued to StartAppl.
//   1  Dialog did not reach a decisive state / dismissed path failed.
//   2  Timeout waiting for entry, dialog, or post-dismissal progress.
//   3  Fatal (missing files / API errors)

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const LAB_PATH = path.resolve(REPO_ROOT, "build/atarixl/kernal/phase5_desktop_bootstrap.lab");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const DEFAULT_DIALOG_TIMEOUT_MS = 20_000;
const DEFAULT_RETURN_DELAY_MS = 200;
const DEFAULT_VISIBLE_SCREENSHOT = path.resolve(
  REPO_ROOT,
  "build/atarixl/phase5_dialog_visible.png",
);
const DEFAULT_DISMISSED_SCREENSHOT = path.resolve(
  REPO_ROOT,
  "build/atarixl/phase5_dialog_dismissed.png",
);
const PHASE5_STATUS = 0x0600;
const PHASE5_STATUS_DESKTOP_VISIBLE = 0x82;
const NATIVE_DESKTOP_START = 0x0400;
const NATIVE_DIALOG_TRAMPOLINE = 0x0700;
const GEOS_ZP_OFFSET = 0x7e;
const ZP_R0 = 0x02 + GEOS_ZP_OFFSET;
const ZP_R0H = ZP_R0 + 1;

function resolveInputPath(rawPath) {
  if (!rawPath) return rawPath;
  if (path.isAbsolute(rawPath)) return rawPath;
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
    nativeDesktop: false,
    bootTimeoutMs: DEFAULT_BOOT_TIMEOUT_MS,
    dialogTimeoutMs: DEFAULT_DIALOG_TIMEOUT_MS,
    returnDelayMs: DEFAULT_RETURN_DELAY_MS,
    visibleScreenshotPath: DEFAULT_VISIBLE_SCREENSHOT,
    dismissedScreenshotPath: DEFAULT_DISMISSED_SCREENSHOT,
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
    if (arg === "--dialog-timeout-ms") {
      i++;
      if (i >= argv.length) throw new Error("--dialog-timeout-ms requires a value");
      options.dialogTimeoutMs = parsePositiveInt(argv[i], "--dialog-timeout-ms");
      continue;
    }
    if (arg === "--return-delay-ms") {
      i++;
      if (i >= argv.length) throw new Error("--return-delay-ms requires a value");
      options.returnDelayMs = parsePositiveInt(argv[i], "--return-delay-ms");
      continue;
    }
    if (arg === "--visible-screenshot") {
      i++;
      if (i >= argv.length) throw new Error("--visible-screenshot requires a path");
      options.visibleScreenshotPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--dismissed-screenshot") {
      i++;
      if (i >= argv.length) throw new Error("--dismissed-screenshot requires a path");
      options.dismissedScreenshotPath = resolveInputPath(argv[i]);
      continue;
    }
    if (arg === "--native-desktop") {
      options.nativeDesktop = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/phase5_desktop_dialog_run.js [options]\n" +
        "  --xex <path>             Desktop bootstrap XEX path\n" +
        "  --disk <path>            ATR to mount as D1\n" +
        "  --os-rom <path>          Atari XL OS ROM path\n" +
        "  --basic-rom <path>       Atari BASIC ROM path\n" +
        "  --no-basic               Skip loading BASIC ROM\n" +
        "  --boot-timeout-ms <ms>   Entry-breakpoint timeout\n" +
        "  --dialog-timeout-ms <ms> Dialog / post-dismissal timeout\n" +
        "  --return-delay-ms <ms>   Delay before pressing Return\n" +
        "  --visible-screenshot <path>\n" +
        "                           Screenshot after the dialog appears\n" +
        "  --dismissed-screenshot <path>\n" +
        "                           Screenshot after the dialog is dismissed\n" +
        "  --native-desktop         Use the native Atari desktop trampoline dialog mode"
      );
      process.exit(0);
    }
    throw new Error("Unknown option: " + arg);
  }

  return options;
}

function parseLabSymbols(text) {
  const symbols = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^al\s+([0-9A-Fa-f]{6})\s+(.+)$/);
    if (!match) continue;
    const addr = parseInt(match[1], 16) & 0xffff;
    const name = match[2].trim().replace(/^\./, "");
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

function hex2(value) {
  return ((value & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(value) {
  return ((value & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function formatState(dbg) {
  if (!dbg) return "n/a";
  return (
    "PC=$" + hex4(dbg.pc) +
    " A=$" + hex2(dbg.a) +
    " X=$" + hex2(dbg.x) +
    " Y=$" + hex2(dbg.y) +
    " SP=$" + hex2(dbg.sp) +
    " P=$" + hex2(dbg.p)
  );
}

function isFailureArtifact(value) {
  return !!(value && value.ok === false && value.failure);
}

async function captureScreenshot(api, outputPath) {
  const shot = await api.artifacts.captureScreenshot();
  const png = Buffer.from(shot.base64 || "", "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, png);
  return {
    path: outputPath,
    width: shot.width | 0,
    height: shot.height | 0,
    byteLength: png.length,
  };
}

async function readBytes(api, addr, count) {
  const bytes = [];
  for (let i = 0; i < count; i++) {
    bytes.push(await api.debug.readMemory((addr + i) & 0xffff));
  }
  return bytes;
}

async function runNativeDesktopDialog(api, options, doDlgBox, mainLoop) {
  console.log("Waiting for native desktop visible marker at $" + hex4(PHASE5_STATUS) + "...");
  await api.debug.setBreakpoints([]);
  await api.system.start();
  let status = 0;
  let desktopStartOriginal = null;
  for (let chunks = 0; chunks < 500; chunks++) {
    await api.system.waitForCycles({ count: 20_000 });
    status = await api.debug.readMemory(PHASE5_STATUS);
    if (status >= PHASE5_STATUS_DESKTOP_VISIBLE) {
      break;
    }
  }
  if (status < PHASE5_STATUS_DESKTOP_VISIBLE) {
    console.error("FATAL: native desktop did not reach visible status $82.");
    process.exit(2);
  }
  console.log("Native desktop visible: PHASE5_STATUS=$" + hex2(status));

  await api.system.pause();
  desktopStartOriginal = await readBytes(api, NATIVE_DESKTOP_START, 3);
  const dialogTrampoline = Uint8Array.from([
    0xA9, 0xFC,       // lda #<_EnterDT_DB
    0x85, ZP_R0,      // sta r0
    0xA9, 0xC3,       // lda #>_EnterDT_DB
    0x85, ZP_R0H,     // sta r0+1
    0x4C, 0x56, 0xC2, // jmp DoDlgBox
  ]);

  await api.debug.writeRange(NATIVE_DIALOG_TRAMPOLINE, dialogTrampoline);
  await api.debug.writeRange(NATIVE_DESKTOP_START, Uint8Array.from([0x4C, 0x00, 0x07]));
  console.log(
    "Patched DesktopStart @$" + hex4(NATIVE_DESKTOP_START) +
      " to jump to dialog trampoline @$" + hex4(NATIVE_DIALOG_TRAMPOLINE),
  );

  try {
    console.log("Waiting for DoDlgBox at $" + hex4(doDlgBox) + "...");
    await api.debug.setBreakpoints([doDlgBox]);
    await api.system.start();
    const dlgEntry = await api.debug.waitForBreakpoint({ timeoutMs: options.dialogTimeoutMs });
    if (isFailureArtifact(dlgEntry) || !dlgEntry || !dlgEntry.debugState) {
      console.error("FATAL: native desktop did not reach DoDlgBox.");
      if (dlgEntry && dlgEntry.failure) {
        console.error(JSON.stringify(dlgEntry.failure, null, 2));
      }
      process.exit(2);
    }
    console.log("DoDlgBox entered: " + formatState(dlgEntry.debugState));

    await api.debug.writeRange(NATIVE_DESKTOP_START, desktopStartOriginal);
    console.log("Restored DesktopStart entry bytes after dialog launch.");

    console.log("Waiting for dialog MainLoop at $" + hex4(mainLoop) + "...");
    await api.debug.setBreakpoints([mainLoop]);
    await api.system.start();
    const dlgLoop = await api.debug.waitForBreakpoint({ timeoutMs: options.dialogTimeoutMs });
    if (isFailureArtifact(dlgLoop) || !dlgLoop || !dlgLoop.debugState) {
      console.error("FATAL: native dialog did not reach MainLoop.");
      if (dlgLoop && dlgLoop.failure) {
        console.error(JSON.stringify(dlgLoop.failure, null, 2));
      }
      process.exit(2);
    }
    console.log("Dialog loop reached: " + formatState(dlgLoop.debugState));

    const visibleShot = await captureScreenshot(api, options.visibleScreenshotPath);
    console.log(
      "Saved dialog-visible screenshot: " +
        visibleShot.path +
        " (" +
        visibleShot.width +
        "x" +
        visibleShot.height +
        ", " +
        visibleShot.byteLength +
        " bytes)",
    );

    console.log("Dismiss dialog with Return, then allow a redraw.");
    await api.debug.setBreakpoints([]);
    await api.system.start();
    await api.system.waitForTime({ ms: options.returnDelayMs, clock: "real" });
    await api.input.tapKey("Return", { holdMs: "80ms", afterMs: "40ms" });
    await api.system.waitForCycles({ count: 1_000_000 });

    const dismissedShot = await captureScreenshot(api, options.dismissedScreenshotPath);
    console.log(
      "Saved post-dismissal screenshot: " +
        dismissedShot.path +
        " (" +
        dismissedShot.width +
        "x" +
        dismissedShot.height +
        ", " +
        dismissedShot.byteLength +
        " bytes)",
    );
  } finally {
    if (desktopStartOriginal) {
      await api.debug.writeRange(NATIVE_DESKTOP_START, desktopStartOriginal);
    }
    await api.debug.setBreakpoints([]);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const symbols = loadLabSymbols(LAB_PATH);
  const doDlgBox = (symbols.DoDlgBox || 0xC256) & 0xffff;
  const mainLoop = (symbols.MainLoop || 0xC1C3) & 0xffff;
  const startAppl = (symbols.StartAppl || 0xC22F) & 0xffff;

  for (const [label, p] of [["XEX", options.xexPath], ["ATR", options.diskPath], ["OS ROM", options.osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      console.error("Rebuild the non-smoke phase 5 desktop bootstrap first.");
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
    await api.input.releaseAllInputs();

    const xexData = new Uint8Array(fs.readFileSync(options.xexPath));
    const diskData = new Uint8Array(fs.readFileSync(options.diskPath));

    console.log("Booting " + path.basename(options.xexPath) + " to entry at $" + hex4(ENTRY_PC));
    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({
      bytes: xexData,
      name: path.basename(options.xexPath),
      awaitEntry: false,
      start: true,
      resetOptions: { portB: 0xff },
    });

    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: options.bootTimeoutMs });
    if (isFailureArtifact(entryEvent) || !entryEvent || !entryEvent.debugState) {
      console.error("FATAL: desktop bootstrap did not reach the XEX entry breakpoint.");
      if (entryEvent && entryEvent.failure) {
        console.error(JSON.stringify(entryEvent.failure, null, 2));
      }
      process.exit(2);
    }
    console.log("XEX entry reached: " + formatState(entryEvent.debugState));

    await api.media.mountDisk(diskData, { name: path.basename(options.diskPath), slot: 0 });
    console.log("Mounted " + path.basename(options.diskPath) + " as D1:");

    if (options.nativeDesktop) {
      await runNativeDesktopDialog(api, options, doDlgBox, mainLoop);
      process.exit(0);
    }

    console.log("Waiting for DoDlgBox at $" + hex4(doDlgBox) + "...");
    await api.debug.setBreakpoints([doDlgBox]);
    await api.system.start();
    const dlgEntry = await api.debug.waitForBreakpoint({ timeoutMs: options.dialogTimeoutMs });
    if (isFailureArtifact(dlgEntry) || !dlgEntry || !dlgEntry.debugState) {
      console.error("FATAL: did not reach DoDlgBox.");
      if (dlgEntry && dlgEntry.failure) {
        console.error(JSON.stringify(dlgEntry.failure, null, 2));
      }
      process.exit(2);
    }
    console.log("DoDlgBox entered: " + formatState(dlgEntry.debugState));

    console.log("Waiting for dialog MainLoop at $" + hex4(mainLoop) + "...");
    await api.debug.setBreakpoints([mainLoop]);
    await api.system.start();
    const dlgLoop = await api.debug.waitForBreakpoint({ timeoutMs: options.dialogTimeoutMs });
    if (isFailureArtifact(dlgLoop) || !dlgLoop || !dlgLoop.debugState) {
      console.error("FATAL: dialog did not reach MainLoop.");
      if (dlgLoop && dlgLoop.failure) {
        console.error(JSON.stringify(dlgLoop.failure, null, 2));
      }
      process.exit(2);
    }
    console.log("Dialog loop reached: " + formatState(dlgLoop.debugState));

    const visibleShot = await captureScreenshot(api, options.visibleScreenshotPath);
    console.log(
      "Saved dialog-visible screenshot: " +
        visibleShot.path +
        " (" +
        visibleShot.width +
        "x" +
        visibleShot.height +
        ", " +
        visibleShot.byteLength +
        " bytes)",
    );

    console.log("Dismiss dialog with Return, then wait for StartAppl at $" + hex4(startAppl) + "...");
    await api.debug.setBreakpoints([startAppl]);
    await api.system.start();
    await api.system.waitForTime({ ms: options.returnDelayMs, clock: "real" });
    await api.input.tapKey("Return", { holdMs: "80ms", afterMs: "40ms" });

    const startApplEvent = await api.debug.waitForBreakpoint({ timeoutMs: options.dialogTimeoutMs });
    if (isFailureArtifact(startApplEvent) || !startApplEvent || !startApplEvent.debugState) {
      console.error("FATAL: dialog dismissal did not reach StartAppl.");
      if (startApplEvent && startApplEvent.failure) {
        console.error(JSON.stringify(startApplEvent.failure, null, 2));
      }
      process.exit(1);
    }
    console.log("StartAppl reached after Return: " + formatState(startApplEvent.debugState));

    const dismissedShot = await captureScreenshot(api, options.dismissedScreenshotPath);
    console.log(
      "Saved post-dismissal screenshot: " +
        dismissedShot.path +
        " (" +
        dismissedShot.width +
        "x" +
        dismissedShot.height +
        ", " +
        dismissedShot.byteLength +
        " bytes)",
    );

    await api.debug.setBreakpoints([]);
    process.exit(0);
  } finally {
    if (runtime && typeof runtime.dispose === "function") {
      await runtime.dispose();
    }
  }
}

main().catch(function (err) {
  console.error("Fatal:", err && err.message ? err.message : String(err));
  if (err && err.stack) console.error(err.stack);
  process.exit(3);
});
