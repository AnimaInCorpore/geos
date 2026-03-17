; GEOS KERNAL by Berkeley Softworks
; Atari XL startup bring-up (Phase 2, OS-assisted mode)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "diskdrv.inc"
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
.import KbdQueFlag
.import KbdQueHead
.import KbdQueTail
.import KbdNextKey
.import _DoKeyboardScan
.import _GetNextChar
.import _DoCheckButtons
.import i_FillRam
.import InitAtariDisplay
.import InitAtariIRQ
.import _NMIHandler
.import _IRQVectorHandler
.import _HorizontalLine
.import _Rectangle
.import _SetPattern
.import OpenDisk
.import SaveFile
.import FindFile
.import GetFHdrInfo
.import ReadFile
.import verifyFlag

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

.ifdef atarixl_disk_smoketest
PHASE4_DDRB        = $04e7
PHASE4_PORTB       = $04e8
PHASE4_PBCTL       = $04e9
PHASE4_C2A1        = $04ea
PHASE4_STAGE       = $04eb
PHASE4_STATUS      = $04ec
PHASE4_ERROR       = $04ed
PHASE4_RESULTS     = $04ee
PHASE4_DONE        = $04ef
PHASE4_DIRCOUNT    = $04f0
PHASE4_DIRTYPE     = $04f1
PHASE4_DIRNAME0    = $04f2
PHASE4_DIRNAME1    = $04f3
PHASE4_DIRNAME2    = $04f4
PHASE4_DIRNAME3    = $04f5
PHASE4_SIOY        = $04f6
PHASE4_SIODST      = $04f7
PHASE4_SIOSECL     = $04f8
PHASE4_SIOSECH     = $04f9
PHASE4_SIOCMD      = $04fa
PHASE4_SIORETA     = $04fb

PHASE4_STAGE_PRE_OPEN  = 1
PHASE4_STAGE_POST_OPEN = 2
PHASE4_STAGE_PRE_SAVE  = 3
PHASE4_STAGE_POST_SAVE = 4
PHASE4_STAGE_PRE_FIND  = 5
PHASE4_STAGE_POST_FIND = 6
PHASE4_STAGE_PRE_READ  = 7
PHASE4_STAGE_POST_READ = 8

PHASE4_PASS_DIR    = $01
PHASE4_PASS_READ   = $02
PHASE4_PASS_WRITE  = $04
PHASE4_PASS_FULL   = $08
PHASE4_PASS_ALL    = PHASE4_PASS_DIR | PHASE4_PASS_READ | PHASE4_PASS_WRITE | PHASE4_PASS_FULL

PHASE4_SMALL_SRC   = BACK_SCR_BASE
PHASE4_SMALL_DST   = BACK_SCR_BASE + $0400
PHASE4_FILL_SRC    = BACK_SCR_BASE + $0800
PHASE4_SMALL_LEN   = 600
PHASE4_FILL_LEN    = 4096
PHASE4_KERNAL_SRC0 = $2000
PHASE4_VARS_BASE   = $86c0
PHASE4_VARS_SIZE   = $0940
.endif

.ifdef atarixl_desktop_smoketest
PHASE5_STATUS      = $04d0
PHASE5_STAGE_BASE  = $2000
PHASE5_INPUT_SRC   = $7800
PHASE5_INPUT_DST   = $fd00
PHASE5_INPUT_SIZE  = $0180
.endif

_ResetHandle:
	sei
	cld
	ldx #$ff
	txs

.ifdef atarixl_disk_smoketest
	jsr InstallAtariSioBridge
	jmp Phase4SmokeRun
@smokeLoop:
	jmp @smokeLoop
.endif

.ifdef atarixl_input_smoketest
	jsr Phase3SmokeInit
@smokeLoop:
	jsr Phase3SmokePollInput
	jsr Phase3SmokeAppMain
	jmp @smokeLoop
.endif

.ifdef atarixl_smoketest
	jsr Phase2SmokeInitDisplay
@smokeLoop:
	jmp @smokeLoop
.endif

.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $10
	jsr InstallAtariSioBridge
	jsr InstallDisableRomStub
	lda #$00
	sta NMIEN
	lda PORTB
	ora #$82
	sta PORTB
	jsr $0300 ; Call the stub at its RAM location — OS ROM now off
	LoadB PHASE5_STATUS, $20
	jsr Phase5InstallBootstrapPayloads
	LoadB PHASE5_STATUS, $30
.else
	; Snapshot OS vectors while OS ROM is still active, then disable OS ROM so
	; the GEOS kernal at $C000-$FFFF becomes visible.  All kernal calls (Init*,
	; i_FillRam, …) must come AFTER this pair; they live at $C100+ and would
	; hit OS ROM code if called before the disable.
	jsr InstallAtariSioBridge
	jsr InstallDisableRomStub
	jsr $0300 ; Call the stub at its RAM location — OS ROM now off
