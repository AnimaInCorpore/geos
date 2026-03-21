"use strict";

// Search for STA $D018 (COLPF2 write) in the GEOS kernal ROM area.

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

    // Search for STA $D018 (8D 18 D0) and STA $D01A (8D 1A D0) in kernal area
    console.log("Searching for COLPF2/COLBK writes in kernal...");
    const patterns = [
      { name: "STA $D018 (COLPF2)", bytes: [0x8D, 0x18, 0xD0] },
      { name: "STA $D01A (COLBK)", bytes: [0x8D, 0x1A, 0xD0] },
      { name: "STA $D016 (COLPF0)", bytes: [0x8D, 0x16, 0xD0] },
      { name: "STA $D017 (COLPF1)", bytes: [0x8D, 0x17, 0xD0] },
      { name: "LDA $C558 (AtariColorTable)", bytes: [0xAD, 0x58, 0xC5] },
    ];

    // Read kernal areas: $C000-$CFFF, $D800-$FFFF
    const areas = [
      [0xC000, 0xD000],
      [0xD800, 0x10000],
    ];

    for (const { name, bytes } of patterns) {
      const hits = [];
      for (const [start, end] of areas) {
        for (let addr = start; addr < end - bytes.length; addr++) {
          let match = true;
          for (let i = 0; i < bytes.length; i++) {
            const b = await api.debug.readMemory(addr + i);
            if (b !== bytes[i]) { match = false; break; }
          }
          if (match) hits.push(addr);
        }
      }
      console.log(name + ": " + hits.length + " hits at " + hits.map(a => "$" + hex4(a)).join(", "));
    }

    // Dump code at $F7BC (VBI routine 2 called by NMI handler)
    console.log("\n=== VBI routine 2 at $F7BC ===");
    const vbi2Bytes = [];
    for (let i = 0; i < 64; i++) {
      vbi2Bytes.push(await api.debug.readMemory(0xF7BC + i));
    }
    console.log(vbi2Bytes.map(b => hex2(b)).join(" "));

    // Also dump DLI handler at $F81A
    console.log("\n=== DLI handler at $F81A ===");
    const dliBytes = [];
    for (let i = 0; i < 32; i++) {
      dliBytes.push(await api.debug.readMemory(0xF81A + i));
    }
    console.log(dliBytes.map(b => hex2(b)).join(" "));

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
