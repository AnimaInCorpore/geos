; GEOS by Berkeley Softworks
; reverse engineered by Maciej Witkowiak, Michael Steil
;
; Atari 810/1050 SIO disk driver (OS-assisted phase)

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "jumptab.inc"
.include "atari.inc"

.ifdef atarixl_disk_smoketest
PHASE4_DBG_SP      = $04f0
PHASE4_DBG_STK0    = $04f1
PHASE4_DBG_VEC_LO  = $04f2
PHASE4_DBG_VEC_HI  = $04f3
PHASE4_DBG_STK1    = $04f4
PHASE4_DBG_STK2    = $04f5
PHASE4_SIOY        = $04f6
PHASE4_SIODST      = $04f7
PHASE4_SIOSECL     = $04f8
PHASE4_SIOSECH     = $04f9
PHASE4_SIOCMD      = $04fa
PHASE4_SIORETA     = $04fb
PHASE4_STATUS      = $04ec
.endif

.ifdef atarixl_desktop_smoketest
PHASE5_SIOY        = $04d2
PHASE5_SIODST      = $04d3
PHASE5_SIOSECL     = $04d4
PHASE5_SIOSECH     = $04d5
PHASE5_SIOCMD      = $04d6
PHASE5_SIORETA     = $04d7
PHASE5_DCB_DDEVIC  = $04d8
PHASE5_DCB_DUNIT   = $04d9
PHASE5_CURDRIVE    = $04da
PHASE5_CURDEVICE   = $04db
PHASE5_CURTYPE     = $04dc
PHASE5_OD_STAGE    = $04dd
.endif

.segment "drv1050"

DriveAddy = $0300

_InitForIO:
	.word __InitForIO
_DoneWithIO:
	.word __DoneWithIO
_ExitTurbo:
	.word __ExitTurbo
_PurgeTurbo:
	.word __PurgeTurbo
_EnterTurbo:
	.word __EnterTurbo
_ChangeDiskDevice:
	.word __ChangeDiskDevice
_NewDisk:
	.word __NewDisk
_ReadBlock:
	.word __ReadBlock
_WriteBlock:
	.word __WriteBlock
_VerWriteBlock:
	.word __VerWriteBlock
_OpenDisk:
	.word __OpenDisk
_GetBlock:
	.word __GetBlock
_PutBlock:
	.word __PutBlock
_GetDirHead:
	.word __GetDirHead
_PutDirHead:
	.word __PutDirHead
_GetFreeDirBlk:
	.word __GetFreeDirBlk
_CalcBlksFree:
	.word __CalcBlksFree
_FreeBlock:
	.word __FreeBlock
_SetNextFree:
	.word __SetNextFree
_FindBAMBit:
	.word __FindBAMBit
_NxtBlkAlloc:
	.word __NxtBlkAlloc
_BlkAlloc:
	.word __BlkAlloc
_ChkDkGEOS:
	.word __ChkDkGEOS
_SetGEOSDisk:
	.word __SetGEOSDisk

Get1stDirEntry:
	jmp _Get1stDirEntry
GetNxtDirEntry:
	jmp _GetNxtDirEntry
GetBorder:
	jmp _GetBorder
AddDirBlock:
	jmp _AddDirBlock
ReadBuff:
	jmp _ReadBuff
WriteBuff:
	jmp _WriteBuff
	jmp DUNK4_2
	jmp GetDOSError
AllocateBlock:
	jmp _AllocateBlock
ReadLink:
	jmp _ReadLink

__GetDirHead:
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $60
.endif
	jsr SetDirHead
	bne __GetBlock
_ReadBuff:
	LoadW r4, diskBlkBuf
__GetBlock:
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $61
	tsx
	stx PHASE4_DBG_SP
	lda $0101,x
	sta PHASE4_DBG_STK0
	lda _EnterTurbo
	sta PHASE4_DBG_VEC_LO
	lda _EnterTurbo+1
	sta PHASE4_DBG_VEC_HI
	lda $0102,x
	sta PHASE4_DBG_STK1
	lda $0103,x
	sta PHASE4_DBG_STK2
	lda EnterTurbo
	cmp #$4c
	beq @enterTurboVisible
	cmp #$6c
	beq @enterTurboVisible
	LoadB PHASE4_STATUS, $e3
	ldx #$e3
	rts
@enterTurboVisible:
.endif
	jsr EnterTurbo
	bnex GetBlk0
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $62
.endif
	jsr InitForIO
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $63
.endif
	jsr ReadBlock
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $64
.endif
	jsr DoneWithIO
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $65
.endif
GetBlk0:
	rts