.endif

	; Phase 2 bring-up: ANTIC mode $0F display list and GTIA palette.
	jsr InitAtariDisplay
	jsr InitAtariKeyboard
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $40
.endif

	; Zero interrupt dispatch vectors before enabling Mode B NMI.  _NMIHandler
	; will fire as soon as NMIEN is written by InitAtariIRQ; CallRoutine must
	; see null vectors rather than uninitialized RAM until FirstInit runs.
	lda #0
	sta intTopVector
	sta intTopVector+1
	sta intBotVector
	sta intBotVector+1
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $41
.endif
	jsr InitAtariIRQ
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $42
.endif

.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $43
.endif
	jsr i_FillRam
	.word $0500
	.word dirEntryBuf
	.byte 0
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $44
.endif
	jsr InstallAtariSioBridge

	; Keep existing date initialization flow for now.
	ldy #2
@copyDate:
	lda dateCopy,y
	sta year,y
	dey
	bpl @copyDate

.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $45
.endif
	jsr FirstInit
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $46
.endif
	jsr MouseInit
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $47
.endif
	lda #currentInterleave
	sta interleave

	lda #1
	sta NUMDRV
	ldy #8
	sty curDevice
	sty curDrive
	lda #DRV_TYPE
	sta curType
	sta _driveType,y

.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_STATUS, $50
.endif
OrigResetHandle:
	sei
	cld
	ldx #$ff
	jsr _DoFirstInitIO
	jsr InitGEOEnv
.ifdef atarixl_desktop_smoketest
	lda #0
	sta intTopVector
	sta intTopVector+1
	sta intBotVector
	sta intBotVector+1
.endif
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
	sta $0232 ; SSKCTL shadow used by the OS SIO path
	sta SIO_BRIDGE_SAVED_SSKCTL
	rts

InstallDisableRomStub:
	ldy #0
@copy:
	lda DisableRomStubTemplate,y
	sta $0300,y
	iny
	cpy #(DisableRomStubTemplateEnd-DisableRomStubTemplate)
	bne @copy
	rts

DisableRomStubTemplate:
	lda PORTB
	ora #$82
	and #$fe
	sta PORTB
	rts
DisableRomStubTemplateEnd:

.ifdef atarixl_desktop_smoketest
; Install staged bootstrap payloads after OS ROM has been disabled.
; Stage layout at $2000:
;   +$0000 .. +$0FFF : $C000-$CFFF
;   +$1000 .. +$2FFF : $A000-$BFFF
;   +$3000 .. +$57FF : $D800-$FFFF (includes vectors)
Phase5InstallBootstrapPayloads:
	LoadW r0, PHASE5_STAGE_BASE
	LoadW r1, $c000
	ldx #$10
@copyCPage:
	ldy #0
@copyCByte:
	lda (r0),y
	sta (r1),y
	iny
	bne @copyCByte
	inc r0H
	inc r1H
	dex
	bne @copyCPage

	LoadW r0, (PHASE5_STAGE_BASE + $1000)
	LoadW r1, $a000
	ldx #$20
@copyAPage:
	ldy #0
@copyAByte:
	lda (r0),y
	sta (r1),y
	iny
	bne @copyAByte
	inc r0H
	inc r1H
	dex
	bne @copyAPage

	LoadW r0, (PHASE5_STAGE_BASE + $3000)
	LoadW r1, $d800
	ldx #$28
@copyDPage:
	ldy #0
@copyDByte:
	lda (r0),y
	sta (r1),y
	iny
	bne @copyDByte
	inc r0H
	inc r1H
	dex
	bne @copyDPage

	LoadW r0, PHASE5_INPUT_SRC
	LoadW r1, PHASE5_INPUT_DST
	LoadW r2, PHASE5_INPUT_SIZE
@copyInput:
	ldy #0
	lda (r0),y
	sta (r1),y
	inc r0L
	bne @skipSrcHi
	inc r0H
@skipSrcHi:
	inc r1L
	bne @skipDstHi
	inc r1H
@skipDstHi:
	SubVW 1, r2
	lda r2L
	ora r2H
	bne @copyInput
	rts
.endif

InstallAtariSioBridge:
	ldy #0
@copy:
	lda SioBridgeTemplate,y
	sta SIO_BRIDGE_BASE,y
	iny
	cpy #(SioBridgeTemplateEnd-SioBridgeTemplate)
	bne @copy
	ldy #3
@snapshotVbiVectors:
	lda VVBLKI,y
	sta SIO_BRIDGE_OS_VBI_VECTORS,y
	dey
	bpl @snapshotVbiVectors
	lda VIMIRQ
	sta SIO_BRIDGE_OS_VIMIRQ
	lda VIMIRQ+1
	sta SIO_BRIDGE_OS_VIMIRQ+1
	ldy #5
@snapshotTopVectors:
	lda $fffa,y
	sta SIO_BRIDGE_OS_TOP_VECTORS,y
	dey
	bpl @snapshotTopVectors
	lda $0232 ; SSKCTL
	sta SIO_BRIDGE_SAVED_SSKCTL
	rts

