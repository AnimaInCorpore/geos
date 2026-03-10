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
automation avoids cross-frame data passing between the harness page and the
embedded emulator frame.

## Recommended Chrome Launch

Chrome is installed at:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

For direct automation, launch Chrome with remote debugging enabled:

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  --remote-debugging-port=9222 `
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

## Direct Automation Rules

When driving jsA8E directly:

1. Wait for `window.A8EAutomation.whenReady()`.
2. Pause the machine and clear inputs/breakpoints before each run.
3. Load ROMs explicitly if they are not already present:
   * `/ATARIXL.ROM`
   * `/ATARIBAS.ROM`
4. Fetch the XEX and ATR from the same page context that calls
   `A8EAutomation`. Do not fetch bytes in an outer frame and pass them into the
   emulator frame unless that path has been revalidated.
5. Collect `debugState`, `traceTail`, and optional disassembly whenever a wait
   times out. That usually gives a better diagnosis than only saving a
   screenshot.

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
2. `runXex(...)`
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
* Entry breakpoint: `$0501`
* Marker block: `$04E7-$04F5`

Flow:

1. `setBreakpoints([0x0501])`
2. `runXex(...)`
3. wait for breakpoint at `$0501`
4. `mountDisk(atr, { name: "phase4_disk_test.atr", slot: 0 })`
5. clear breakpoints
6. `start()`
7. `waitForTime({ ms: 1500, clock: "real" })`
8. `pause()`
9. `collectArtifacts({ ranges: [{ label: "phase4_markers", start: 0x04e7, length: 0x0f }], traceTailLimit: 32 })`

This remains diagnostic only. Altirra is still the sign-off path for Phase 4.

## Known Pitfalls

### Harness cross-frame `runXex` failure

Current harness runs can fail with:

```text
A8EAutomation.dev.runXex requires XEX bytes or a HostFS file
```

The practical workaround is to drive `third_party/A8E/jsA8E/index.html`
directly and fetch the XEX/ATR in that same page context.

### Phase 4 current jsA8E state

As of 2026-03-10, a direct jsA8E Phase 4 run starts the smoke XEX but does not
reach the expected `$0501` entry breakpoint within 15 seconds. The machine
settles in a loop around `$5059-$505E`:

```text
$5059  LDA $D01F
$505C  AND #$01
$505E  BNE $5059
```

At that point:

* `D1:` is still not mounted
* no `PHASE4_*` markers are available yet
* useful follow-up artifacts are:
  * paused `debugState`
  * `traceTail`
  * disassembly around the current PC

## Suggested Next-Session Start

For the fastest restart next time:

1. rebuild the needed smoke target
2. start `python -m http.server 8765`
3. decide whether the harness page is enough
4. if the harness fails early, switch immediately to direct Chrome/CDP on the
   emulator page
5. for Phase 4, treat a missed `$0501` breakpoint as a real diagnostic result
   and capture `debugState`, `traceTail`, and disassembly before changing code
