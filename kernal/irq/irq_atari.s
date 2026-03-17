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
.import atari_dlist
.import _ResetHandle

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

ATARI_DMACTL_ACTIVE = $3E
SDMCTL = $022F
SDLSTL = $0230
SDLSTH = $0231

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
	; Keep NMI source mask pinned to VBI-only.  Some legacy C64 app paths can
	; accidentally write ANTIC NMIEN while running on Atari and re-enable DLI,
	; which causes rapid sequential DLI firings that starve the main loop.
	lda nmiEnableMask
	sta NMIEN
	txa
	pha
	tya
	pha
	jsr TickAtariTimers
	jsr AtariIRQCore
	pla
	tay
	pla
	tax
@done:
	pla
	rti

@is_dli:
	sta NMIRES          ; acknowledge DLI; without this the NMI re-fires immediately
	; Recover from accidental DLI enablement by restoring the intended mask.
	lda nmiEnableMask
	sta NMIEN
	; Re-assert display and CPU vectors even on DLI entry so legacy code that
	; scribbles ANTIC/page-2 state cannot starve the system before next VBI.
	jsr MaintainAtariDisplay
	pla
	rti

; Increment RTCLOK and decrement CDTMV1-5 each VBI.
; Replicates the OS VBI-immediate timer maintenance so that SIOV timeouts
; (driven by CDTMV5) and other OS services work correctly in ROM-off mode,
; and also when jsA8E dispatches the NMI to the RAM handler instead of the
; OS ROM handler while the SIO bridge has OS ROM banked in.
; Clobbers A only; X and Y are preserved.
TickAtariTimers:
	; Increment RTCLOK ($12-$14) — 3-byte big-endian real-time clock
	inc RTCLOK+2
	bne @rtcDone
	inc RTCLOK+1
	bne @rtcDone
	inc RTCLOK
@rtcDone:
	; Decrement CDTMV1-5 ($0218-$0221) — 16-bit little-endian countdown timers.
	; Each timer: if non-zero, subtract 1 from the 16-bit value.
	lda CDTMV1
	bne @decCDTMV1lo
	lda CDTMV1+1
	beq @skipCDTMV1
	dec CDTMV1+1
@decCDTMV1lo:
	dec CDTMV1
@skipCDTMV1:
	lda CDTMV2
	bne @decCDTMV2lo
	lda CDTMV2+1
	beq @skipCDTMV2
	dec CDTMV2+1
@decCDTMV2lo:
	dec CDTMV2
@skipCDTMV2:
	lda CDTMV3
	bne @decCDTMV3lo
	lda CDTMV3+1
	beq @skipCDTMV3
	dec CDTMV3+1
@decCDTMV3lo:
	dec CDTMV3
@skipCDTMV3:
	lda CDTMV4
	bne @decCDTMV4lo
	lda CDTMV4+1
	beq @skipCDTMV4
	dec CDTMV4+1
@decCDTMV4lo:
	dec CDTMV4
@skipCDTMV4:
	lda CDTMV5
	bne @decCDTMV5lo
	lda CDTMV5+1
	beq @skipCDTMV5
	dec CDTMV5+1
@decCDTMV5lo:
	dec CDTMV5
@skipCDTMV5:
	rts

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
	jsr MaintainAtariDisplay
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

MaintainAtariDisplay:
	lda #<_NMIHandler
	sta $FFFA
	lda #>_NMIHandler
	sta $FFFB
	lda #<_ResetHandle
	sta $FFFC
	lda #>_ResetHandle
	sta $FFFD
	lda #<_IRQVectorHandler
	sta $FFFE
	lda #>_IRQVectorHandler
	sta $FFFF
	lda #<atari_dlist
	sta DLISTL
	sta SDLSTL
	lda #>atari_dlist
	sta DLISTH
	sta SDLSTH
	lda #ATARI_DMACTL_ACTIVE
	sta DMACTL
	sta SDMCTL
	rts
