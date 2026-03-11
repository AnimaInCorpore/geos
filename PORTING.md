# Porting GEOS to Atari 800 XL

This document describes the work required to port the GEOS kernel from Commodore 64
to the Atari 800 XL (64 KB RAM, cartridge boot, Atari 810/1050 floppy drive).

First-release target platform: **PAL Atari 800 XL**. NTSC support is a follow-up
compatibility phase after the PAL baseline is stable.

Both platforms share a 6502-family CPU, so pure arithmetic/logic code, most process
scheduling code, and most file-format logic are directly reusable. The graphics stack
is not drop-in: C64 bitmap routines assume VIC-II's tiled memory layout, while Atari
mode `$0F` is linear and must explicitly handle ANTIC 4 KB DMA boundaries. The work is
therefore concentrated in the hardware abstraction layer: display, input, disk I/O,
interrupts, and memory mapping.

---

## 1. Hardware Differences

| Feature        | C64                           | Atari 800 XL                       |
|----------------|-------------------------------|-------------------------------------|
| CPU            | 6510 @ 1 MHz                  | 6502C (SALLY) @ 1.79 MHz            |
| CPU I/O port   | $00/$01 (memory banking)      | Not present (normal RAM at $00/$01) |
| Video          | VIC-II ($D000–$D02F)          | ANTIC ($D400) + GTIA ($D000)        |
| Audio/kbd I/O  | SID ($D400), CIA1 ($DC00)     | POKEY ($D200), PIA ($D300)          |
| Joystick       | CIA1 Port B ($DC01)           | PIA Port A ($D300)                  |
| Mouse/paddle   | SID potentiometers ($D419/1A) | POKEY paddle inputs (POT0/POT1)     |
| Serial/disk    | IEC bus via CIA2 ($DD00)      | SIO bus via POKEY                   |
| Timer/VBlank   | CIA1 60 Hz IRQ                | ANTIC VBI NMI (50 Hz PAL target; 60 Hz NTSC later) |
| Hardware sprites | VIC-II (8 sprites)          | GTIA Players & Missiles (4+4)       |
| ROM layout     | BASIC $A000, KERNAL $E000     | OS $C000–$FFFF (disableable)        |
| I/O area       | $D000–$DFFF                   | $D000–$D7FF only                    |

---

## 2. Memory Map

### C64 GEOS (current)

```
$0002–$003F  Zero page: r0–r15 registers, system variables
$0400–$07FF  Application RAM
$8000–$8FFF  OS variables, disk buffers (diskBlkBuf, dirEntryBuf, etc.)
$9000–$9D7F  Disk driver
$9D80–$9FFF  Low KERNAL (lokernal)
$A000–$BFFF  Graphics bitmap (320×200 px, 8000 bytes) + icon data
$BF40–$BFFF  Icon/sprite data
$C000–$CFFF  KERNAL: header, jump table, main code
$D000–$DFFF  VIC/SID/CIA I/O (no code executable here)
$FE80–$FFFA  Input driver
$FFFA–$FFFF  C64 KERNAL ROM (system vectors)
```

### Proposed GEOS-XL Memory Map

```
$0000–$007F  Atari OS zero page (reserved; do not use)
$0080–$00FF  GEOS zero page: r0–r15 + system variables (shifted up from $02)
$0100–$01FF  Stack
$0200–$03FF  Atari OS page 2/3 (partially reserved; GEOS avoids)
$0400–$3F3F  Application RAM + work area
$3F40–$3FFF  Icon/mouse pointer data (relocated from C64 $BF40–$BFFF)
$4000–$4FEF  Bitmap lines 0–101 (102 × 40 = 4080 bytes)
$4FF0–$4FFF  Unused 16-byte guard gap (required to avoid ANTIC 4 KB wrap corruption)
$5000–$5F4F  Bitmap lines 102–199 (98 × 40 = 3920 bytes)
$5F50–$7FFF  Back screen buffer, printer buffer, application heap
$8000–$8FFF  OS variables, disk buffers (same layout as C64)
$9000–$9D7F  Disk driver (new Atari SIO driver)
$9D80–$9FFF  Low KERNAL (lokernal, largely unchanged)
$A000–$BFFF  Cartridge ROM: bootstrap loader (stays as ROM throughout runtime)
$C000–$CFFF  GEOS KERNAL main code (Atari OS ROM disabled; RAM used here)
$D000–$D7FF  Atari hardware I/O: GTIA, POKEY, PIA, ANTIC
$D800–$DFFF  Atari FP ROM (leave alone unless OS fully replaced)
$E000–$FFFF  GEOS KERNAL continued + input driver (Atari OS ROM disabled; RAM)
$FD00–$FEFF  Input driver (same location as C128; see note below)
$FFFA–$FFFF  CPU vectors: NMI, RESET, IRQ (must live in RAM once OS disabled)
```

**Input driver address note:** The C64 places the input driver at `$FE80` (MOUSE_BASE
in `inc/geossym.inc`). The C128 uses `$FD00` (MOUSE_BASE_128). For GEOS-XL, `$FD00`
is the **final ROM-off runtime address** (matching the C128 address). Update
`MOUSE_BASE`, `MOUSE_JMP`, and `END_MOUSE` in `inc/geossym.inc`; update the loader
copy path; and create `input/inputdrv_atarixl.cfg` with `start = $FD00`.

During OS-assisted Phases 2–4, keep the input driver in low RAM (for example
`$0400–$04FF` or `$7000–$7FFF`), because OS ROM is still mapped at `$D800–$FFFF`
and writes to `$FD00` are ignored. Move/copy it to `$FD00` only in Phase 5 after
OS ROM is disabled.

**Key constraint:** The Atari OS ROM occupies $C000–$FFFF and must be **disabled** by
writing to PORTB ($D301) before GEOS code in that range can execute. BASIC ROM
($A000–$BFFF) is replaced by the cartridge, so it is automatically inactive when a
cartridge is present.

**XL/XE self-test caveat (OS-assisted phases):** XL/XE self-test can map ROM over
`$5000–$57FF`, which overlaps the second bitmap segment. During Phases 2–4, avoid
self-test boot/key combinations and keep PORTB bit 7 set (`1`) for normal RAM at
`$5000–$57FF`.

### PORTB ($D301) ROM banking bits — XL/XE

On Atari XL/XE machines the bit polarity for ROM control is as follows (power-on
default: $FF, all bits high):

| Bit | Value | Effect |
|-----|-------|--------|
| 0   | 1     | OS ROM active ($C000–$CFFF, $D800–$FFFF) |
| 0   | 0     | RAM visible at $C000–$CFFF and $D800–$FFFF |
| 1   | 0     | BASIC ROM active ($A000–$BFFF) — irrelevant when cart is present |
| 1   | 1     | RAM visible at $A000–$BFFF |
| 7   | 0     | Self-test ROM visible at $5000–$57FF (only when OS ROM is active) |
| 7   | 1     | RAM visible at $5000–$57FF |

Tested operation masks (read-modify-write to preserve other bits):

```asm
; Disable BASIC ROM (show RAM or defer to cartridge):
    lda PORTB
    ora #$02        ; set bit 1 = 1 → RAM/cart at $A000
    sta PORTB

; Disable OS ROM (must be done from a RAM stub, never from ROM itself):
    ; --- copy this stub to page 2 first, then JSR to it ---
    ; stub: lda PORTB; and #$FE; sta PORTB; rts
    lda PORTB
    and #$FE        ; clear bit 0 = 0 → RAM at $C000 and $D800
    sta PORTB
```

---

## 3. Cartridge Boot Strategy

An Atari 800 XL right-slot cartridge occupies $A000–$BFFF (8 KB). The cartridge
header lives at the top of the ROM:

- `$BFFA–$BFFB`: **RUN address** — jumped to (JMP) by the OS once initialisation is complete
- `$BFFC`: **Flags byte** — bit 0 = cartridge present, bit 2 = boot without disk, bit 7 = diagnostic cart
- `$BFFD`: **Reserved/unused** — set to `$00`
- `$BFFE–$BFFF`: **INIT address** — JSR'd by the OS during startup (before RUN), if enabled by `$BFFC`

Call order: the OS first JSRs to the INIT address (if the flag byte at $BFFC indicates
an INIT is present), waits for it to RTS, then JMPs to the RUN address.

### Bootstrap cartridge boot flow (8 KB ROM)

The cartridge ROM remains visible at $A000–$BFFF throughout execution (standard Atari
cartridges cannot be disabled from software). The GEOS KERNAL is therefore loaded into
the RAM space exposed after disabling the Atari OS ROM, keeping
the same base address as the C64 ($C000).

1. Cartridge INIT executes from ROM. BASIC is already disabled by the Atari OS when it
   detects a cartridge (cartridge takes precedence at $A000–$BFFF).