; Runs from low RAM so the driver can bank OS ROM in for SIOV without
; executing out from underneath the high kernal mapping.
SioBridgeTemplate:
	php
	sei
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $68
.endif
	lda NMIEN
	sta SIO_BRIDGE_SAVED_NMIEN
	lda PBCTL
	sta SIO_BRIDGE_SAVED_PBCTL
	lda #$3c
	sta PBCTL
	lda PORTB
	sta SIO_BRIDGE_SAVED_PORTB
	lda #$00
	sta NMIEN
	; Swap top vectors while RAM is visible at $FFFA-$FFFF. Doing this before
	; bank-in keeps jsA8E and real hardware aligned when SIOV runs with OS ROM.
	ldy #5
@swapTopVectors:
	lda $fffa,y
	sta SIO_BRIDGE_SAVED_TOP_VECTORS,y
	lda SIO_BRIDGE_OS_TOP_VECTORS,y
	sta $fffa,y
	dey
	bpl @swapTopVectors
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $69
.endif
	lda SIO_BRIDGE_SAVED_PORTB  ; reload — previous lda #$00 clobbered A
	ora #$83                    ; force OS ROM active, BASIC off, self-test off
	sta PORTB
	ldy #37
@prepareVectors:
	lda $0200,y
	sta SIO_BRIDGE_SAVED_VECTORS,y
	sta SIO_BRIDGE_OS_VECTORS,y
	dey
	bpl @prepareVectors
	ldy #3
@patchVbiVectors:
	lda SIO_BRIDGE_OS_VBI_VECTORS,y
	sta SIO_BRIDGE_OS_VECTORS+(VVBLKI-$0200),y
	dey
	bpl @patchVbiVectors
	lda SIO_BRIDGE_OS_VIMIRQ
	sta SIO_BRIDGE_OS_VECTORS+(VIMIRQ-$0200)
	lda SIO_BRIDGE_OS_VIMIRQ+1
	sta SIO_BRIDGE_OS_VECTORS+(VIMIRQ-$0200)+1
	ldy #37
@swapVectors:
	lda SIO_BRIDGE_OS_VECTORS,y
	sta $0200,y
	dey
	bpl @swapVectors
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $6a
.endif
	; Force a clean serial state before each bridged SIOV call. This mirrors
	; the standalone diagnostics path and avoids carrying stale SERIO state
	; across earlier bootstrap transactions.
	lda #$00
	sta $0232 ; SSKCTL shadow
	sta SKCTL
	lda SIO_BRIDGE_SAVED_SSKCTL
	sta $0232 ; SSKCTL
	sta SKCTL
	lda #$40
	sta NMIEN
	cli
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $6b
.endif
	jsr SIOV
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $6c
.endif
	sei
	sta SIO_BRIDGE_SAVED_A
	sty SIO_BRIDGE_SAVED_Y
	lda #$00
	sta NMIEN
	ldy #37
@restoreVectors:
	lda SIO_BRIDGE_SAVED_VECTORS,y
	sta $0200,y
	dey
	bpl @restoreVectors
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $6d
.endif
	lda SIO_BRIDGE_SAVED_PORTB
	sta PORTB
	ldy #5
@restoreTopVectors:
	lda SIO_BRIDGE_SAVED_TOP_VECTORS,y
	sta $fffa,y
	dey
	bpl @restoreTopVectors
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $6e
.endif
	lda SIO_BRIDGE_SAVED_PBCTL
	sta PBCTL
	lda SIO_BRIDGE_SAVED_NMIEN
	sta NMIEN
	ldy SIO_BRIDGE_SAVED_Y
	lda SIO_BRIDGE_SAVED_A
	plp
	rts
SioBridgeTemplateEnd:

