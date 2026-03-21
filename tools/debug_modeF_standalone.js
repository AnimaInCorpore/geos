"use strict";

// Standalone mode $F test: no GEOS, just plain Atari OS with a manually
// configured mode $F display list. This tests if jsA8E mode $F rendering
// works at all.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, "0"); }

async function main() {
  const osPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIXL.ROM");
  const basicPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIBAS.ROM");

  if (!fs.existsSync(osPath)) { console.error("FATAL: OS ROM not found"); process.exit(3); }

  const runtime = await createHeadlessAutomation({
    roms: { os: osPath, basic: fs.existsSync(basicPath) ? basicPath : undefined },
    turbo: true, sioTurbo: false, frameDelayMs: 0, skipRendering: false,
  });

  try {
    const api = runtime.api;
    await api.whenReady();

    // Let Atari OS boot normally
    await api.system.start();
    await api.system.waitForCycles({ count: 5000000 });

    // Take screenshot of normal Atari boot (mode 2 text)
    let shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/test_normal_boot.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("Normal boot screenshot: " + png.length + " bytes");
    }

    // Now set up mode $F display list.
    // Build a 6502 program that:
    // 1. Sets up a mode F display list at $0600
    // 2. Fills screen memory at $4000 with test patterns
    // 3. Sets DMACTL, DLISTL/H, color registers
    // 4. Loops forever

    // Build display list at $0600:
    // 3 blank lines ($70 x 3)
    // Mode $F + LMS to $4000 ($4F, $00, $40)
    // 95 more mode F lines ($0F x 95)
    // JVB to $0600 ($41, $00, $06)

    // We'll write this data using writeMemory, then build a tiny 6502 program
    // that sets DMACTL and the display list registers.

    // First, fill screen memory at $4000 with a test pattern
    // Pattern: alternating $FF and $00 lines (checkerboard)
    for (let line = 0; line < 96; line++) {
      const val = (line < 10) ? 0xFF : // top: all foreground
                  (line >= 86) ? 0xFF : // bottom: all foreground
                  (line % 2 === 0) ? 0xAA : 0x55; // middle: checkerboard
      for (let col = 0; col < 40; col++) {
        await api.debug.writeMemory(0x4000 + line * 40 + col, val);
      }
    }
    console.log("Screen memory filled.");

    // Build display list at $0600
    await api.debug.writeMemory(0x0600, 0x70); // blank 8
    await api.debug.writeMemory(0x0601, 0x70); // blank 8
    await api.debug.writeMemory(0x0602, 0x70); // blank 8
    await api.debug.writeMemory(0x0603, 0x4F); // mode F + LMS
    await api.debug.writeMemory(0x0604, 0x00); // LMS lo = $00
    await api.debug.writeMemory(0x0605, 0x40); // LMS hi = $40
    for (let i = 0; i < 95; i++) {
      await api.debug.writeMemory(0x0606 + i, 0x0F); // mode F
    }
    await api.debug.writeMemory(0x0606 + 95, 0x41); // JVB
    await api.debug.writeMemory(0x0606 + 96, 0x00); // JVB lo
    await api.debug.writeMemory(0x0606 + 97, 0x06); // JVB hi

    console.log("Display list built at $0600.");

    // Build 6502 code at $0700 that sets everything up
    // LDA #$00  STA $D400  ; disable DMACTL first
    // LDA #$00  STA $D402  ; DLISTL = $00
    // LDA #$06  STA $D403  ; DLISTH = $06
    // LDA #$3E  STA $D400  ; DMACTL = $3E (normal PF, DL DMA, P/M DMA)
    // LDA #$94  STA $D01A  ; COLBK = $94 (blue)
    // LDA #$0E  STA $D018  ; COLPF2 = $0E (white)
    // LDA #$00  STA $D017  ; COLPF1 = $00 (black luma -> foreground)
    // LDA #$00  STA $D016  ; COLPF0 = $00
    // JMP $0700+offset  ; loop forever
    const code = [
      0xA9, 0x00, 0x8D, 0x00, 0xD4, // LDA #$00, STA $D400
      0xA9, 0x00, 0x8D, 0x02, 0xD4, // LDA #$00, STA $D402 (DLISTL)
      0xA9, 0x06, 0x8D, 0x03, 0xD4, // LDA #$06, STA $D403 (DLISTH)
      0xA9, 0x3E, 0x8D, 0x00, 0xD4, // LDA #$3E, STA $D400 (DMACTL)
      0xA9, 0x94, 0x8D, 0x1A, 0xD0, // LDA #$94, STA $D01A (COLBK)
      0xA9, 0x0E, 0x8D, 0x18, 0xD0, // LDA #$0E, STA $D018 (COLPF2)
      0xA9, 0x00, 0x8D, 0x17, 0xD0, // LDA #$00, STA $D017 (COLPF1)
      0xA9, 0x00, 0x8D, 0x16, 0xD0, // LDA #$00, STA $D016 (COLPF0)
      // Enable VBI so VCOUNT keeps advancing
      0xA9, 0x40, 0x8D, 0x0E, 0xD4, // LDA #$40, STA $D40E (NMIEN = VBI)
      // Infinite loop
      0x4C, 0x00, 0x07 + 45,         // JMP self (loop)
    ];
    // Fix the JMP target
    const loopAddr = 0x0700 + code.length - 3;
    code[code.length - 2] = loopAddr & 0xFF;
    code[code.length - 1] = (loopAddr >> 8) & 0xFF;

    for (let i = 0; i < code.length; i++) {
      await api.debug.writeMemory(0x0700 + i, code[i]);
    }
    console.log("Setup code written at $0700.");

    // Set breakpoint at current PC, execute our code
    // Actually, simpler: just set PC to $0700 and run
    // We can do this by building and running an XEX

    // Build XEX with our code
    const xexBytes = [];
    // XEX header: $FFFF
    xexBytes.push(0xFF, 0xFF);
    // Segment: start=$0700, end=$0700+code.length-1
    xexBytes.push(0x00, 0x07); // start lo/hi
    xexBytes.push((code.length - 1) & 0xFF, ((0x0700 + code.length - 1) >> 8) & 0xFF);
    for (const b of code) xexBytes.push(b);
    // Run address segment: $02E0-$02E1
    xexBytes.push(0xE0, 0x02, 0xE1, 0x02);
    xexBytes.push(0x00, 0x07); // run at $0700

    console.log("Running XEX...");
    await api.dev.runXex({
      bytes: new Uint8Array(xexBytes),
      name: "modeF_test.xex",
      awaitEntry: false,
      start: true,
    });

    // Wait for it to execute and render a few frames
    await api.system.waitForCycles({ count: 5000000 });

    // Take screenshot
    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/test_modeF_standalone.png");
      fs.writeFileSync(outPath, png);
      console.log("Mode F standalone screenshot: " + png.length + " bytes");
    }

    // Verify state
    const sdmctl = await api.debug.readMemory(0x022f);
    console.log("SDMCTL: $" + hex2(sdmctl));

    // Read some screen data back
    for (let i = 0; i < 5; i++) {
      const v = await api.debug.readMemory(0x4000 + i);
      console.log("Screen[$" + (0x4000 + i).toString(16) + "]: $" + hex2(v));
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
