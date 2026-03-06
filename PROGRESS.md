# Porting Progress

Source: `PORTING.md` -> "8. Recommended Porting Sequence"

Update rule: after each completed porting step, change exactly one matching checkbox from `[ ]` to `[x]`.

## Phase 1: Build infrastructure

- [x] 1. Add `atarixl` variant to `Makefile` and `config.inc`
- [x] 2. Create `inc/atari.inc`
- [x] 3. Derive `kernal/kernal_atarixl.cfg` from `kernal_bsw.cfg`; adjust addresses
- [x] 4. Shift GEOS zero page to `$80` in `inc/geossym.inc`; wrap `START_IO`/`CLEAR_IO` in `inc/geosmac.inc`
- [x] 5. Verify the build completes without assembler errors (binary will be non-functional)

### Notes

- 2026-03-05: Completed step 4 by adding Atari-only zero-page remapping in `inc/geossym.inc` (`r0` now starts at `$80`) and making `START_IO`/`END_IO` macros no-ops under `atarixl` in `inc/geosmac.inc`.
- 2026-03-05: Installed additional 6502 assembler alternatives via Homebrew for compatibility checks: `acme`, `64tass` (formula `tass64`), and `xa`.
- 2026-03-05: `make clean && make atarixl` now completes and produces `build/atarixl/geos.d64` (currently non-functional, with expected linker warnings for not-yet-implemented Atari segments such as `start_atari`, `hw_atari`, `irq_atari`, and `keyboard_atari`).

## Phase 2: Bring up the display (OS-assisted mode)

- [x] 6. Write `kernal/start/start_atari.s` (ANTIC display list, GTIA color init)
- [x] 7. Write `kernal/hw/hw_atari.s`
- [ ] 8. Boot in Altirra emulator with OS ROM active; verify bitmap appears on screen
- [ ] 9. Run graphics routines (`HorizontalLine`, `Rectangle`); confirm correct output

## Phase 3: Bring up input (OS-assisted mode)

- [x] 10. Write `input/joydrv_atari.s`
- [x] 11. Write `kernal/irq/irq_atari.s` Mode A (VBI via VVBLKD/SETVBV)
- [x] 12. Write `kernal/keyboard/keyboard_atari.s` with POKEY scancode table
- [ ] 13. Test: joystick moves cursor, keyboard events reach GEOS event loop

## Phase 4: Bring up disk (OS-assisted mode, SIOV active)

- [ ] 14. Write `drv/drv1050.s` using OS `jsr SIOV`
- [ ] 15. Create a GEOS-format disk image with Atari geometry using a custom conversion tool
- [ ] 16. Audit and fix all `$FE`/`#254` sector-payload literals in `kernal/files/` (see section 6.7 in `PORTING.md`)
- [ ] 17. Test: directory listing, file read, file write, disk full detection

## Phase 5: Cartridge boot and ROM-off

- [ ] 18. Write OS ROM disable stub in `start_atari.s`; test RAM at `$C000` after disable
- [ ] 19. Switch VBI handler to Mode B (direct NMI at `$FFFA`)
- [ ] 20. Create 8 KB cartridge ROM image for `$A000-$BFFF`; test cold-boot in Altirra
- [ ] 21. Verify GEOS desktop loads end-to-end from cartridge + floppy; then test on hardware

## Phase 6: Integration and polish

- [ ] 22. Implement P/M graphics cursor rendering (`kernal/sprites/` rewrite)
- [ ] 23. Connect VBI counter to `kernal/time/` clock routines
- [ ] 24. Implement ST mouse driver (`input/mse_stmouse.s`, adapted from `amigamse.s`)
- [ ] 25. Regression-test all graphics, font, menu, dialog, and file operations
- [ ] 26. Tune timing loops (Atari 1.79 MHz vs C64 1 MHz; cycle-count-dependent delays differ)

### Phase 2 Notes

- 2026-03-05: Completed step 6 by adding `kernal/start/start_atari.s` with `_ResetHandle`, ANTIC mode `$0F` display list (including LMS jump at `$5000`), GTIA color initialization, and POKEY keyboard scan reset (`SKCTL`).
- 2026-03-05: Updated `Makefile` so `VARIANT=atarixl` builds `kernal/start/start_atari.s` (and no longer links `start64.s` for Atari). `make clean && make -j4 atarixl` now links without the `start_atari` missing-segment warning.
- 2026-03-05: Completed step 7 by adding `kernal/hw/hw_atari.s` with Atari display init (`DLIST*`, `DMACTL`, GTIA palette), baseline P/M setup (`PMBASE`, `GRACTL`, player colors/sizes), and a 200-entry scanline LUT across the LMS split (`y=101` to `y=102`). The LUT is linked via a dedicated `hw_atari_lut` segment in `KERNAL_HI` to avoid `KERNAL_LO` overflow.
- 2026-03-06: Step 8 validation attempt: rebuilt with `make clean && make -j4 atarixl` and regenerated `build/atarixl/geos.d64`; Altirra source tree is now present at `third_party/Altirra-4.40-src`, but the upstream build path is Windows-only (`src/BUILD-HOWTO.html` requires Windows 10+ and Visual Studio 2022 v143/Windows SDK, and `release.py` expects Windows tools like `where`/`devenv.com`). Step 8 remains unchecked pending on-screen bitmap verification in Altirra (PAL 800XL profile, OS ROM enabled).

### Phase 3 Notes

- 2026-03-05: Completed step 10 by replacing the `input/joydrv_atari.s` placeholder with a full Atari-specific driver derived from `joydrv.s`. `ReadInput` now samples joystick 0 direction from `PORTA` (active-low) and fire from `TRIG0` (active-low), then feeds the existing GEOS acceleration/vector pipeline. Verified with `make -j4 atarixl`.
- 2026-03-06: Completed step 11 by adding `kernal/irq/irq_atari.s` with Mode-A OS deferred VBI installation (`SETVBV` code 6) and a shared IRQ/VBI core that preserves GEOS zero-page workspace, runs `_DoKeyboardScan`, and dispatches `intTopVector`/`intBotVector` before returning via `XITVBV`. Updated `Makefile` so `VARIANT=atarixl` links `irq_atari.s` instead of C64 `irq.s`, and `start_atari.s` now installs the deferred VBI hook during reset. Verified with `make clean && make -j4 atarixl` (remaining expected warning: missing `keyboard_atari` segment until step 12).
- 2026-03-06: Completed step 12 by adding `kernal/keyboard/keyboard_atari.s` with a 64-entry POKEY `KBCODE` translation table (base + shifted), queue-compatible `_DoKeyboardScan`/`_GetNextChar` logic, and OS-assisted repeat timing via `KEYREP`. Updated `Makefile`/`kernal_atarixl.cfg` so `VARIANT=atarixl` now links `keyboard_atari.s` instead of C64 `keyboard1/2/3.s`. Verified with `make clean && make -j4 atarixl`.
