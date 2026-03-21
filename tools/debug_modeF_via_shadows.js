"use strict";

// Test mode $F by modifying OS display list and shadow registers.
// The OS VBI copies shadow registers to hardware, so this approach works.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v) { return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0"); }

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

    // Read current display list address
    const sdlstl = await api.debug.readMemory(0x0230);
    const sdlsth = await api.debug.readMemory(0x0231);
    const dlAddr = (sdlsth << 8) | sdlstl;
    console.log("Current display list at $" + hex4(dlAddr));

    // Read and show current display list
    const dlBytes = [];
    for (let i = 0; i < 40; i++) {
      dlBytes.push(await api.debug.readMemory(dlAddr + i));
    }
    console.log("DL bytes: " + dlBytes.map(b => hex2(b)).join(" "));

    // Find the first mode 2 entry and its LMS address
    let dlOffset = 0;
    let screenAddr = 0;
    while (dlOffset < 40) {
      const b = dlBytes[dlOffset];
      const mode = b & 0x0f;
      const lms = (b & 0x40) !== 0;
      if (mode >= 2) {
        if (lms) {
          screenAddr = dlBytes[dlOffset + 1] | (dlBytes[dlOffset + 2] << 8);
          console.log("First mode line at DL+" + dlOffset + ": mode $" + hex2(mode) + " LMS=$" + hex4(screenAddr));
          break;
        }
      }
      if (mode === 0) { dlOffset++; }
      else if (mode === 1 || lms) { dlOffset += 3; }
      else { dlOffset++; }
    }

    // Build a NEW display list at $0600 for mode $F
    // 3 blank lines, then 96 mode $F lines pointing to $4000, then JVB
    let pos = 0x0600;
    await api.debug.writeMemory(pos++, 0x70); // blank 8
    await api.debug.writeMemory(pos++, 0x70); // blank 8
    await api.debug.writeMemory(pos++, 0x70); // blank 8
    const lmsPos = pos;
    await api.debug.writeMemory(pos++, 0x4F); // mode F + LMS
    await api.debug.writeMemory(pos++, 0x00); // LMS lo
    await api.debug.writeMemory(pos++, 0x40); // LMS hi
    for (let i = 0; i < 95; i++) {
      await api.debug.writeMemory(pos++, 0x0F); // mode F
    }
    await api.debug.writeMemory(pos++, 0x41); // JVB
    await api.debug.writeMemory(pos++, 0x00); // lo
    await api.debug.writeMemory(pos++, 0x06); // hi

    // Fill screen at $4000 with a test pattern
    for (let line = 0; line < 96; line++) {
      let val;
      if (line < 8) val = 0xFF; // top: all 1s (foreground)
      else if (line >= 88) val = 0xFF; // bottom: all 1s
      else if (line % 2 === 0) val = 0xAA; // even: checkerboard
      else val = 0x55; // odd: inverse checkerboard
      for (let col = 0; col < 40; col++) {
        await api.debug.writeMemory(0x4000 + line * 40 + col, val);
      }
    }
    console.log("Test screen filled at $4000.");

    // Set OS shadow registers to point to our new display list
    await api.debug.writeMemory(0x0230, 0x00); // SDLSTL = $00
    await api.debug.writeMemory(0x0231, 0x06); // SDLSTH = $06

    // Set color shadow registers
    await api.debug.writeMemory(0x02C0, 0x00); // COLOR0
    await api.debug.writeMemory(0x02C1, 0x00); // COLOR1 = black luma
    await api.debug.writeMemory(0x02C2, 0x0E); // COLOR2 = white (COLPF2)
    await api.debug.writeMemory(0x02C3, 0x00); // COLOR3
    await api.debug.writeMemory(0x02C4, 0x94); // COLOR4 = blue (COLBK)

    // Wait for VBI to propagate
    await api.system.waitForCycles({ count: 2000000 });

    // Verify
    const newSdlstl = await api.debug.readMemory(0x0230);
    const newSdlsth = await api.debug.readMemory(0x0231);
    console.log("SDLST = $" + hex4((newSdlsth << 8) | newSdlstl));
    console.log("COLOR2 = $" + hex2(await api.debug.readMemory(0x02C2)));
    console.log("COLOR4 = $" + hex2(await api.debug.readMemory(0x02C4)));

    // Take screenshot
    let shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/test_modeF_shadows.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("Mode F shadows screenshot: " + png.length + " bytes");
    }

    // Also try with GRAPHICS 8 via BASIC
    console.log("\n=== Testing via BASIC GRAPHICS 8 ===");
    // Type GRAPHICS 8 into BASIC
    await api.input.typeText("GRAPHICS 8\n");
    await api.system.waitForCycles({ count: 3000000 });

    // Set some pixels via PLOT/DRAWTO
    await api.input.typeText("COLOR 1\n");
    await api.system.waitForCycles({ count: 500000 });
    await api.input.typeText("PLOT 0,0:DRAWTO 319,191\n");
    await api.system.waitForCycles({ count: 2000000 });
    await api.input.typeText("PLOT 319,0:DRAWTO 0,191\n");
    await api.system.waitForCycles({ count: 2000000 });

    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/test_graphics8.png");
      fs.writeFileSync(outPath, png);
      console.log("GRAPHICS 8 screenshot: " + png.length + " bytes");
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