.ifdef atarixl_disk_smoketest
Phase4SmokeRun:
	lda #$3c
	sta PBCTL
	lda #$ff
	sta PORTB
	lda #$38
	sta PBCTL
	lda #$ff
	sta PORTB
	lda #$3c
	sta PBCTL

	lda PORTB
	ora #$80
	sta PORTB
	jsr InitAtariKeyboard

	; The smoketest XEX does not carry the BSS/VARS area, so clear it explicitly
	; before invoking GEOS file-system routines that depend on those buffers.
	jsr Phase4ClearVars

	lda #$00
	sta DMACTL
	sta NMIEN
	sta PHASE4_DDRB
	sta PHASE4_PORTB
	sta PHASE4_PBCTL
	sta PHASE4_C2A1
	sta PHASE4_STAGE
	sta PHASE4_STATUS
	sta PHASE4_ERROR
	sta PHASE4_RESULTS
	sta PHASE4_DONE
	sta PHASE4_DIRCOUNT
	sta PHASE4_DIRTYPE
	sta PHASE4_DIRNAME0
	sta PHASE4_DIRNAME1
	sta PHASE4_DIRNAME2
	sta PHASE4_DIRNAME3
	sta PHASE4_SIOY
	sta PHASE4_SIODST
	sta PHASE4_SIOSECL
	sta PHASE4_SIOSECH
	sta PHASE4_SIOCMD
	sta PHASE4_SIORETA

	LoadB NUMDRV, 1
	LoadB curDrive, 8
	LoadB curDevice, 8
	LoadB curType, DRV_TYPE
	LoadB driveType, DRV_TYPE
	LoadB interleave, currentInterleave
	LoadB sysRAMFlg, 0
	LoadB verifyFlag, 0
	LoadB diskOpenFlg, 0
	LoadB isGEOS, 0

	; Expose RAM at $A000-$BFFF and $C000-$FFFF before calling GEOS code that
	; lives under the Atari ROMs. The smoke harness runs from low RAM, so this
	; transition is safe here.
	lda PORTB
	ora #$82
	and #$fe
	sta PORTB
	jsr Phase4InstallHighKernal
	jsr Phase4InstallRamVectors

	jsr Phase4FillSmallSource
	jsr Phase4FillLargeSource
	LoadB PHASE4_STAGE, PHASE4_STAGE_PRE_OPEN
	lda #$38
	sta PBCTL
	lda #$ff
	sta PORTB
	lda PORTB
	sta PHASE4_DDRB
	lda #$3c
	sta PBCTL
	lda #$fe
	sta PORTB
	lda PORTB
	sta PHASE4_PORTB
	lda PBCTL
	sta PHASE4_PBCTL
	lda $c2a1
	sta PHASE4_C2A1
	cmp #$6c
	beq @openDiskVisible
	LoadB PHASE4_STATUS, $e1
	ldx #$e1
	jmp Phase4SmokeFail
@openDiskVisible:
	; Re-assert RAM interrupt vectors after the ROM visibility probe.
	; In jsA8E's Phase 4 path, the temporary PORTB flips can leave the
	; underlying $FFFA-$FFFF RAM bytes stale before the first disk call.
	jsr Phase4InstallRamVectors
	LoadB PHASE4_STATUS, $f0
	jsr OpenDisk
	bnex Phase4SmokeFail
	LoadB PHASE4_STAGE, PHASE4_STAGE_POST_OPEN

	LoadB PHASE4_STAGE, PHASE4_STAGE_PRE_SAVE
	jsr Phase4SaveSmallFile
	bnex Phase4SmokeFail
	LoadB PHASE4_STAGE, PHASE4_STAGE_POST_SAVE
	jsr Phase4MarkWritePass

	jsr Phase4CheckDirectory
	bnex Phase4SmokeFail
	jsr Phase4MarkDirPass

	jsr Phase4ReadBackSmallFile
	bnex Phase4SmokeFail
	jsr Phase4MarkReadPass

	jsr Phase4FillUntilFull
	bnex Phase4SmokeFail
	jsr Phase4MarkFullPass

Phase4SmokeDone:
	lda #$ff
	sta PHASE4_DONE
Phase4SmokeHalt:
	jmp Phase4SmokeHalt

Phase4SmokeFail:
	stx PHASE4_ERROR
	bra Phase4SmokeDone

Phase4MarkDirPass:
	lda PHASE4_RESULTS
	ora #PHASE4_PASS_DIR
	sta PHASE4_RESULTS
	rts

Phase4MarkReadPass:
	lda PHASE4_RESULTS
	ora #PHASE4_PASS_READ
	sta PHASE4_RESULTS
	rts

Phase4MarkWritePass:
	lda PHASE4_RESULTS
	ora #PHASE4_PASS_WRITE
	sta PHASE4_RESULTS
	rts

Phase4MarkFullPass:
	lda PHASE4_RESULTS
	ora #PHASE4_PASS_FULL
	sta PHASE4_RESULTS
	rts

; Install the staged $C000-$FFFF image from conventional RAM after ROM is disabled.
Phase4InstallHighKernal:
	; Atari keeps $D000-$D7FF mapped to I/O registers regardless of PORTB.
	; Copy around that hole so we do not scribble GTIA/POKEY/PIA/ANTIC state
	; and accidentally remap ROM while installing the staged kernal image.
	;
	; Source layout at $2000 mirrors $C000-$FFFF contiguously, so:
	;   $2000-$2FFF -> $C000-$CFFF
	;   $3800-$5FFF -> $D800-$FFFF
	LoadW r0, PHASE4_KERNAL_SRC0
	LoadW r1, $c000
	ldx #$10
@page:
	ldy #0
@byte:
	lda (r0),y
	sta (r1),y
	iny
	bne @byte
	inc r0H
	inc r1H
	dex
	bne @page

	LoadW r0, (PHASE4_KERNAL_SRC0 + $1800)
	LoadW r1, $d800
	ldx #$28
@pageHi:
	ldy #0
@byteHi:
	lda (r0),y
	sta (r1),y
	iny
	bne @byteHi
	inc r0H
	inc r1H
	dex
	bne @pageHi
	rts

Phase4InstallRamVectors:
	lda #<_NMIHandler
	sta $fffa
	lda #>_NMIHandler
	sta $fffb
	lda #<_ResetHandle
	sta $fffc
	lda #>_ResetHandle
	sta $fffd
	lda #<_IRQVectorHandler
	sta $fffe
	lda #>_IRQVectorHandler
	sta $ffff
	rts