2. While OS ROM is still active, disable ANTIC DMA and load floppy payloads via OS
   `SIOV` in this order (stage anything destined for `$C000+`/`$FD00` into low RAM):
   - `lda #$00` / `sta DMACTL` to blank the display and stop all ANTIC DMA fetches.
   - Disk driver (~3.5 KB) → $9000–$9D7F (final location)
   - Lokernal (~640 bytes) → $9D80–$9FFF (final location)
   - KERNAL header + main code (final size per link map; must fit split ROM-off
     regions from §5) → temporary low-RAM buffer (e.g. `$4000–$7D7F`)
   - Input driver (~384 bytes) → temporary low-RAM buffer (e.g. `$7E00–$7F7F`)
   - Icon/sprite data (~192 bytes) → $3F40–$3FFF (final location, loaded after the
     temporary KERNAL/input buffers are staged)
3. Copy the OS-ROM-disable stub to page 2 RAM ($0200), then call it:
   ```asm
   ; Stub (8 bytes, copied to $0200 before calling):
   disable_os_stub:
       lda PORTB       ; read current PORTB value
       and #$FE        ; clear bit 0 → OS ROM off, RAM at $C000/$D800
       sta PORTB
       rts
   ; ... copy stub bytes to $0200 using LDA/STA, then: jsr $0200
   ```
4. Copy staged payloads to their final ROM-off addresses:
   - KERNAL header + main code from temp buffer → $C000+ (split around hardware I/O; see §5)
   - Input driver from temp buffer → $FD00–$FE7F
5. Install GEOS NMI/IRQ/RESET vectors into RAM at $FFFA–$FFFF (now accessible as RAM).
6. Jump to GEOS KERNAL entry at $C000 (cartridge RUN vector).

**Payload sizes for floppy load (approximate):**

| Artifact | C64 address | Size | Atari address |
|----------|-------------|------|---------------|
| Disk driver | $9000–$9D7F | ~3.5 KB | $9000–$9D7F (unchanged) |
| Lokernal | $9D80–$9FFF | 640 bytes | $9D80–$9FFF (unchanged) |
| Icon/mouseptr data | $BF40–$BFFF | 192 bytes | $3F40–$3FFF (relocated; $BF40 is in cart ROM) |
| KERNAL header | $C000–$C0FF | 256 bytes | Stage in low RAM, then copy to $C000–$C0FF after OS-off |
| KERNAL main | $C100–$FF?? | Link-map dependent | Stage in low RAM, then copy to $C100–$CFFF + $E000–$FCFF |
| Input driver | $FE80–$FFFA | ~384 bytes | Stage in low RAM, then copy to $FD00–$FE7F after OS-off |

### Alternative: 16 KB bankswitched cartridge ($8000–$BFFF)

- Bank 0 ($8000–$9FFF): Bootstrap + enough code to disable OS ROM and load drivers
- Bank 1 ($A000–$BFFF): Reserved or additional font/data ROM

With a bankswitched cart the KERNAL still lives at $C000+ in RAM (same approach as
above). The advantage is 8 KB more ROM space for the bootstrap and optional data.
This is the preferred approach for a production cartridge.

---

## 4. New File: `inc/atari.inc`

Replace or conditionally include instead of `inc/c64.inc`. Defines all Atari
hardware register addresses used throughout the port:

```asm
; -----------------------------------------------
; GTIA  ($D000)
; -----------------------------------------------
; NOTE: Several Atari registers are read/write aliases at the same address.
; Prefer *_R / *_W names in new code to avoid accidental read/write misuse.
HPOSP0  = $D000   ; Player 0 horizontal position (write)
HPOSP1  = $D001
HPOSP2  = $D002
HPOSP3  = $D003
HPOSM0  = $D004   ; Missile 0 horizontal position
SIZEP0  = $D008   ; Player 0 size
SIZEP1  = $D009
SIZEP2  = $D00A
SIZEP3  = $D00B
GRAFP0_W = $D00D  ; Player 0 graphics data (write)
GRAFP1_W = $D00E
GRAFP2_W = $D00F
GRAFP3_W = $D010
TRIG0_R  = $D010  ; Joystick 0 trigger (read, active low: 0=pressed)
TRIG1_R  = $D011  ; Joystick 1 trigger (read, active low)
GRAFP0   = GRAFP0_W
GRAFP1   = GRAFP1_W
GRAFP2   = GRAFP2_W
GRAFP3   = GRAFP3_W
TRIG0    = TRIG0_R
TRIG1    = TRIG1_R
COLPM0  = $D012   ; Player 0 color
COLPM1  = $D013
COLPM2  = $D014
COLPM3  = $D015
COLPF0  = $D016   ; Playfield color 0
COLPF1  = $D017
COLPF2  = $D018   ; Playfield color 2 — foreground pixel color in mode $0F
COLPF3  = $D019
COLBK   = $D01A   ; Background color
PRIOR   = $D01B   ; Priority control
VDELAY  = $D01C   ; Vertical delay
GRACTL  = $D01D   ; Graphics control:
                  ;   bit 0: enable missile graphics display latching (GRAFM writes)
                  ;   bit 1: enable player graphics display latching (GRAFPx writes)
                  ;   bit 2: latch paddle/trigger inputs
HITCLR  = $D01E   ; Write: clear collision registers
CONSOL  = $D01F   ; Console keys (Start/Select/Option, read active-low)

; -----------------------------------------------
; POKEY  ($D200)
; -----------------------------------------------
POT0_R   = $D200  ; Paddle 0 value (read after POTGO)
POT1_R   = $D201
POT2_R   = $D202
POT3_R   = $D203
POT4_R   = $D204
POT5_R   = $D205
POT6_R   = $D206
POT7_R   = $D207
ALLPOT_R = $D208  ; Potentiometer port status (read)
KBCODE  = $D209   ; Last keyboard scan code latched by POKEY (0–$3F)
                  ; Does NOT indicate "no key" — use CH ($02FC) for that
RANDOM  = $D20A   ; Random number (read)
POTGO   = $D20B   ; Write: start potentiometer scan
AUDF1_W = $D200   ; Audio frequency channel 1 (write)
AUDC1_W = $D201   ; Audio control channel 1 (write)
AUDF2_W = $D202
AUDC2_W = $D203
AUDF3_W = $D204
AUDC3_W = $D205
AUDF4_W = $D206
AUDC4_W = $D207
AUDCTL_W = $D208  ; Audio control (write)
IRQEN_W  = $D20E  ; IRQ enable mask (write)
IRQST_R  = $D20E  ; IRQ status (read, active-low bits)
SKSTAT_R = $D20F  ; Serial/keyboard status (read): bit2=0 key down, bit3=0 shift down
SKCTL_W  = $D20F  ; Serial/keyboard control (write)
POT0    = POT0_R
POT1    = POT1_R
POT2    = POT2_R
POT3    = POT3_R
POT4    = POT4_R
POT5    = POT5_R
POT6    = POT6_R
POT7    = POT7_R
ALLPOT  = ALLPOT_R
AUDF1   = AUDF1_W
AUDC1   = AUDC1_W
AUDF2   = AUDF2_W
AUDC2   = AUDC2_W
AUDF3   = AUDF3_W
AUDC3   = AUDC3_W
AUDF4   = AUDF4_W
AUDC4   = AUDC4_W
AUDCTL  = AUDCTL_W
IRQEN   = IRQEN_W
IRQST   = IRQST_R
SKSTAT  = SKSTAT_R
SKCTL   = SKCTL_W

; -----------------------------------------------
; PIA  ($D300)
; -----------------------------------------------
PORTA   = $D300   ; Port A: joystick 0 (bits 0–3), joystick 1 (bits 4–7), active-low
PORTB   = $D301   ; Port B: bit0=OS ROM select, bit1=BASIC ROM select, bit7=self-test ROM
                  ; (130XE also uses upper bits for RAM banking)
PACTL   = $D302   ; Port A control
PBCTL   = $D303   ; Port B control

; -----------------------------------------------
; ANTIC  ($D400)
; -----------------------------------------------
DMACTL  = $D400   ; DMA control
CHACTL  = $D401   ; Character control
DLISTL  = $D402   ; Display list address low byte
DLISTH  = $D403   ; Display list address high byte
HSCROL  = $D404   ; Horizontal scroll
VSCROL  = $D405   ; Vertical scroll
PMBASE  = $D407   ; Player/missile base address (high byte only, 2 KB aligned)
CHBASE  = $D409   ; Character set base address (high byte)
WSYNC   = $D40A   ; Write: halt CPU until next horizontal blank
VCOUNT  = $D40B   ; Vertical line counter (read)
PENH    = $D40C   ; Light pen horizontal position (read)
PENV    = $D40D   ; Light pen vertical position (read)
NMIEN   = $D40E   ; NMI enable: bit6=VBI, bit5=DLI
NMIST   = $D40F   ; NMI status (read): bit7=DLI pending, bit6=VBI pending
NMIRES  = $D40F   ; NMI acknowledge/reset (write; use for VBI acknowledge)

; -----------------------------------------------
; NMI control macros (usable in both OS-assisted and ROM-off modes)
; -----------------------------------------------
; DISABLE_NMI — use in place of C64 "sei" where guarding against the VBI tick
; ENABLE_NMI  — use in place of C64 "cli"
; (defined in inc/geosmac.inc under .ifdef atarixl; listed here for reference)

; -----------------------------------------------
; Atari OS variables (valid when OS ROM active)
; -----------------------------------------------
SIOV    = $E459   ; OS SIO entry point (fixed address in Atari OS ROM)
SETVBV  = $E45C   ; OS: set VBI vector (XL/XE ROM)
XITVBV  = $E462   ; OS: VBI exit (XL/XE ROM)
VVBLKI  = $0222   ; Immediate VBI vector (2-byte pointer, OS-managed)
VVBLKD  = $0224   ; Deferred VBI vector (2-byte pointer, OS-managed)
RTCLOK  = $0012   ; 3-byte real-time clock incremented each VBI ($12/$13/$14)
CH      = $02FC   ; OS keyboard shadow: $FF = no key pending, else ATASCII code
KEYREP  = $02DA   ; OS keyboard repeat counter
```

