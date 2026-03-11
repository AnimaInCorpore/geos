(function () {
  "use strict";

  const DEFAULT_ENTRY_PC = 0x0501;
  const DEFAULT_TIMEOUT_MS = 15000;
  const ROM_PATHS = {
    os: "/ATARIXL.ROM",
    basic: "/ATARIBAS.ROM",
  };
  const PHASE4_MARKER_RANGE = { label: "phase4_markers", start: 0x04e7, length: 0x0f };
  const BITMAP_HEAD_RANGE = { label: "bitmap_head", start: 0x4000, length: 0x40 };
  const GUARD_GAP_RANGE = { label: "guard_gap", start: 0x4ff0, length: 0x10 };

  const SCENARIOS = {
    phase2_display: {
      id: "phase2_display",
      label: "Phase 2 display",
      prereq: "make atarixl-smoketest",
      xexPath: "/build/atarixl/phase2_smoketest.xex",
      entryPc: DEFAULT_ENTRY_PC,
      description:
        "Boot the low-RAM Phase 2 display harness, let the static bitmap settle, then capture a screenshot and a small framebuffer dump.",
      caveat: "Repeatable browser automation path. Step sign-off still stays in Altirra.",
      run: runPhase2Display,
    },
    phase3_input: {
      id: "phase3_input",
      label: "Phase 3 input",
      prereq: "make atarixl-input-smoketest",
      xexPath: "/build/atarixl/phase3_input_smoketest.xex",
      entryPc: DEFAULT_ENTRY_PC,
      description:
        "Boot the input smoke harness, inject joystick and keyboard activity through the public automation API, and capture before/after screenshots.",
      caveat: "Repeatable browser automation and smoke evidence path, not final input timing sign-off.",
      run: runPhase3Input,
    },
    phase4_disk: {
      id: "phase4_disk",
      label: "Phase 4 disk",
      prereq: "make atarixl-disk-smoketest",
      xexPath: "/build/atarixl/phase4_disk_smoketest.xex",
      diskPath: "/build/atarixl/phase4_disk_test.atr",
      entryPc: 0x0881,
      runXexOptions: {
        awaitEntry: false,
        start: true,
        resetOptions: { portB: 0xff },
      },
      description:
        "Boot the Phase 4 XEX to its $0881 entry breakpoint, replace D1 with the writable ATR, then collect screenshot, trace, and PHASE4_* marker bytes.",
      caveat:
        "Browser-side diagnostic/sign-off-prep path: jsA8E cannot boot the XEX and mount the test ATR in D1 simultaneously, so the harness swaps D1 after the boot loader reaches $0881.",
      run: runPhase4Disk,
    },
  };

  const state = {
    busy: false,
    artifactUrl: "",
    objectUrls: [],
    progressEvents: [],
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.scenarioSelect = document.getElementById("scenarioSelect");
    els.scenarioMeta = document.getElementById("scenarioMeta");
    els.runButton = document.getElementById("runButton");
    els.clearButton = document.getElementById("clearButton");
    els.statusPill = document.getElementById("statusPill");
    els.resultBadge = document.getElementById("resultBadge");
    els.logOutput = document.getElementById("logOutput");
    els.emulatorFrame = document.getElementById("emulatorFrame");
    els.resultSummary = document.getElementById("resultSummary");
    els.screenshotGallery = document.getElementById("screenshotGallery");
    els.artifactJson = document.getElementById("artifactJson");
    els.downloadJsonLink = document.getElementById("downloadJsonLink");

    populateScenarioList();
    els.scenarioSelect.addEventListener("change", refreshScenarioMeta);
    els.runButton.addEventListener("click", function () {
      runSelectedScenario().catch(handleRunError);
    });
    els.clearButton.addEventListener("click", clearLog);

    applyQueryParams();
    refreshScenarioMeta();
  }

  function populateScenarioList() {
    const keys = Object.keys(SCENARIOS);
    for (let i = 0; i < keys.length; i++) {
      const scenario = SCENARIOS[keys[i]];
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = scenario.label;
      els.scenarioSelect.appendChild(option);
    }
  }

  function applyQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const scenario = params.get("scenario");
    if (scenario && SCENARIOS[scenario]) {
      els.scenarioSelect.value = scenario;
    }
    if (params.get("autorun") === "1") {
      window.setTimeout(function () {
        runSelectedScenario().catch(handleRunError);
      }, 200);
    }
  }

  function refreshScenarioMeta() {
    const scenario = getSelectedScenario();
    if (!scenario) return;
    const lines = [
      "<div><strong>Build prerequisite:</strong> <code>" + escapeHtml(scenario.prereq) + "</code></div>",
      "<div><strong>XEX:</strong> <code>" + escapeHtml(scenario.xexPath) + "</code></div>",
      "<div>" + escapeHtml(scenario.description) + "</div>",
      "<div><strong>Caveat:</strong> " + escapeHtml(scenario.caveat) + "</div>",
    ];
    if (scenario.diskPath) {
      lines.splice(
        2,
        0,
        "<div><strong>ATR:</strong> <code>" + escapeHtml(scenario.diskPath) + "</code></div>",
      );
    }
    els.scenarioMeta.innerHTML = lines.join("");
  }

  function getSelectedScenario() {
    return SCENARIOS[els.scenarioSelect.value] || null;
  }

  async function runSelectedScenario() {
    if (state.busy) return;
    const scenario = getSelectedScenario();
    if (!scenario) throw new Error("No jsA8E scenario is selected");

    let api = null;
    let progressSubscription = 0;
    state.busy = true;
    state.progressEvents = [];
    setStatus("Running");
    els.resultBadge.textContent = "Running";
    els.runButton.disabled = true;
    els.scenarioSelect.disabled = true;
    resetResults();
    logLine("Starting " + scenario.label);

    try {
      api = await getAutomationApi();
      progressSubscription = subscribeToProgress(api);
      const capabilities = await api.getCapabilities();
      logLine("Capabilities: " + JSON.stringify(capabilities));
      await ensureRoms(api);
      await prepareForRun(api);

      const result = await scenario.run(api, scenario);
      await finalizeResult(api, scenario, result);
      setStatus("Complete");
      els.resultBadge.textContent = result.badge || "Complete";
    } finally {
      if (
        api &&
        api.events &&
        typeof api.events.unsubscribe === "function" &&
        progressSubscription
      ) {
        api.events.unsubscribe(progressSubscription);
      }
      state.busy = false;
      els.runButton.disabled = false;
      els.scenarioSelect.disabled = false;
    }
  }

  async function prepareForRun(api) {
    try {
      await api.system.pause();
    } catch {
      // ignore
    }
    await api.input.releaseAllInputs();
    await api.debug.setBreakpoints([]);
  }

  async function ensureRoms(api) {
    const systemState = await api.getSystemState();
    if (!systemState.roms || !systemState.roms.osLoaded) {
      logLine("Loading ATARIXL.ROM");
      await api.media.loadRom("os", { buffer: await fetchArrayBuffer(ROM_PATHS.os) });
    }
    if (!systemState.roms || !systemState.roms.basicLoaded) {
      logLine("Loading ATARIBAS.ROM");
      await api.media.loadRom("basic", { buffer: await fetchArrayBuffer(ROM_PATHS.basic) });
    }
  }

  async function getAutomationApi() {
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const frameWindow = els.emulatorFrame.contentWindow;
      if (
        frameWindow &&
        frameWindow.A8EAutomation &&
        typeof frameWindow.A8EAutomation.whenReady === "function"
      ) {
        return frameWindow.A8EAutomation.whenReady();
      }
      await sleep(100);
    }

    throw new Error("jsA8E automation API did not become ready");
  }

  async function runPhase2Display(api, scenario) {
    const entryEvent = await bootXexToEntry(
      api,
      scenario.xexPath,
      scenario.entryPc,
      scenario.runXexOptions,
    );
    if (isFailureArtifact(entryEvent)) {
      return buildBootFailureResult(
        scenario,
        entryEvent,
        "The display smoke binary did not reach its expected entry breakpoint.",
      );
    }
    await api.debug.setBreakpoints([]);
    await api.system.start();
    const waitResult = await api.system.waitForTime({ ms: 900, clock: "real" });
    const pausedState = await settleForArtifacts(api, waitResult);
    const screenshot = await captureScreenshot(api, "phase2-display");
    const artifacts = await api.artifacts.collectArtifacts({
      ranges: [BITMAP_HEAD_RANGE, GUARD_GAP_RANGE],
      traceTailLimit: 16,
    });

    logLine("Phase 2 paused state: " + formatState(pausedState));
    return {
      badge: waitResult.ok ? "Ready" : "Paused",
      summary: [
        "Booted " + scenario.xexPath,
        "Captured the static display harness after the bitmap settled.",
        "Collected the first 64 bytes of the bitmap and the 16-byte ANTIC guard gap at $4FF0-$4FFF.",
      ],
      screenshots: [screenshot],
      artifacts: artifacts,
    };
  }

  async function runPhase3Input(api, scenario) {
    const entryEvent = await bootXexToEntry(
      api,
      scenario.xexPath,
      scenario.entryPc,
      scenario.runXexOptions,
    );
    if (isFailureArtifact(entryEvent)) {
      return buildBootFailureResult(
        scenario,
        entryEvent,
        "The input smoke binary did not reach its expected entry breakpoint.",
      );
    }
    await api.debug.setBreakpoints([]);
    await api.system.start();
    await api.system.waitForTime({ ms: 450, clock: "real" });

    const screenshots = [];
    screenshots.push(await captureScreenshot(api, "phase3-baseline"));
    logLine("Captured baseline input frame");

    await api.input.setJoystick({ right: true });
    await api.system.waitForTime({ ms: 320, clock: "real" });
    await api.input.releaseAllInputs();
    await api.system.waitForTime({ ms: 160, clock: "real" });
    screenshots.push(await captureScreenshot(api, "phase3-joystick"));
    logLine("Captured joystick-injected frame");

    await api.input.tapKey({ key: "a", code: "KeyA" }, { afterMs: 120 });
    await api.system.waitForTime({ ms: 180, clock: "real" });
    screenshots.push(await captureScreenshot(api, "phase3-keyboard"));
    logLine("Captured keyboard-injected frame");

    const pausedState = await api.system.pause();
    const artifacts = await api.artifacts.collectArtifacts({ traceTailLimit: 16 });

    logLine("Phase 3 paused state: " + formatState(pausedState));
    return {
      badge: "Ready",
      summary: [
        "Booted " + scenario.xexPath,
        "Injected joystick-right through input.setJoystick(...).",
        "Injected a keyboard event through input.tapKey(...).",
      ],
      screenshots: screenshots,
      artifacts: artifacts,
    };
  }

  async function runPhase4Disk(api, scenario) {
    const entryEvent = await bootXexToEntry(
      api,
      scenario.xexPath,
      scenario.entryPc,
      scenario.runXexOptions,
    );
    if (isFailureArtifact(entryEvent)) {
      return buildBootFailureResult(
        scenario,
        entryEvent,
        "The Phase 4 XEX still failed before the harness could swap D1 to the test ATR.",
      );
    }
    const diskUrl = withCacheBust(scenario.diskPath);
    logLine("Swapping D1 to " + scenario.diskPath + " at $" + hex(entryEvent.debugState.pc, 4));
    const mountResult = await api.media.mountDiskFromUrl(diskUrl, {
      name: fileNameFromPath(scenario.diskPath),
      slot: 0,
    });
    logLine(
      "Mounted D1 from " +
        (mountResult.sourceUrl || scenario.diskPath) +
        " (" +
        (mountResult.byteLength | 0) +
        " bytes)",
    );
    await api.debug.setBreakpoints([]);
    await api.system.start();

    const waitResult = await api.system.waitForTime({ ms: 1500, clock: "real" });
    const pausedState = await settleForArtifacts(api, waitResult);
    const screenshot = await captureScreenshot(api, "phase4-disk");
    const artifacts = await api.artifacts.collectArtifacts({
      ranges: [PHASE4_MARKER_RANGE],
      traceTailLimit: 32,
    });
    const phase4Markers = decodePhase4Markers(artifacts);

    if (phase4Markers) {
      logLine(
        "Phase 4 markers: stage=$" +
          hex(phase4Markers.stage, 2) +
          " status=$" +
          hex(phase4Markers.status, 2) +
          " error=$" +
          hex(phase4Markers.error, 2) +
          " results=$" +
          hex(phase4Markers.results, 2) +
          " done=$" +
          hex(phase4Markers.done, 2),
      );
    }
    logLine("Phase 4 paused state: " + formatState(pausedState));

    return {
      badge: waitResult.ok ? "Captured" : "Paused",
      summary: buildPhase4Summary(scenario, phase4Markers, waitResult),
      screenshots: [screenshot],
      artifacts: artifacts,
      phase4Markers: phase4Markers,
    };
  }

  async function bootXexToEntry(api, xexPath, entryPc, runXexOptions) {
    const targetPc = typeof entryPc === "number" ? entryPc & 0xffff : DEFAULT_ENTRY_PC;
    const xexUrl = withCacheBust(xexPath);
    await api.debug.setBreakpoints([targetPc]);
    logLine("Booting " + xexPath + " to entry breakpoint $" + hex(targetPc, 4));
    await api.dev.runXexFromUrl(
      xexUrl,
      Object.assign(
        {
          name: fileNameFromPath(xexPath),
        },
        runXexOptions || {},
      ),
    );
    const stop = await api.debug.waitForBreakpoint({
      timeoutMs: DEFAULT_TIMEOUT_MS,
      immediate: false,
      screenshot: true,
      traceTailLimit: 32,
      beforeInstructions: 8,
      afterInstructions: 8,
    });
    if (isFailureArtifact(stop)) {
      logLine("Entry wait failed: " + describeFailure(stop));
      return stop;
    }
    if (!stop || !stop.debugState) {
      throw new Error("The smoke XEX did not reach the expected entry breakpoint");
    }
    logLine("Breakpoint hit: " + formatState(stop.debugState));
    return stop;
  }

  async function settleForArtifacts(api, waitResult) {
    if (waitResult && waitResult.ok === false && waitResult.debugState) {
      logLine("Execution stopped early: " + formatState(waitResult.debugState));
      return waitResult.debugState;
    }
    return api.system.pause();
  }

  async function captureScreenshot(api, label) {
    const shot = await api.artifacts.captureScreenshot();
    const bytes = base64ToBytes(shot.base64 || "");
    const blob = new Blob([bytes], { type: shot.mimeType || "image/png" });
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    return {
      label: label,
      url: url,
      downloadName: label + ".png",
      width: shot.width | 0,
      height: shot.height | 0,
    };
  }

  async function finalizeResult(api, scenario, result) {
    const systemState = await api.getSystemState();
    const output = {
      scenario: scenario.id,
      scenarioLabel: scenario.label,
      timestamp: new Date().toISOString(),
      progressEvents: state.progressEvents.slice(),
      systemState: systemState,
      phase4Markers: result.phase4Markers || null,
      artifacts: result.artifacts,
    };

    const artifactText = JSON.stringify(output, null, 2);
    els.artifactJson.textContent = artifactText;
    updateJsonDownload(artifactText, scenario.id + "_artifacts.json");
    renderSummary(systemState, result);
    renderScreenshots(result.screenshots || []);
    logLine("Scenario complete");
  }

  function renderSummary(systemState, result) {
    const lines = [];
    const debugState = result.artifacts && result.artifacts.debugState;
    lines.push(renderSummaryLine("Renderer", systemState.rendererBackend || "unknown"));
    lines.push(renderSummaryLine("Run state", debugState ? formatState(debugState) : "n/a"));
    lines.push(renderSummaryLine("Mounted media", formatMountedMedia(systemState)));
    if (result.artifacts && result.artifacts.failure) {
      lines.push(
        renderSummaryLine(
          "Failure phase",
          result.artifacts.phase || result.artifacts.failure.phase || "n/a",
        ),
      );
      lines.push(
        renderSummaryLine(
          "Failure reason",
          result.artifacts.failure.reason || "n/a",
        ),
      );
    }
    if (result.artifacts && result.artifacts.consoleKeys) {
      lines.push(
        renderSummaryLine(
          "Console keys",
          formatConsoleKeys(result.artifacts.consoleKeys),
        ),
      );
    }

    const summary = Array.isArray(result.summary) ? result.summary : [];
    for (let i = 0; i < summary.length; i++) {
      lines.push(renderSummaryLine("Note", summary[i]));
    }

    if (result.phase4Markers) {
      lines.push(
        renderSummaryLine(
          "Phase 4 markers",
          "stage=$" +
            hex(result.phase4Markers.stage, 2) +
            " status=$" +
            hex(result.phase4Markers.status, 2) +
            " error=$" +
            hex(result.phase4Markers.error, 2) +
            " results=$" +
            hex(result.phase4Markers.results, 2) +
            " done=$" +
            hex(result.phase4Markers.done, 2),
        ),
      );
      lines.push(
        renderSummaryLine(
          "Phase 4 dir",
          "count=" +
            result.phase4Markers.dirCount +
            " type=$" +
            hex(result.phase4Markers.dirType, 2) +
            " name=" +
            result.phase4Markers.dirName,
        ),
      );
    }

    els.resultSummary.innerHTML = lines.join("");
  }

  function renderSummaryLine(label, value) {
    return (
      "<div><strong>" +
      escapeHtml(label) +
      ":</strong> " +
      escapeHtml(String(value || "")) +
      "</div>"
    );
  }

  function renderScreenshots(screenshots) {
    els.screenshotGallery.innerHTML = "";
    for (let i = 0; i < screenshots.length; i++) {
      const shot = screenshots[i];
      const article = document.createElement("article");
      article.className = "shot";

      const head = document.createElement("div");
      head.className = "shot-head";

      const titleWrap = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = shot.label;
      const meta = document.createElement("span");
      meta.textContent = shot.width + "x" + shot.height;
      titleWrap.appendChild(strong);
      titleWrap.appendChild(meta);

      const link = document.createElement("a");
      link.href = shot.url;
      link.download = shot.downloadName;
      link.textContent = "Download PNG";

      const image = document.createElement("img");
      image.src = shot.url;
      image.alt = shot.label;

      head.appendChild(titleWrap);
      head.appendChild(link);
      article.appendChild(head);
      article.appendChild(image);
      els.screenshotGallery.appendChild(article);
    }
  }

  function resetResults() {
    clearObjectUrls();
    if (state.artifactUrl) {
      URL.revokeObjectURL(state.artifactUrl);
      state.artifactUrl = "";
    }
    els.resultSummary.innerHTML = "<div>Run in progress.</div>";
    els.screenshotGallery.innerHTML = "";
    els.artifactJson.textContent = "Run in progress.";
    els.downloadJsonLink.hidden = true;
    els.downloadJsonLink.removeAttribute("href");
  }

  function subscribeToProgress(api) {
    if (!api || !api.events || typeof api.events.subscribe !== "function") {
      return 0;
    }
    return api.events.subscribe("progress", function (event) {
      const entry = sanitizeProgressEvent(event);
      state.progressEvents.push(entry);
      logLine("Progress: " + formatProgressEvent(entry));
    });
  }

  function updateJsonDownload(text, name) {
    if (state.artifactUrl) {
      URL.revokeObjectURL(state.artifactUrl);
    }
    state.artifactUrl = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    els.downloadJsonLink.href = state.artifactUrl;
    els.downloadJsonLink.download = name;
    els.downloadJsonLink.hidden = false;
  }

  function buildPhase4Summary(scenario, markers, waitResult) {
    const entryPc = typeof scenario.entryPc === "number" ? scenario.entryPc & 0xffff : DEFAULT_ENTRY_PC;
    const lines = [
      "Booted " + scenario.xexPath + " to $" + hex(entryPc, 4) + " and swapped D1 to " + scenario.diskPath + ".",
      waitResult && waitResult.ok === false
        ? "Execution paused early with reason '" + (waitResult.reason || "pause") + "'."
        : "Execution was allowed to run for 1500 ms before artifact capture.",
    ];

    if (markers) {
      lines.push(
        "PHASE4_STAGE=$" +
          hex(markers.stage, 2) +
          ", PHASE4_STATUS=$" +
          hex(markers.status, 2) +
          ", PHASE4_ERROR=$" +
          hex(markers.error, 2) +
          ", PHASE4_RESULTS=$" +
          hex(markers.results, 2) +
          ", PHASE4_DONE=$" +
          hex(markers.done, 2) +
          ".",
      );
    }

    return lines;
  }

  function buildBootFailureResult(scenario, failure, note) {
    const entryPc = typeof scenario.entryPc === "number" ? scenario.entryPc & 0xffff : DEFAULT_ENTRY_PC;
    const screenshot = screenshotFromArtifactBundle(failure, scenario.id + "-failure");
    return {
      badge: failure.phase === "waiting_for_console_input" ? "Console Wait" : "Timeout",
      summary: [
        "Boot attempt for " + scenario.xexPath + " did not reach $" + hex(entryPc, 4) + ".",
        describeFailure(failure),
        note,
      ],
      screenshots: screenshot ? [screenshot] : [],
      artifacts: failure,
      phase4Markers: decodePhase4Markers(failure),
    };
  }

  function decodePhase4Markers(artifacts) {
    if (!artifacts || !Array.isArray(artifacts.memoryRanges)) return null;
    for (let i = 0; i < artifacts.memoryRanges.length; i++) {
      const range = artifacts.memoryRanges[i];
      if (range.label !== PHASE4_MARKER_RANGE.label) continue;
      const bytes = hexToBytes(range.hex || "");
      if (bytes.length < PHASE4_MARKER_RANGE.length) return null;
      return {
        ddrb: bytes[0],
        portb: bytes[1],
        pbctl: bytes[2],
        c2a1: bytes[3],
        stage: bytes[4],
        status: bytes[5],
        error: bytes[6],
        results: bytes[7],
        done: bytes[8],
        dirCount: bytes[9],
        dirType: bytes[10],
        dirName: asciiFromBytes(bytes.slice(11, 15)),
      };
    }
    return null;
  }

  function formatMountedMedia(systemState) {
    if (!systemState || !systemState.media || !Array.isArray(systemState.media.deviceSlots)) {
      return "n/a";
    }
    const slots = [];
    for (let i = 0; i < systemState.media.deviceSlots.length; i++) {
      const slot = systemState.media.deviceSlots[i];
      if (!slot || !slot.mounted) continue;
      slots.push("D" + (i + 1) + "=" + (slot.name || "mounted"));
    }
    return slots.length ? slots.join(", ") : "none";
  }

  function formatConsoleKeys(consoleKeys) {
    if (!consoleKeys) return "n/a";
    return (
      "option=" +
      (!!consoleKeys.option) +
      ", select=" +
      (!!consoleKeys.select) +
      ", start=" +
      (!!consoleKeys.start)
    );
  }

  function setStatus(text) {
    els.statusPill.textContent = text;
  }

  function clearLog() {
    els.logOutput.textContent = "Log cleared.";
  }

  function logLine(message) {
    const line = "[" + new Date().toLocaleTimeString() + "] " + message;
    if (!els.logOutput.textContent || els.logOutput.textContent === "No run yet.") {
      els.logOutput.textContent = line;
    } else {
      els.logOutput.textContent += "\n" + line;
    }
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }

  function handleRunError(error) {
    setStatus("Error");
    els.resultBadge.textContent = "Error";
    const message = error && error.message ? error.message : String(error);
    logLine("Error: " + message);
    els.resultSummary.innerHTML =
      '<div><strong>Run failed:</strong> ' + escapeHtml(message) + "</div>";
    els.artifactJson.textContent = message;
  }

  function isFailureArtifact(result) {
    return !!(result && result.ok === false && result.failure);
  }

  function describeFailure(failure) {
    if (!failure) return "Automation failed.";
    const parts = [];
    if (failure.phase) parts.push("phase=" + failure.phase);
    if (failure.failure && failure.failure.reason) {
      parts.push("reason=" + failure.failure.reason);
    } else if (failure.reason) {
      parts.push("reason=" + failure.reason);
    }
    if (failure.failure && failure.failure.message) {
      parts.push(failure.failure.message);
    }
    if (failure.debugState) {
      parts.push("PC=$" + hex(failure.debugState.pc, 4));
    }
    return parts.join(", ") || "Automation failed.";
  }

  function screenshotFromArtifactBundle(bundle, label) {
    if (
      !bundle ||
      !bundle.screenshot ||
      bundle.screenshot.error ||
      !bundle.screenshot.base64
    ) {
      return null;
    }
    const bytes = base64ToBytes(bundle.screenshot.base64);
    const blob = new Blob([bytes], { type: bundle.screenshot.mimeType || "image/png" });
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    return {
      label: label,
      url: url,
      downloadName: label + ".png",
      width: bundle.screenshot.width | 0,
      height: bundle.screenshot.height | 0,
    };
  }

  function sanitizeProgressEvent(event) {
    const out = {
      timestamp: new Date().toISOString(),
      operation: event && event.operation ? String(event.operation) : "automation",
      phase: event && event.phase ? String(event.phase) : "progress",
    };
    if (event && event.url) out.url = String(event.url);
    if (event && event.responseUrl) out.responseUrl = String(event.responseUrl);
    if (event && typeof event.status === "number") out.status = event.status | 0;
    if (event && event.reason) out.reason = String(event.reason);
    if (event && event.message) out.message = String(event.message);
    if (event && typeof event.targetPc === "number") out.targetPc = event.targetPc & 0xffff;
    if (event && typeof event.pc === "number") out.pc = event.pc & 0xffff;
    if (event && typeof event.byteLength === "number") out.byteLength = event.byteLength | 0;
    if (event && typeof event.slot === "number") out.slot = event.slot | 0;
    return out;
  }

  function formatProgressEvent(event) {
    const parts = [event.operation + ":" + event.phase];
    if (event.status !== undefined) parts.push("status=" + event.status);
    if (event.targetPc !== undefined) parts.push("target=$" + hex(event.targetPc, 4));
    if (event.pc !== undefined) parts.push("pc=$" + hex(event.pc, 4));
    if (event.slot !== undefined) parts.push("slot=" + event.slot);
    if (event.byteLength !== undefined) parts.push("bytes=" + event.byteLength);
    if (event.reason) parts.push("reason=" + event.reason);
    if (event.message) parts.push(event.message);
    return parts.join(" ");
  }

  async function fetchArrayBuffer(path) {
    const response = await fetch(withCacheBust(path));
    if (!response.ok) {
      throw new Error("Unable to fetch " + path + " (" + response.status + ")");
    }
    return response.arrayBuffer();
  }

  function withCacheBust(path) {
    const text = String(path || "");
    const joiner = text.includes("?") ? "&" : "?";
    return text + joiner + "cb=" + Date.now();
  }

  function clearObjectUrls() {
    for (let i = 0; i < state.objectUrls.length; i++) {
      URL.revokeObjectURL(state.objectUrls[i]);
    }
    state.objectUrls = [];
  }

  function base64ToBytes(base64) {
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function hexToBytes(hexText) {
    const text = String(hexText || "").trim();
    if (!text.length) return new Uint8Array(0);
    const out = new Uint8Array(text.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(text.substr(i * 2, 2), 16) & 0xff;
    }
    return out;
  }

  function asciiFromBytes(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const value = bytes[i] & 0xff;
      if (!value || value === 0xa0) break;
      if (value >= 32 && value <= 126) out += String.fromCharCode(value);
      else out += ".";
    }
    return out || "(blank)";
  }

  function fileNameFromPath(path) {
    const normalized = String(path || "").replace(/[?#].*$/, "");
    const parts = normalized.split(/[\\/]/);
    return parts[parts.length - 1] || "artifact.bin";
  }

  function formatState(state) {
    if (!state) return "n/a";
    return (
      "reason=" +
      (state.reason || "update") +
      " PC=$" +
      hex(state.pc, 4) +
      " A=$" +
      hex(state.a, 2) +
      " X=$" +
      hex(state.x, 2) +
      " Y=$" +
      hex(state.y, 2) +
      " SP=$" +
      hex(state.sp, 2)
    );
  }

  function hex(value, width) {
    return ((value || 0) >>> 0).toString(16).toUpperCase().padStart(width, "0");
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms | 0);
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