Phase4FillSmallSource:
	LoadW r7, PHASE4_SMALL_SRC
	lda #0
	sta r0L
	LoadW r2, PHASE4_SMALL_LEN
@loop:
	ldy #0
	lda r0L
	sta (r7),y
	inc r0L
	inc r7L
	bne @skipHi
	inc r7H
@skipHi:
	SubVW 1, r2
	lda r2L
	ora r2H
	bne @loop
	rts

Phase4ClearVars:
	LoadW r7, PHASE4_VARS_BASE
	LoadW r2, PHASE4_VARS_SIZE
	lda #0
@loop:
	ldy #0
	sta (r7),y
	inc r7L
	bne @skipHi
	inc r7H
@skipHi:
	SubVW 1, r2
	lda r2L
	ora r2H
	bne @loop
	rts

Phase4FillLargeSource:
	LoadW r7, PHASE4_FILL_SRC
	LoadW r2, PHASE4_FILL_LEN
	lda #$5a
@loop:
	ldy #0
	sta (r7),y
	inc r7L
	bne @skipHi
	inc r7H
@skipHi:
	SubVW 1, r2
	lda r2L
	ora r2H
	bne @loop
	rts

Phase4ClearFileHeader:
	lda #0
	tay
@loop:
	sta fileHeader,y
	iny
	bne @loop
	rts

Phase4InitSeqHeader:
	jsr Phase4ClearFileHeader
	MoveW r0, fileHeader
	LoadB fileHeader+O_GHCMDR_TYPE, USR
	LoadB fileHeader+O_GHGEOS_TYPE, DATA
	LoadB fileHeader+O_GHSTR_TYPE, SEQUENTIAL
	MoveW r7, fileHeader+O_GHST_ADDR
	MoveW r2, fileHeader+O_GHEND_ADDR
	rts

Phase4SaveSmallFile:
	LoadW r0, Phase4SmallName
	LoadW r7, PHASE4_SMALL_SRC
	LoadW r2, (PHASE4_SMALL_SRC + PHASE4_SMALL_LEN)
	jsr Phase4InitSeqHeader
	LoadW r9, fileHeader
	LoadB r10L, 0
	LoadB PHASE4_STATUS, $79
	jmp SaveFile

Phase4CheckDirectory:
	jsr Get1stDirEntry
	bnex @fail
@scan:
	ldy #OFF_CFILE_TYPE
	lda (r5),y
	beq @next
	lda PHASE4_DIRCOUNT
	bne @haveEntryMeta
	sta PHASE4_DIRTYPE
	iny
	iny
	lda (r5),y
	sta PHASE4_DIRNAME0
	iny
	lda (r5),y
	sta PHASE4_DIRNAME1
	iny
	lda (r5),y
	sta PHASE4_DIRNAME2
	iny
	lda (r5),y
	sta PHASE4_DIRNAME3
	ldy #OFF_CFILE_TYPE
	lda (r5),y
	sta PHASE4_DIRTYPE
@haveEntryMeta:
	inc PHASE4_DIRCOUNT
@next:
	jsr GetNxtDirEntry
	bnex @fail
	tya
	beq @scan
	CmpBI PHASE4_DIRCOUNT, 0
	beq @notFound
	LoadW r6, Phase4SmallName
	jsr FindFile
	bnex @done
	ldx #0
@done:
	rts
@notFound:
	ldx #FILE_NOT_FOUND
	rts
@fail:
	rts

Phase4MatchDirName:
	MoveW r5, r1
	AddVW OFF_FNAME, r1
	ldy #0
@loop:
	lda (r0),y
	beq @pad
	cmp (r1),y
	bne @fail
	iny
	cpy #16
	bne @loop
	beq @ok
@pad:
	lda (r1),y
	cmp #$a0
	beq @padNext
	cmp #$00
	bne @fail
@padNext:
	iny
	cpy #16
	bne @pad
@ok:
	ldx #0
	rts
@fail:
	ldx #FILE_NOT_FOUND
	rts

Phase4ReadBackSmallFile:
	LoadW r6, Phase4SmallName
	LoadB PHASE4_STAGE, PHASE4_STAGE_PRE_FIND
	jsr FindFile
	bnex @done
	LoadB PHASE4_STAGE, PHASE4_STAGE_POST_FIND
	LoadW r9, dirEntryBuf
	jsr GetFHdrInfo
	bnex @done
	LoadW r7, PHASE4_SMALL_DST
	LoadW r2, $ffff
	LoadB PHASE4_STAGE, PHASE4_STAGE_PRE_READ
	jsr ReadFile
	bnex @done
	LoadB PHASE4_STAGE, PHASE4_STAGE_POST_READ
	LoadW r6, PHASE4_SMALL_SRC
	LoadW r7, PHASE4_SMALL_DST
	LoadW r2, PHASE4_SMALL_LEN
