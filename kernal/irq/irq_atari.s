; GEOS KERNAL by Berkeley Softworks
; Atari XL IRQ/VBI support (Mode A: OS deferred VBI hook)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "atari.inc"

; keyboard.s
.import _DoKeyboardScan

; vars.s
.import KbdQueFlag
.import alarmWarnFlag

.import CallRoutine

.ifdef wheels_screensaver
.import ProcessMouse
.import GetRandom
.endif

.global nmiDisableDepth
.global nmiEnableMask
.global InitAtariIRQ
.global _IRQHandler
.global _IRQVectorHandler
.global _NMIHandler

.segment "irq_atari"

InitAtariIRQ:
	lda #0
	sta nmiDisableDepth
	lda #$40
	sta nmiEnableMask

	lda #<_NMIHandler
	sta $FFFA
	lda #>_NMIHandler
	sta $FFFB
	lda #<_IRQVectorHandler
	sta $FFFE
	lda #>_IRQVectorHandler
	sta $FFFF

	lda nmiEnableMask
	sta NMIEN
	rts

; Jump-table callable entry. Kept for compatibility with MainIRQ.
_IRQHandler:
	pha
	txa
	pha
	tya
	pha
	jsr AtariIRQCore
	pla
	tay
	pla
	tax
	pla
	rts

; Raw CPU IRQ vector entry for ROM-off execution.
_IRQVectorHandler:
	pha
	txa
	pha
	tya
	pha
	jsr AtariIRQCore
	pla
	tay
	pla
	tax
	pla
	rti

; Direct NMI handler for Mode B (ROM-off execution)
_NMIHandler:
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
	jsr AtariIRQCore
	pla
	tay
	pla
	tax
@done:
	pla
	rti

@is_dli:
	; TODO: DLI handler (mouse sampling)
	pla
	rti

AtariDeferredVBI:
	jsr AtariIRQCore
	jmp XITVBV

AtariIRQCore:
	PushW CallRLo
	PushW returnAddress
	ldx #0
@saveZP:
	lda r0,x
	pha
	inx
	cpx #32
	bne @saveZP
	START_IO
	lda dblClickCount
	beq @skipDbl
	dec dblClickCount
@skipDbl:
	ldy KbdQueFlag
	beq @skipKbdQueueDec
	iny
	beq @skipKbdQueueDec
	dec KbdQueFlag
@skipKbdQueueDec:
	jsr _DoKeyboardScan
	lda alarmWarnFlag
	beq @skipAlarm
	dec alarmWarnFlag
@skipAlarm:
.ifdef wheels_screensaver
	lda saverStatus
	lsr
	bcc @dispatchVectors      ; screensaver not running
	jsr ProcessMouse
	jsr GetRandom
	bra @doneVectors
.endif
@dispatchVectors:
	lda intTopVector
	ldx intTopVector+1
	jsr CallRoutine
	lda intBotVector
	ldx intBotVector+1
	jsr CallRoutine
@doneVectors:
	END_IO
	ldx #31
@restoreZP:
	pla
	sta r0,x
	dex
	bpl @restoreZP
	PopW returnAddress
	PopW CallRLo
	rts
