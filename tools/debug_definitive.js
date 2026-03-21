"use strict";

// Definitive test: capture screenshot with original colors AND with patched colors
// in the same run, to compare.

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

    // Read color table state
    console.log("\n=== Original color state ===");
    for (let i = 0; i < 5; i++) {
      const v = await api.debug.readMemory(0xC558 + i);
      console.log("AtariColorTable[" + i + "] = $" + hex2(v));
    }
    const color2Shadow = await api.debug.readMemory(0x02c2);
    console.log("COLOR2 shadow = $" + hex2(color2Shadow));

    // Screenshot with original colors
    let shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_original_colors.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("Original screenshot: " + png.length + " bytes");
    }

    // Now patch colors for contrast
    console.log("\n=== Patching colors ===");
    await api.debug.writeMemory(0xC558, 0x00); // COLBK = black
    await api.debug.writeMemory(0xC559, 0x00); // COLPF0
    await api.debug.writeMemory(0xC55A, 0x0E); // COLPF1 = white luma
    await api.debug.writeMemory(0xC55B, 0x0E); // COLPF2 = white
    await api.debug.writeMemory(0xC55C, 0x00); // COLPF3

    // Wait for VBI to pick up new colors
    await api.system.waitForCycles({ count: 500000 });

    // Screenshot with white COLPF2 + white COLPF1 luma
    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_white_colors.png");
      fs.writeFileSync(outPath, png);
      console.log("White colors screenshot: " + png.length + " bytes");
    }

    // Now patch for maximum contrast: white background, dark foreground
    await api.debug.writeMemory(0xC55A, 0x00); // COLPF1 = black luma
    await api.debug.writeMemory(0xC55B, 0x0E); // COLPF2 = white
    await api.system.waitForCycles({ count: 500000 });

    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_contrast_colors.png");
      fs.writeFileSync(outPath, png);
      console.log("Contrast screenshot: " + png.length + " bytes");
    }

    // Also try with colored background for clarity
    await api.debug.writeMemory(0xC558, 0x24); // COLBK = dark red
    await api.debug.writeMemory(0xC55A, 0x00); // COLPF1 = black foreground
    await api.debug.writeMemory(0xC55B, 0x9A); // COLPF2 = bright blue bg
    await api.system.waitForCycles({ count: 500000 });

    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_blue_contrast.png");
      fs.writeFileSync(outPath, png);
      console.log("Blue contrast screenshot: " + png.length + " bytes");
    }

    // Check screen memory one more time
    console.log("\n=== Screen memory verification ===");
    const screenBase = 0x4000;
    const bytesPerLine = 40;
    for (let lineNum = 0; lineNum < 200; lineNum += 10) {
      const lineAddr = screenBase + lineNum * bytesPerLine;
      const lineBytes = [];
      for (let i = 0; i < bytesPerLine; i++) {
        lineBytes.push(await api.debug.readMemory(lineAddr + i));
      }
      const allFF = lineBytes.every(b => b === 0xff);
      const all00 = lineBytes.every(b => b === 0x00);
      const unique = new Set(lineBytes.map(b => hex2(b)));
      if (allFF) console.log("Line " + lineNum + ": ALL $FF");
      else if (all00) console.log("Line " + lineNum + ": ALL $00");
      else console.log("Line " + lineNum + ": " + unique.size + " unique values: " + lineBytes.slice(0, 10).map(b => hex2(b)).join(" ") + "...");
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
