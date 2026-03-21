"use strict";

// Check if GEOS NMI handler is running by using breakpoints on the NMI entry point
// and checking if MaintainAtariDisplay is called.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v) { return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0"); }

// Load label file to find key addresses
function loadSymbols() {
  const labFile = path.resolve(REPO_ROOT, "build/atarixl/kernal/phase5_desktop_bootstrap.lab");
  const syms = {};
  if (!fs.existsSync(labFile)) return syms;
  const lines = fs.readFileSync(labFile, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^al\s+([0-9A-Fa-f]+)\s+\.(.+)/);
    if (m) syms[m[2]] = parseInt(m[1], 16) & 0xffff;
  }
  return syms;
}

async function main() {
  const xexPath = path.resolve(REPO_ROOT, "build/atarixl/phase5_desktop_bootstrap.xex");
  const diskPath = path.resolve(REPO_ROOT, "build/atarixl/geos.atr");
  const osPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIXL.ROM");
  const basicPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) { console.error("FATAL: " + label + " not found: " + p); process.exit(3); }
  }

  const syms = loadSymbols();
  console.log("Key symbols from phase5_desktop_bootstrap.lab:");
  for (const name of ["_NMIHandler", "MaintainAtariDisplay", "InitAtariColors",
    "InitAtariDisplay", "InitAtariIRQ", "AtariColorTable"]) {
    if (syms[name]) console.log("  " + name + " = $" + hex4(syms[name]));
    else console.log("  " + name + " = NOT FOUND");
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

    // Boot to entry
    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({ bytes: xexData, name: "bootstrap.xex", awaitEntry: false, start: true, resetOptions: { portB: 0xff } });
    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    if (!entryEvent || !entryEvent.debugState) { console.error("FATAL: No entry BP"); process.exit(3); }

    await api.media.mountDisk(diskData, { name: "geos.atr", slot: 0 });
    await api.debug.setBreakpoints([]);
    await api.system.start();

    // Wait for desktop to paint
    for (let chunk = 0; chunk < 500; chunk++) {
      await api.system.waitForCycles({ count: 20000 });
      const status = await api.debug.readMemory(ADDR_STATUS);
      if (status >= 0x82) break;
    }
    console.log("\nDesktop painted.");

    // Now set breakpoint on _NMIHandler to see if NMI fires
    const nmiAddr = syms["_NMIHandler"];
    if (nmiAddr) {
      console.log("\nSetting breakpoint on _NMIHandler ($" + hex4(nmiAddr) + ")...");
      await api.debug.setBreakpoints([nmiAddr]);

      // Run and wait for breakpoint
      await api.system.start();
      const nmiHit = await api.debug.waitForBreakpoint({ timeoutMs: 5000 });
      if (nmiHit && nmiHit.debugState) {
        console.log("NMI handler HIT at PC=$" + hex4(nmiHit.debugState.pc || 0));
        console.log("  A=$" + hex2(nmiHit.debugState.a || 0) +
          " X=$" + hex2(nmiHit.debugState.x || 0) +
          " Y=$" + hex2(nmiHit.debugState.y || 0));
      } else {
        console.log("NMI handler NOT HIT within 5 seconds!");
      }
      await api.debug.setBreakpoints([]);
    }

    // Check MaintainAtariDisplay
    const maintainAddr = syms["MaintainAtariDisplay"];
    if (maintainAddr) {
      console.log("\nSetting breakpoint on MaintainAtariDisplay ($" + hex4(maintainAddr) + ")...");
      await api.debug.setBreakpoints([maintainAddr]);
      await api.system.start();
      const maintainHit = await api.debug.waitForBreakpoint({ timeoutMs: 5000 });
      if (maintainHit && maintainHit.debugState) {
        console.log("MaintainAtariDisplay HIT at PC=$" + hex4(maintainHit.debugState.pc || 0));
      } else {
        console.log("MaintainAtariDisplay NOT HIT within 5 seconds!");
      }
      await api.debug.setBreakpoints([]);
    }

    // Run for more cycles and dump current COLPF2 state
    await api.system.start();
    await api.system.waitForCycles({ count: 5000000 });

    // Check NMIEN (what we wrote)
    const nmienRam = await api.debug.readMemory(0xd40e);
    console.log("\nNMIEN/NMIST read: $" + hex2(nmienRam));

    // Read the actual NMI vector in RAM (since OS ROM is off)
    const nmiLo = await api.debug.readMemory(0xfffa);
    const nmiHi = await api.debug.readMemory(0xfffb);
    console.log("NMI vector: $" + hex4((nmiHi << 8) | nmiLo));

    // Dump a few bytes at the NMI handler address to verify it's our code
    if (nmiAddr) {
      const nmiCode = [];
      for (let i = 0; i < 16; i++) {
        nmiCode.push(await api.debug.readMemory(nmiAddr + i));
      }
      console.log("Code at _NMIHandler: " + nmiCode.map(b => hex2(b)).join(" "));
    }

    // Check InitAtariColors code and AtariColorTable
    const colorTableAddr = syms["AtariColorTable"];
    if (colorTableAddr) {
      const table = [];
      for (let i = 0; i < 5; i++) {
        table.push(await api.debug.readMemory(colorTableAddr + i));
      }
      console.log("AtariColorTable: " + table.map(b => "$" + hex2(b)).join(" ") + " (COLBK COLPF0 COLPF1 COLPF2 COLPF3)");
    }

    // Take final screenshot
    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_nmi_debug.png");
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