---

## 5. Build System Changes

### Makefile additions

```makefile
# New variant target
atarixl:
	$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari

# New platform flag passed to ca65
ifeq ($(VARIANT),atarixl)
  PLATFORM_DEFINES = -D atarixl=1
  PLATFORM_INC     = atari.inc
  KERNAL_CFG       = kernal/kernal_atarixl.cfg
else
  PLATFORM_DEFINES =
  PLATFORM_INC     = c64.inc
  KERNAL_CFG       = kernal/kernal_$(VARIANT).cfg
endif
```

### Local toolchain note (macOS/Homebrew)

For assembler compatibility checks during Atari XL bring-up, these alternatives are
installed locally in addition to `cc65`:

- `acme` (`brew install acme`)
- `64tass` (`brew install 64tass`, formula name: `tass64`)
- `xa` (`brew install xa`)

The project build still uses `ca65`/`ld65` by default.

### `config.inc` additions

```asm
.ifdef atarixl
  ; Atari 800 XL variant
  PLATFORM        = 1       ; 0=C64, 1=Atari XL
  VIDEO_STD       = 0       ; 0=PAL (first release), 1=NTSC
  VBI_HZ          = 50      ; PAL frame rate baseline
  BITMAP_BASE     = $4000   ; 320×200 monochrome bitmap (8000 bytes, same as C64)
  KERNAL_BASE     = $C000   ; KERNAL lives at same address as C64 (Atari OS ROM displaced)
  INPUT_BASE      = $FD00   ; Input driver (C128 address; C64 used $FE80)
  DISK_BASE       = $9000   ; Disk driver location (same as C64)
  ZP_BASE         = $80     ; GEOS zero page starts at $80 (Atari OS owns $00–$7F)
.endif
```

### New linker config: `kernal/kernal_atarixl.cfg`

The Atari config must be derived from the existing `kernal_bsw.cfg`, not invented from
scratch, because the sources declare ~100 named segments that must all be explicitly
mapped. The approach: copy `kernal_bsw.cfg`, adjust the `MEMORY` region addresses, and
edit the `SEGMENTS` block to:

- Remove C64-only segments: `serial1`, `serial2`, `reu`, `ramexp1`, `ramexp2`,
  `tobasic1`, `tobasic2`
- Add new Atari segments: `start_atari`, `hw_atari`, `irq_atari`, `keyboard_atari`
- Remap addresses for the new memory layout

Skeleton showing the key `MEMORY` region changes (segment assignments remain the same
names as `kernal_bsw.cfg`; only the load addresses change):

```
MEMORY {
    ; Purgeable init code — load into low RAM, discarded after boot
    START:        start = $0500, size = $0B00, fill = yes, file = %O;

    ; Disk driver + lokernal (same as C64)
    LOKERNAL:     start = $9D80, size = $0280, fill = yes, file = %O;

    ; Icon/mouse pointer data — relocated away from $BF40 (cartridge ROM area)
    ICONS:        start = $3F40, size = $00C0, fill = yes, file = %O;

    ; KERNAL: split to avoid Atari hardware I/O ($D000–$D7FF)
    KERNALHDR:    start = $C000, size = $0100, fill = yes, file = %O;
    KERNAL_LO:    start = $C100, size = $0F00, fill = yes, file = %O;
    KERNAL_HI:    start = $E000, size = $1D00, fill = yes, file = %O;

    ; VARS BSS — shifted to avoid Atari OS zero page
    VARS:         start = $86C0, size = $0940;
}

SEGMENTS {
    vars:               load = VARS,      type = bss;

    ; Purgeable init (replaces start64.s with start_atari.s)
    start_atari:        load = START,     type = ro;

    ; lokernal segments (unchanged from kernal_bsw.cfg)
    files1a2a:          load = LOKERNAL,  type = ro;
    files1a2b:          load = LOKERNAL,  type = ro;
    files1b:            load = LOKERNAL,  type = ro;
    ; serial1 REMOVED — IEC bus not present; SIO lives in disk driver
    ; reu REMOVED — no REU on Atari
    ; tobasic1 REMOVED — replaced by Atari warm-reset stub

    ; icon area (relocated)
    mouseptr:           load = ICONS,     type = ro;
    dlgbox2:            load = ICONS,     type = ro;

    ; kernal header
    header:             load = KERNALHDR, type = ro;
    ; tobasic2 REMOVED
    mainloop1:          load = KERNALHDR, type = ro;
    files2:             load = KERNALHDR, type = ro;

    ; kernal code (all other segments from kernal_bsw.cfg remain)
    ; Place segments in KERNAL_LO first, then continue in KERNAL_HI.
    ; Never map executable/data segments into $D000–$D7FF.
    jumptab:            load = KERNAL_LO, type = ro;
    hw_atari:           load = KERNAL_LO, type = ro;   ; replaces hw1a/hw1b
    irq_atari:          load = KERNAL_LO, type = ro;   ; replaces irq
    keyboard_atari:     load = KERNAL_HI, type = ro;   ; replaces keyboard1/2/3
    ; ... all other segments assigned to KERNAL_LO or KERNAL_HI ...
}
```

Verify the final layout with `ld65 --map` and confirm no segment overflows or
generated output in the I/O area ($D000–$D7FF) or other reserved ranges.

---

## 6. Module-by-Module Porting Guide

### 6.1 Remove — Not Applicable on Atari

| Module | Reason |
|--------|--------|
| `kernal/reu/` | C64 REU (RAM Expansion Unit); Atari uses different expansions (XE, VBXE) |
| `kernal/tobasic/` | "Return to Commodore BASIC" — replace with "warm reset to Atari OS" |
| `kernal/serial/` | C64 IEC serial bus; replaced entirely by SIO (see §6.7) |
| `kernal/128k/`, `kernal/640/`, `kernal/c128/` | C128-specific; not relevant |
| `input/mse1351.s` | Uses SID chip potentiometers; no SID on Atari |
| `input/amigamse.s` | Uses C64 CIA for quadrature reads — **do not remove**; adapt to read PORTA instead (see §6.6) |
| `input/lightpen.s` | Uses VIC light-pen registers ($D013/$D014); replace with ANTIC version |

### 6.2 Rewrite: Hardware Initialization

**Current files:** `kernal/hw/hw1a.s`, `kernal/start/start64.s`
**New file:** `kernal/start/start_atari.s`

Replace:
- VIC-II init table → ANTIC display list setup + GTIA color init
- CIA1/CIA2 init → POKEY + PIA init
- C64 memory banking via `$00`/`$01` CPU I/O port → Atari PORTB ROM banking

**ANTIC display list for 320×200 monochrome (mode $0F):**

ANTIC mode $0F with a custom display list can render 200 scan lines into the overscan
area, matching the C64's 320×200 bitmap exactly. Standard NTSC/PAL televisions handle
200 lines without issue, so GEOS Y-coordinate limits can stay 0–199.

Critical ANTIC constraint: ANTIC's DMA address counter cannot naturally cross a 4 KB
boundary while fetching mode-$0F data. A single LMS at `$4000` will corrupt the display
once the fetch stream reaches `$4FFF`. The display list must insert a new LMS at the
boundary and continue at `$5000`.

