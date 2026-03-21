"use strict";

// Final test: GEOS desktop with fixed mainloop2, better colors.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, "0"); }

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
    console.log("Desktop painted (status=$" + hex2(await api.debug.readMemory(ADDR_STATUS)) + ").");

    // Give plenty of time for desktop to fully render
    await api.system.waitForCycles({ count: 10000000 });

    // Screenshot with original colors
    let shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_desktop_fixed.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("Fixed desktop screenshot: " + outPath + " (" + png.length + " bytes)");
    }

    // Check screen memory for desktop content
    console.log("\n=== Screen memory survey ===");
    const screenBase = 0x4000;
    for (let lineNum = 0; lineNum < 200; lineNum += 10) {
      const lineAddr = screenBase + lineNum * 40;
      const lineBytes = [];
      for (let i = 0; i < 40; i++) {
        lineBytes.push(await api.debug.readMemory(lineAddr + i));
      }
      const allSame = lineBytes.every(b => b === lineBytes[0]);
      const allAA55 = lineBytes.every((b, i) => b === (i % 2 === 0 ? 0xAA : 0x55));
      const all55AA = lineBytes.every((b, i) => b === (i % 2 === 0 ? 0x55 : 0xAA));
      const all00 = lineBytes.every(b => b === 0);
      const allFF = lineBytes.every(b => b === 0xFF);
      let desc;
      if (allAA55) desc = "AA/55 pattern";
      else if (all55AA) desc = "55/AA pattern";
      else if (allFF) desc = "ALL $FF";
      else if (all00) desc = "ALL $00";
      else if (allSame) desc = "ALL $" + hex2(lineBytes[0]);
      else desc = lineBytes.slice(0, 10).map(b => hex2(b)).join(" ") + "...";
      console.log("Line " + lineNum + ": " + desc);
    }

    // Also try with C64-like colors (dark blue bg, light blue fg)
    // COLPF2 = background (for "0" bits) = $94 (blue)
    // COLPF1 = foreground luma (for "1" bits) = combined with COLPF2 hue
    // To get white-on-blue: COLPF2=$94, COLPF1=$0E
    // "0" bits = $94 (blue), "1" bits = ($90|$0E) = $9E (bright blue)
    // Better: COLPF2=$94, COLPF1=$0A → "1" bits = ($90|$0A) = $9A
    // Even better: for C64 look, COLPF2=$96, COLPF1=$0E
    // → "0" = $96 (mid blue), "1" = ($90|$0E) = $9E (bright blue-white)
    await api.debug.writeMemory(0xC558, 0x90); // COLBK = dark blue
    await api.debug.writeMemory(0xC55A, 0x0E); // COLPF1 = white luma
    await api.debug.writeMemory(0xC55B, 0x96); // COLPF2 = blue bg
    await api.system.waitForCycles({ count: 500000 });

    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_desktop_blue.png");
      fs.writeFileSync(outPath, png);
      console.log("Blue desktop screenshot: " + outPath + " (" + png.length + " bytes)");
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
