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
GS_DoIcons       = $C15A
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

.segment "CODE"

.ifdef atarixl_desktop_smoketest
PHASE5_STATUS = $04d0
PHASE5_STATUS_DESKTOP_VISIBLE = $82
.endif

; ---------------------------------------------------------------
; Entry point – called by KERNAL _MNLP every main-loop iteration.
; Paint once on first call, then return immediately on subsequent
; calls so the desktop keeps running without erasing its own output.
; ---------------------------------------------------------------
DesktopStart:
        lda painted
        beq @doPaint
        rts                     ; already painted — just return
@doPaint:
        inc painted             ; mark as painted before we begin
        sei
        cld
        lda #$00
        sta NMIEN
        lda #(ST_WR_FORE | ST_WR_BACK)
        sta dispBufferOn

        ; --- Menu bar (rows 0-15): white ---
        lda #<SCREEN_BASE
        sta r0
        lda #>SCREEN_BASE
        sta r0+1
        lda #<BACK_SCR_BASE
        sta r1
        lda #>BACK_SCR_BASE
        sta r1+1
        ldx #MENU_ROWS
@menuRows:
        ldy #SC_BYTE_WIDTH - 1
@menuCols:
        lda #$ff
        sta (r0),y
        sta (r1),y
        dey
        bpl @menuCols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       
        clc
        lda r1
        adc #SC_BYTE_WIDTH
        sta r1
        bcc :+
        inc r1+1
:       
        dex
        bne @menuRows
        ; --- Desktop background (rows 16-183): clear to zero ---
        ; r0 already points to SCREEN_BASE + MENU_ROWS * 40,
        ; r1 to BACK_SCR_BASE + MENU_ROWS * 40 after menu loop.
        ldx #DESKTOP_BG_ROWS
@bgRows:
        ldy #SC_BYTE_WIDTH - 1
@bgCols:
        lda #$00
        sta (r0),y
        sta (r1),y
        dey
        bpl @bgCols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:
        clc
        lda r1
        adc #SC_BYTE_WIDTH
        sta r1
        bcc :+
        inc r1+1
:
        dex
        bne @bgRows

.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $81
.endif

        lda #<DesktopIcons
        sta r0
        lda #>DesktopIcons
        sta r0+1
        jsr GS_DoIcons
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, $83
.endif

        ; --- Status bar (rows 184-199): black ---
        lda #<BOTTOM_FRONT
        sta r0
        lda #>BOTTOM_FRONT
        sta r0+1
        lda #<(BACK_SCR_BASE + ((SC_PIX_HEIGHT - 16) * SC_BYTE_WIDTH))
        sta r1
        lda #>(BACK_SCR_BASE + ((SC_PIX_HEIGHT - 16) * SC_BYTE_WIDTH))
        sta r1+1
        ldx #16
@bottomRows:
        ldy #SC_BYTE_WIDTH - 1
@bottomCols:
        lda #$11
        sta (r0),y
        sta (r1),y
        dey
        bpl @bottomCols
        clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       
        clc
        lda r1
        adc #SC_BYTE_WIDTH
        sta r1
        bcc :+
        inc r1+1
:       dex
        bne @bottomRows
.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, PHASE5_STATUS_DESKTOP_VISIBLE
.endif
        lda #$40
        sta NMIEN
        cli
        rts

DesktopIconNoop:
        rts

DesktopIcons:
        .byte 2
        .word 0
        .byte 0
        .word DesktopDiskPic
        .byte 4, 48, 6, 16
        .word DesktopIconNoop
        .word DesktopOpenPic
        .byte 20, 48, 6, 16
        .word DesktopIconNoop

DesktopDiskPic:
        .byte 5, %11111111, $80+1, %11111110, $db+8, 2, $80+6
        .byte %10000000, %00000000, %00000000, %00000000, %00000000, %00000011, $80+12
        .byte %10000000, %00000001, %11001100, %01111100, %00000000, %00000011
        .byte %10000000, %00000001, %11001100, %11000110, %00000000, %00000011, $db+8, 2, $80+6
        .byte %10000000, %00000001, %11101100, %11000110, %00000000, %00000011, $db+8, 2, $80+6
        .byte %10000000, %00000001, %10111100, %11000110, %00000000, %00000011, $db+8, 2, $80+6
        .byte %10000000, %00000001, %10011100, %11000110, %00000000, %00000011, $80+6
        .byte %10000000, %00000001, %10001100, %01111100, %00000000, %00000011, $db+8, 2, $80+6
        .byte %10000000, %00000000, %00000000, %00000000, %00000000, %00000011
        .byte 6, %11111111, $80+1, %01111111, 5, %11111111

DesktopOpenPic:
        .byte 5, %11111111, $80+1, %11111110, $db+8, 2, $80+6
        .byte %10000000, %00000000, %00000000, %00000000, %00000000, %00000011, $80+(9*6)
        .byte %10000000, %00111110, %00000000, %00000000, %00000000, %00000011
        .byte %10000000, %01100011, %00000000, %00000000, %00000000, %00000011
        .byte %10000000, %01100011, %01111100, %01111001, %11110000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %11011000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11111101, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11000001, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %10011000, %00000011
        .byte %10000000, %00111110, %01111100, %01111001, %10011000, %00000011, $db+8, 2, $80+6
        .byte %10000000, %00000000, %01100000, %00000000, %00000000, %00000011
        .byte 6, %11111111, $80+1, %01111111, 5, %11111111

.segment "BSS"
painted:        .res 1
