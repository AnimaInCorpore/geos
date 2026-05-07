; Atari XL optional phase 7 cartridge bootstrap.
;
; This ROM assumes the first file on D1: is a GEOS sequential file whose
; payload is the phase 5 desktop bootstrap XEX bytes.  The file is streamed
; block-by-block from the ATR, the XEX records are parsed in place, and the
; final run vector record jumps back into the existing phase 5 bootstrap.

SIOV    = $E459

DMACTL  = $D400
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

LOADSTAT = $05F0
LOADERR  = $05F1
STATE    = $05F2
STARTLO  = $05F3
STARTHI  = $05F4
ENDLO    = $05F5
ENDHI    = $05F6
FILELENLO = $05F7
FILELENHI = $05F8
DESTLO   = $0080
DESTHI   = $0081
REMLENLO = $05F9
REMLENHI = $05FA
CURBLKLO = $05FB
CURBLKHI = $05FC
PAYLEN   = $05FD
PHYSLO   = $05FE
PHYSHI   = $05FF

BLOCKBUF = $0700

.segment "cart"

CartInit:
	rts

CartRun:
	sei
	cld
	ldx #$ff
	txs
	lda #$10
	sta LOADSTAT
	lda #$00
	sta LOADERR
	sta DMACTL
	sta STATE
	lda #$01
	sta CURBLKLO
	lda #$00
	sta CURBLKHI
	jsr LoadBootstrapXex
	lda #$ff
	sta LOADSTAT
@hang:
	jmp @hang

LoadBootstrapXex:
	lda #$00
	sta CURBLKLO
	sta CURBLKHI
	jsr ReadCurrentBlock
	lda BLOCKBUF+71
	sta STARTLO
	lda BLOCKBUF+72
	sta STARTHI
	lda BLOCKBUF+73
	sta ENDLO
	lda BLOCKBUF+74
	sta ENDHI
	sec
	lda ENDLO
	sbc STARTLO
	sta FILELENLO
	lda ENDHI
	sbc STARTHI
	sta FILELENHI
	lda #$01
	sta CURBLKLO
	lda #$00
	sta CURBLKHI
@blockLoop:
	jsr ReadCurrentBlock
	lda #$fe
	sta PAYLEN
	lda FILELENHI
	bne @havePayload
	lda FILELENLO
	cmp PAYLEN
	bcs @havePayload
	sta PAYLEN
@havePayload:
	ldx PAYLEN
	beq @done
	ldy #2
@byteLoop:
	lda BLOCKBUF,y
	jsr FeedXexByte
	lda FILELENLO
	bne :+
	dec FILELENHI
	lda #$ff
	sta FILELENLO
	bne @checkDone
:
	dec FILELENLO
@checkDone:
	lda FILELENLO
	ora FILELENHI
	beq @done
	iny
	dex
	bne @byteLoop
	inc CURBLKLO
	bne @blockLoop
	inc CURBLKHI
	jmp @blockLoop
@done:
	lda #$30
	sta LOADSTAT
	jmp ($02e0)

ReadCurrentBlock:
	lda CURBLKLO
	asl
	sta PHYSLO
	lda CURBLKHI
	rol
	sta PHYSHI
	inc PHYSLO
	bne :+
	inc PHYSHI
:
	lda #<BLOCKBUF
	sta DBUFLO
	lda #>BLOCKBUF
	sta DBUFHI
	jsr ReadSector128
	inc PHYSLO
	bne :+
	inc PHYSHI
:
	lda #<(BLOCKBUF + 128)
	sta DBUFLO
	lda #>(BLOCKBUF + 128)
	sta DBUFHI
	jmp ReadSector128

ReadSector128:
	lda #$31
	sta DDEVIC
	lda #$01
	sta DUNIT
	lda #$52
	sta DCOMND
	lda #$40
	sta DSTATS
	lda #$07
	sta DTIMLO
	lda #$80
	sta DBYTLO
	lda #$00
	sta DBYTHI
	lda PHYSLO
	sta DAUX1
	lda PHYSHI
	sta DAUX2
	cli
	jsr SIOV
	sei
	tya
	bpl :+
	jmp LoaderFail
:
	lda DSTATS
	bpl :+
	jmp LoaderFail
:
	rts

FeedXexByte:
	lda STATE
	beq @expectFF0
	cmp #1
	beq @expectFF1
	cmp #2
	beq @expectStartLo
	cmp #3
	beq @expectStartHi
	cmp #4
	beq @expectEndLo
	cmp #5
	beq @expectEndHi

	tya
	pha
	ldy #0
	sta (DESTLO),y
	pla
	tay
	inc DESTLO
	bne :+
	inc DESTHI
:
	lda REMLENLO
	bne @decLow
	dec REMLENHI
	lda #$ff
	sta REMLENLO
	bne @checkDone
@decLow:
	dec REMLENLO
@checkDone:
	lda REMLENLO
	ora REMLENHI
	bne @done
	lda #$02
	sta STATE
@done:
	rts

@expectFF0:
	cmp #$ff
	bne LoaderFail
	lda #$01
	sta STATE
	rts

@expectFF1:
	cmp #$ff
	bne LoaderFail
	lda #$02
	sta STATE
	rts

@expectStartLo:
	sta STARTLO
	lda #$03
	sta STATE
	rts

@expectStartHi:
	sta STARTHI
	lda #$04
	sta STATE
	rts

@expectEndLo:
	sta ENDLO
	lda #$05
	sta STATE
	rts

@expectEndHi:
	sta ENDHI
	lda STARTLO
	sta DESTLO
	lda STARTHI
	sta DESTHI
	lda ENDLO
	sec
	sbc STARTLO
	sta REMLENLO
	lda ENDHI
	sbc STARTHI
	sta REMLENHI
	inc REMLENLO
	bne :+
	inc REMLENHI
:
	lda #$06
	sta STATE
	rts

LoaderFail:
	lda #$ff
	sta LOADSTAT
	lda #$01
	sta LOADERR
@failHang:
	jmp @failHang

.segment "header"
	.word CartRun
	.byte $05
	.byte $00
	.word CartInit