```asm
BITMAP_LMS0 = $4000    ; lines 0–101 (102 * 40 = 4080 bytes)
BITMAP_LMS1 = $5000    ; lines 102–199 (98 * 40 = 3920 bytes)

atari_dlist:
    .byte $70, $70, $70         ; 3 × blank-8 = 24 blank scan lines (top border)
    .byte $4F                   ; mode $0F + LMS: load new scan address
    .word BITMAP_LMS0           ; first 4 KB segment
    .repeat 101
      .byte $0F                 ; remaining lines in first segment
    .endrepeat
    .byte $4F                   ; mode $0F + LMS at 4 KB boundary
    .word BITMAP_LMS1           ; second segment starts exactly at $5000
    .repeat 97
      .byte $0F                 ; remaining lines (total visible lines = 200)
    .endrepeat
    .byte $41                   ; JVB: jump + trigger VBI
    .word atari_dlist           ; loop back to top of display list
```

PAL baseline note: keep display list geometry as defined above for v1 PAL release.
For NTSC follow-up, keep bitmap height at 200 but also revalidate border centering,
VBI-rate-dependent timing, and palette tuning (see §10).

Initialization:
```asm
    lda #<atari_dlist
    sta DLISTL
    lda #>atari_dlist
    sta DLISTH
    lda #$22            ; DMACTL: DL DMA + normal-width playfield
                        ; mode $0F at normal width is already 320 pixels
    sta DMACTL
    lda #$00            ; black background
    sta COLBK
    lda #$0F            ; white foreground
    sta COLPF2
```

Do not switch to wide playfield (`DMACTL` low bits = `11`) unless you intentionally
target overscan width; normal width (`10`) is the canonical 320-pixel mode-$0F setup.

### 6.3 Rewrite: VBI/IRQ Handler

**Current file:** `kernal/irq/irq.s`
**New file:** `kernal/irq/irq_atari.s`

On C64, GEOS hooks the CIA1 frame IRQ for its main timing tick. On Atari the
equivalent is the ANTIC Vertical Blank Interrupt (VBI), which fires as an **NMI**
once per frame. For the first release, assume PAL timing (50 Hz) everywhere.
Two operating modes are needed during development:

#### Mode A — OS-assisted (use during Phases 2–4)

While the Atari OS ROM is still active, hook the VBI through the OS deferred VBI
vector rather than installing a raw NMI handler. This avoids conflicting with the OS
and lets the OS continue to manage SIO, RTCLOK, and keyboard repeat.

```asm
; Install GEOS deferred VBI handler via OS SETVBV routine
; (OS must be active; VVBLKD is at $0224)
    lda #7              ; SETVBV code 7 = set deferred VBI
    ldx #>geos_vbi      ; handler address high
    ldy #<geos_vbi      ; handler address low
    jsr SETVBV          ; OS SETVBV entry

geos_vbi:
    ; OS has already saved registers; do not save/restore here
    jsr _DoKeyboardScan
    jsr UpdateMouse
    ; ... decrement process timers ...
    jmp XITVBV          ; OS XITVBV: exit deferred VBI (mandatory)
```

Use symbolic OS entry equates (`SETVBV`, `XITVBV`) and verify addresses against the
target OS ROM revision during emulator and hardware validation.

#### Mode B — ROM-off runtime (use from Phase 5 onward)

Once the OS ROM is disabled, install the NMI handler directly at $FFFA–$FFFB (now
RAM). The IRQ vector at $FFFE handles BRK and any POKEY IRQ use.

```asm
; Install vectors into RAM (OS ROM must already be disabled)
    lda #<geos_nmi
    sta $FFFA
    lda #>geos_nmi
    sta $FFFB
    lda #<geos_irq
    sta $FFFE
    lda #>geos_irq
    sta $FFFF

; Enable VBI NMI
    lda #$40
    sta nmiEnableMask   ; baseline mask: VBI only (set to #$60 when DLI enabled)
    sta NMIEN

geos_nmi:
    pha
    lda NMIST
    and #$80            ; DLI pending?
    bne @is_dli
    lda NMIST
    and #$40            ; VBI pending?
    beq @done           ; spurious/unknown NMI source

@is_vbi:
    sta NMIRES          ; acknowledge VBI only
    txa
    pha
    tya
    pha
    ; ... save r0–r15 and other state (same structure as C64 irq.s) ...
    jsr _DoKeyboardScan
    jsr UpdateMouse
    ; ... decrement timers, schedule processes ...
    ; ... restore state ...
    pla
    tay
    pla
    tax
@done:
    pla
    rti

@is_dli:
    txa
    pha
    tya
    pha
    jsr ServiceMouseDLI ; high-rate quadrature sample
    pla
    tay
    pla
    tax
    pla
    rti
```

**Replacing `sei`/`cli` critical sections:** Unlike most NMI sources, the Atari VBI
NMI can be suppressed in software by writing to ANTIC's `NMIEN` register ($D40E).
This provides a clean replacement for the C64's `sei`/`cli` pattern, but GEOS has
nested critical sections, so the macros must be reference-counted. Add low-RAM
variables (for example in `kernal/vars/vars_atari.s`):
- `nmiDisableDepth` (initialized to `0`)
- `nmiEnableMask` (initialized to `#$40`; set to `#$60` when DLI sampling is enabled)

Then add to `inc/geosmac.inc`:

```asm
.macro DISABLE_NMI
    inc nmiDisableDepth
    lda nmiDisableDepth
    cmp #$01
    bne :+
    lda #$00
    sta NMIEN       ; disable VBI/DLI only on outermost entry
:
.endmacro

.macro ENABLE_NMI
    lda nmiDisableDepth
    beq :+          ; tolerate unbalanced enable during bring-up
    dec nmiDisableDepth
    bne :+
    lda nmiEnableMask
    sta NMIEN       ; restore configured NMI sources on outermost exit
:
.endmacro
```

Replace every `sei` (that guards against the timing tick) with `DISABLE_NMI`, and
every corresponding `cli` with `ENABLE_NMI`. This preserves C64 critical-section
semantics without prematurely re-enabling NMI in nested call paths.

NMI dispatch rule: DLI and VBI share the same CPU NMI vector at `$FFFA`. Always branch
by `NMIST` inside `geos_nmi`; do not run full VBI work on DLI entries. Also do not
write `NMIRES` in the DLI path; DLI status auto-clears on interrupt service completion.

### 6.4 Rewrite: Keyboard Scanner

**Current files:** `kernal/keyboard/`
**New file:** `kernal/keyboard/keyboard_atari.s`

The C64 scans an 8×8 matrix through CIA1. Atari POKEY performs hardware key scanning.
Three registers are relevant:

| Register | Address | Purpose |
|----------|---------|---------|
| `KBCODE` | $D209 | Raw keyboard code; bits 0–5 = key index, bit 6 = Shift, bit 7 = Control. It does **not** reset to $FF on release. |
| `SKSTAT` | $D20F | Bit 2 = 0 while a key is physically held down (key-down qualifier). |
| `CH`     | $02FC | OS shadow of keyboard input (ATASCII). Holds $FF when no key event is pending. Valid only while OS is active; replicate with a GEOS-owned variable once OS ROM is disabled. |

Cold-boot initialization requirement: reset and re-enable POKEY keyboard scanning
in `start_atari.s` before first `KBCODE` use:

```asm
    lda #$00
    sta SKCTL_W         ; reset keyboard/serial state machine
    lda #$03
    sta SKCTL_W         ; enable keyboard scan + debounce
```

Recommended keyboard-scan loop:

```asm
_DoKeyboardScan:
    lda SKSTAT
    and #$04            ; bit 2: 0 = key down
    bne @no_key         ; bit was 1 → no key pressed right now

    lda KBCODE          ; raw scan code + modifier flags
    ; ... look up in 64-entry POKEY→GEOS translation table ...
    ; ... handle shift via KBCODE bit 6 ...
    ; ... handle control via KBCODE bit 7 ...
    sta keyData         ; store result for GEOS event queue
    rts

@no_key:
    ; No key: store "no key" sentinel in OS-assisted mode = read CH and check $FF
    ; In ROM-off mode: use GEOS own no-key constant (e.g. NO_KEY = $FF)
    lda #$FF
    sta keyData
    rts
```

Build a 64-entry translation table mapping POKEY raw codes (0–$3F) to GEOS internal
key codes (as defined in `inc/const.inc`). Atari key codes differ significantly from
C64 scan codes.

Key repeat: in OS-assisted mode, use OS repeat delay via `KEYREP` ($02DA). In ROM-off
mode, implement a repeat counter in `keyboard_atari.s` using the VBI tick counter.

### 6.5 Adapt: Zero Page

**File:** `inc/geossym.inc`

The C64 GEOS zero page starts at `$02` (r0L). On Atari, $00–$7F is used by the
Atari OS; GEOS zero page must move to `$80`:

```asm
; Old (C64):
r0L = $02   r0H = $03
r1L = $04   r1H = $05
; ...

; New (Atari):
r0L = $80   r0H = $81
r1L = $82   r1H = $83
; ...
```

