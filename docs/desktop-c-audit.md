# C Desktop Audit for Atari XL

Date: 2026-05-07

Scope:
- `third_party/geos-desktop2.1-master/src/desktop.c`
- `third_party/geos-desktop2.1-master/src/desktop-res.grc`
- Directly included support files were sampled where they affect the decision, because
  `desktop.c` includes them into the same translation unit.

## Decision

Do not replace `apps/desktop_atari.s` with this C desktop as the next mainline step.
Keep refining the native Atari desktop, and use this C code as a high-level behavior
reference for menus, directory paging, icon selection, and the info dialog.

Reason: the source is useful application logic, but its build target, headers,
runtime memory model, direct memory accesses, driver loading behavior, and several
input/device paths are still C64-specific. Making it Atari-ready would require a real
cc65 GEOS-Atari target plus application changes, not just swapping the CVT into the
Atari disk image.

## Hard Atari Blockers

| Area | Source | Atari issue | Required retarget |
| --- | --- | --- | --- |
| Build target | `build.bat`, `desktop-res.grc` | Builds with `cl65 -t geos-cbm`; generated header has `mode c64only`. The cc65 GEOS C headers and libraries assume C64 GEOS zero page, memory symbols, and target startup. | Add or vendor an Atari GEOS cc65 target/runtime, or compile only after replacing the GEOS C ABI assumptions. Change the resource mode away from C64-only. |
| Zero page ABI | cc65 GEOS target used by `desktop.c` | `geos-cbm` uses `R_BASE=$02`, while the Atari port moved GEOS registers to `$80`. Calls that pass parameters through `r0`-`r15` would write the wrong zero-page bytes. | Provide Atari-aware `gsym.h`/runtime/library objects with `R_BASE=$80` and matching syscall wrappers. |
| Screen memory | `desktop.c:45`, `desktop.c:235` | `PEEK(0x8c00)` and `FillRam(0x8c00, ..., 1000)` assume a C64 GEOS screen/color area. On Atari `$8c00` is in the `$8000-$8fff` OS/disk-buffer region and must not be cleared. | Remove the direct `$8c00` access. Use GEOS drawing calls or Atari screen/back-buffer symbols. |
| C target memory map | cc65 `geos-cbm` config | Default application/heap/stack assumptions allow code and stack above `$4000`; Atari uses `$4000-$5f4f` for the visible bitmap and reserves `$3f40-$3fff` for icons. | Link the C app with a custom Atari memory config. Keep code/BSS/heap below `$3f40` or explicitly place heap/stack in a safe non-screen region. |
| Input driver load | `desktop.c:64-78` | Always scans D8 for a GEOS `INPUT_DEVICE` file and loads it. On Atari the input driver is already part of the selected Atari build path; a C64 input driver file would be unsafe. | Make this an Atari no-op or an Atari-driver selector that only accepts Atari-compatible drivers. |
| Printer driver load | `desktop.c:80-108` | Same D8-first assumption and C64 printer-driver file type workflow. Atari printer support is not equivalent yet. | Gate behind implemented Atari printer support; otherwise show status only. |
| Non-GEOS conversion | `desktop.c:265-268` | `SetGEOSDisk()` assumes GEOS/C64 disk semantics. The Atari path uses ATR geometry and a custom GEOS disk builder. | Disable until an Atari DOS-to-GEOS conversion path exists. |
| Directory cursor internals | `desktop.c:315-337`, `desktop.c:340-400`, `desktop.c:512-531` | Uses `$8000/$8001` and `r5 = 0x8002 - 0x20` to page through directory buffers. The current Atari port preserves the GEOS buffer layout, so this is not instantly wrong, but it is fragile and tied to kernel internals. | Prefer `GetPtrCurDkNm`, `Get1stDirEntry`, `GetNxtDirEntry`, and named symbols/constants over raw addresses and manual `r5` adjustment. |
| C64 keyboard matrix | included `desktop-vectors.c` | `isCBMKeyPressed()` banks I/O with `$01` and reads CIA `$dc00/$dc01`. This is hard C64 hardware. | Replace with an Atari modifier policy, probably Option/Select/Control depending on desired desktop UX. |
| BASIC exit | included `desktop-menu.c`, `desktop-icons.c` | `ToBASIC()` and the menu label `BASIC` are C64 desktop semantics. In ROM-off Atari GEOS there is no safe C64 BASIC return path. | Replace with an Atari reset/exit action or remove the item. |

## Mostly Portable Pieces

- The 320x200 layout itself is compatible with the Atari mode `$0f` bitmap target.
- GEOS drawing calls such as `FrameRectangle`, `Rectangle`, `HorizontalLine`,
  `VerticalLine`, `DrawLine`, `PutString`, `PutDecimal`, and `DoMenu` are the right
  abstraction layer, assuming the Atari KERNAL routines remain regression-clean.
- Directory listing logic based on `Get1stDirEntry`, `GetNxtDirEntry`, `GetFHdrInfo`,
  `FindFile`, and `GetFile` is a useful high-level model for the native desktop.
- The icon table shape and menu hierarchy are useful references for growing
  `apps/desktop_atari.s`.
- `appMain` and `otherPressVec` hook concepts match the GEOS event model, but the
  C function-pointer ABI must be retargeted before using this implementation.

## Resource Notes

- The mirrored `target/desktop.cvt` is 13,450 bytes. The current native Atari desktop
  CVT is about 1 KB. The C app may fit in low application RAM after relinking, but its
  default cc65 stack/heap placement does not fit the Atari bitmap map.
- `desktop.c` uses `calloc()`/`free()` for icon tables during normal UI flows. A port
  should replace this with static storage or a tightly bounded heap before relying on
  it in the constrained Atari app region.
- The app stores eight file icons with 64 bytes of bitmap data each, plus drive,
  printer, trash, close, and multi-file icons. The data volume is reasonable; the risk
  is placement and API compatibility, not icon size.
- The resource file's menu table is small, but the generated header must come from
  `desktop-res.grc`; editing `desktop-res.h` directly is not durable.
- A local `cl65 -t geos-cbm` compile attempt is not reliable evidence for Atari
  readiness, because it regenerates C64-target resources and still links the C64 GEOS
  C runtime.

## Recommended Path

1. Keep `apps/desktop_atari.s` as the shipping Atari shell.
2. Port features incrementally from this C desktop's behavior:
   menu labels and callbacks first, then directory paging, file selection, info dialog,
   and finally file operations.
3. If a C desktop port is still desired later, start by creating a small Atari cc65
   GEOS proof app that calls only `ClrScr`, `PutString`, `DoMenu`, and `MainLoop`.
   Do not port `desktop.c` until that proves the Atari C ABI, zero page, stack, heap,
   and CVT header path.
4. Treat the C desktop's full source as a reference implementation, not as an
   importable artifact, until every hard blocker above has an Atari replacement.