__PutDirHead:
	jsr SetDirHead
	bne __PutBlock
_WriteBuff:
	LoadW r4, diskBlkBuf
__PutBlock:
	jsr EnterTurbo
	bnex PutBlk1
	jsr InitForIO
	jsr WriteBlock
	bnex PutBlk0
	jsr VerWriteBlock
PutBlk0:
	jsr DoneWithIO
PutBlk1:
	rts

SetDirHead:
	LoadB r1L, DIR_TRACK
	LoadB r1H, 0
	sta r4L
	LoadB r4H, (>curDirHead)
	rts

CheckParams:
	bbrf 6, curType, CheckParams_1
	jsr DoCacheVerify
	beq CheckParams_2
CheckParams_1:
	lda #0
	sta errCount
	ldx #INV_TRACK
	lda r1L
	beq CheckParams_2
	cmp #N_TRACKS+1
	bcs CheckParams_2
	sec
	rts
CheckParams_2:
	clc
	rts

__OpenDisk:
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_OD_STAGE, $a0
.endif
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $10
.endif
	ldy curDrive
	lda _driveType,y
	sta tmpDriveType
	and #%10111111
	sta _driveType,y
	jsr NewDisk
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_OD_STAGE, $a1
.endif
	bnex OpenDsk1
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $11
	LoadB PHASE4_STATUS, $20
.endif
	.ifdef atarixl_disk_smoketest
	lda GetDirHead
	cmp #$6c
	beq @getDirHeadVisible
	LoadB PHASE4_STATUS, $e2
	ldx #$e2
	bra OpenDsk1
@getDirHeadVisible:
	.endif
	jsr GetDirHead
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_OD_STAGE, $a2
.endif
	bnex OpenDsk1
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $21
.endif
	bbrf 6, tmpDriveType, OpenDsk0
	jsr DoCacheVerify
	beq OpenDsk0
	jsr DoClearCache
	jsr SetDirHead
	jsr DoCacheWrite
OpenDsk0:
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $30
.endif
	LoadW r5, curDirHead
	jsr ChkDkGEOS
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_OD_STAGE, $a3
.endif
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $31
	LoadB PHASE4_STATUS, $40
.endif
	LoadW r4, curDirHead+OFF_DISK_NAME
	ldx #r5
	jsr GetPtrCurDkNm
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $41
	LoadB PHASE4_STATUS, $50
.endif
	ldx #r4
	ldy #r5
	lda #18
	jsr CopyFString
.ifdef atarixl_desktop_smoketest
	LoadB PHASE5_OD_STAGE, $a4
.endif
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $51
.endif
	ldx #0
OpenDsk1:
.ifdef atarixl_desktop_smoketest
	stx PHASE5_OD_STAGE
.endif
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $ff
.endif
	lda tmpDriveType
	ldy curDrive
	sta _driveType,y
	rts
tmpDriveType:
	.byte 0

__BlkAlloc:
	ldy #1
	sty r3L
	dey
	sty r3H
__NxtBlkAlloc:
	PushW r9
	PushW r3
	LoadW r3, $00fe
	ldx #r2
	ldy #r3
	jsr Ddiv
	lda r8L
	beq BlkAlc0
	inc r2L
	bne BlkAlc0
	inc r2H
BlkAlc0:
	LoadW r5, curDirHead
	jsr CalcBlksFree
	PopW r3
	ldx #INSUFF_SPACE
	CmpW r2, r4
	beq BlkAlc1
	bcs BlkAlc4
BlkAlc1:
	MoveW r6, r4
	MoveW r2, r5
BlkAlc2:
	jsr SetNextFree
	bnex BlkAlc4
	ldy #0
	lda r3L
	sta (r4),y
	iny
	lda r3H
	sta (r4),y
	AddVW 2, r4
	lda r5L
	bne @X
	dec r5H
@X:	dec r5L
	lda r5L
	ora r5H
	bne BlkAlc2
	ldy #0
	tya
	sta (r4),y
	iny
	lda r8L
	bne BlkAlc3
	lda #$fe
BlkAlc3:
	clc
	adc #1
	sta (r4),y
	ldx #0
BlkAlc4:
	PopW r9
	rts

_Get1stDirEntry:
	LoadB r1L, DIR_TRACK
	LoadB r1H, 1
	jsr ReadBuff
	LoadW r5, diskBlkBuf+FRST_FILE_ENTRY
	lda #0
	sta borderFlag
	rts

