"use strict";

// Diagnostic: inspect jsA8E video pixel buffer via collectArtifacts
// and by directly accessing internal state through the automation API.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSA8E_DIR = path.resolve(REPO_ROOT, "third_party/A8E/jsA8E");
const { createHeadlessAutomation } = require(path.join(JSA8E_DIR, "headless"));

async function main() {
  const osPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIXL.ROM");
  const basicPath = path.resolve(REPO_ROOT, "third_party/A8E/ATARIBAS.ROM");

  if (!fs.existsSync(osPath)) {
    console.error("FATAL: OS ROM not found: " + osPath);
    process.exit(3);
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

    // Start and run
    console.log("Starting machine...");
    await api.system.start();
    console.log("Running 5000000 cycles (~170 frames)...");
    await api.system.waitForCycles({ count: 5000000 });

    // Check display hardware state via memory reads
    console.log("\n=== Hardware State ===");
    const dmactl = await api.debug.readMemory(0x022f); // SDMCTL
    const dlstl = await api.debug.readMemory(0x0230);
    const dlsth = await api.debug.readMemory(0x0231);
    const color0 = await api.debug.readMemory(0x02c0);
    const color1 = await api.debug.readMemory(0x02c1);
    const color2 = await api.debug.readMemory(0x02c2);
    const color4 = await api.debug.readMemory(0x02c8);
    console.log("SDMCTL=$" + dmactl.toString(16).padStart(2, "0") +
      " SDLST=$" + ((dlsth << 8) | dlstl).toString(16).padStart(4, "0"));
    console.log("COLOR0=$" + color0.toString(16).padStart(2, "0") +
      " COLOR1=$" + color1.toString(16).padStart(2, "0") +
      " COLOR2=$" + color2.toString(16).padStart(2, "0") +
      " COLOR4=$" + color4.toString(16).padStart(2, "0"));

    // Use collectArtifacts to get memory dumps + screenshot
    console.log("\n=== collectArtifacts test ===");
    const artifacts = await api.artifacts.collectArtifacts({
      screenshot: true,
      screenshotEncoding: "bytes",
      ranges: [
        { start: 0x022f, length: 3, label: "SDMCTL/SDLST" },
        { start: 0x02c0, length: 9, label: "COLOR registers" },
      ],
    });
    console.log("Artifacts keys:", Object.keys(artifacts));
    if (artifacts.screenshot) {
      console.log("Screenshot in artifacts:", !!artifacts.screenshot.bytes,
        "size:", artifacts.screenshot.bytes ? artifacts.screenshot.bytes.length : 0);
    }

    // Take screenshot directly
    const shot = await api.artifacts.captureScreenshot({ encoding: "bytes" });
    console.log("\nDirect screenshot:");
    console.log("  mimeType:", shot.mimeType);
    console.log("  bytes length:", shot.bytes ? shot.bytes.length : 0);

    if (shot.bytes) {
      const png = Buffer.from(shot.bytes);
      // Parse IHDR
      if (png.length > 24 && png[12] === 0x49) { // 'I'
        console.log("  Width:", png.readUInt32BE(16));
        console.log("  Height:", png.readUInt32BE(20));
      }
      const outPath = path.resolve(REPO_ROOT, "build/debug_screenshot.png");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, png);
      console.log("  Saved:", outPath);
    }

    // Check if the headless env has a createCaptureCanvas that actually works
    // The issue might be in how headless creates the canvas for screenshot
    console.log("\n=== Canvas environment check ===");
    const vmCtx = runtime.context;
    const vm = require("node:vm");
    const canvasInfo = vm.runInContext(`
      (function() {
        var info = {};
        info.hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
        info.hasDocument = typeof document !== 'undefined';
        info.hasCanvas = typeof HTMLCanvasElement !== 'undefined';

        // Check createCaptureCanvas from A8EAtariSupport
        if (typeof A8EAtariSupport !== 'undefined') {
          info.hasSupport = true;
          info.supportKeys = Object.keys(A8EAtariSupport);
          var canvas = A8EAtariSupport.createCaptureCanvas(10, 10);
          if (canvas) {
            info.canvasCreated = true;
            info.canvasType = typeof canvas;
            info.canvasConstructor = canvas.constructor ? canvas.constructor.name : 'unknown';
            var ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
              info.ctxCreated = true;
              info.ctxType = typeof ctx;
              info.hasCreateImageData = typeof ctx.createImageData === 'function';
              info.hasPutImageData = typeof ctx.putImageData === 'function';
              info.hasConvertToBlob = typeof canvas.convertToBlob === 'function';
              info.hasToBlob = typeof canvas.toBlob === 'function';
              info.hasToDataURL = typeof canvas.toDataURL === 'function';
              info.hasToBuffer = typeof canvas.toBuffer === 'function';

              // Try creating imageData and blitting
              if (info.hasCreateImageData) {
                var imageData = ctx.createImageData(10, 10);
                info.imageDataType = typeof imageData;
                info.imageDataKeys = Object.keys(imageData);
                info.imageDataLength = imageData.data ? imageData.data.length : 0;
              }
            }
          } else {
            info.canvasCreated = false;
          }
        }
        return info;
      })()
    `, vmCtx);
    console.log(JSON.stringify(canvasInfo, null, 2));

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
