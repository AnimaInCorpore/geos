; GEOS KERNAL by Berkeley Softworks
; Atari XL startup bring-up (Phase 2, OS-assisted mode)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "inputdrv.inc"
.include "atari.inc"

; main.s
.import InitGEOEnv
.import _DoFirstInitIO
.import _EnterDeskTop

; header.s
.import dateCopy

.import LdApplic
.import GetBlock
.import EnterDeskTop
.import GetDirHead
.import FirstInit
.import i_FillRam
.import InitAtariDisplay
.import InitAtariIRQ

.ifdef usePlus60K
.import DetectPlus60K
.endif
.if .defined(useRamCart64) || .defined(useRamCart128)
.import DetectRamCart
.endif
.ifdef useRamExp
.import LoadDeskTop
.endif

.global _ResetHandle

.segment "start"
	.byte 0

.segment "start_atari"

_ResetHandle:
	sei
	cld
	ldx #$ff
	txs

	; Phase 2 bring-up: ANTIC mode $0F display list and GTIA palette.
	jsr InitAtariDisplay
	jsr InitAtariKeyboard
	jsr InitAtariIRQ

	jsr i_FillRam
	.word $0500
	.word dirEntryBuf
	.byte 0

	; Keep existing date initialization flow for now.
	ldy #2
@copyDate:
	lda dateCopy,y
	sta year,y
	dey
	bpl @copyDate

	jsr FirstInit
	jsr MouseInit
	lda #currentInterleave
	sta interleave

	lda #1
	sta NUMDRV
	ldy #0
	sty curDrive
	lda #DRV_TYPE
	sta curType
	sta _driveType,y

OrigResetHandle:
	sei
	cld
	ldx #$ff
	jsr _DoFirstInitIO
	jsr InitGEOEnv
.ifdef usePlus60K
	jsr DetectPlus60K
.endif
.if .defined(useRamCart64) || .defined(useRamCart128)
	jsr DetectRamCart
.endif
	jsr GetDirHead
	MoveB bootSec, r1H
	MoveB bootTr, r1L
	AddVB 32, bootOffs
	bne @bootLoad
@fallback:
	MoveB bootSec2, r1H
	MoveB bootTr2, r1L
	bne @bootLoad
	lda NUMDRV
	bne @enterDesktop
	inc NUMDRV
@enterDesktop:
	LoadW EnterDeskTop+1, _EnterDeskTop
.ifdef useRamExp
	jsr LoadDeskTop
.endif
	jmp EnterDeskTop

@bootLoad:
	MoveB r1H, bootSec
	MoveB r1L, bootTr
	LoadW r4, diskBlkBuf
	jsr GetBlock
	bnex @enterDesktop
	MoveB diskBlkBuf+1, bootSec2
	MoveB diskBlkBuf, bootTr2
@scanDir:
	ldy bootOffs
	lda diskBlkBuf+2,y
	beq @nextEntry
	lda diskBlkBuf+$18,y
	cmp #AUTO_EXEC
	beq @runAutoExec
@nextEntry:
	AddVB 32, bootOffs
	bne @scanDir
	beq @fallback
@runAutoExec:
	ldx #0
@copyEntry:
	lda diskBlkBuf+2,y
	sta dirEntryBuf,x
	iny
	inx
	cpx #30
	bne @copyEntry
	LoadW r9, dirEntryBuf
	LoadW EnterDeskTop+1, _ResetHandle
	LoadB r0L, 0
	jsr LdApplic

bootTr:
	.byte DIR_TRACK
bootSec:
	.byte 1
bootTr2:
	.byte 0
bootSec2:
	.byte 0
bootOffs:
	.byte 0

InitAtariKeyboard:
	lda #$00
	sta SKCTL
	lda #$03
	sta SKCTL
	rts
