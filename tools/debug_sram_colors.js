"use strict";

// Check sram values for GTIA color registers during GEOS desktop rendering.
// The mode F renderer reads from sram[0xD016..0xD01A] for colors.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

const ENTRY_PC = 0x0881;
const ADDR_STATUS = 0x04d0;

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
    const vmCtx = runtime.context;
    await api.whenReady();

    const xexData = new Uint8Array(fs.readFileSync(xexPath));
    const diskData = new Uint8Array(fs.readFileSync(diskPath));

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
    console.log("Desktop painted, running 5M more cycles...");
    await api.system.waitForCycles({ count: 5000000 });

    // Read GTIA sram values by accessing them through the VM context
    // The app doesn't expose sram directly, but we can try reading GTIA registers
    // via the readMemory API (which reads ram[], not sram[])

    // IO address for GTIA color registers:
    // COLPF0=$D016 (write) / GRAFP2=$D016 (read)
    // COLPF1=$D017 (write) / GRAFP3=$D017 (read)
    // COLPF2=$D018 (write) / TRIG0=$D018 (read)
    // COLPF3=$D019 (write) / TRIG1=$D019 (read)
    // COLBK=$D01A (write) / PRIOR=$D01A (read)

    // readMemory reads from ram[], which may not reflect sram[] for I/O addresses
    // Let's read shadow registers instead (OS copies shadow -> hardware via VBI)
    const sdmctl = await api.debug.readMemory(0x022f);
    const color0 = await api.debug.readMemory(0x02c0);
    const color1 = await api.debug.readMemory(0x02c1);
    const color2 = await api.debug.readMemory(0x02c2);
    const color3 = await api.debug.readMemory(0x02c3);
    const color4 = await api.debug.readMemory(0x02c8);

    console.log("\nOS Shadow registers:");
    console.log("  SDMCTL=$" + sdmctl.toString(16).padStart(2, "0"));
    console.log("  COLOR0=$" + color0.toString(16).padStart(2, "0") + " (COLPF0)");
    console.log("  COLOR1=$" + color1.toString(16).padStart(2, "0") + " (COLPF1)");
    console.log("  COLOR2=$" + color2.toString(16).padStart(2, "0") + " (COLPF2) ← should be $0F");
    console.log("  COLOR3=$" + color3.toString(16).padStart(2, "0") + " (COLPF3)");
    console.log("  COLOR4=$" + color4.toString(16).padStart(2, "0") + " (COLBK)");

    // PORTB to check ROM banking
    const portb = await api.debug.readMemory(0xd301);
    console.log("  PORTB=$" + portb.toString(16).padStart(2, "0") + " (OS ROM " + ((portb & 1) ? "ON" : "OFF") + ")");

    // Now read sram through injected code
    const sramInfo = vm.runInContext(`
      (function() {
        // We need to find sram. It's in machine.ctx.sram.
        // But machine is a closure variable in A8EApp.create().
        // However, the readMemory function exposed on the app reads from ram, not sram.
        // Let's try to find it through the global objects.
        var result = {};

        // Actually, can we access it via getBankState? That might read from sram.
        return result;
      })()
    `, vmCtx);

    // Use getBankState to check
    const bankState = await api.debug.getBankState();
    console.log("\nBank state:", JSON.stringify(bankState));

    // Try readRange for I/O area
    // readMemory at $D018 reads TRIG0 (read register), not COLPF2 (write register)
    // The read value at $D018 is the trigger state, not the color
    const trig0 = await api.debug.readMemory(0xd018);
    const trig1 = await api.debug.readMemory(0xd019);
    console.log("\nI/O read at $D018 (TRIG0/COLPF2 addr):", "$" + trig0.toString(16).padStart(2, "0"));
    console.log("I/O read at $D019 (TRIG1/COLPF3 addr):", "$" + trig1.toString(16).padStart(2, "0"));

    // Check: does the writeMemory API write to sram?
    // If we write to $D018 via API, does it update sram?
    console.log("\nAttempting to write COLPF2=$0F via writeMemory API...");
    await api.debug.writeMemory(0xd018, 0x0f);
    // Read back
    const afterWrite = await api.debug.readMemory(0xd018);
    console.log("After writeMemory($D018, $0F), read=$" + afterWrite.toString(16).padStart(2, "0"));

    // Run more cycles and take screenshot
    await api.system.waitForCycles({ count: 2000000 });

    const shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_desktop_after_write.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("\nScreenshot after writeMemory: " + outPath + " (" + png.length + " bytes)");
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