Update every named zero-page symbol in `geossym.inc`. Then grep for any source files
that hard-code zero-page addresses numerically and update them.

Also remove all references to `CPU_DATA` (= `$01`, the C64 6510 I/O port). The
`START_IO` / `CLEAR_IO` macros in `geosmac.inc` that save/restore `$01` must become
no-ops on Atari. Wrap them with `.ifdef`:

```asm
.macro START_IO
  .ifndef atarixl
    lda $01
    sta _io_save
    lda #$35
    sta $01
  .endif
.endmacro
```

**ROM-off mode note:** If a future optimized build fully replaces the ROM-banked
`SIOV` bridge with a custom raw-SIO stack, the Atari OS no longer runs and $00–$7F
becomes ordinary free RAM. GEOS zero-page registers could then theoretically move
back near $00 to save a few bytes elsewhere. However, keeping them at `$80` is
strongly recommended throughout development to avoid OS-conflict bugs during the
OS-assisted Phases 2–4.

### 6.6 Rewrite: Input Drivers

#### Joystick: `input/joydrv_atari.s` (adapted from `input/joydrv.s`)

Change only the hardware read. C64 reads CIA1 Port B at `$DC01`; Atari reads
PIA Port A at `PORTA` ($D300):

```asm
; C64 original:
    lda $DC01
    eor #$FF        ; active-low → active-high

; Atari replacement:
    lda PORTA       ; bits 0–3: joystick 0 (up/down/left/right), active-low
    eor #$0F        ; invert low nibble to get active-high

; Fire button (C64 was CIA1 Port B bit 4, Atari is TRIG0):
    lda TRIG0       ; $D010: 0 = fire pressed (active-low)
    eor #$01        ; invert to active-high
```

All movement math, acceleration, fractional-pixel accumulation: **unchanged**.

#### Mouse (primary): `input/mse_stmouse.s` (adapted from `input/amigamse.s`)

The Atari 8-bit community standard for GUI pointer input is an **Atari ST mouse**
plugged into joystick port 1. An ST mouse uses the same quadrature encoding as an
Amiga mouse: it pulses the Up/Down/Left/Right direction pins as the ball moves.
The decode logic from `input/amigamse.s` is reusable, but sampling only once per VBI is
too slow and drops quadrature transitions during fast movement.

Required architecture:
1. Use ANTIC DLIs for high-rate sampling (set DLI bits on several mode `$0F` lines).
   With PAL 50 Hz, 6–10 DLIs/frame yields ~300–500 Hz effective poll rate.
2. In the DLI NMI path, decode gray-code transitions and accumulate signed deltas into
   `mouseXDelta` / `mouseYDelta`.
3. In the frame VBI (50 Hz for v1), consume those accumulators, update GEOS pointer coordinates,
   clamp to bounds, and clear the accumulators.
4. Do not program POKEY Timer 1 (`AUDF1`/`IRQEN` bit 0) for mouse polling; Timer 1/2 are
   used by Atari OS SIO timing and must remain untouched for reliable floppy I/O.

```asm
; Example display-list entry with DLI enabled (mode $0F + DLI bit):
    .byte $8F, <scanline_addr, >scanline_addr

InitMouseDLI:
    lda #$60            ; NMIEN mask: bit6=VBI + bit5=DLI
    sta nmiEnableMask
    sta NMIEN
    rts

; In geos_nmi: DLI path does high-rate quadrature sampling
ServiceMouseDLI:
    lda PORTA           ; joystick port 1 is high nibble
    lsr
    lsr
    lsr
    lsr                 ; bits 0–3 now hold quadrature state
    ; ... gray-code decode vs previous state ...
    ; ... inc/dec mouseXDelta and mouseYDelta ...
    rts
```

Because DLI and VBI share a single NMI vector, `ServiceMouseDLI` must be reached via
`geos_nmi` dispatch (see §6.3 Mode B). Keep DLI service short and avoid `NMIRES` writes
there; only the VBI path acknowledges through `NMIRES`.

VBI-side cursor update:

```asm
UpdateMouse:
    ; apply mouseXDelta/mouseYDelta to absolute pointer position
    ; clamp to 0..319 / 0..199
    lda #0
    sta mouseXDelta
    sta mouseYDelta
    lda TRIG1           ; button read still comes from port 1 trigger
    eor #$01            ; active-low -> active-high
    rts
```

This keeps hardware sampling rate independent from UI refresh rate and prevents
missed quadrature states.

#### Mouse (secondary): `input/mse_paddle.s` (POKEY paddles / CX22 Trak-Ball)

Paddles and the Atari CX22 Trak-Ball use POKEY analog potentiometer inputs. This
gives **absolute** position values (0–228), not relative movement, which produces
a poor GUI experience (jitter, no acceleration). Only implement this driver if an
ST or Amiga mouse is not available as a target input device.

```asm
; Start conversion in one VBI/IRQ pass:
BeginPaddleScan:
    lda #$FF
    sta POTGO           ; start pot scan
    rts

; Read on a later pass (typically next VBI) after conversion completes:
ReadPaddleSample:
    lda ALLPOT          ; bit=1 means corresponding POT still charging
    and #%00000011      ; POT0/POT1 done?
    bne @not_ready
    lda POT0            ; X axis (0–228 absolute)
    ; ... compute delta from previous reading ...
    lda POT1            ; Y axis
    lda TRIG0           ; fire button (active-low, port 0)
    eor #$01
@not_ready:
    rts
```

#### Light pen: `input/lightpen_atari.s` (new, based on `input/lightpen.s`)

Replace VIC light-pen register reads with ANTIC reads:

```asm
; C64: lda $D013 (LPXPOS), lda $D014 (LPYPOS)
; Atari:
    lda PENH    ; $D40C: horizontal position (0–167 in half-color-clocks)
    lda PENV    ; $D40D: vertical line (equals VCOUNT value at pen trigger)
```

Scale PENH/PENV to GEOS pixel coordinates; adapt calibration dialog accordingly.

### 6.7 Rewrite: Disk Driver

**Current files:** `drv/drv1541.s`, `drv1571.s`, `drv1581.s`
**New file:** `drv/drv1050.s`

The Atari SIO (Serial I/O) bus completely replaces the C64 IEC bus. The new driver
must expose the same jump table interface at $9000 that the C64 drivers use.

#### SIO command structure

```
SYNC byte  : $55
Device ID  : $31 (drive 1), $32 (drive 2), ...
Command    : $52=read sector, $50=put (write, no verify), $57=write+verify, $21=format
AUX1       : sector number low byte
AUX2       : sector number high byte
Checksum   : sum of Device+Command+AUX1+AUX2, truncated to 8 bits
```

When the Atari OS is active, call SIO via the OS entry point at the fixed address
`$E459`. The OS expects a Device Control Block (DCB) to be filled in page 3 before
the call:

```asm
; Device Control Block (DCB) — OS page 3
DDEVIC  = $0300   ; device ID
DUNIT   = $0301   ; unit number (1 = first drive)
DCOMND  = $0302   ; command byte
DSTATS  = $0303   ; data direction: $40=receive, $80=send
DBUFLO  = $0304   ; buffer address low
DBUFHI  = $0305   ; buffer address high
DTIMLO  = $0306   ; timeout in seconds
DBYTLO  = $0308   ; byte count low
DBYTHI  = $0309   ; byte count high
DAUX1   = $030A   ; auxiliary byte 1 (sector number low)
DAUX2   = $030B   ; auxiliary byte 2 (sector number high)

; Example: read sector N (in r0) into diskBlkBuf
_ReadBlock:
    lda #$31        ; drive 1
    sta DDEVIC
    lda #1
    sta DUNIT
    lda #$52        ; command: read sector
    sta DCOMND
    lda #$40        ; direction: receive
    sta DSTATS
    lda #<diskBlkBuf
    sta DBUFLO
    lda #>diskBlkBuf
    sta DBUFHI
    lda #7          ; 7-second timeout
    sta DTIMLO
    lda #128        ; 128 bytes/sector (810 SD)
    sta DBYTLO
    lda #0
    sta DBYTHI
    lda r0L         ; sector number low
    sta DAUX1
    lda r0H
    sta DAUX2
    jsr SIOV        ; call OS SIO (valid 6502: jsr with absolute address)
    ; on return: Y=1 and N=0 = success; Y=negative = error; DSTATS = status
    rts
```

Minimal error-handling skeleton (recommended starting point):

```asm
_ReadBlock:
    ; ... fill DCB fields ...
    jsr SIOV
    tya
    bmi @sio_error      ; Y < 0 => error
    lda #$00
    rts                 ; success (A=0)

@sio_error:
    lda DSTATS          ; OS SIO status/error code
    ; common values:
    ;   $8A = device NAK
    ;   $8B = serial framing error
    ;   $8C = checksum error
    ;   $90 = device timeout
    ; map to GEOS disk error codes here if desired
    rts
```