@cmpLoop:
	ldy #0
	lda (r6),y
	cmp (r7),y
	bne @mismatch
	inc r6L
	bne @skipSrcHi
	inc r6H
@skipSrcHi:
	inc r7L
	bne @skipDstHi
	inc r7H
@skipDstHi:
	SubVW 1, r2
	lda r2L
	ora r2H
	bne @cmpLoop
	ldx #0
@done:
	rts
@mismatch:
	ldx #BYTE_DEC_ERR
	rts

Phase4FillUntilFull:
	lda #'0'
	sta Phase4FillName+6
	LoadB PHASE4_STATUS, 0
@loop:
	LoadW r0, Phase4FillName
	LoadW r7, PHASE4_FILL_SRC
	LoadW r2, (PHASE4_FILL_SRC + PHASE4_FILL_LEN)
	jsr Phase4InitSeqHeader
	LoadW r9, fileHeader
	LoadB r10L, 0
	jsr SaveFile
	beq @saved
	cpx #INSUFF_SPACE
	beq @full
	rts
@saved:
	inc PHASE4_STATUS
	inc Phase4FillName+6
	bra @loop
@full:
	ldx #0
	rts

Phase4SmokeShowResults:
	jsr Phase4SmokeInitDisplayOnly
	jsr Phase4SmokeDrawFrame
	jsr Phase4SmokeDrawResultBits
	jsr Phase4SmokeDrawStageCount
	jsr Phase4SmokeDrawErrorBits
	rts

Phase4SmokeInitDisplayOnly:
	lda #$00
	sta DMACTL

	lda #<phase2_smoke_dlist
	sta DLISTL
	lda #>phase2_smoke_dlist
	sta DLISTH

	lda #<BITMAP_BASE
	sta r0L
	lda #>BITMAP_BASE
	sta r0H
	lda #$00
	ldx #$10
	jsr FillPages

	lda #(BITMAP_BASE + $1000) & $ff
	sta r0L
	lda #>(BITMAP_BASE + $1000)
	sta r0H
	lda #$00
	ldx #$10
	jsr FillPages

	lda #<BACK_SCR_BASE
	sta r0L
	lda #>BACK_SCR_BASE
	sta r0H
	lda #$00
	ldx #$20
	jsr FillPages

	lda #(ST_WR_FORE | ST_WR_BACK)
	sta dispBufferOn

	lda #$00
	sta COLBK
	sta COLPF0
	sta COLPF1
	sta COLPF3
	lda #$0f
	sta COLPF2

	lda #$22
	sta DMACTL
	rts

Phase4SmokeDrawFrame:
	lda #0
	jsr _SetPattern
	LoadB r2L, 0
	LoadB r2H, 199
	LoadW r3, 0
	LoadW r4, 319
	jsr _Rectangle

	lda #1
	jsr _SetPattern
	LoadB r2L, 16
	LoadB r2H, 64
	LoadW r3, 20
	LoadW r4, 72
	jsr _Rectangle
	LoadB r2L, 16
	LoadB r2H, 64
	LoadW r3, 92
	LoadW r4, 144
	jsr _Rectangle
	LoadB r2L, 16
	LoadB r2H, 64
	LoadW r3, 164
	LoadW r4, 216
	jsr _Rectangle
	LoadB r2L, 16
	LoadB r2H, 64
	LoadW r3, 236
	LoadW r4, 288
	jsr _Rectangle

	ldx #0
@stageFrameLoop:
	lda #1
	jsr _SetPattern
	txa
	asl
	asl
	asl
	asl
	asl
	clc
	adc #20
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #20
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 88
	LoadB r2H, 112
	jsr _Rectangle
	inx
	cpx #8
	bne @stageFrameLoop

	ldx #0
@errorFrameLoop:
	lda #1
	jsr _SetPattern
	txa
	asl
	asl
	asl
	asl
	asl
	clc
	adc #20
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #20
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 136
	LoadB r2H, 160
	jsr _Rectangle
	inx
	cpx #8
	bne @errorFrameLoop
	rts

Phase4SmokeDrawResultBits:
	lda PHASE4_RESULTS
	sta r0L
	ldx #0
@bitLoop:
	lda r0L
	and #1
	beq @clear
	lda #9
	bne @draw
@clear:
	lda #0
@draw:
	jsr _SetPattern
	txa
	asl
	asl
	asl
	asl
	asl
	clc
	adc #28
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #36
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 24
	LoadB r2H, 56
	jsr _Rectangle
	lsr r0L
	inx
	cpx #4
	bne @bitLoop
	rts

Phase4SmokeDrawStageCount:
	ldx #0
@stageLoop:
	cpx PHASE4_STAGE
	bcs @clear
	lda #9
	bne @draw
@clear:
	lda #0
@draw:
	jsr _SetPattern
	txa
	asl
	asl
	asl
	asl
	asl
	clc
	adc #20
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #20
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 92
	LoadB r2H, 108
	jsr _Rectangle
	inx
	cpx #8
	bne @stageLoop
	rts

