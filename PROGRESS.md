# Porting Progress

Source: `PORTING.md` -> "8. Recommended Porting Sequence"

Update rule: after each completed porting step, change exactly one matching checkbox from `[ ]` to `[x]`.

## Phase 1: Build infrastructure

- [x] 1. Add `atarixl` variant to `Makefile` and `config.inc`
- [x] 2. Create `inc/atari.inc`
- [x] 3. Derive `kernal/kernal_atarixl.cfg` from `kernal_bsw.cfg`; adjust addresses
- [ ] 4. Shift GEOS zero page to `$80` in `inc/geossym.inc`; wrap `START_IO`/`CLEAR_IO` in `inc/geosmac.inc`
- [ ] 5. Verify the build completes without assembler errors (binary will be non-functional)

## Phase 2: Bring up the display (OS-assisted mode)

- [ ] 6. Write `kernal/start/start_atari.s` (ANTIC display list, GTIA color init)
- [ ] 7. Write `kernal/hw/hw_atari.s`
- [ ] 8. Boot in Altirra emulator with OS ROM active; verify bitmap appears on screen
- [ ] 9. Run graphics routines (`HorizontalLine`, `Rectangle`); confirm correct output

## Phase 3: Bring up input (OS-assisted mode)

- [ ] 10. Write `input/joydrv_atari.s`
- [ ] 11. Write `kernal/irq/irq_atari.s` Mode A (VBI via VVBLKD/SETVBV)
- [ ] 12. Write `kernal/keyboard/keyboard_atari.s` with POKEY scancode table
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