_GetNxtDirEntry:
	ldx #0
	ldy #0
	AddVW $20, r5
	CmpWI r5, diskBlkBuf+$ff
	bcc GNDirEntry1
	ldy #$ff
	MoveW diskBlkBuf, r1
	bne GNDirEntry0
	lda borderFlag
	bne GNDirEntry1
	lda #$ff
	sta borderFlag
	jsr GetBorder
	bnex GNDirEntry1
	tya
	bne GNDirEntry1
GNDirEntry0:
	jsr ReadBuff
	ldy #0
	LoadW r5, diskBlkBuf+FRST_FILE_ENTRY
GNDirEntry1:
	rts

_GetBorder:
	jsr GetDirHead
	bnex GetBord2
	LoadW r5, curDirHead
	jsr ChkDkGEOS
	bne GetBord0
	ldy #$ff
	bne GetBord1
GetBord0:
	MoveW curDirHead+OFF_OP_TR_SC, r1
	ldy #0
GetBord1:
	ldx #0
GetBord2:
	rts

__ChkDkGEOS:
	ldy #OFF_GS_ID
	ldx #0
	LoadB isGEOS, 0
ChkDkG0:
	lda (r5),y
	cmp GEOSDiskID,x
	bne ChkDkG1
	iny
	inx
	cpx #11
	bne ChkDkG0
	LoadB isGEOS, $ff
ChkDkG1:
	lda isGEOS
	rts

GEOSDiskID:
	.byte "GEOS format V1.0",NULL

__GetFreeDirBlk:
	php
	sei
	PushB r6L
	PushW r2
	ldx r10L
	inx
	stx r6L
	LoadB r1L, DIR_TRACK
	LoadB r1H, 1
GFDirBlk0:
	jsr ReadBuff
GFDirBlk1:
	bnex GFDirBlk5
	dec r6L
	beq GFDirBlk3
GFDirBlk11:
	lda diskBlkBuf
	bne GFDirBlk2
	jsr AddDirBlock
	bra GFDirBlk1
GFDirBlk2:
	sta r1L
	MoveB diskBlkBuf+1, r1H
	bra GFDirBlk0
GFDirBlk3:
	ldy #FRST_FILE_ENTRY
	ldx #0
GFDirBlk4:
	lda diskBlkBuf,y
	beq GFDirBlk5
	tya
	addv $20
	tay
	bcc GFDirBlk4
	LoadB r6L, 1
	ldx #FULL_DIRECTORY
	ldy r10L
	iny
	sty r10L
	cpy #$12
	bcc GFDirBlk11
GFDirBlk5:
	PopW r2
	PopB r6L
	plp
	rts

_AddDirBlock:
	PushW r6
	ldy #$48
	ldx #FULL_DIRECTORY
	lda curDirHead,y
	beq ADirBlk0
	MoveW r1, r3
	jsr SetNextFree
	MoveW r3, diskBlkBuf
	jsr WriteBuff
	bnex ADirBlk0
	MoveW r3, r1
	jsr ClearAndWrite
ADirBlk0:
	PopW r6
	rts

ClearAndWrite:
	lda #0
	tay
CAndWr0:
	sta diskBlkBuf,y
	iny
	bne CAndWr0
	dey
	sty diskBlkBuf+1
	jmp WriteBuff

__SetNextFree:
	lda r3H
	add interleave
	sta r6H
	MoveB r3L, r6L
	jsr NormalizeAtariSector
	sta r6H
SNxtFreeTrack:
	CmpBI r6L, N_TRACKS+1
	bcs SNxtFree5
	CmpBI r6L, DIR_TRACK
	beq SNxtFreeNextTrack
	ldy #18
SNxtFreeScan:
	jsr _AllocateBlock
	beqx SNxtFree4
	inc r6H
	jsr NormalizeAtariSector
	sta r6H
	dey
	bne SNxtFreeScan
SNxtFreeNextTrack:
	inc r6L
	lda #0
	sta r6H
	bra SNxtFreeTrack
SNxtFree4:
	MoveW_ r6, r3
	ldx #0
	rts
SNxtFree5:
	ldx #INSUFF_SPACE
	rts

NormalizeAtariSector:
	cmp #18
	bcc @done
	sub #18
	bra NormalizeAtariSector
@done:
	rts

_AllocateBlock:
	jsr FindBAMBit
	beq SNFHlp2_3
	lda r8H
	eor #$ff
	and curDirHead,x
	sta curDirHead,x
	ldx r7H
	dec curDirHead,x
	ldx #0
	rts