Phase4SmokeDrawErrorBits:
	lda PHASE4_ERROR
	sta r0L
	ldx #0
@bitLoop:
	lda r0L
	and #1
	beq @clear
	lda #10
	bne @draw
@clear:
	lda #0
@draw:
	jsr _SetPattern
	txa
	asl
	asl
	asl
	asl
	asl
	clc
	adc #20
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #20
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 140
	LoadB r2H, 156
	jsr _Rectangle
	lsr r0L
	inx
	cpx #8
	bne @bitLoop
	rts

Phase4SmallName:
	.byte "PH4TEST", 0

Phase4FillName:
	.byte "PH4FIL0", 0

.endif

.ifdef atarixl_input_smoketest
Phase3SmokeInit:
	lda PORTB
	ora #$80
	sta PORTB

	jsr Phase2SmokeInitDisplay
	jsr InitAtariKeyboard
	LoadB pressFlag, 0
	LoadB faultData, 0
	LoadB mouseOn, SET_MSE_ON
	LoadB KbdQueHead, 0
	LoadB KbdQueTail, 0
	LoadB KbdNextKey, 0
	LoadB KbdQueFlag, $ff
	jsr MouseInit

	LoadW mouseXPos, 160
	LoadB mouseYPos, 100

	LoadW intTopVector, Phase3SmokeVBI
	LoadW intBotVector, 0
	LoadW inputVector, Phase3SmokeInputVector
	LoadW keyVector, Phase3SmokeKeyVector
	LoadW mouseVector, 0
	LoadW mouseFaultVec, 0
	LoadW otherPressVec, 0

	LoadW phase3PrevX, $ffff
	LoadB phase3PrevY, $ff
	LoadB phase3LastKey, 0
	LoadB phase3JoystickSeen, 0
	LoadB phase3KeySeen, 0
	LoadB phase3UiDirty, $ff

	jsr Phase3SmokeDrawFrame
	rts

Phase3SmokePollInput:
	jsr UpdateMouse
	jsr Phase3ClampMouse
	jsr _DoKeyboardScan
	jmp _DoCheckButtons

Phase3SmokeVBI:
	jsr UpdateMouse
	jsr Phase3ClampMouse
	rts

Phase3ClampMouse:
	lda mouseXPos+1
	beq @checkXLow
	cmp #1
	bne @clampXByDir
	lda mouseXPos
	cmp #64
	bcc @checkY
@clampXByDir:
	lda inputData
	cmp #3
	beq @clampXLow
	cmp #4
	beq @clampXLow
	cmp #5
	beq @clampXLow
	LoadW mouseXPos, 319
	bra @checkY
@clampXLow:
	LoadW mouseXPos, 0
	bra @checkY
@checkXLow:
	bpl @checkY
	LoadW mouseXPos, 0
@checkY:
	lda mouseYPos
	cmp #200
	bcc @done
	lda inputData
	cmp #1
	beq @clampYLow
	cmp #2
	beq @clampYLow
	cmp #3
	beq @clampYLow
	LoadB mouseYPos, 199
	rts
@clampYLow:
	LoadB mouseYPos, 0
@done:
	rts

Phase3SmokeInputVector:
	LoadB phase3JoystickSeen, $ff
	LoadB phase3UiDirty, $ff
	rts

Phase3SmokeKeyVector:
	MoveB keyData, phase3LastKey
	LoadB phase3KeySeen, $ff
	LoadB phase3UiDirty, $ff
	rts

Phase3SmokeAppMain:
	lda mouseXPos
	cmp phase3PrevX
	bne @redrawCursor
	lda mouseXPos+1
	cmp phase3PrevX+1
	bne @redrawCursor
	lda mouseYPos
	cmp phase3PrevY
	bne @redrawCursor
	lda phase3UiDirty
	beq @done
	bne @drawStatus

@redrawCursor:
	lda phase3PrevY
	cmp #$ff
	beq @drawCursor
	lda #0
	jsr _SetPattern
	jsr Phase3DrawCursorRect
@drawCursor:
	MoveW mouseXPos, phase3PrevX
	MoveB mouseYPos, phase3PrevY
	LoadB phase3JoystickSeen, $ff
	LoadB phase3UiDirty, $ff
	lda #9
	jsr _SetPattern
	jsr Phase3DrawCursorRect

@drawStatus:
	jsr Phase3SmokeDrawStatus
	LoadB phase3UiDirty, 0
@done:
	rts

Phase3DrawCursorRect:
	lda phase3PrevY
	sec
	sbc #2
	sta r2L
	clc
	adc #4
	sta r2H
	lda phase3PrevX
	sec
	sbc #2
	sta r3L
	lda phase3PrevX+1
	sbc #0
	sta r3H
	lda phase3PrevX
	clc
	adc #2
	sta r4L
	lda phase3PrevX+1
	adc #0
	sta r4H
	jmp _Rectangle