When the OS ROM is disabled, baseline GEOS-XL should still use OS `SIOV` by calling
through a low-RAM trampoline that temporarily banks OS ROM in, executes `jsr SIOV`,
then banks OS ROM out again:

1. Enter critical section (`DISABLE_NMI`).
2. Save current `PORTB`.
3. Bank in the OS call window with `PORTB` bits 0/1/7 forced high so OS ROM is
   visible while BASIC and self-test stay hidden.
4. Call `SIOV`.
5. Restore saved `PORTB` (OS ROM hidden again).
6. Exit critical section (`ENABLE_NMI`).

Important: this wrapper must run from RAM below `$C000` (for example page 2/3),
because enabling OS ROM overlays `$C000–$FFFF` where GEOS KERNAL code normally runs.
Also keep `NMIEN` forced to zero for the whole banked call window: when OS ROM is
visible, vectors at `$FFFA–$FFFF` are OS vectors, not GEOS vectors. If an NMI occurs
in that window, control will enter the OS handler with GEOS runtime state active.
If a build cannot guarantee `NMIEN=0` throughout, install a temporary low-RAM NMI
stub (`rti`) before banking OS ROM in.
Raw POKEY SIO can be added later only as an optimization path.

```asm
; Runs from RAM below $C000
SIOBridgeRam:
    DISABLE_NMI
    lda PORTB
    sta savedPortB
    ora #$83        ; OS ROM on, BASIC off, self-test off
    sta PORTB
    lda #$00
    sta NMIEN       ; force NMI off while vectors point to OS
    jsr SIOV
    lda #$00
    sta NMIEN       ; keep masked until GEOS mapping restored
    lda savedPortB  ; OS ROM off again
    sta PORTB
    ENABLE_NMI
    rts
```

#### Disk geometry and drive capabilities

| Drive    | Tracks | Sectors/track | Bytes/sector | Capacity | Notes |
|----------|--------|---------------|--------------|----------|-------|
| 810 SD   | 40     | 18            | 128          | 90 KB    | Standard; most common |
| 1050 ED  | 40     | 26            | 128          | 127 KB   | Enhanced density |
| XF551 DD | 40     | 18            | 256          | 180 KB   | True double density |
| Happy 1050 DD | 40 | 18           | 256          | 180 KB   | Requires drive modification |

**Important:** A stock Atari 1050 cannot do True Double Density (256-byte sectors).
It only operates in Single Density (128 bytes) or Enhanced Density (128 bytes ×
26 sectors). True 256-byte sectors require an XF551 or a modified 1050 (e.g. Happy
upgrade). Target the 810/1050 SD/ED as the baseline and treat XF551 as an optional
extension.

#### GEOS block abstraction — do NOT change the 256-byte block size

GEOS's file system is built entirely around **256-byte logical blocks**. The value
`$FE` (= 254) that appears in `files1b.s`, `files1a2b.s`, and `files8.s` represents
the 254-byte usable payload per block (256 bytes minus the 2-byte next-track/sector
link). **This must not be changed.** Altering the logical block size would require
rewriting the entire VLIR file system, all directory handlers, and all memory buffers
— an impractical scope of work.

Instead, the disk driver at `$9000` must **abstract the physical sector size** by
mapping one 256-byte GEOS logical block to two consecutive 128-byte physical Atari
sectors:

```asm
; _ReadBlock: read one 256-byte GEOS logical block from two 128-byte physical sectors
; Input: r0 = GEOS logical block number (0-based)
; Output: diskBlkBuf filled with 256 bytes
_ReadBlock:
    ; Physical sector = (block_number * 2) + 1   (Atari sectors are 1-based)
    ; First physical sector → diskBlkBuf+0
    ; Second physical sector → diskBlkBuf+128
    lda r0L             ; block number low
    asl                 ; × 2
    rol r0H
    clc
    adc #1              ; + 1 (make 1-based)
    sta DAUX1           ; first physical sector number
    ; ... set DBYTLO=#128, DBUFLO=#<diskBlkBuf, call SIOV ...
    ; ... then load sector+1 into diskBlkBuf+128 ...
    rts

; _WriteBlock: split diskBlkBuf into two 128-byte physical sectors and write both
_WriteBlock:
    ; same address arithmetic as _ReadBlock
    ; write diskBlkBuf+0 → first physical sector
    ; write diskBlkBuf+128 → second physical sector
    rts
```

This 2:1 mapping is entirely internal to the driver. All GEOS file-system code above
the driver sees unmodified 256-byte blocks and the same 254-byte payload semantics,
whether those values remain as `$FE` literals or are consolidated into named constants.

**BAM (Block Availability Map) checklist:**
- The C64 BAM maps 35 tracks. The Atari needs a new BAM for 40 tracks.
- With 2:1 mapping, one GEOS logical block consumes two physical 128-byte sectors.
  Capacity: 810 SD = 720 physical sectors ÷ 2 = 360 GEOS blocks (minus directory).
- Define a new on-disk BAM format compatible with the Atari track/sector layout.
- All GEOS code that reads the BAM works on logical block numbers and is unaffected.

#### Driver jump table at $9000

Expose the same public interface as the C64 drivers; only the implementation changes:

```asm
; Pointers ($9000–$902F): filled at init time with Atari SIO function addresses
; Public functions ($9030–):
;   Get1stDirEntry, GetNxtDirEntry, GetBorder, AddDirBlock,
;   ReadBuff, WriteBuff, SendTSBytes, CheckErrors, AllocateBlock, ReadLink
```

### 6.8 Rewrite: Graphics Hardware Interface

**Affected files:** `kernal/graph/mode.s`, `kernal/sprites/`, `kernal/hw/`

**Bitmap base address:** Change the constant that points to the screen bitmap.
C64 uses $A000 (VIC bank 2); Atari uses $4000 (ANTIC LMS pointer in display list).
All code that reads or writes a hard-coded bitmap base must use the new `BITMAP_BASE`
constant.

**Framebuffer address math (mandatory rewrite):** C64 bitmap code assumes VIC-II's
8×8 character-tiled layout. Atari mode `$0F` is linear-by-scanline, so the byte
address for pixel `(x, y)` is based on `(y * 40) + (x >> 3)` plus the scanline start.
Because the display list inserts an LMS jump from `$4FF0` to `$5000`, linear math must
also account for that discontinuity.

Do not reuse C64 scanline-address helpers as-is. Rewrite every routine that computes
screen addresses (`point`, `line`, `rect`, `bitmapup`, font blitters, and rectangle
save/restore paths) to use a precomputed 200-entry scanline lookup table:

```asm
; rowBaseLo/rowBaseHi[y] = exact byte address of scanline y
; includes the 4 KB jump between y=101 and y=102
GetPixelByteAddress:
    ; input: Y = scanline (0..199), r0 = X (0..319)
    lda rowBaseLo,y
    sta r5L
    lda rowBaseHi,y
    sta r5H
    ; byteOffset = X >> 3
    ; r5 = r5 + byteOffset
    rts
```

This LUT keeps inner loops fast on 6502 and removes runtime branching around ANTIC's
4 KB boundary.

**Mouse cursor (P/M graphics):** The C64 GEOS cursor is 16×16 pixels. A single GTIA
player is only 8 pixels wide in normal mode, so baseline GEOS-XL should use **two
players** (P0 + P1) as adjacent halves of one cursor sprite:

```asm
; P/M memory area: 2 KB aligned, place at $7800 (example)
; PMBASE = $D407: write high byte of 2KB-aligned address
    lda #$78
    sta PMBASE

; Enable P/M DMA and player/missile output
    lda #$3E        ; DMACTL: playfield + P/M single-line DMA
    sta DMACTL
    lda #$03        ; GRACTL: enable player+missile graphics output latching
    sta GRACTL

; Keep both players single-width (8 px each)
    lda #$00
    sta SIZEP0
    sta SIZEP1

; Use the same color for both halves
    lda #$0F
    sta COLPM0
    sta COLPM1

; Horizontal placement: P1 = P0 + 8 pixels
    lda mouseXPosAtari      ; already converted to GTIA HPOS scale
    sta HPOSP0
    clc
    adc #8
    sta HPOSP1

; Write cursor shape rows at Y position:
    ; P0 data at PMBASE+$0400 (left 8 bits of each cursor row)
    ; P1 data at PMBASE+$0500 (right 8 bits of each cursor row)
    ; Zero old rows, then write 16 rows at mouseYPos offset
```

`kernal/sprites/` can be adapted or replaced entirely with P/M routines. The cursor
shape data (16×16 px arrow, hourglass, etc.) is reusable as-is; cursor rendering code
is not.

### 6.9 Rewrite: Timer and Real-Time Clock

**File:** `kernal/time/`

C64 uses CIA1 hardware timers for the frame tick and wall clock. On Atari:

