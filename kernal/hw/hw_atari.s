; GEOS KERNAL by Berkeley Softworks
; Atari XL hardware support (Phase 2, OS-assisted mode)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "atari.inc"

.import i_FillRam

.global InitAtariDisplay
.global InitAtariPM
.global AtariRowBaseLo
.global AtariRowBaseHi
.global AtariBackRowBaseLo
.global AtariBackRowBaseHi

BITMAP_LMS0 = BITMAP_BASE
BITMAP_LMS1 = BITMAP_BASE + $1000

.segment "hw_atari"

InitAtariDisplay:
	lda #$00
	sta DMACTL
	lda #<atari_dlist
	sta DLISTL
	lda #>atari_dlist
	sta DLISTH
	jsr ClearAtariBitmap
	jsr InitAtariColors
	jsr InitAtariPM
	lda #$3e            ; DL DMA + normal-width playfield + player/missile DMA
	sta DMACTL
	rts

ClearAtariBitmap:
	jsr i_FillRam
	.word $2000
	.word BITMAP_LMS0
	.byte 0
	rts

InitAtariColors:
	lda AtariColorTable+0
	sta COLBK
	lda AtariColorTable+1
	sta COLPF0
	lda AtariColorTable+2
	sta COLPF1
	lda AtariColorTable+3
	sta COLPF2
	lda AtariColorTable+4
	sta COLPF3
	rts

InitAtariPM:
	jsr i_FillRam
	.word $0800
	.word ATARI_PM_BASE
	.byte 0
	lda #>(ATARI_PM_BASE)
	sta PMBASE
	lda #$00            ; keep P/M output disabled while registers are reset
	sta GRACTL
	sta SIZEP0
	sta SIZEP1
	sta SIZEP2
	sta SIZEP3
	sta SIZEM
	sta HPOSP0
	sta HPOSP1
	sta HPOSP2
	sta HPOSP3
	sta GRAFP0_W
	sta GRAFP1_W
	sta GRAFP2_W
	sta GRAFP3_W
	sta GRAFM_W
	lda #$0f
	sta COLPM0
	sta COLPM1
	sta COLPM2
	sta COLPM3
	lda #$03            ; latch player/missile graphics output
	sta GRACTL
	rts

AtariColorTable:
	.byte $00           ; COLBK: black
	.byte $00           ; COLPF0
	.byte $00           ; COLPF1
	.byte $0f           ; COLPF2: white foreground
	.byte $00           ; COLPF3

atari_dlist:
	.byte $70, $70, $70
	.byte $4f
	.word BITMAP_LMS0
	.repeat 101
		.byte $0f
	.endrepeat
	.byte $4f
	.word BITMAP_LMS1
	.repeat 97
		.byte $0f
	.endrepeat
	.byte $41
	.word atari_dlist

; 200-entry scanline lookup with explicit LMS jump between y=101 and y=102.
.segment "hw_atari_lut"

AtariRowBaseLo:
	.repeat 102, I
		.byte <(BITMAP_LMS0 + (I * 40))
	.endrepeat
	.repeat 98, I
		.byte <(BITMAP_LMS1 + (I * 40))
	.endrepeat

AtariRowBaseHi:
	.repeat 102, I
		.byte >(BITMAP_LMS0 + (I * 40))
	.endrepeat
	.repeat 98, I
		.byte >(BITMAP_LMS1 + (I * 40))
	.endrepeat

AtariBackRowBaseLo:
	.repeat 200, I
		.byte <(BACK_SCR_BASE + (I * 40))
	.endrepeat

AtariBackRowBaseHi:
	.repeat 200, I
		.byte >(BACK_SCR_BASE + (I * 40))
	.endrepeat