SNFHlp2_3:
	ldx #BAD_BAM
	rts

__FindBAMBit:
	lda r6L
	asl
	asl
	sta r7H
	lda r6H
	and #%00000111
	tax
	lda FBBBitTab,x
	sta r8H
	lda r6H
	lsr
	lsr
	lsr
	sec
	adc r7H
	tax
	lda curDirHead,x
	and r8H
	rts

FBBBitTab:
	.byte $01, $02, $04, $08
	.byte $10, $20, $40, $80

__FreeBlock:
	jsr FindBAMBit
	bne FreeBlk0
	lda r8H
	eor curDirHead,x
	sta curDirHead,x
	ldx r7H
	inc curDirHead,x
	ldx #0
	rts
FreeBlk0:
	ldx #BAD_BAM
	rts

__CalcBlksFree:
	LoadW_ r4, 0
	ldy #OFF_TO_BAM
CBlksFre0:
	lda (r5),y
	add r4L
	sta r4L
	bcc CBlksFre1
	inc r4H
CBlksFre1:
	tya
	clc
	adc #4
	tay
	cpy #(OFF_TO_BAM + ((DIR_TRACK - 1) * 4))
	beq CBlksFre1
	cpy #(OFF_TO_BAM + (N_TRACKS * 4))
	bne CBlksFre0
	LoadW r3, TOTAL_BLOCKS
	rts

__SetGEOSDisk:
	jsr GetDirHead
	bnex SetGDisk2
	LoadW r5, curDirHead
	jsr CalcBlksFree
	ldx #INSUFF_SPACE
	lda r4L
	ora r4H
	beq SetGDisk2
	LoadB r3L, DIR_TRACK+1
	LoadB r3H, 0
	jsr SetNextFree
	beqx SetGDisk0
	LoadB r3L, 1
	jsr SetNextFree
	bnex SetGDisk2
SetGDisk0:
	MoveW r3, r1
	jsr ClearAndWrite
	bnex SetGDisk2
	MoveW r1, curDirHead+OFF_OP_TR_SC
	ldy #OFF_GS_ID+15
	ldx #15
SetGDisk1:
	lda GEOSDiskID,x
	sta curDirHead,y
	dey
	dex
	bpl SetGDisk1
	jsr PutDirHead
SetGDisk2:
	rts


; Atari XL SIO transport layer (OS-assisted mode)
;
; Device Control Block (DCB) in Atari OS page 3
DDEVIC  = $0300
DUNIT   = $0301
DCOMND  = $0302
DSTATS  = $0303
DBUFLO  = $0304
DBUFHI  = $0305
DTIMLO  = $0306
DBYTLO  = $0308
DBYTHI  = $0309
DAUX1   = $030A
DAUX2   = $030B

SIO_CMD_READ          = $52
SIO_CMD_WRITE         = $50
SIO_CMD_WRITE_VERIFY  = $57
SIO_STAT_READ         = $40
SIO_STAT_WRITE        = $80
SIO_TIMEOUT_SECONDS   = 7

__InitForIO:
	ldx #0
	rts

__DoneWithIO:
	rts

__EnterTurbo:
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $24
.endif
	ldx #0
.ifdef atarixl_disk_smoketest
	LoadB PHASE4_STATUS, $25
.endif
	rts

__ExitTurbo:
	ldx #0
	rts

__PurgeTurbo:
	jsr ClearCache
PurgeTurbo0:
	ldy curDrive
	lda #0
	sta _turboFlags,y
	ldx #0
	rts

__NewDisk:
	jsr ClearCache
	lda #0
	sta errCount
	sta lastSIOStatus
	ldx #0
	rts

__ChangeDiskDevice:
	sta curDrive
	sta curDevice
	jsr PurgeTurbo0
	lda #%11000000
	ldy curDrive
	sta _turboFlags,y
	ldx #0
	rts

__ReadBlock:
_ReadLink:
	jsr CheckParams_1
	bcc RdBlockDone
	bbrf 6, curType, RdBlockIO
	jsr DoCacheRead
	bne RdBlockDone
RdBlockIO:
	lda #SIO_CMD_READ
	sta sioCommand
	lda #SIO_STAT_READ
	sta sioDirection
	jsr ReadWrite256
	bnex RdBlockDone
	bbrf 6, curType, RdBlockDone
	jsr DoCacheWrite
RdBlockDone:
	ldy #0
	rts

