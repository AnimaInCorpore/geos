"use strict";

// Phase 5 ANTIC write tracer.
//
// Instruments jsA8E's I/O layer to log every write to ANTIC registers
// ($D400-$D40F) during the desktop bootstrap, capturing the PC and
// opcode of the offending instruction.  This identifies C64-legacy
// code paths that corrupt the Atari display list, DMACTL, or NMIEN.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

// ANTIC register names
const ANTIC_NAMES = {
  0xd400: "DMACTL",
  0xd401: "CHACTL",
  0xd402: "DLISTL",
  0xd403: "DLISTH",
  0xd404: "HSCROL",
  0xd405: "VSCROL",
  0xd406: "---",
  0xd407: "PMBASE",
  0xd408: "---",
  0xd409: "CHBASE",
  0xd40a: "WSYNC",
  0xd40b: "VCOUNT",
  0xd40c: "PENH",
  0xd40d: "PENV",
  0xd40e: "NMIEN",
  0xd40f: "NMIRES",
};

// Known-good writers (our own code) — will be identified from kernal.lab
const KERNAL_LABEL_FILE = path.resolve(REPO_ROOT, "build/atarixl/kernal/phase5_desktop_bootstrap.lab");

function hex2(v) { return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v) { return ((v & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0"); }

function loadSymbols() {
  const syms = {};
  if (!fs.existsSync(KERNAL_LABEL_FILE)) return syms;
  const lines = fs.readFileSync(KERNAL_LABEL_FILE, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^al\s+([0-9A-Fa-f]+)\s+\.(.+)/);
    if (m) {
      syms[parseInt(m[1], 16) & 0xffff] = m[2];
    }
  }
  return syms;
}

function findNearestSymbol(syms, addr) {
  let best = null;
  let bestDist = 0xffff;
  for (const [a, name] of Object.entries(syms)) {
    const d = (addr - Number(a)) & 0xffff;
    if (d < bestDist && d < 256) {
      best = name;
      bestDist = d;
    }
  }
  return best ? (best + (bestDist > 0 ? "+" + bestDist : "")) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const maxEvents = args.includes("--max-events")
    ? parseInt(args[args.indexOf("--max-events") + 1], 10) || 500
    : 500;
  const postCycles = args.includes("--post-cycles")
    ? parseInt(args[args.indexOf("--post-cycles") + 1], 10) || 5000000
    : 5000000;
  const screenshotPath = args.includes("--screenshot")
    ? path.resolve(REPO_ROOT, args[args.indexOf("--screenshot") + 1])
    : "";
  const filterReg = args.includes("--filter")
    ? args[args.indexOf("--filter") + 1].toUpperCase()
    : "";

  const syms = loadSymbols();
  const xexPath = path.resolve(REPO_ROOT, "build/atarixl/phase5_desktop_bootstrap.xex");
  const diskPath = path.resolve(REPO_ROOT, "build/atarixl/geos.atr");
  const osPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIXL.ROM");
  const basicPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIBAS.ROM");

  for (const [label, p] of [["XEX", xexPath], ["ATR", diskPath], ["OS ROM", osPath]]) {
    if (!fs.existsSync(p)) {
      console.error("FATAL: " + label + " not found: " + p);
      process.exit(3);
    }
  }

  const runtime = await createHeadlessAutomation({
    roms: {
      os: osPath,
      basic: fs.existsSync(basicPath) ? basicPath : undefined,
    },
    turbo: true,
    sioTurbo: false,
    frameDelayMs: 0,
    skipRendering: false,
  });

  try {
    const api = runtime.api;
    const app = runtime.app;
    await api.whenReady();

    const xexData = new Uint8Array(fs.readFileSync(xexPath));
    const diskData = new Uint8Array(fs.readFileSync(diskPath));

    // ---- Instrument I/O writes ----
    // The CPU write hook catches RAM writes. For ANTIC register writes
    // ($D400-$D40F) which go through ioAccess, we need to patch the
    // access function list for those addresses.
    const anticLog = [];
    let logging = false;

    // Get the machine context through the app object
    const ctx = app.ctx || (app.machine && app.machine.ctx) || null;
    if (ctx && ctx.accessFunctionList) {
      // Save original I/O access functions for $D400-$D40F
      const origFunctions = {};
      for (let addr = 0xd400; addr <= 0xd40f; addr++) {
        origFunctions[addr] = ctx.accessFunctionList[addr];
      }

      // Wrap each ANTIC address with a logging proxy
      for (let addr = 0xd400; addr <= 0xd40f; addr++) {
        const origFn = origFunctions[addr];
        const regAddr = addr;
        ctx.accessFunctionList[addr] = function (ctx2, value) {
          if (value != null && logging) {
            const pc = ctx2.currentInstructionPc & 0xffff;
            const op = ctx2.currentOpcode & 0xff;
            const regName = ANTIC_NAMES[regAddr] || "$" + hex4(regAddr);
            if (!filterReg || regName === filterReg) {
              anticLog.push({
                reg: regAddr,
                name: regName,
                val: value & 0xff,
                pc: pc,
                op: op,
                cyc: ctx2.cycleCounter >>> 0,
              });
            }
          }
          return origFn(ctx2, value);
        };
      }
      console.log("ANTIC write hooks installed on $D400-$D40F");
    } else {
      console.log("WARNING: Could not access CPU context — falling back to polling-only mode");
    }

    // Also hook GTIA color register writes ($D016-$D01A = COLPF0-COLBK on Atari)
    // These are the registers that C64 VIC init corrupts
    const GTIA_NAMES = {
      0xd016: "COLPF0/GRAFP2",
      0xd017: "COLPF1/GRAFP3",
      0xd018: "COLPF2/TRIG0",
      0xd019: "COLPF3/TRIG1",
      0xd01a: "COLBK/PRIOR",
      0xd01b: "GRACTL",
    };
    if (ctx && ctx.accessFunctionList) {
      for (let addr = 0xd016; addr <= 0xd01b; addr++) {
        const origFn = ctx.accessFunctionList[addr];
        const regAddr = addr;
        ctx.accessFunctionList[addr] = function (ctx2, value) {
          if (value != null && logging) {
            const pc = ctx2.currentInstructionPc & 0xffff;
            anticLog.push({
              reg: regAddr,
              name: GTIA_NAMES[regAddr] || "$" + hex4(regAddr),
              val: value & 0xff,
              pc: pc,
              op: ctx2.currentOpcode & 0xff,
              cyc: ctx2.cycleCounter >>> 0,
            });
          }
          return origFn(ctx2, value);
        };
      }
      console.log("GTIA write hooks installed on $D016-$D01B");
    }

    // ---- Boot to entry ----
    await api.debug.setBreakpoints([ENTRY_PC]);
    await api.dev.runXex({
      bytes: xexData,
      name: path.basename(xexPath),
      awaitEntry: false,
      start: true,
      resetOptions: { portB: 0xff },
    });
    const entryEvent = await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    if (!entryEvent || !entryEvent.debugState) {
      console.error("FATAL: Did not reach entry breakpoint");
      process.exit(3);
    }

    await api.media.mountDisk(diskData, { name: path.basename(diskPath), slot: 0 });
    await api.debug.setBreakpoints([]);

    // ---- Run until status reaches $80 (START_APPL), then enable tracing ----
    console.log("Running bootstrap to START_APPL ($80)...");
    await api.system.start();
    let status = 0;
    for (let chunk = 0; chunk < 500; chunk++) {
      await api.system.waitForCycles({ count: 20000 });
      status = await api.debug.readMemory(ADDR_STATUS);
      if (status >= 0x80 || status >= 0xe0) break;
    }
    console.log("Status reached: $" + hex2(status));

    if (status < 0x80) {
      console.error("Bootstrap did not reach START_APPL in time.");
      process.exit(2);
    }

    // Enable ANTIC logging now — this captures only desktop runtime writes
    logging = true;
    console.log("ANTIC tracing ENABLED — running " + postCycles + " more cycles...");

    // Run with periodic polling and check for log overflow
    const POLL_CHUNK = 50000;
    let remaining = postCycles;
    while (remaining > 0 && anticLog.length < maxEvents) {
      const step = Math.min(remaining, POLL_CHUNK);
      await api.system.waitForCycles({ count: step });
      remaining -= step;
    }
    logging = false;

    // ---- Report ----
    console.log("\n=== ANTIC/GTIA Write Trace (" + anticLog.length + " events) ===\n");

    // Deduplicate by PC to show unique write sources
    const byPc = {};
    for (const ev of anticLog) {
      const key = ev.pc + ":" + ev.reg;
      if (!byPc[key]) {
        byPc[key] = { ...ev, count: 1, values: [ev.val] };
      } else {
        byPc[key].count++;
        if (!byPc[key].values.includes(ev.val)) {
          byPc[key].values.push(ev.val);
        }
      }
    }

    const sorted = Object.values(byPc).sort((a, b) => a.cyc - b.cyc);
    console.log("Unique write sources (PC:register):\n");
    for (const ev of sorted) {
      const sym = findNearestSymbol(syms, ev.pc);
      const symStr = sym ? " [" + sym + "]" : "";
      const vals = ev.values.map(v => "$" + hex2(v)).join(",");
      console.log(
        "  PC=$" + hex4(ev.pc) + symStr +
        "  =>  " + ev.name + " ($" + hex4(ev.reg) + ")" +
        "  vals=" + vals +
        "  count=" + ev.count
      );
    }

    // Show raw log (first N entries)
    const showRaw = Math.min(anticLog.length, 100);
    if (showRaw > 0) {
      console.log("\nFirst " + showRaw + " raw events:\n");
      for (let i = 0; i < showRaw; i++) {
        const ev = anticLog[i];
        const sym = findNearestSymbol(syms, ev.pc);
        const symStr = sym ? " [" + sym + "]" : "";
        console.log(
          "  [" + i + "] " + ev.name +
          " <- $" + hex2(ev.val) +
          "  PC=$" + hex4(ev.pc) + symStr +
          "  cyc=" + ev.cyc
        );
      }
    }

    // Final display state
    const sdmctl = await api.debug.readMemory(0x022f);
    const sdlst_lo = await api.debug.readMemory(0x0230);
    const sdlst_hi = await api.debug.readMemory(0x0231);
    const nmien = await api.debug.readMemory(0xd40e);
    console.log("\nFinal display state:");
    console.log("  SDMCTL=$" + hex2(sdmctl) +
      " SDLST=$" + hex4((sdlst_hi << 8) | sdlst_lo) +
      " NMIST=$" + hex2(nmien) + " (note: $D40E read = NMIST, not NMIEN)");

    // Shadow color registers (OS VBI copies these to hardware each frame)
    const colorAddrs = [
      [0x02C0, "COLOR0/COLPF0"], [0x02C1, "COLOR1/COLPF1"],
      [0x02C2, "COLOR2/COLPF2"], [0x02C3, "COLOR3/COLPF3"],
      [0x02C8, "COLOR4/COLBK"],
    ];
    const colorVals = [];
    for (const [addr, name] of colorAddrs) {
      const v = await api.debug.readMemory(addr);
      colorVals.push("  " + name + "=$" + hex2(v));
    }
    console.log("  Shadow colors: " + colorVals.join("  "));

    // PORTB to check ROM banking state
    const portb = await api.debug.readMemory(0xd301);
    console.log("  PORTB=$" + hex2(portb) + " (bit0=" + (portb & 1) + " OS ROM " + ((portb & 1) ? "ON" : "OFF") + ")");

    // NMI/IRQ/RESET vectors (in RAM when OS ROM is off)
    const nmi_lo = await api.debug.readMemory(0xfffa);
    const nmi_hi = await api.debug.readMemory(0xfffb);
    const rst_lo = await api.debug.readMemory(0xfffc);
    const rst_hi = await api.debug.readMemory(0xfffd);
    const irq_lo = await api.debug.readMemory(0xfffe);
    const irq_hi = await api.debug.readMemory(0xffff);
    console.log("  NMI=$" + hex4((nmi_hi << 8) | nmi_lo) +
      " RESET=$" + hex4((rst_hi << 8) | rst_lo) +
      " IRQ=$" + hex4((irq_hi << 8) | irq_lo));

    // Check what symbol _NMIHandler maps to
    const nmiLabel = findNearestSymbol(syms, (nmi_hi << 8) | nmi_lo);
    console.log("  NMI handler: " + (nmiLabel || "unknown"));

    // Display list dump (first 30 bytes from SDLST address)
    const dlAddr = (sdlst_hi << 8) | sdlst_lo;
    if (dlAddr > 0) {
      const dlBytes = [];
      for (let i = 0; i < 30; i++) {
        dlBytes.push(await api.debug.readMemory(dlAddr + i));
      }
      console.log("  DList @$" + hex4(dlAddr) + ": " + dlBytes.map(hex2).join(" "));
    }

    // Screen sample
    const screenBytes = [];
    for (let i = 0; i < 40; i++) {
      screenBytes.push(await api.debug.readMemory(0x4000 + i));
    }
    console.log("  SCREEN_BASE row 0: " + screenBytes.map(hex2).join(" "));
    const row48bytes = [];
    for (let i = 0; i < 40; i++) {
      row48bytes.push(await api.debug.readMemory(0x4000 + 48 * 40 + i));
    }
    console.log("  SCREEN_BASE row 48 (icon area): " + row48bytes.map(hex2).join(" "));

    if (screenshotPath) {
      const shot = await api.artifacts.captureScreenshot();
      const png = Buffer.from(shot.base64 || "", "base64");
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, png);
      console.log("\nScreenshot saved: " + screenshotPath);
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
  if (err.stack) console.error(err.stack);
  process.exit(3);
});
