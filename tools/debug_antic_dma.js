"use strict";

// Test if ANTIC is actually fetching display list and rendering playfield.
// We do this by modifying the display list to use a different mode (e.g., mode 2 = text)
// and see if text renders. If text renders but mode F doesn't, there's a mode F bug.
// If nothing renders, there's an ANTIC state machine issue.

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

    // TEST 1: Check if the display list is being read by ANTIC
    // Write a known byte to where the display list should be and see effect
    // Display list at $C55D. The first 3 bytes are $70 $70 $70 (3 blank line entries)
    // followed by $4F (mode $F with LMS)

    // Read current display list
    console.log("=== Current display list (first 10 bytes) ===");
    for (let i = 0; i < 10; i++) {
      const v = await api.debug.readMemory(0xC55D + i);
      console.log("  $" + hex4(0xC55D + i) + ": $" + hex2(v));
    }

    // TEST 2: Create a simple display list in RAM that uses mode 2 (text)
    // This bypasses any issues with mode F specifically.
    // Build display list at $0600 (safe area):
    // $70 $70 $70 (3 blank lines)
    // $42 $00 $40 (mode 2 LMS $4000)
    // $02 x 23 (23 more mode 2 lines)
    // $41 $00 $06 (JVB $0600)

    // First fill screen at $4000 with text-mode data
    // In mode 2, each byte is an ATASCII character, rendered using CHBASE
    // Fill with character 'A' ($21 in internal code) = visible
    for (let i = 0; i < 960; i++) { // 24 lines * 40 chars
      await api.debug.writeMemory(0x4000 + i, 0x21 + (i % 26)); // A-Z repeating
    }

    // Build display list at $0600
    await api.debug.writeMemory(0x0600, 0x70); // blank 8
    await api.debug.writeMemory(0x0601, 0x70); // blank 8
    await api.debug.writeMemory(0x0602, 0x70); // blank 8
    await api.debug.writeMemory(0x0603, 0x42); // mode 2 + LMS
    await api.debug.writeMemory(0x0604, 0x00); // LMS low = $00
    await api.debug.writeMemory(0x0605, 0x40); // LMS high = $40
    for (let i = 0; i < 23; i++) {
      await api.debug.writeMemory(0x0606 + i, 0x02); // mode 2
    }
    await api.debug.writeMemory(0x0606 + 23, 0x41); // JVB
    await api.debug.writeMemory(0x0606 + 24, 0x00); // JVB low
    await api.debug.writeMemory(0x0606 + 25, 0x06); // JVB high

    // Set colors for visibility
    await api.debug.writeMemory(0xC558, 0x94); // COLBK = blue
    await api.debug.writeMemory(0xC559, 0x00); // COLPF0
    await api.debug.writeMemory(0xC55A, 0x0E); // COLPF1 = white
    await api.debug.writeMemory(0xC55B, 0x94); // COLPF2 = blue
    await api.debug.writeMemory(0xC55C, 0x00); // COLPF3

    // Now point display list to our new one
    // Need to write DLISTL/DLISTH through the hardware registers
    // But writeMemory writes to ram[], not through I/O...
    // We need to write through the I/O access function.
    // Alternative: modify MaintainAtariDisplay's display list pointer

    // The display list address is stored at:
    //   - atari_dlist symbol in the kernal (what MaintainAtariDisplay uses)
    //   - SDLSTL/SDLSTH shadow registers ($0230/$0231)
    //   - io.displayListAddress (ANTIC internal)

    // We can't write to io.displayListAddress through the API.
    // But we CAN modify the shadow registers AND the value in atari_dlist.
    // MaintainAtariDisplay does:
    //   lda #<atari_dlist → STA DLISTL
    //   lda #>atari_dlist → STA DLISTH
    // So it hardcodes the display list address. We can't change it without
    // modifying the code.

    // Instead, let's modify the EXISTING display list at $C55D to use mode 2.
    // Change the first mode entry from $4F (mode F + LMS) to $42 (mode 2 + LMS)
    await api.debug.writeMemory(0xC560, 0x42); // mode 2 + LMS (was $4F)
    // Following bytes are LMS address $4000 (already correct)
    // Change subsequent mode F ($0F) entries to mode 2 ($02)
    for (let i = 0xC563; i <= 0xC58F; i++) {
      await api.debug.writeMemory(i, 0x02); // mode 2
    }
    // Add JVB
    await api.debug.writeMemory(0xC590, 0x41); // JVB
    await api.debug.writeMemory(0xC591, 0x5D); // low byte
    await api.debug.writeMemory(0xC592, 0xC5); // high byte

    // Wait for display to update
    await api.system.waitForCycles({ count: 2000000 });

    // Take screenshot
    let shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_mode2_test.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("Mode 2 test screenshot: " + png.length + " bytes");
    }

    // Now restore mode F but keep the colors
    await api.debug.writeMemory(0xC560, 0x4F); // mode F + LMS
    for (let i = 0xC563; i <= 0xC58F; i++) {
      await api.debug.writeMemory(i, 0x0F); // mode F
    }
    // Restore JVB position - BUT MaintainAtariDisplay will overwrite DLISTL/H
    // every VBI, which resets ANTIC to $C55D. So the display list IS being
    // reset every frame. That should be fine.

    // Wait and screenshot
    await api.system.waitForCycles({ count: 2000000 });

    shot = await api.artifacts.captureScreenshot();
    if (shot && shot.base64) {
      const png = Buffer.from(shot.base64, "base64");
      const outPath = path.resolve(REPO_ROOT, "build/geos_modeF_restored.png");
      fs.writeFileSync(outPath, png);
      console.log("Mode F restored screenshot: " + png.length + " bytes");
    }

    // TEST 3: Check what CHBASE is set to (affects character rendering)
    const chbase = await api.debug.readMemory(0xd409); // reads VCOUNT actually
    // Can't read CHBASE through API... check shadow
    const chbas = await api.debug.readMemory(0x02f4); // CHBAS shadow
    console.log("CHBAS shadow ($02F4): $" + hex2(chbas));

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
