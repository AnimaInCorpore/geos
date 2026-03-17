"use strict";

// Runs the Phase 4 disk smoketest against multiple ATR images and checks each
// run via the PHASE4_* pass markers reported by tools/phase4_disk_run.js.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.resolve(REPO_ROOT, "build/atarixl");
const RUNNER = path.resolve(REPO_ROOT, "tools/phase4_disk_run.js");
const DISK_TOOL = path.resolve(REPO_ROOT, "tools/atari_geos_disk.py");

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(label + " failed with exit code " + String(result.status));
  }
}

function generateEmptyDisk(diskPath) {
  runOrThrow(
    "python3",
    [DISK_TOOL, "--disk-name", "GEOSXL", diskPath],
    "ATR generation"
  );
}

function copyForWritableRun(sourcePath) {
  const base = path.basename(sourcePath, ".atr");
  const targetPath = path.join(BUILD_DIR, base + ".step17.atr");
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function main() {
  const phase4Disk = path.join(BUILD_DIR, "phase4_disk_test.atr");
  const geosDisk = path.join(BUILD_DIR, "geos.atr");
  const blankDisk = path.join(BUILD_DIR, "blank_geos.atr");
  const disks = [phase4Disk, geosDisk, blankDisk];

  generateEmptyDisk(geosDisk);
  generateEmptyDisk(blankDisk);

  for (const disk of disks) {
    if (!fs.existsSync(disk)) {
      throw new Error("Required ATR not found: " + disk);
    }
  }

  console.log("Running Phase 4 matrix on:");
  for (const disk of disks) {
    console.log("  " + disk);
  }

  for (const sourceDisk of disks) {
    const writableDisk = copyForWritableRun(sourceDisk);
    console.log("");
    console.log("=== " + path.basename(sourceDisk) + " -> " + path.basename(writableDisk) + " ===");
    runOrThrow("node", [RUNNER, "--disk", writableDisk], "phase4 disk run");
  }

  console.log("");
  console.log("Phase 4 matrix PASS for phase4_disk_test/geos/blank_geos ATR images.");
}

try {
  main();
} catch (error) {
  console.error("Fatal:", error && error.message ? error.message : String(error));
  process.exit(1);
}
