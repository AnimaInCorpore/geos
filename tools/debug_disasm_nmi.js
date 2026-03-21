"use strict";

// Disassemble the NMI handler to check if it calls MaintainAtariDisplay.

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

    // Dump 128 bytes at _NMIHandler ($F727)
    console.log("=== NMI Handler code at $F727 ===");
    const nmiBytes = [];
    for (let i = 0; i < 128; i++) {
      nmiBytes.push(await api.debug.readMemory(0xF727 + i));
    }

    // Simple 6502 disassembler (enough for the NMI handler)
    const OPCODES = {
      0x48: ["PHA", 1, "imp"], 0x68: ["PLA", 1, "imp"],
      0x8A: ["TXA", 1, "imp"], 0x98: ["TYA", 1, "imp"],
      0xAA: ["TAX", 1, "imp"], 0xA8: ["TAY", 1, "imp"],
      0x08: ["PHP", 1, "imp"], 0x28: ["PLP", 1, "imp"],
      0x40: ["RTI", 1, "imp"], 0x60: ["RTS", 1, "imp"],
      0x78: ["SEI", 1, "imp"], 0x58: ["CLI", 1, "imp"],
      0x18: ["CLC", 1, "imp"], 0x38: ["SEC", 1, "imp"],
      0xEA: ["NOP", 1, "imp"],
      0xCA: ["DEX", 1, "imp"], 0xE8: ["INX", 1, "imp"],
      0x88: ["DEY", 1, "imp"], 0xC8: ["INY", 1, "imp"],
      0xA9: ["LDA", 2, "imm"], 0xA2: ["LDX", 2, "imm"], 0xA0: ["LDY", 2, "imm"],
      0x29: ["AND", 2, "imm"], 0x09: ["ORA", 2, "imm"], 0x49: ["EOR", 2, "imm"],
      0xC9: ["CMP", 2, "imm"], 0xE0: ["CPX", 2, "imm"], 0xC0: ["CPY", 2, "imm"],
      0xAD: ["LDA", 3, "abs"], 0xAE: ["LDX", 3, "abs"], 0xAC: ["LDY", 3, "abs"],
      0x8D: ["STA", 3, "abs"], 0x8E: ["STX", 3, "abs"], 0x8C: ["STY", 3, "abs"],
      0x2D: ["AND", 3, "abs"], 0x0D: ["ORA", 3, "abs"], 0x4D: ["EOR", 3, "abs"],
      0xCD: ["CMP", 3, "abs"], 0xEC: ["CPX", 3, "abs"], 0xCC: ["CPY", 3, "abs"],
      0x6D: ["ADC", 3, "abs"], 0xED: ["SBC", 3, "abs"],
      0xCE: ["DEC", 3, "abs"], 0xEE: ["INC", 3, "abs"],
      0x4C: ["JMP", 3, "abs"], 0x20: ["JSR", 3, "abs"],
      0x85: ["STA", 2, "zp"], 0x86: ["STX", 2, "zp"], 0x84: ["STY", 2, "zp"],
      0xA5: ["LDA", 2, "zp"], 0xA6: ["LDX", 2, "zp"], 0xA4: ["LDY", 2, "zp"],
      0xC5: ["CMP", 2, "zp"], 0xE4: ["CPX", 2, "zp"], 0xC4: ["CPY", 2, "zp"],
      0x65: ["ADC", 2, "zp"], 0xE5: ["SBC", 2, "zp"],
      0x25: ["AND", 2, "zp"], 0x05: ["ORA", 2, "zp"], 0x45: ["EOR", 2, "zp"],
      0xC6: ["DEC", 2, "zp"], 0xE6: ["INC", 2, "zp"],
      0xF0: ["BEQ", 2, "rel"], 0xD0: ["BNE", 2, "rel"],
      0x10: ["BPL", 2, "rel"], 0x30: ["BMI", 2, "rel"],
      0x90: ["BCC", 2, "rel"], 0xB0: ["BCS", 2, "rel"],
      0x50: ["BVC", 2, "rel"], 0x70: ["BVS", 2, "rel"],
      0xBD: ["LDA", 3, "abx"], 0xB9: ["LDA", 3, "aby"],
      0x9D: ["STA", 3, "abx"], 0x99: ["STA", 3, "aby"],
      0x91: ["STA", 2, "iny"], 0xB1: ["LDA", 2, "iny"],
      0x81: ["STA", 2, "inx"], 0xA1: ["LDA", 2, "inx"],
      0x6C: ["JMP", 3, "ind"],
      0xB5: ["LDA", 2, "zpx"], 0x95: ["STA", 2, "zpx"],
    };

    let pc = 0;
    const base = 0xF727;
    while (pc < 128) {
      const op = nmiBytes[pc];
      const info = OPCODES[op];
      let line = "$" + hex4(base + pc) + ": " + hex2(op) + " ";
      if (!info) {
        line += "          ???";
        pc++;
      } else {
        const [mne, size, mode] = info;
        for (let i = 1; i < size; i++) line += hex2(nmiBytes[pc + i]) + " ";
        for (let i = size; i < 3; i++) line += "   ";
        line += " " + mne + " ";
        if (mode === "imm") line += "#$" + hex2(nmiBytes[pc + 1]);
        else if (mode === "zp") line += "$" + hex2(nmiBytes[pc + 1]);
        else if (mode === "zpx") line += "$" + hex2(nmiBytes[pc + 1]) + ",X";
        else if (mode === "abs") line += "$" + hex4(nmiBytes[pc + 1] | (nmiBytes[pc + 2] << 8));
        else if (mode === "abx") line += "$" + hex4(nmiBytes[pc + 1] | (nmiBytes[pc + 2] << 8)) + ",X";
        else if (mode === "aby") line += "$" + hex4(nmiBytes[pc + 1] | (nmiBytes[pc + 2] << 8)) + ",Y";
        else if (mode === "ind") line += "($" + hex4(nmiBytes[pc + 1] | (nmiBytes[pc + 2] << 8)) + ")";
        else if (mode === "inx") line += "($" + hex2(nmiBytes[pc + 1]) + ",X)";
        else if (mode === "iny") line += "($" + hex2(nmiBytes[pc + 1]) + "),Y";
        else if (mode === "rel") {
          const offset = nmiBytes[pc + 1] > 127 ? nmiBytes[pc + 1] - 256 : nmiBytes[pc + 1];
          line += "$" + hex4(base + pc + 2 + offset);
        }
        pc += size;
      }
      console.log(line);
      if (op === 0x40 || op === 0x60) console.log("---"); // RTI/RTS separator
    }

    // Also dump MaintainAtariDisplay area
    // Since it's NOT in the label file, let's search for it by looking for
    // the JSR in the NMI handler that calls it
    console.log("\n=== AtariColorTable at $C558 ===");
    const colorTable = [];
    for (let i = 0; i < 5; i++) {
      colorTable.push(await api.debug.readMemory(0xC558 + i));
    }
    console.log("  " + colorTable.map(b => "$" + hex2(b)).join(" "));

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
