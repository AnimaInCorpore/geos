; GEOS KERNAL by Berkeley Softworks
; reverse engineered by Maciej Witkowiak, Michael Steil
;
; Loading: EnterDeskTop, StartAppl syscalls

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "diskdrv.inc"
.include "c64.inc"

.import _MNLP
.import UNK_4
.import UNK_5
.import DeskTopName
.import _EnterDT_DB
.import TempCurDrive
.import _InitMachine
.import ClrScr
.import _UseSystemFont

.import MainLoop
.import CallRoutine
.import GetFile
.import OpenDisk
.import SetDevice
.import DoDlgBox

.ifdef wheels
.import OEnterDesktop
.import InitMachine
.endif

.ifdef atarixl_desktop_smoketest
PHASE5_STATUS = $04d0
PHASE5_ERROR_X = $04d1
.endif

.global _EnterDeskTop
.global _StartAppl

.segment "load1a"

_EnterDeskTop:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $60
.endif
.ifdef wheels
.import GetNewKernal
.import _FirstInit2
	jsr _FirstInit2
	lda #$C0 + 10
	jsr GetNewKernal
	jsr OEnterDesktop
.else
	sei
	cld
	ldx #$ff
.ifndef bsw128
	stx firstBoot
.endif
	txs
	jsr ClrScr
	jsr _InitMachine
.ifdef useRamExp
	MoveW DeskTopStart, r0
	MoveB DeskTopLgh, r2H
	LoadW r1, 1
	jsr RamExpRead
	LoadB r0L, NULL
	MoveW DeskTopExec, r7
.else
.ifdef atarixl_desktop_smoketest
	lda curDrive
	jsr EDT3
	beqx EDT5
	LoadB PHASE5_STATUS, $e2
	stx PHASE5_ERROR_X
	rts
.else
	MoveB curDrive, TempCurDrive
	eor #1
	tay
	lda _driveType,Y
	php
	lda TempCurDrive
	plp
	bpl EDT1
	tya
EDT1:	jsr EDT3
	ldy NUMDRV
.ifdef bsw128
	dey
	beq EDT2
.else
	cpy #2
	bcc EDT2
.endif
	lda curDrive
	eor #1
	jsr EDT3
EDT2:	LoadW r0, _EnterDT_DB
	jsr DoDlgBox
	lda TempCurDrive
	bne EDT1
.endif
EDT3:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $61
.endif
	jsr SetDevice
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $62
.endif
	jsr OpenDisk
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $6A
.endif
	beqx EDT5
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $e2
	stx PHASE5_ERROR_X
	rts
.endif
EDT4:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $e1
.endif
	rts
EDT5:
	lda curDrive
	sta curDevice
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $63
.endif
	sta r0L
	LoadW r6, DeskTopName
	jsr GetFile
	bnex EDT4GetFile
	lda fileHeader+O_GHFNAME+13
.ifdef bsw128
	cmp #'2'
.else
	cmp #'1'
.endif
	bcc EDT4VerA
	bne EDT6
	lda fileHeader+O_GHFNAME+15
.ifdef bsw128
	cmp #'0'
.else
	cmp #'5'
.endif
	bcc EDT4VerB
EDT6:	lda TempCurDrive
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $70
.endif
	jsr SetDevice
	LoadB r0L, NULL
	MoveW fileHeader+O_GHST_VEC, r7
.endif
.endif

EDT4GetFile:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $e3
	rts
.endif
	bra EDT4
EDT4VerA:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $e4
	rts
.endif
	bra EDT4
EDT4VerB:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $e5
	rts
.endif
	bra EDT4

_StartAppl:
	sei
	cld
	ldx #$FF
	txs
	jsr UNK_5
.ifdef wheels
.import _FirstInit3
	jsr InitMachine
	jsr _FirstInit3
.else
	jsr _InitMachine
.endif
	jsr _UseSystemFont
	jsr UNK_4
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $80
.endif
	ldx r7H
	lda r7L
.ifdef bsw128
	jsr CallRoutine
	cli                
	jmp MainLoop
.else
	jmp _MNLP
.endif
