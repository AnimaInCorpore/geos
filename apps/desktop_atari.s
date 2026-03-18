; Atari-native minimal GEOS desktop application
;
; This replaces the C64 DESK TOP binary for atarixl builds.
; The C64 desktop hardcodes C64 KERNAL ROM addresses for font/bitmap
; data (~$F1xx), which are garbage in Atari ROM-off mode.  This app
; uses only jumptable calls that resolve to the same $C100-based
; addresses on both platforms.
;
; Load address : $0400 (APP_RAM)
; Start vector : $0400 (DesktopStart)
; GEOS type    : APPLICATION (6)
; Structure    : SEQ (0)

.include "const.inc"
.include "geossym.inc"

.macro LoadB dest, value
        lda #value
        sta dest
.endmacro

.macro LoadW dest, value
        lda #<(value)
        sta dest
        lda #>(value)
        sta dest+1
.endmacro

NMIEN = $D40E

; ---------------------------------------------------------------
; GEOS jumptable (fixed at $C100 on atarixl and c64 alike)
; ---------------------------------------------------------------
GS_UseSystemFont = $C14B   ; entry 25
GS_ClrScr        = $C620
GS_i_FillRam     = $C1B4   ; entry 60

; ---------------------------------------------------------------
; Screen constants (atarixl)
; ---------------------------------------------------------------
MENU_ROWS      = 16
MENU_SIZE      = 640          ; 16 * 40
STAT_ROWS      = 16
STAT_SIZE      = 640          ; 16 * 40
STAT_FRONT_ROW = 184          ; rows 184-199
STAT_FRONT     = SCREEN_BASE + STAT_FRONT_ROW * SC_BYTE_WIDTH  ; $5CC0
STAT_BACK      = BACK_SCR_BASE + STAT_FRONT_ROW * SC_BYTE_WIDTH ; $7CC0
DESKTOP_BG_ROWS = STAT_FRONT_ROW - MENU_ROWS
ICON_WIDTH     = 8
ICON_HEIGHT    = 32
ICON1_FRONT    = SCREEN_BASE + (48 * SC_BYTE_WIDTH) + 4
ICON2_FRONT    = SCREEN_BASE + (48 * SC_BYTE_WIDTH) + 20
BOTTOM_FRONT   = SCREEN_BASE + ((SC_PIX_HEIGHT - 16) * SC_BYTE_WIDTH)

; ---------------------------------------------------------------
; Patterns
; ---------------------------------------------------------------
PAT_WHITE = $00
PAT_BACK  = $55   ; 50% checkerboard (standard GEOS desktop background)
PAT_BLACK = $FF

.ifdef atarixl_desktop_smoketest
PHASE5_STATUS = $04d0
PHASE5_STATUS_DESKTOP_VISIBLE = $82
.endif

.segment "CODE"

; ---------------------------------------------------------------
; Entry point – called by KERNAL _MNLP every main-loop iteration.
; Paint once, then return so the frame remains stable on screen.
; ---------------------------------------------------------------
DesktopStart:
        lda init_done
        beq @paint
        jmp DesktopHold

@paint:
        sei
        cld
        lda #0
        sta NMIEN
        inc init_done

        ; --- Menu bar (rows 0-15): white ---
        lda #<SCREEN_BASE
        sta r0
        lda #>SCREEN_BASE
        sta r0+1
        ldx #MENU_ROWS
@menuRows:
        ldy #SC_BYTE_WIDTH - 1
@menuCols:
        lda #$ff
        sta (r0),y
        dey
        bpl @menuCols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       dex
        bne @menuRows
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $81
.endif

        ; --- Icon blocks: same desktop smoke-frame layout, painted once ---
        lda #<ICON1_FRONT
        sta r0
        lda #>ICON1_FRONT
        sta r0+1
        ldx #ICON_HEIGHT
@icon1Rows:
        ldy #ICON_WIDTH - 1
@icon1Cols:
        lda #$f0
        sta (r0),y
        dey
        bpl @icon1Cols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       
        dex
        bne @icon1Rows
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $82
.endif

        lda #<ICON2_FRONT
        sta r0
        lda #>ICON2_FRONT
        sta r0+1
        ldx #ICON_HEIGHT
@icon2Rows:
        ldy #ICON_WIDTH - 1
@icon2Cols:
        lda #$0f
        sta (r0),y
        dey
        bpl @icon2Cols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       
        dex
        bne @icon2Rows
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $83
.endif

        ; --- Status bar (rows 184-199): black ---
        lda #<BOTTOM_FRONT
        sta r0
        lda #>BOTTOM_FRONT
        sta r0+1
        ldx #16
@bottomRows:
        ldy #SC_BYTE_WIDTH - 1
@bottomCols:
        lda #$11
        sta (r0),y
        dey
        bpl @bottomCols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       dex
        bne @bottomRows
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $84
.endif

.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, PHASE5_STATUS_DESKTOP_VISIBLE
.endif
        jmp DesktopHold

DesktopHold:
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, PHASE5_STATUS_DESKTOP_VISIBLE
.endif
        jmp DesktopHold

; One-byte flag, lives in BSS / uninitialised RAM after CODE
init_done:
        .byte 0
