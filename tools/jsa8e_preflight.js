"use strict";

const ADDR_PAL_R = 0xd014;

const REQUIRED_AUTOMATION_CAPABILITIES = [
  "groupedApi",
  "urlXexLoad",
  "urlDiskLoad",
  "failureSnapshots",
  "progressEvents",
  "waitPrimitives",
  "cacheControl",
  "snapshots",
  "memoryWrite",
  "memoryWait",
  "resetPortBOverride",
];

const BOOT_GUARDS = {
  maxBootInstructions: 1_000_000,
  maxBootCycles: "5s",
  detectTightLoop: true,
};

function hex2(value) {
  return ((value & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(value) {
  return ((value & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

function summarizeMediaSlots(state) {
  const slots =
    state &&
    state.media &&
    Array.isArray(state.media.deviceSlots)
      ? state.media.deviceSlots
      : [];
  const mounted = slots
    .filter(function (slot) {
      return slot && slot.mounted;
    })
    .map(function (slot) {
      const index =
        slot.slot !== undefined
          ? slot.slot
          : slot.index !== undefined
            ? slot.index
            : "?";
      return "D" + (Number(index) + 1) + ":" + (slot.name || "mounted");
    });
  return mounted.length ? mounted.join(",") : "none";
}

async function getSystemState(api, timeoutMs) {
  if (api.system && typeof api.system.getSystemState === "function") {
    return api.system.getSystemState({ timeoutMs: timeoutMs });
  }
  return api.getSystemState({ timeoutMs: timeoutMs });
}

async function readAutomationState(api, label, timeoutMs) {
  const state = await getSystemState(api, timeoutMs || 3000);
  if (state && state.error && state.error.details && state.error.details.parts) {
    console.warn(
      "jsA8E state partial (" + label + "): " +
        Object.keys(state.error.details.parts).join(",")
    );
  }

  const debugState = state && state.debugState ? state.debugState : null;
  const pc = debugState ? "$" + hex4(debugState.pc) : "$????";
  console.log(
    "jsA8E state (" + label + "): ready=" + !!(state && state.ready) +
      " running=" + !!(state && state.running) +
      " pc=" + pc +
      " media=" + summarizeMediaSlots(state)
  );
  return state;
}

async function verifyAutomationPreflight(api, options) {
  const opts = options && typeof options === "object" ? options : {};
  const label = opts.label || "preflight";
  const timeoutMs = opts.timeoutMs || 3000;
  const capabilities = await api.getCapabilities();
  const missing = REQUIRED_AUTOMATION_CAPABILITIES.filter(function (name) {
    return !capabilities[name];
  });
  if (missing.length) {
    throw new Error(
      "jsA8E automation baseline missing for " + label + ": " +
        missing.join(", ")
    );
  }

  const state = await readAutomationState(api, label, timeoutMs);
  const palR = await api.debug.readMemory(ADDR_PAL_R);
  if ((palR & 0x08) !== 0) {
    throw new Error(
      "jsA8E run is not using a PAL Atari 800 XL profile: PAL_R=$" +
        hex2(palR)
    );
  }

  console.log(
    "jsA8E automation baseline OK: api=" +
      (capabilities.apiVersion || "?") +
      " artifactSchema=" +
      (capabilities.artifactSchemaVersion || "?") +
      " PAL_R=$" +
      hex2(palR)
  );

  return {
    capabilities: capabilities,
    state: state,
    palR: palR,
  };
}

module.exports = {
  BOOT_GUARDS,
  REQUIRED_AUTOMATION_CAPABILITIES,
  readAutomationState,
  verifyAutomationPreflight,
};
