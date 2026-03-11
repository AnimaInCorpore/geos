# jsA8E Automation Quick Start

This note records the shortest reliable path for running the Atari XL smoke
checks through `window.A8EAutomation`, plus the current failure modes that are
easy to forget between sessions.

## Build Prerequisites

Build the smoke artifact that matches the test you want to run:

* Phase 2 display: `make atarixl-smoketest`
* Phase 3 input: `make atarixl-input-smoketest`
* Phase 4 disk diagnostics: `make atarixl-disk-smoketest`

The current Atari XL smoke artifacts live under `build/atarixl/`.

## Serve The Repo Root

jsA8E expects HTTP, not `file://`.

From the repository root:

```powershell
python -m http.server 8765
```

Primary URLs:

* Harness page: `http://127.0.0.1:8765/tools/jsa8e_automation_smoketest.html`
* Emulator page: `http://127.0.0.1:8765/third_party/A8E/jsA8E/index.html`

## Choose The Right Entry Point

Use the harness page when you want the existing Phase 2/3/4 scenario UI and its
built-in screenshot/artifact collection.

Use the emulator page directly when you need scripted control from Chrome/CDP or
when the harness is failing before it reaches the real emulator work. Direct
automation now has feature parity with the harness on media loading because
jsA8E exposes URL-native `runXexFromUrl(...)` and `mountDiskFromUrl(...)`.

If worker-backed automation is the variable you are trying to eliminate, boot
the emulator page with `?a8e_worker=0` or set
`window.A8E_BOOT_OPTIONS = { worker: false }` before `ui.js` runs. That forces
the main-thread backend while keeping the same public `window.A8EAutomation`
contract.

## Recommended Chrome Launch

Chrome is installed at:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

For direct automation, launch Chrome with remote debugging enabled:

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  --remote-debugging-port=9222 `
  --remote-allow-origins=http://127.0.0.1:9222 `
  --user-data-dir="$env:TEMP\codex-jsa8e-profile" `
  --headless=new `
  --disable-gpu `
  --disable-extensions `
  --no-first-run `
  --no-default-browser-check `
  --window-size=1600,1200 `
  http://127.0.0.1:8765/third_party/A8E/jsA8E/index.html
```

Then attach through the Chrome DevTools Protocol (`/json/list` ->
`webSocketDebuggerUrl`) and evaluate in the page that owns
`window.A8EAutomation`.

Two practical notes from recent runs:

* Recent Chrome builds reject the DevTools WebSocket with HTTP 403 unless the
  launch command includes a matching `--remote-allow-origins=...` flag (or `*`
  if you explicitly want that).
* Use a fresh remote-debugging port and/or a fresh `--user-data-dir` for each
  scripted run when possible. Reusing an older Chrome instance can make CDP
  attach to the wrong tab or inherit stale origin-policy state.

## Direct Automation Rules

When driving jsA8E directly:

1. Wait for `window.A8EAutomation.whenReady()`.
2. Snapshot the machine with `getSystemState({ timeoutMs: ... })` before each
   run. Treat a returned `error.details.parts` payload as partial state, not as
   a generic hang.
3. Pause the machine and clear inputs/breakpoints before each run. Worker-backed
   `start()` / `pause()` / `reset()` now resolve only after the state transition
   is acknowledged.
4. Load ROMs explicitly if they are not already present:
   * `/ATARIXL.ROM`
   * `/ATARIBAS.ROM`
5. Prefer `dev.runXexFromUrl("/build/atarixl/....xex")` and
   `media.mountDiskFromUrl("/build/atarixl/....atr")` over manual fetch-plus-buffer
   handoff.
   Do not use `../build/...` from the harness page: the embedded iframe runs at
   `/third_party/A8E/jsA8E/index.html`, so jsA8E resolves media URLs relative to
   that location and `../build/...` incorrectly points at `/third_party/A8E/build/...`
   instead of the repo-root `/build/...` tree.
6. Subscribe to `events.subscribe("progress", handler)` when debugging loader or
   media issues. The progress phases now distinguish resource fetch, media
   acceptance, loader installation, loader execution, entry-PC success, and
   timeout/failure phases.
7. Treat timeout returns from `waitForPc()` / `waitForBreakpoint()` as
   structured failure bundles, not only as exceptions. They can already include
   `debugState`, `traceTail`, disassembly, console-key state, mounted media,
   and an optional screenshot.
8. For ad-hoc capture, use `artifacts.captureFailureState(...)` or
   `debug.runUntilPcOrSnapshot(...)` before writing one-off harness code.
9. In headless CDP runs, do not assume the harness query string
   (`?scenario=...&autorun=1`) is sufficient evidence that a scenario actually
   started. Confirm via the harness DOM/log state, or set the scenario and
   trigger the run explicitly through CDP.

## Per-Scenario Recipes

### Phase 2 display

Use:

* XEX: `/build/atarixl/phase2_smoketest.xex`
* Wait: about `900 ms` real time after start
* Artifacts:
  * screenshot
  * `bitmap_head` at `$4000` length `$40`
  * `guard_gap` at `$4FF0` length `$10`

Flow:

1. `setBreakpoints([0x0501])`
2. `runXexFromUrl(...)`
3. wait for `$0501`
4. clear breakpoints
5. `start()`
6. `waitForTime({ ms: 900, clock: "real" })`
7. `pause()`
8. `collectArtifacts(...)`

### Phase 3 input

