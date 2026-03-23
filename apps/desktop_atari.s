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
GS_BitmapUp      = $C142
GS_ClrScr        = $C124
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
PAT_BACK_A = $55   ; checkerboard phase A
PAT_BACK_B = $AA   ; checkerboard phase B
PAT_WHITE  = $FF
PAT_BLACK  = $00

.segment "CODE"

.ifdef atarixl_desktop_smoketest
PHASE5_STATUS = $0600
PHASE5_STATUS_DESKTOP_VISIBLE = $82
.endif

; ---------------------------------------------------------------
; Entry point – called by KERNAL _MNLP every main-loop iteration.
; Paint once on first call, then return immediately on subsequent
; calls so the desktop keeps running without erasing its own output.
; ---------------------------------------------------------------
DesktopStart:
        lda #0                  ; self-modified to non-zero after first paint
        bne @alreadyDone
        jmp @doPaint
@alreadyDone:
        rts
@doPaint:
.ifdef atarixl_desktop_smoketest
        lda #$7F
        sta PHASE5_STATUS
.endif
        lda #$01
        sta DesktopStart+1      ; self-modify immediate operand
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
        lda #PAT_WHITE
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
        ; --- Desktop background (rows 16-183): checkerboard ---
        ; r0 already points to SCREEN_BASE + MENU_ROWS * 40,
        ; r1 to BACK_SCR_BASE + MENU_ROWS * 40 after menu loop.
        lda #PAT_BACK_A
        sta r2L
        ldx #DESKTOP_BG_ROWS
@bgRows:
        ldy #SC_BYTE_WIDTH - 1
        lda r2L
@bgCols:
        sta (r0),y
        sta (r1),y
        eor #$ff
        dey
        bpl @bgCols
        lda r2L
        eor #$ff
        sta r2L
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

        ; --- Status bar (rows 184-199): black ---
        ; r0 already points past checkerboard end = SCREEN_BASE + 184*40 = BOTTOM_FRONT
        ; r1 already points past back-buffer checkerboard end = BACK_SCR_BASE + 184*40
        ldx #16
@bottomRows:
        ldy #SC_BYTE_WIDTH - 1
@bottomCols:
        lda #PAT_BLACK
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
        LoadB PHASE5_STATUS, $81
.endif

        ; Blit icons directly (BlitIcon6x16 hangs on Atari emulation)
        ; Manually blit icon to screen/back buffer
        ldx #16
        LoadW r0, SCREEN_BASE + (48 * SC_BYTE_WIDTH) + 4
        LoadW r1, BACK_SCR_BASE + (48 * SC_BYTE_WIDTH) + 4
        LoadW r2, DiskIconRaw
        @blitLoop:
        ldy #3
        @blitCol:
        lda (r2),y
        sta (r0),y
        sta (r1),y
        dey
        bpl @blitCol
        AddVW SC_BYTE_WIDTH, r0
        AddVW SC_BYTE_WIDTH, r1
        AddVW 4, r2
        dex
        bne @blitLoop


        LoadW r2, OpenIconRaw
        lda #<ICON2_FRONT
        sta r0
        lda #>ICON2_FRONT
        sta r0+1
        lda #<(BACK_SCR_BASE + (48 * SC_BYTE_WIDTH) + 20)
        sta r1
        lda #>(BACK_SCR_BASE + (48 * SC_BYTE_WIDTH) + 20)
        sta r1+1
        jsr BlitIcon6x16

.ifdef atarixl_desktop_smoketest
        LoadB PHASE5_STATUS, PHASE5_STATUS_DESKTOP_VISIBLE
.endif
        lda #$40
        sta NMIEN
        cli
        rts

; ---------------------------------------------------------------
; Blit a 6-byte-wide, 16-row uncompressed icon to front+back screen
; Input: r2 = source data pointer (ZP $84/$85)
;        r0 = front screen row start + column offset
;        r1 = back screen row start + column offset
; Destroys: A, X, Y, r0, r1, r2
; ---------------------------------------------------------------
BlitIcon6x16:
        ldx #16
@row:   ldy #5
@col:   lda (r2),y
        sta (r0),y
        sta (r1),y
        dey
        bpl @col
        clc
        lda r2
        adc #6
        sta r2
        bcc :+
        inc r2+1
:       clc
        lda r0
        adc #SC_BYTE_WIDTH
        sta r0
        bcc :+
        inc r0+1
:       clc
        lda r1
        adc #SC_BYTE_WIDTH
        sta r1
        bcc :+
        inc r1+1
:       dex
        bne @row
        rts

DesktopIconNoop:
        rts

DesktopIcons:
        .byte 2
        .word 0
        .byte 0
        .word DiskIconRaw
        .byte 4, 48, 6, 16
        .word DesktopIconNoop
        .word OpenIconRaw
        .byte 20, 48, 6, 16
        .word DesktopIconNoop

; Uncompressed 6x16 icon data (decoded from GEOS RLE)
DiskIconRaw:
        .byte $FF, $FF, $FF, $FF, $FF, $FE  ; row 0: top border
        .byte $80, $00, $00, $00, $00, $03  ; row 1: blank
        .byte $80, $00, $00, $00, $00, $03  ; row 2: blank
        .byte %10000000, %00011111, %00001100, %00000011, %00000000, %00000011
        .byte %10000000, %00011001, %10000000, %00000011, %00000000, %00000011
        .byte %10000000, %00011000, %11011100, %11110011, %00110000, %00000011
        .byte %10000000, %00011000, %11001101, %10011011, %01100000, %00000011
        .byte %10000000, %00011000, %11001101, %10000011, %11000000, %00000011
        .byte %10000000, %00011000, %11001100, %11110011, %10000000, %00000011
        .byte %10000000, %00011000, %11001100, %00011011, %11000000, %00000011
        .byte %10000000, %00011001, %10001101, %10011011, %01100000, %00000011
        .byte %10000000, %00011111, %00001100, %11110011, %00110000, %00000011
        .byte $80, $00, $00, $00, $00, $03  ; row 12: blank
        .byte $80, $00, $00, $00, $00, $03  ; row 13: blank
        .byte $FF, $FF, $FF, $FF, $FF, $FF  ; row 14: bottom border
        .byte $7F, $FF, $FF, $FF, $FF, $FF  ; row 15: bottom border

OpenIconRaw:
        .byte $FF, $FF, $FF, $FF, $FF, $FE  ; row 0: top border
        .byte $80, $00, $00, $00, $00, $03  ; row 1: blank
        .byte $80, $00, $00, $00, $00, $03  ; row 2: blank
        .byte %10000000, %00111110, %00000000, %00000000, %00000000, %00000011
        .byte %10000000, %01100011, %00000000, %00000000, %00000000, %00000011
        .byte %10000000, %01100011, %01111100, %01111001, %11110000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %11011000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11111101, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11000001, %10011000, %00000011
        .byte %10000000, %01100011, %01100110, %11001101, %10011000, %00000011
        .byte %10000000, %00111110, %01111100, %01111001, %10011000, %00000011
        .byte $80, $00, $00, $00, $00, $03  ; row 12: blank
        .byte $80, $00, $00, $00, $00, $03  ; row 13: blank
        .byte $FF, $FF, $FF, $FF, $FF, $FF  ; row 14: bottom border
        .byte $7F, $FF, $FF, $FF, $FF, $FF  ; row 15: bottom border