__WriteBlock:
	jsr CheckParams
	bcc WrBlockDone
	lda #SIO_CMD_WRITE
	sta sioCommand
	lda #SIO_STAT_WRITE
	sta sioDirection
	jsr ReadWrite256
WrBlockDone:
	rts

__VerWriteBlock:
	jsr CheckParams
	bcc VWrBlockDone
	lda #SIO_CMD_WRITE_VERIFY
	sta sioCommand
	lda #SIO_STAT_WRITE
	sta sioDirection
	jsr ReadWrite256
	bnex VWrBlockDone
	bbrf 6, curType, VWrBlockDone
	jmp DoCacheWrite
VWrBlockDone:
	rts

; SendTSBytes jump-table entry (unused for Atari SIO path)
DUNK4_2:
	ldx #0
	rts

; CheckErrors jump-table entry
GetDOSError:
	lda lastSIOStatus
	tay
	beq GetDOSError_OK
	jmp MapSIOError
GetDOSError_OK:
	ldx #0
	rts

; Reads/writes one 256-byte GEOS logical block as two 128-byte Atari sectors.
; Input: r1 = GEOS block address in C64 track/sector form, r4 = transfer buffer.
; Uses: sioCommand/sioDirection to select read vs. write command.
ReadWrite256:
	PushW r2
	jsr TrackSectorToLogicalBlock
	bcc ReadWriteBadParams

	lda r0L
	asl
	sta sioSectorL
	lda r0H
	rol
	sta sioSectorH
	inc sioSectorL
	bne @sectorReady
	inc sioSectorH
@sectorReady:
	MoveW r4, sioBufferL
	jsr DoSioSectorIO
	bnex ReadWriteDone

	inc sioSectorL
	bne @sectorPlusOne
	inc sioSectorH
@sectorPlusOne:
	clc
	lda sioBufferL
	adc #$80
	sta sioBufferL
	bcc @bufferReady
	inc sioBufferH
@bufferReady:
	jsr DoSioSectorIO
ReadWriteDone:
	PopW r2
	rts

ReadWriteBadParams:
	PopW r2
	ldx #INV_TRACK
	rts

DoSioSectorIO:
	; Atari OS-assisted calls can clobber ZP $BA; keep GEOS device state in
	; sync with the active drive before each physical sector transaction.
	lda curDrive
	sta curDevice
	jsr SetupSioDCB
.ifdef atarixl_desktop_smoketest
	lda DDEVIC
	sta PHASE5_DCB_DDEVIC
	lda DUNIT
	sta PHASE5_DCB_DUNIT
	lda curDrive
	sta PHASE5_CURDRIVE
	lda curDevice
	sta PHASE5_CURDEVICE
	lda curType
	sta PHASE5_CURTYPE
.endif
	lda sioCommand
	sta DCOMND
.ifdef atarixl_disk_smoketest
	sta PHASE4_SIOCMD
.endif
.ifdef atarixl_desktop_smoketest
	sta PHASE5_SIOCMD
.endif
	lda sioDirection
	sta DSTATS
	lda sioBufferL
	sta DBUFLO
	lda sioBufferH
	sta DBUFHI
	lda sioSectorL
	sta DAUX1
.ifdef atarixl_disk_smoketest
	sta PHASE4_SIOSECL
.endif
.ifdef atarixl_desktop_smoketest
	sta PHASE5_SIOSECL
.endif
	lda sioSectorH
	sta DAUX2
.ifdef atarixl_disk_smoketest
	sta PHASE4_SIOSECH
	LoadB PHASE4_STATUS, $66
.endif
.ifdef atarixl_desktop_smoketest
	sta PHASE5_SIOSECH
.endif
	lda curDevice
	sta sioSavedCurDevice
	php
	sei
	jsr SIO_BRIDGE_BASE
	plp
	lda sioSavedCurDevice
	sta curDevice
.ifdef atarixl_disk_smoketest
	sta PHASE4_SIORETA
	tya
	sta PHASE4_SIOY
	lda DSTATS
	sta PHASE4_SIODST
	LoadB PHASE4_STATUS, $67
	tya
.endif
.ifdef atarixl_desktop_smoketest
	sta PHASE5_SIORETA
	tya
	sta PHASE5_SIOY
	lda DSTATS
	sta PHASE5_SIODST
	tya
.endif
	tya
	bmi SioError
	lda DSTATS
	bmi SioError
	lda #0
	sta lastSIOStatus
	ldx #0
	rts

SioError:
	lda DSTATS
	sta lastSIOStatus
	jmp MapSIOError

