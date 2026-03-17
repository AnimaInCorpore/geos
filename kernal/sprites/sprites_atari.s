; GEOS KERNAL by Berkeley Softworks
; Atari XL player/missile sprite driver

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "atari.inc"

.global _DisablSprite
.global _DrawSprite
.global _EnablSprite
.global _PosSprite

ATARI_PM_Y_OFFSET    = 24
ATARI_PM_X_OFFSET    = 48
ATARI_CURSOR_HEIGHT  = 16

.segment "vars"

AtariSpriteEnableMask:
	.byte 0

AtariSprite0X:
	.word 0
AtariSprite1X:
	.word 0

AtariSprite0Y:
	.byte 0
AtariSprite1Y:
	.byte 0

AtariSprite0Left:
	.res ATARI_CURSOR_HEIGHT
AtariSprite0Right:
	.res ATARI_CURSOR_HEIGHT
AtariSprite1Data:
	.res ATARI_CURSOR_HEIGHT

.segment "sprites"

;---------------------------------------------------------------
; DrawSprite (Atari)
;
; Pass:      r3L sprite number (0..1 supported)
;            r4  ptr to C64-format 24x21 sprite data (3 bytes/row)
; Return:    converted shape stored; refreshed on screen when enabled
;---------------------------------------------------------------
_DrawSprite:
	lda r3L
	beq @sprite0
	cmp #1
	beq @sprite1
	rts

@sprite0:
	ldy #0
	ldx #0
@copy0:
	lda (r4),y
	sta AtariSprite0Left,x
	iny
	lda (r4),y
	sta AtariSprite0Right,x
	iny
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @copy0
	lda AtariSpriteEnableMask
	and #$01
	beq @done
	jsr AtariClearSprite0
	jsr AtariDrawSprite0
@done:
	rts

@sprite1:
	ldy #0
	ldx #0
@copy1:
	lda (r4),y
	sta AtariSprite1Data,x
	iny
	iny
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @copy1
	lda AtariSpriteEnableMask
	and #$02
	beq @done
	jsr AtariClearSprite1
	jsr AtariDrawSprite1
	rts

;---------------------------------------------------------------
; PosSprite (Atari)
;
; Pass:      r3L sprite number (0..1 supported)
;            r4  x pos (0..319)
;            r5L y pos (0..199)
; Return:    sprite moved
;---------------------------------------------------------------
_PosSprite:
	lda r3L
	beq @sprite0
	cmp #1
	beq @sprite1
	rts

@sprite0:
	lda AtariSpriteEnableMask
	and #$01
	beq @store0
	jsr AtariClearSprite0
@store0:
	MoveW r4, AtariSprite0X
	MoveB r5L, AtariSprite0Y
	jsr AtariSetSprite0HPos
	lda AtariSpriteEnableMask
	and #$01
	beq @done
	jsr AtariDrawSprite0
@done:
	rts

@sprite1:
	lda AtariSpriteEnableMask
	and #$02
	beq @store1
	jsr AtariClearSprite1
@store1:
	MoveW r4, AtariSprite1X
	MoveB r5L, AtariSprite1Y
	jsr AtariSetSprite1HPos
	lda AtariSpriteEnableMask
	and #$02
	beq @done
	jsr AtariDrawSprite1
	rts

;---------------------------------------------------------------
; EnablSprite (Atari)
;
; Pass:      r3L sprite number (0..1 supported)
; Return:    sprite shown
;---------------------------------------------------------------
_EnablSprite:
	lda r3L
	beq @sprite0
	cmp #1
	beq @sprite1
	rts

@sprite0:
	lda AtariSpriteEnableMask
	ora #$01
	sta AtariSpriteEnableMask
	jsr AtariSetSprite0HPos
	jmp AtariDrawSprite0

@sprite1:
	lda AtariSpriteEnableMask
	ora #$02
	sta AtariSpriteEnableMask
	jsr AtariSetSprite1HPos
	jmp AtariDrawSprite1

;---------------------------------------------------------------
; DisablSprite (Atari)
;
; Pass:      r3L sprite number (0..1 supported)
; Return:    sprite hidden
;---------------------------------------------------------------
_DisablSprite:
	lda r3L
	beq @sprite0
	cmp #1
	beq @sprite1
	rts

@sprite0:
	lda AtariSpriteEnableMask
	and #$01
	beq @done0
	jsr AtariClearSprite0
	lda AtariSpriteEnableMask
	and #$fe
	sta AtariSpriteEnableMask
@done0:
	rts

@sprite1:
	lda AtariSpriteEnableMask
	and #$02
	beq @done1
	jsr AtariClearSprite1
	lda AtariSpriteEnableMask
	and #$fd
	sta AtariSpriteEnableMask
@done1:
	rts

AtariSetSprite0HPos:
	lda AtariSprite0X+1
	lsr
	lda AtariSprite0X
	ror
	clc
	adc #ATARI_PM_X_OFFSET
	sta HPOSP0
	clc
	adc #8
	sta HPOSP1
	rts

AtariSetSprite1HPos:
	lda AtariSprite1X+1
	lsr
	lda AtariSprite1X
	ror
	clc
	adc #ATARI_PM_X_OFFSET
	sta HPOSP2
	rts

AtariDrawSprite0:
	lda AtariSprite0Y
	clc
	adc #ATARI_PM_Y_OFFSET
	tay
	ldx #0
@loop0:
	lda AtariSprite0Left,x
	sta ATARI_PM_BASE+$0400,y
	lda AtariSprite0Right,x
	sta ATARI_PM_BASE+$0500,y
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @loop0
	rts

AtariClearSprite0:
	lda AtariSprite0Y
	clc
	adc #ATARI_PM_Y_OFFSET
	tay
	ldx #0
	lda #0
@loop0:
	sta ATARI_PM_BASE+$0400,y
	sta ATARI_PM_BASE+$0500,y
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @loop0
	rts

AtariDrawSprite1:
	lda AtariSprite1Y
	clc
	adc #ATARI_PM_Y_OFFSET
	tay
	ldx #0
@loop1:
	lda AtariSprite1Data,x
	sta ATARI_PM_BASE+$0600,y
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @loop1
	rts

AtariClearSprite1:
	lda AtariSprite1Y
	clc
	adc #ATARI_PM_Y_OFFSET
	tay
	ldx #0
	lda #0
@loop1:
	sta ATARI_PM_BASE+$0600,y
	iny
	inx
	cpx #ATARI_CURSOR_HEIGHT
	bne @loop1
	rts
