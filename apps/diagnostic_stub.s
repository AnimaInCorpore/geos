; Minimal diagnostic stub for DESK TOP
; Jumps directly to record1 entry point $1956
; Purpose: Verify the DESK TOP app can at least enter its main routine
; without requiring the full GEOS KERNAL initialization.

.include "const.inc"
.include "atari.inc"

; Record 1 entry point from disassembly
DESKTOP_ENTRY = $1956

.segment "START"
    sei
    cld
    ldx #$FF
    txs
    
    ; Minimal screen setup
    lda #$00
    sta DMACTL
    lda #<atari_dlist
    sta DLISTL
    lda #>atari_dlist
    sta DLISTH
    lda #$3E
    sta DMACTL

    ; Diagnostic: Jump to the desktop application entry
    jsr DESKTOP_ENTRY

@loop:
    jmp @loop

; Basic display list
atari_dlist:
    .byte $70, $70, $70
    .byte $4F
    .word $4000
    .repeat 199
        .byte $0F
    .endrepeat
    .byte $41
    .word atari_dlist