Phase3SmokeDrawFrame:
	lda #0
	jsr _SetPattern
	LoadB r2L, 0
	LoadB r2H, 199
	LoadW r3, 0
	LoadW r4, 319
	jsr _Rectangle

	lda #2
	jsr _SetPattern
	LoadB r2L, 8
	LoadB r2H, 28
	LoadW r3, 12
	LoadW r4, 44
	jsr _Rectangle
	LoadB r2L, 8
	LoadB r2H, 28
	LoadW r3, 56
	LoadW r4, 88
	jsr _Rectangle

	ldx #0
@frameBits:
	txa
	asl
	asl
	asl
	clc
	adc #120
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #7
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 8
	LoadB r2H, 28
	jsr _Rectangle
	inx
	cpx #8
	bne @frameBits
	rts

Phase3SmokeDrawStatus:
	lda phase3JoystickSeen
	beq @clearJoy
	lda #9
	bne @drawJoy
@clearJoy:
	lda #0
@drawJoy:
	jsr _SetPattern
	LoadB r2L, 10
	LoadB r2H, 26
	LoadW r3, 16
	LoadW r4, 40
	jsr _Rectangle

	lda phase3KeySeen
	beq @clearKeyLamp
	lda #10
	bne @drawKeyLamp
@clearKeyLamp:
	lda #0
@drawKeyLamp:
	jsr _SetPattern
	LoadB r2L, 10
	LoadB r2H, 26
	LoadW r3, 60
	LoadW r4, 84
	jsr _Rectangle

	ldx #0
	lda phase3LastKey
	sta r0L
@keyBits:
	lda r0L
	and #$80
	beq @clearBit
	lda #10
	bne @drawBit
@clearBit:
	lda #0
@drawBit:
	jsr _SetPattern
	txa
	asl
	asl
	asl
	clc
	adc #120
	sta r3L
	lda #0
	sta r3H
	lda r3L
	clc
	adc #7
	sta r4L
	lda #0
	adc #0
	sta r4H
	LoadB r2L, 10
	LoadB r2H, 26
	jsr _Rectangle
	asl r0L
	inx
	cpx #8
	bne @keyBits
	rts
.endif

.if .defined(atarixl_smoketest) || .defined(atarixl_input_smoketest) || .defined(atarixl_disk_smoketest)
Phase2SmokeInitDisplay:
	lda PORTB
	ora #$80
	sta PORTB

	lda #$00
	sta DMACTL

	lda #<phase2_smoke_dlist
	sta DLISTL
	lda #>phase2_smoke_dlist
	sta DLISTH

	lda #<BITMAP_BASE
	sta r0L
	lda #>BITMAP_BASE
	sta r0H
	lda #$00
	ldx #$10
	jsr FillPages

	lda #<(BITMAP_BASE + $1000)
	sta r0L
	lda #>(BITMAP_BASE + $1000)
	sta r0H
	lda #$00
	ldx #$10
	jsr FillPages

	lda #<BACK_SCR_BASE
	sta r0L
	lda #>BACK_SCR_BASE
	sta r0H
	lda #$00
	ldx #$20
	jsr FillPages

	lda #(ST_WR_FORE | ST_WR_BACK)
	sta dispBufferOn
	jsr Phase2SmokeDraw

	lda #$00
	sta COLBK
	sta COLPF0
	sta COLPF1
	sta COLPF3
	lda #$0f
	sta COLPF2

	lda #$22
	sta DMACTL
	rts

Phase2SmokeDraw:
	lda #1
	jsr _SetPattern

	LoadB r2L, 20
	LoadB r2H, 60
	LoadW r3, 24
	LoadW r4, 120
	jsr _Rectangle

	lda #2
	jsr _SetPattern
	LoadB r2L, 96
	LoadB r2H, 110
	LoadW r3, 64
	LoadW r4, 255
	jsr _Rectangle

	lda #$ff
	LoadB r11L, 101
	LoadW r3, 0
	LoadW r4, 319
	jsr _HorizontalLine

	lda #$ff
	LoadB r11L, 102
	LoadW r3, 0
	LoadW r4, 319
	jsr _HorizontalLine

	lda #$aa
	LoadB r11L, 150
	LoadW r3, 16
	LoadW r4, 303
	jsr _HorizontalLine
	rts

FillPages:
@pageLoop:
	ldy #$00
@byteLoop:
	sta (r0),y
	iny
	bne @byteLoop
	inc r0H
	dex
	bne @pageLoop
	rts

phase2_smoke_dlist:
	.byte $70, $70, $70
	.byte $4f
	.word BITMAP_BASE
	.repeat 101
		.byte $0f
	.endrepeat
	.byte $4f
	.word BITMAP_BASE + $1000
	.repeat 97
		.byte $0f
	.endrepeat
	.byte $41
	.word phase2_smoke_dlist
.endif

.ifdef atarixl_input_smoketest
.segment "vars"

phase3PrevX:
	.res 2, 0
phase3PrevY:
	.res 1, 0
phase3LastKey:
	.res 1, 0
phase3JoystickSeen:
	.res 1, 0
phase3KeySeen:
	.res 1, 0
phase3UiDirty:
	.res 1, 0
.endif