- **OS-assisted mode:** The Atari OS increments `RTCLOK` ($12–$14, 3-byte big-endian
  counter) on every VBI. Read it directly for elapsed-time calculations.
- **ROM-off mode:** Maintain a GEOS-owned 3-byte VBI counter, incremented inside
  `geos_nmi` (§6.3 Mode B).

Adapt `kernal/time/` to read from this VBI counter instead of CIA1. The rest of the
time-keeping logic (alarm scheduling, process timers) is unchanged.

### 6.10 Modules Reusable Without Change

The following modules contain no hardware-specific code and can be assembled for
Atari XL without modification (beyond the zero-page address shift and the
bitmap-base constant):

| Module | Notes |
|--------|-------|
| `kernal/math/` | Pure 6502 arithmetic |
| `kernal/memory/` | FillRam, MoveData |
| `kernal/process/` | Cooperative multitasking scheduler |
| `kernal/menu/` | Menu system (uses graphics + input abstraction) |
| `kernal/dlgbox/` | Dialog boxes |
| `kernal/icon/` | Icon rendering |
| `kernal/load/` | Application and desk accessory loader |
| `kernal/files/` | VLIR file format, directory handling (sector-size audit required — see §6.7) |
| `kernal/bitmask/` | Bitmask lookup tables |
| `kernal/patterns/` | Fill patterns |
| `kernal/bswfont/` | Berkeley Softworks system font |
| `inc/geosmac.inc` | Assembly macros (after START_IO/CLEAR_IO fix) |
| `inc/const.inc` | System constants (remove C64-specific color equates) |
| `input/joydrv.s` | Movement/acceleration logic (hardware read replaced) |

`kernal/graph/*.s` and parts of `kernal/fonts/` are intentionally not listed here:
their bitmap-address math must be rewritten for Atari's linear framebuffer and LMS
boundary handling (see §6.8).

---

## 7. New Files to Create

| File | Purpose |
|------|---------|
| `inc/atari.inc` | All Atari hardware register equates |
| `kernal/start/start_atari.s` | Boot sequence, OS ROM disable, ANTIC/GTIA init |
| `kernal/irq/irq_atari.s` | VBI NMI handler (Mode B), POKEY IRQ handler |
| `kernal/keyboard/keyboard_atari.s` | POKEY key scanner + POKEY→GEOS scancode table |
| `kernal/hw/hw_atari.s` | ANTIC display list, P/M memory setup, color table |
| `kernal/vars/vars_atari.s` | Atari-specific system variables (VBI counter, etc.) |
| `kernal/kernal_atarixl.cfg` | ca65 linker config (derived from kernal_bsw.cfg) |
| `drv/drv1050.s` | Atari SIO disk driver (810 SD / 1050 ED compatible) |
| `drv/drv1050.cfg` | Linker config for 1050 driver |
| `input/inputdrv_atarixl.cfg` | Input driver linker config (base address $FD00) |
| `input/joydrv_atari.s` | PIA-based joystick driver |
| `input/mse_stmouse.s` | Atari ST mouse driver (adapted from `amigamse.s`, reads PORTA) |
| `input/mse_paddle.s` | Optional: POKEY paddle driver (fallback; inferior UX) |

---

## 8. Recommended Porting Sequence

### Phase 1: Build infrastructure
1. Add `atarixl` variant to `Makefile` and `config.inc`
2. Create `inc/atari.inc`
3. Derive `kernal/kernal_atarixl.cfg` from `kernal_bsw.cfg`; adjust addresses
4. Shift GEOS zero page to `$80` in `inc/geossym.inc`; wrap `START_IO`/`CLEAR_IO` in `inc/geosmac.inc`
5. Verify the build completes without assembler errors (binary will be non-functional)

### Phase 2: Bring up the display (OS-assisted mode)
6. Write `kernal/start/start_atari.s` (ANTIC display list, GTIA color init)
7. Write `kernal/hw/hw_atari.s`
8. Boot in Altirra emulator with **PAL Atari 800 XL** profile and OS ROM active; verify bitmap appears on screen
9. Run graphics routines (`HorizontalLine`, `Rectangle`); confirm correct output

Phase 2 gate before considering step 9 done:
- Replace C64 tiled framebuffer address helpers with Atari linear scanline LUT helpers.
- Validate drawing across the LMS jump boundary (`y=101` to `y=102`) to ensure no wrap artifacts.

Preferred jsA8E browser-side iteration path (repeatable evidence and diagnostics; not Altirra sign-off):
- Use the smoke-test workflows documented in `README.md` ("Atari XL Smoke Testing (jsA8E)") and `third_party/A8E/implementation/jsA8E/AUTOMATION.md`.
- Start each browser run by checking `getCapabilities()` / `getSystemState({ timeoutMs: ... })` and treat `groupedApi`, `urlXexLoad`, `urlDiskLoad`, `failureSnapshots`, `progressEvents`, `waitPrimitives`, and `resetPortBOverride` as the required automation baseline for Atari bring-up. Treat `getSystemState()` partial returns with structured `error.details.parts` as degraded-but-usable diagnostics, not as a generic automation hang.
- Prefer the grouped `window.A8EAutomation` surface: `dev.runXexFromUrl(...)` / `dev.runXex(...)`, `media.mountDiskFromUrl(...)`, `debug.runUntilPcOrSnapshot(...)`, `debug.waitForBreakpoint(...)`, `artifacts.captureFailureState(...)`, and `events.subscribe("progress", ...)`.
- Assume worker-backed `system.start()` / `system.pause()` / `system.reset()` are now request/response calls that acknowledge completion before resolving; treat later Phase 4 failures as disk/runtime faults unless those lifecycle calls fail explicitly.
- When boot state matters, use the reset-time bank override support (`system.reset({ portB: $FF })`, `system.boot({ portB: $FF })`, or `dev.runXex({ ..., resetOptions: { portB: $FF } })`) so the browser harness can rule out XL self-test / ROM-mapping issues before treating a failure as a GEOS regression.
- When you need a deterministic browser-side fallback, force the main-thread backend with `?a8e_worker=0` (or `window.A8E_BOOT_OPTIONS = { worker: false }` before `ui.js` runs) instead of inventing a separate harness API.
- Treat schema-versioned failure bundles (`artifactSchemaVersion: "2"`) as the default browser-side evidence format; they now include debug state, bank state, mounted media, console-key state, trace tail, optional disassembly/source context, and optional screenshots.
- Keep Altirra as the required sign-off path for steps that explicitly call it out (for example 8, 9, 17, 20, and 21).
- Treat the jsA8E Phase 4 flow as a diagnostic path only, because it still approximates the final setup by swapping `D1:` after the XEX loader reaches the rebased `$0881` smoke entry point.

### Phase 3: Bring up input (OS-assisted mode)
10. Write `input/joydrv_atari.s`
11. Write `kernal/irq/irq_atari.s` Mode A (VBI via VVBLKD/SETVBV)
12. Write `kernal/keyboard/keyboard_atari.s` with POKEY scancode table
13. Test: joystick moves cursor, keyboard events reach GEOS event loop

### Phase 4: Bring up disk (OS-assisted mode, SIOV active)
14. Write `drv/drv1050.s` using OS `jsr SIOV`
15. Create a GEOS-format disk image with Atari geometry using a custom conversion tool
16. Audit sector-payload references in `kernal/files/`; replace hard-coded `$FE`/`#254` literals with named 256-byte-block constants where needed, without changing GEOS block semantics (see §6.7)
17. Test: directory listing, file read, file write, disk full detection

Phase 4 gate before considering step 17 done:
- Make `EnterTurbo`/`ExitTurbo`/`PurgeTurbo` Atari-safe first. Baseline Atari 1050 bring-up can treat them as compatibility no-ops (or a tiny state-only shim) until a real acceleration path exists.
- Use the documented Phase 4 smoke harnesses from `README.md` / `third_party/A8E/implementation/jsA8E/AUTOMATION.md`: Altirra with `build/atarixl/phase4_test.ini` and `"Simulator: Error mode" = 2` for sign-off-grade debugging, and the jsA8E smoke path for faster browser-side iteration and artifact capture.
- In jsA8E, always start the smoke XEX through the newer preflight/boot path (`dev.runXex(...)` / `dev.runXexFromUrl(...)`) and preserve the emitted progress checkpoints plus the structured boot-failure artifact. For the current Phase 4 smoke XEX, the working browser-side entry flow is `awaitEntry: false` plus a normal breakpoint wait at `$0881`; treat `xex_boot_failed`, ROM/protected-memory overlap, boot-buffer placement, self-test-visible bank-state reports, and any explicit lifecycle-request timeout as harness/emulator diagnostics that must be cleared before evaluating GEOS disk code.
- Use `media.mountDiskFromUrl(...)` with cache-busting fetch controls for the writable ATR swap, and record `getSystemState({ timeoutMs: ... })` before and after the mount so the artifact bundle captures the exact ROM/media/bank state for the failed run even when one backend read degrades into partial state.
- For browser-side bring-up, use reset-time `PORTB` overrides to force the intended XL boot mapping first; if the harness still fails before `$0881`, debug that boot path using the returned bank state, trace tail, optional disassembly, source context, and explicit pause/fault reason instead of continuing with generic timeout retries.
- If worker-backed browser runs remain ambiguous, retry the same flow in main-thread mode via `?a8e_worker=0` before attributing the result to `drv1050` or GEOS file-system logic.
- Require the smoke path to advance past `OpenDisk -> GetDirHead -> EnterTurbo -> ReadBlock`. If a stop occurs earlier, capture the structured failure bundle and resolve that earlier boot/runtime fault before attributing the failure to `drv1050` or GEOS file-system logic.
- Only sign off step 17 after directory listing, sequential file read/write, and disk-full detection all pass on Atari `.atr` images such as `build/atarixl/geos.atr` and `build/atarixl/blank_geos.atr`.

