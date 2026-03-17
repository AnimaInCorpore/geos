; GEOS by Berkeley Softworks
; reverse engineered by Maciej Witkowiak, Michael Steil
;
; Atari ST mouse input driver (Atari XL, joystick port 1)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "atari.inc"

.segment "inputdrv"

MouseInit:
	jmp _MouseInit
SlowMouse:
	jmp _SlowMouse
UpdateMouse:
	jmp _UpdateMouse
.ifdef bsw128
SetMouse:
	rts
.endif

acceleration:
	.byte 3

fireLast:
	.byte 0

lastY:
	.byte 0
lastX:
	.byte 0

; Gray-code predecessor tables indexed by current phase (0..3).
; Forward sequence is 00 -> 01 -> 11 -> 10 -> 00.
goingDown:
	.byte 2, 0, 3, 1
goingUp:
	.byte 1, 3, 0, 2

_MouseInit:
	LoadW mouseXPos, 8
	LoadB mouseYPos, 8
	LoadB inputData, $ff
	lda PORTA
	lsr
	lsr
	lsr
	lsr
	and #$03
	sta lastY
	lda PORTA
	lsr
	lsr
	lsr
	lsr
	lsr
	lsr
	and #$03
	sta lastX
	jsr ReadTriggerBit4
	sta fireLast
	asl
	asl
	asl
	eor #%10000000
	sta mouseData
_SlowMouse:
	rts

_UpdateMouse:
	bbrf MOUSEON_BIT, mouseOn, _SlowMouse
	lda mouseAccel
	lsr
	lsr
	lsr
	lsr
	sta acceleration
	beq @accelMin
	jmp @haveAccel
@accelMin:
	lda #1
	sta acceleration
@haveAccel:

	; Fire button (TRIG1: active-low).
	jsr ReadTriggerBit4
	cmp fireLast
	beq @decodeY
	sta fireLast
	asl
	asl
	asl
	eor #%10000000
	sta mouseData
	smbf MOUSE_BIT, pressFlag

@decodeY:
	; Y axis from Up/Down lines (PORTA bits 4-5).
	lda PORTA
	lsr
	lsr
	lsr
	lsr
	and #$03
	tax
	cpx lastY
	beq @decodeX
	lda lastY
	cmp goingDown,x
	beq @goDown
	cmp goingUp,x
	bne @storeY
@goUp:
	lda mouseYPos
	sub acceleration
	bcc @clampYMin
	sta mouseYPos
	jmp @storeY
@clampYMin:
	lda #0
	sta mouseYPos
	jmp @storeY
@goDown:
	lda mouseYPos
	add acceleration
	cmp #200
	bcc @storeYPos
	lda #199
@storeYPos:
	sta mouseYPos
@storeY:
	stx lastY

@decodeX:
	; X axis from Left/Right lines (PORTA bits 6-7).
	lda PORTA
	lsr
	lsr
	lsr
	lsr
	lsr
	lsr
	and #$03
	tax
	cpx lastX
	beq @done
	lda lastX
	cmp goingDown,x
	beq @goRight
	cmp goingUp,x
	bne @storeX
@goLeft:
	lda mouseXPos
	sub acceleration
	sta mouseXPos
	lda mouseXPos+1
	sbc #0
	sta mouseXPos+1
	bcs @storeX
	LoadW mouseXPos, 0
	jmp @storeX
@goRight:
	lda mouseXPos
	add acceleration
	sta mouseXPos
	lda mouseXPos+1
	adc #0
	sta mouseXPos+1
	lda mouseXPos+1
	cmp #$01
	bcc @storeX
	bne @clampXMax
	lda mouseXPos
	cmp #$40
	bcc @storeX
@clampXMax:
	LoadW mouseXPos, 319
@storeX:
	stx lastX
@done:
	rts

ReadTriggerBit4:
	lda TRIG1
	and #$01
	beq @pressed
	lda #0
	rts
@pressed:
	lda #$10
	rts