SetupSioDCB:
	lda #$31
	sta DDEVIC
	lda curDrive
	sec
	sbc #7
	bcs @unitReady
	lda #1
@unitReady:
	sta DUNIT
	lda #SIO_TIMEOUT_SECONDS
	sta DTIMLO
	lda #$80
	sta DBYTLO
	lda #0
	sta DBYTHI
	rts

MapSIOError:
	tay
	cmp #$8C
	beq @checksum
	cmp #$8B
	beq @framing
	cmp #$90
	beq @timeout
	cmp #$8A
	beq @timeout
	ldx #BYTE_DEC_ERR
	rts
@checksum:
	ldx #DAT_CHKSUM_ERR
	rts
@framing:
	ldx #NO_SYNC
	rts
@timeout:
	ldx #DEV_NOT_FOUND
	rts

; Convert C64-style GEOS T/S to a 0-based logical block index.
; Output: r0 = block number, C=1 if valid.
TrackSectorToLogicalBlock:
	lda r1L
	beq @invalid
	cmp #N_TRACKS+1
	bcs @invalid
	lda r1H
	cmp #18
	bcs @invalid
	lda r1L
	sec
	sbc #1
	sta r0L
	lda #0
	sta r0H
	asl r0L
	rol r0H
	lda r0L
	sta r2L
	lda r0H
	sta r2H
	asl r0L
	rol r0H
	asl r0L
	rol r0H
	asl r0L
	rol r0H
	clc
	lda r0L
	adc r2L
	sta r0L
	lda r0H
	adc r2H
	sta r0H
	lda r1H
	add r0L
	sta r0L
	lda r0H
	adc #0
	sta r0H
	sec
	rts
@invalid:
	clc
	rts

.segment "drv1050_drivecode"
	.byte 0
.segment "drv1050_b"

ClrCacheDat:
	.word 0

ClearCache:
	bbsf 6, curType, DoClearCache
	rts
DoClearCache:
	LoadW r0, ClrCacheDat
	ldy #0
	sty r1L
	sty r1H
	sty r2H
	iny
	iny
	sty r2L
	iny
	sty r3H
	ldy curDrive
	lda driveData,y
	sta r3L
DoClrCache1:
	jsr StashRAM
	inc r1H
	bne DoClrCache1
	inc r3L
	dec r3H
	bne DoClrCache1
	rts

DoCacheRead:
	ldy #%10010001
	jsr DoCacheDisk
	ldy #0
	lda (r4),y
	iny
	ora (r4),y
	rts

GiveNoError:
	ldx #0
	rts

DoCacheVerify:
	ldy #%10010011
	jsr DoCacheDisk
	and #$20
	rts

DoCacheWrite:
	ldy #%10010000
DoCacheDisk:
	PushW r0
	PushW r1
	PushW r2
	PushB r3L
	tya
	pha
	ldy r1L
	dey
	lda CacheTabL,y
	add r1H
	sta r1H
	lda CacheTabH,y
	ldy curDrive
	adc driveData,y
	sta r3L
	ldy #0
	sty r1L
	sty r2L
	iny
	sty r2H
	MoveW r4, r0
	pla
	tay
	jsr DoRAMOp
	tax
	PopB r3L
	PopW r2
	PopW r1
	PopW r0
	txa
	ldx #0
	rts

CacheTabL:
	.byte $00, $12, $24, $36, $48, $5a, $6c, $7e
	.byte $90, $a2, $b4, $c6, $d8, $ea, $fc, $0e
	.byte $20, $32, $44, $56
CacheTabH:
	.byte $00, $00, $00, $00, $00, $00, $00, $00
	.byte $00, $00, $00, $00, $00, $00, $00, $01
	.byte $01, $01, $01, $01

sioCommand:
	.byte 0
sioDirection:
	.byte 0
sioBufferL:
	.byte 0
sioBufferH:
	.byte 0
sioSectorL:
	.byte 0
sioSectorH:
	.byte 0
lastSIOStatus:
	.byte 0
sioSavedCurDevice:
	.byte 0

tmpclkreg:
	.byte 0
tmpPS:
	.byte 0
tmpgrirqen:
	.byte 0
tmpCPU_DATA:
	.byte 0
tmpmobenble:
	.byte 0
	.byte 0
DExeProc:
	.word 0
DTrkSec:
	.word 0
tmpDD00:
	.byte 0
tmpDD00_2:
	.byte 0
errCount:
	.byte 0
errStore:
	.byte 0
tryCount:
	.byte 0
borderFlag:
	.byte 0
