; GEOS KERNAL by Berkeley Softworks
; Atari XL keyboard driver (POKEY KBCODE scanner)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "atari.inc"

.import KbdQueHead
.import KbdQueue
.import KbdQueTail
.import KbdQueFlag
.import KbdNextKey

.global _DoKeyboardScan
.global KbdScanHelp3
.global _GetNextChar

.segment "keyboard_atari"

_DoKeyboardScan:
	lda SKSTAT
	and #$04                    ; SKSTAT bit2: 0=key down
	beq @decode
	LoadB KbdQueFlag, $ff       ; no key held: stop repeat
	LoadB KbdNextKey, 0
	rts

@decode:
	lda KBCODE
	sta r0L
	and #$3f
	tax
	lda AtariKbdMap,x
	bbrf 6, r0L, @haveChar      ; bit6 set: shifted variant
	lda AtariKbdShiftMap,x
@haveChar:
	cmp #KEY_INVALID
	beq @clearRepeat

	; Keep C64-style control behavior: set bit 7 on printable chars.
	bbrf 7, r0L, @haveFinalChar
	cmp #$20
	bcc @haveFinalChar
	ora #$80
@haveFinalChar:
	sta r0H
	cmp KbdNextKey
	bne @queueNew
	lda KbdQueFlag
	bne @done                    ; held key, repeat timer not elapsed yet
	lda r0H
	jsr KbdScanHelp2
	jsr SetRepeatDelay
	rts

@queueNew:
	sta KbdNextKey
	lda r0H
	jsr KbdScanHelp2
	jsr SetRepeatDelay
	rts

@clearRepeat:
	LoadB KbdQueFlag, $ff
	LoadB KbdNextKey, 0
@done:
	rts

SetRepeatDelay:
	lda KEYREP                   ; OS-assisted repeat source
	bne @store
	lda #8
@store:
	sta KbdQueFlag
	rts

KbdScanHelp2:
	php
	sei
	pha
	smbf KEYPRESS_BIT, pressFlag
	ldx KbdQueTail
	pla
	sta KbdQueue,x
	jsr KbdQueueStep
	cpx KbdQueHead
	beq @done
	stx KbdQueTail
@done:
	plp
	rts

KbdScanHelp3:
	php
	sei
	ldx KbdQueHead
	lda KbdQueue,x
	sta keyData
	jsr KbdQueueStep
	stx KbdQueHead
	cpx KbdQueTail
	bne @done
	rmb KEYPRESS_BIT, pressFlag
@done:
	plp
	rts

KbdQueueStep:
	inx
	cpx #16
	bne @done
	ldx #0
@done:
	rts

_GetNextChar:
	bbrf KEYPRESS_BIT, pressFlag, @none
	jmp KbdScanHelp3
@none:
	lda #0
	rts

; 64-entry tables indexed by KBCODE bits 0..5.
; Entries use GEOS key values (printable ASCII or KEY_* constants).
AtariKbdMap:
	.byte 'l', 'j', ';', KEY_INVALID, KEY_INVALID, 'k', '+', '*'
	.byte 'o', KEY_INVALID, 'p', 'u', CR, 'i', '-', '='
	.byte 'v', KEY_HELP, 'c', KEY_INVALID, KEY_INVALID, 'b', 'x', 'z'
	.byte '4', KEY_INVALID, '3', '6', KEY_ESC, '5', '2', '1'
	.byte ',', ' ', '.', 'n', KEY_INVALID, 'm', '/', KEY_INVALID
	.byte 'r', KEY_INVALID, 'e', 'y', KEY_TAB, 't', 'w', 'q'
	.byte '9', KEY_INVALID, '0', '7', KEY_DELETE, '8', '<', '>'
	.byte 'f', 'h', 'd', KEY_INVALID, KEY_INVALID, 'g', 's', 'a'

AtariKbdShiftMap:
	.byte 'L', 'J', ':', KEY_INVALID, KEY_INVALID, 'K', $5c, '^'
	.byte 'O', KEY_INVALID, 'P', 'U', CR, 'I', '_', '|'
	.byte 'V', KEY_HELP, 'C', KEY_INVALID, KEY_INVALID, 'B', 'X', 'Z'
	.byte '$', KEY_INVALID, '#', '&', KEY_ESC, '%', $22, '!'
	.byte '[', ' ', '+', 'N', KEY_INVALID, 'M', '?', KEY_INVALID
	.byte 'R', KEY_INVALID, 'E', 'Y', KEY_TAB, 'T', 'W', 'Q'
	.byte '(', KEY_INVALID, ')', $27, KEY_INSERT, '@', '}', KEY_INVALID
	.byte 'F', 'H', 'D', KEY_INVALID, KEY_INVALID, 'G', 'S', 'A'
