; Minimal Atari-native entry stub for DESK TOP
; This bypasses GEOS KERNAL _StartAppl and tries to call the desktop paint routine directly.

.include "const.inc"
.include "geossym.inc"
.include "atari.inc"

; Assuming the desktop entry is $0400 based on our previous config
DESKTOP_ENTRY = $0400

.segment "START"
    sei
    cld
    ldx #$FF
    txs
    
    ; Setup rudimentary Atari display
    lda #$00
    sta DMACTL
    lda #<atari_dlist
    sta DLISTL
    lda #>atari_dlist
    sta DLISTH
    lda #$3E
    sta DMACTL

    ; Manually call the desktop's entry routine
    jsr DESKTOP_ENTRY

@loop:
    jmp @loop

; Minimal DLIST
atari_dlist:
    .byte $70, $70, $70
    .byte $4F
    .word $4000 ; SCREEN_BASE
    .repeat 199
        .byte $0F
    .endrepeat
    .byte $41
    .word atari_dlist