### Phase 5: Cartridge boot and ROM-off
18. Write OS ROM disable stub in `start_atari.s`; test RAM at $C000 after disable using the existing low-RAM staging/copy-under-ROM path
19. Switch VBI handler to Mode B (direct NMI at $FFFA)
20. Create 8 KB cartridge ROM image for $A000–$BFFF; test cold-boot in Altirra **PAL XL** profile
21. Verify GEOS desktop loads end-to-end from cartridge + floppy; then test on **PAL** hardware

Phase 5 prerequisites and disk rule:
- Do not start ROM-disable/cartridge work until Phase 4 disk I/O succeeds end-to-end with OS ROM enabled in Altirra. Use jsA8E in parallel as the faster browser-side path to clear pre-entry boot issues, confirm bank-state assumptions, and iterate on low-RAM staging/copy-under-ROM behavior, but do not block Phase 5 on jsA8E reproducing the exact final `D1:` boot configuration.
- Keep disk I/O on OS `SIOV` via a low-RAM ROM-banking trampoline. Reuse the Phase 4 staging/copy-under-ROM path and do not block Phase 5 on raw POKEY SIO.

### Phase 6: Integration and polish
22. Implement P/M graphics cursor rendering (`kernal/sprites/` rewrite)
23. Connect VBI counter to `kernal/time/` clock routines
24. Implement ST mouse driver (`input/mse_stmouse.s`, adapted from `amigamse.s`)
25. Regression-test all graphics, font, menu, dialog, and file operations
26. Tune timing loops (Atari 1.79 MHz vs C64 1 MHz; cycle-count-dependent delays differ)

Step 24 implementation requirement:
- Poll ST mouse quadrature using ANTIC DLIs (~300–500 Hz by placing DLI on selected scanlines), then apply accumulated deltas in the PAL frame VBI (50 Hz).

Step 26 timing requirement:
- Calibrate delays with ANTIC/P-M DMA enabled; effective CPU time is lower during active display than during VBI.

Phase 6 regression note:
- Use jsA8E first for repeatable browser-side regression capture (screenshots, traces, failure bundles, and scripted input) across Phases 2-4 smoke binaries and selected cartridge/ROM-off bring-up binaries, then repeat milestone sign-off in Altirra and on PAL hardware where required.

---

## 9. Key Risks and Constraints

**Zero page conflict.** Atari OS reserves $00–$7F. Every source file that
hard-codes zero-page addresses must be updated. Run a thorough grep for numeric
ZP references before declaring Phase 1 complete.

**Cartridge at $A000–$BFFF.** Standard Atari cartridges cannot be disabled from
software, so $A000–$BFFF remains cartridge ROM throughout execution. The GEOS
KERNAL must therefore live at $C000+ (same as C64), in the space vacated by the
Atari OS ROM after it is disabled. Do not attempt to place writable KERNAL data at
$A000–$BFFF.

**Framebuffer layout mismatch.** C64 bitmap-address math is VIC-II tiled
(`(y>>3)*320 + (x>>3)*8 + (y&7)`), but Atari mode `$0F` is linear
(`y*40 + (x>>3)`). Any graphics/font routine that computes screen addresses must be
rewritten for the Atari layout.

**ANTIC 4 KB DMA boundary.** A mode-$0F scanline fetch cannot naturally cross
`$xFFF -> $x000`. With a bitmap starting at `$4000`, line 102 ends at `$4FEF`, so
line 103 must begin at `$5000` via a new LMS instruction. Keep the `$4FF0–$4FFF`
gap unused and encode the jump in the scanline LUT.

**OS ROM disable ordering.** The disable must be performed by a stub already in RAM
before the switch. Verify that no interrupt can fire between copying the stub and
completing the PORTB write. Disable NMI (`sta NMIEN` with zero) before the stub
runs; re-enable after vectors are installed in RAM.

**OS-assisted vs ROM-off modes.** Phases 2–4 run with the Atari OS active (VBI via
VVBLKD, SIO via SIOV, keyboard via OS, clock via RTCLOK). Phase 5 switches to ROM-off
mode (raw NMI, own keyboard scanner, own VBI counter). Disk I/O should still use
OS `SIOV` through a low-RAM ROM-banking trampoline until an optional optimized raw
SIO path is added. Keep both modes distinct and do not mix OS-ROM-active assumptions
with ROM-off code.

**PAL-first timing policy.** First-release build targets PAL only (`VBI_HZ = 50`).
Implement timing with `VBI_HZ`-based constants so NTSC (`VBI_HZ = 60`) can be added
later without rewriting core logic (scope checklist in §10).

**ANTIC DMA cycle stealing.** Effective CPU throughput is lower during active display
than during VBI, especially with mode `$0F` plus P/M DMA enabled. Validate any
cycle-counted loops under real display DMA load, not only in blank/VBI windows.

**VBI masking via NMIEN.** Unlike some NMI sources, the Atari VBI NMI can be
suppressed by writing `#$00` to NMIEN ($D40E). Use the `DISABLE_NMI`/`ENABLE_NMI`
macros (§6.3) with a nesting counter. A non-counted implementation will re-enable
NMI too early in nested critical sections and cause timing-sensitive corruption.

**Mouse sampling rate.** Quadrature must be sampled above frame rate. Polling only
once per VBI will miss transitions during fast movement; use ANTIC DLI-based sampling
in the ~300–500 Hz range and apply accumulated deltas in VBI.

**Disk I/O baseline in ROM-off mode.** Avoid blocking the port on a full raw-SIO
rewrite. Use the ROM-banked `SIOV` bridge first (running from RAM below `$C000`),
then add raw/high-speed SIO later as an optimization.

**Banked SIOV vector window.** While OS ROM is temporarily banked in for `SIOV`,
`$FFFA–$FFFF` are OS vectors. Keep VBI NMI masked for that whole window (or use a
temporary low-RAM `RTI` NMI stub) to avoid dispatching into unexpected handlers.

**Sector abstraction in the disk driver.** Do not change the GEOS 256-byte logical
block size or the meaning of the 254-byte payload values used in `kernal/files/`.
Those literals may be consolidated into named constants, but the driver at $9000 must
still map each 256-byte GEOS block to two consecutive 128-byte physical Atari SD
sectors (see §6.7). Changing the logical block size would require rewriting the entire
VLIR file system and is not feasible. Target a stock Atari 810 or 1050 first; add
XF551 true-DD (256-byte sector) support later as an optional fast-path in the driver.

**`CPU_DATA` / $01.** The `START_IO`/`CLEAR_IO` macros save and manipulate the
C64's CPU I/O port at $01. On Atari, $01 is ordinary RAM. Make these macros no-ops
under `atarixl` to avoid corrupting application data.

**PORTB bit polarity.** On XL/XE machines, BASIC ROM disable is bit 1 = 1 (RAM),
and OS ROM disable is bit 0 = 0 (RAM). The polarities differ from what intuition
might suggest; refer to the mask table in §2 and test on real hardware or Altirra
with accurate XL hardware emulation enabled.

---

## 10. NTSC Follow-Up Scope

NTSC support should start only after the PAL baseline (Phases 1–5) is stable.
Keep the same 320×200 bitmap model, then validate these deltas:

1. Set timing configuration to NTSC (`VIDEO_STD = 1`, `VBI_HZ = 60`).
2. Re-test display-list centering/borders on NTSC hardware or emulator and adjust
   blank-line counts if needed.
3. Recalibrate all frame-based timing constants (keyboard repeat, cursor blink,
   scheduler ticks, and any disk timeout logic measured in frames).
4. Re-check GTIA palette choices on NTSC displays/emulators and adjust hues/luma
   where readability or UI contrast regresses.
5. Re-run integration tests from Phase 6 under NTSC to confirm no PAL-only timing
   assumptions remain.