Use:

* XEX: `/build/atarixl/phase3_input_smoketest.xex`
* Baseline settle: about `450 ms`
* Input sequence:
  * baseline screenshot
  * joystick right
  * keyboard `KeyA`

Flow:

1. boot to `$0501`
2. clear breakpoints
3. `start()`
4. `waitForTime({ ms: 450, clock: "real" })`
5. baseline screenshot
6. `setJoystick({ right: true })`
7. wait about `320 ms`
8. `releaseAllInputs()`
9. wait about `160 ms`
10. joystick screenshot
11. `tapKey({ key: "a", code: "KeyA" }, { afterMs: 120 })`
12. wait about `180 ms`
13. keyboard screenshot
14. `pause()` and collect trace/artifacts

### Phase 4 disk diagnostics

Use:

* XEX: `/build/atarixl/phase4_disk_smoketest.xex`
* ATR: `/build/atarixl/phase4_disk_test.atr`
* Entry breakpoint: `$0881`
* Marker block: `$04E7-$04F5`

Flow:

1. `setBreakpoints([0x0881])`
2. `runXexFromUrl("/build/atarixl/phase4_disk_smoketest.xex", { name: "phase4_disk_smoketest.xex", awaitEntry: false, start: true, resetOptions: { portB: 0xFF } })`
3. wait for breakpoint at `$0881`
4. `mountDiskFromUrl("/build/atarixl/phase4_disk_test.atr", { name: "phase4_disk_test.atr", slot: 0 })`
5. clear breakpoints
6. `start()`
7. `waitForTime({ ms: 1500, clock: "real" })`
8. `pause()`
9. `collectArtifacts({ ranges: [{ label: "phase4_markers", start: 0x04e7, length: 0x0f }], traceTailLimit: 32 })`

For Phase 4, this remains a diagnostic and sign-off-prep flow. jsA8E is already a
real automation surface here, but Altirra is still the sign-off path because the
browser harness swaps `D1:` after the XEX reaches `$0881` instead of reproducing
the final boot configuration exactly.

Before and after the ATR swap, capture `getSystemState({ timeoutMs: ... })` so
the failure bundle records ROM readiness, mounted media, bank state, and any
partial worker-read failures alongside the disk markers.

## Known Pitfalls

### Phase 4 current jsA8E state

As of 2026-03-11, jsA8E has the newer automation surface upstream:

* `runXexFromUrl(...)`
* `mountDiskFromUrl(...)`
* `captureFailureState(...)`
* `runUntilPcOrSnapshot(...)`
* progress events via `events.subscribe("progress", ...)`
* structured timeout bundles from `waitForPc()` / `waitForBreakpoint()`

That means the harness and the direct emulator page can both use the same
URL-native media path. The earlier automation deadlocks are no longer the main
problem: worker lifecycle calls acknowledge completion, `getSystemState()`
degrades into partial-state errors instead of hanging, and the same API can be
forced into main-thread mode for deterministic fallback. The remaining Phase 4
problem is later in disk/runtime behavior, not media transport or XEX preflight.
A Phase 4 jsA8E run now reaches the rebased `$0881` entry breakpoint when
launched with `awaitEntry: false`, `start: true`, and a reset-time `PORTB=$FF`
override, then stalls after the writable ATR is swapped into `D1:` and the
first `ReadBlock` starts.

The browser harness now appends a cache-busting query to `runXexFromUrl(...)`,
`mountDiskFromUrl(...)`, and ROM fetches. Without that, Chrome/jsA8E can keep
serving a stale Phase 4 XEX and report the old `$0500-$1FFF` preflight overlap
even after the rebuilt `$0880-$1FFF` image exists on disk.

The current observed marker/data state after resuming from `$0881` in a successful run:

* `PHASE4_STAGE=$01`
* `PHASE4_STATUS=$67` (ReadBlock success)
* `PHASE4_ERROR=$00`
* `PHASE4_RESULTS=$01` (Pass Dir)

The earlier SIO stall (stuck at `$66`) was resolved by the updated low-RAM SIO bridge in `kernal/start/start_atari.s`, which now enables NMIs (`NMIEN=$40`) and restores OS VBI vectors during the `SIOV` call. This allows OS timers to increment, enabling `SIOV` to complete and return.

### Cache-busting reload

When browser caching is suspicious, jsA8E now exposes:

* `system.reload({ cacheBust: true })`

Use that on the emulator page before reconnecting, or reload the harness page
with a cache-busting query when you want both the host UI and the embedded frame
to pick up fresh scripts.

## Suggested Next-Session Start

For the fastest restart next time:

1. rebuild the needed smoke target
2. start `python -m http.server 8765`
3. run `npm run test:automation` in `third_party/A8E/jsA8E` if you need to
   confirm the current automation layer before debugging GEOS-specific behavior
4. try the harness page first; it now uses `runXexFromUrl(...)`,
   `mountDiskFromUrl(...)`, progress events, structured timeout artifacts, and
   acknowledged worker lifecycle control
5. if the worker path is suspect, retry the emulator page with `?a8e_worker=0`
   before changing GEOS code
6. if Phase 4 still misses `$0881`, keep the emitted progress log and failure
   bundle before retrying in direct Chrome/CDP
7. for Phase 4, treat a missed `$0881` breakpoint as a real diagnostic result
   and keep `debugState`, `traceTail`, disassembly, console-key state, and the
   inferred failure phase before changing code
