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
PHASE5_MENU_HEIGHT = 16
PHASE5_ICON_WIDTH = 8
PHASE5_ICON_HEIGHT = 32
PHASE5_ICON1_ADDR = SCREEN_BASE + (48 * SC_BYTE_WIDTH) + 4
PHASE5_ICON2_ADDR = SCREEN_BASE + (48 * SC_BYTE_WIDTH) + 20
PHASE5_BOTTOM_BAR_ADDR = SCREEN_BASE + ((SC_PIX_HEIGHT - 16) * SC_BYTE_WIDTH)
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
	stx PHASE5_ERROR_X
@phase5ErrorLoop:
	jmp @phase5ErrorLoop
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
	pha
	LoadB PHASE5_STATUS, $61
	pla
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
	sta r0L
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $63
.endif
	LoadW r6, DeskTopName
	jsr GetFile
	bnex EDT4GetFile
.ifdef atarixl_desktop_smoketest
	bra EDT6
.endif
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
	pha
	LoadB PHASE5_STATUS, $70
	pla
.endif
	jsr SetDevice
	LoadB r0L, NULL
	MoveW fileHeader+O_GHST_VEC, r7
.ifdef atarixl_desktop_smoketest
.ifdef atarixl_desktop_smoke_frame
	jsr Phase5RenderDesktopSmoke
	LoadB PHASE5_STATUS, $81
@phase5DeskLoop:
	jmp @phase5DeskLoop
.else
	jmp _StartAppl
.endif
.endif
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
.ifdef atarixl
	; Atari desktop/application startup can rely on VBI-driven state even
	; during the first entry-vector call. Keep IRQ/NMI servicing active.
	cli
.endif
	jmp _MNLP
.endif

.if .defined(atarixl_desktop_smoketest) && .defined(atarixl_desktop_smoke_frame)
; Draw a stable desktop-like frame in Atari mode $0F once the desktop file has
; been found.  The C64 DESK TOP binary is not Atari-safe yet, so this provides
; visible bootstrap evidence while desktop app porting remains pending.
Phase5RenderDesktopSmoke:
	jsr ClrScr

	; Menu bar
	LoadW r0, SCREEN_BASE
	ldx #PHASE5_MENU_HEIGHT
@menuRows:
	ldy #SC_BYTE_WIDTH - 1
@menuCols:
	lda #$ff
	sta (r0),y
	dey
	bpl @menuCols
	AddVW SC_BYTE_WIDTH, r0
	dex
	bne @menuRows

	; Icon block 1
	LoadW r0, PHASE5_ICON1_ADDR
	ldx #PHASE5_ICON_HEIGHT
@icon1Rows:
	ldy #PHASE5_ICON_WIDTH - 1
@icon1Cols:
	lda #$f0
	sta (r0),y
	dey
	bpl @icon1Cols
	AddVW SC_BYTE_WIDTH, r0
	dex
	bne @icon1Rows

	; Icon block 2
	LoadW r0, PHASE5_ICON2_ADDR
	ldx #PHASE5_ICON_HEIGHT
@icon2Rows:
	ldy #PHASE5_ICON_WIDTH - 1
@icon2Cols:
	lda #$0f
	sta (r0),y
	dey
	bpl @icon2Cols
	AddVW SC_BYTE_WIDTH, r0
	dex
	bne @icon2Rows

	; Bottom status bar
	LoadW r0, PHASE5_BOTTOM_BAR_ADDR
	ldx #16
@bottomRows:
	ldy #SC_BYTE_WIDTH - 1
@bottomCols:
	lda #$11
	sta (r0),y
	dey
	bpl @bottomCols
	AddVW SC_BYTE_WIDTH, r0
	dex
	bne @bottomRows
	rts
.endif
