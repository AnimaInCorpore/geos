"use strict";

// Set breakpoint on STA COLPF2 ($F86E) to verify it executes with correct value.
// Then take screenshot immediately after.

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

    // Verify code at $F86E
    const codeAtF86E = [];
    for (let i = 0; i < 10; i++) {
      codeAtF86E.push(await api.debug.readMemory(0xF86E + i));
    }
    console.log("Code at $F86E: " + codeAtF86E.map(b => hex2(b)).join(" "));
    // Should be: 8D 18 D0 = STA $D018

    // Also dump MaintainAtariDisplay at $F81A for full picture
    console.log("\nFull MaintainAtariDisplay ($F81A-$F87F):");
    const maintainBytes = [];
    for (let i = 0; i < 0x66; i++) {
      maintainBytes.push(await api.debug.readMemory(0xF81A + i));
    }
    // Print in rows of 16
    for (let row = 0; row < maintainBytes.length; row += 16) {
      const addr = "$" + hex4(0xF81A + row) + ": ";
      const bytes = maintainBytes.slice(row, row + 16).map(b => hex2(b)).join(" ");
      console.log(addr + bytes);
    }

    // Set breakpoint on $F86E (STA $D018 = COLPF2 write)
    console.log("\nSetting breakpoint on STA $D018 at $F86E...");
    await api.debug.setBreakpoints([0xF86E]);
    await api.system.start();
    const hit = await api.debug.waitForBreakpoint({ timeoutMs: 10000 });
    if (hit && hit.debugState) {
      console.log("Breakpoint HIT!");
      console.log("  PC=$" + hex4(hit.debugState.pc));
      console.log("  A=$" + hex2(hit.debugState.a) + " (value being stored to COLPF2)");
      console.log("  X=$" + hex2(hit.debugState.x));
      console.log("  Y=$" + hex2(hit.debugState.y));
    } else {
      console.log("Breakpoint NOT HIT within 10 seconds!");
    }

    // Clear breakpoints, run more, take screenshot
    await api.debug.setBreakpoints([]);
    await api.system.start();
    await api.system.waitForCycles({ count: 5000000 });

    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_colpf2_debug.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("\nScreenshot: " + outPath + " (" + png.length + " bytes)");
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
