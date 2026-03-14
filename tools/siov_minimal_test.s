; tools/siov_minimal_test.s
;
; Phase 4 step-17a: minimal SIOV smoke test.
;
; OS ROM stays active throughout.  No GEOS kernal, no ROM disable, no
; SIO bridge.  Reads sector 1 of D1: into a 128-byte buffer and records
; the result at $04D0-$04D4 for inspection via the debugger / automation.
;
; Result bytes (all zeroed on entry, written once SIOV returns or halts):
;   $04D0  STATUS   $00 = still running / not reached
;                   $01 = SIOV returned success (Y < $80)
;                   $FF = SIOV returned error   (Y >= $80)
;   $04D1  YREG     raw Y register value returned by SIOV
;   $04D2  DSTS     DSTATS byte from OS page-3 DCB after the call
;   $04D3  BUF0     first byte of the 128-byte sector-1 payload
;   $04D4  BUF1     second byte of the sector-1 payload
;
; Code lives at $0900-$09FF to avoid jsA8E's XEX boot loader ($0700-$087F).
;
; Build (standalone, no GEOS includes needed):
;   ca65 -I inc tools/siov_minimal_test.s -o build/atarixl/siov_minimal_test.o
;   ld65 -C tools/siov_minimal_test.cfg   build/atarixl/siov_minimal_test.o \
;        -o build/atarixl/siov_minimal_test.bin
; Then the Makefile wraps the binary in an XEX envelope (RUN=$0900).

; ---------------------------------------------------------------
; Atari OS constants (no includes required)
; ---------------------------------------------------------------
SIOV    = $E459     ; Atari OS SIO entry point (fixed in XL/XE ROM)

; Device Control Block — OS page 3
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

; ---------------------------------------------------------------
; Result / diagnostic scratchpad
; ---------------------------------------------------------------
STATUS  = $04D0     ; test outcome written by this code
YREG    = $04D1
DSTS    = $04D2
BUF0    = $04D3
BUF1    = $04D4

SECBUF  = $0780     ; 128-byte read buffer (well clear of OS page 2/3)

; ---------------------------------------------------------------
; Code
; ---------------------------------------------------------------
.segment "CODE"

Entry:
    sei
    cld
    ldx #$FF
    txs

    ; Zero all result bytes so automation can detect "still running"
    lda #$00
    sta STATUS
    sta YREG
    sta DSTS
    sta BUF0
    sta BUF1

    ; ----------------------------------------------------------
    ; Fill the Device Control Block for a sector-1 read of D1:
    ; ----------------------------------------------------------
    lda #$31        ; device ID: disk drive 1
    sta DDEVIC
    lda #$01        ; unit 1
    sta DUNIT
    lda #$52        ; command byte: $52 = read sector
    sta DCOMND
    lda #$40        ; direction: $40 = receive (host reads from device)
    sta DSTATS
    lda #<SECBUF    ; buffer address low
    sta DBUFLO
    lda #>SECBUF    ; buffer address high
    sta DBUFHI
    lda #$07        ; timeout: 7 seconds
    sta DTIMLO
    lda #$80        ; byte count low:  128 bytes/sector (SD)
    sta DBYTLO
    lda #$00        ; byte count high: 0
    sta DBYTHI
    lda #$01        ; sector number AUX1 (low):  sector 1
    sta DAUX1
    lda #$00        ; sector number AUX2 (high): 0
    sta DAUX2

    ; ----------------------------------------------------------
    ; Call SIOV via OS ROM (OS ROM is still active, no banking)
    ; Interrupts must be enabled: SIOV relies on the VBI/timer
    ; IRQ (CDTMV5) for its timeout countdown.
    ; ----------------------------------------------------------
    cli
    jsr SIOV
    sei

    ; ----------------------------------------------------------
    ; Record return state
    ; SIOV returns: Y = 1 (success) or Y >= $80 (error code)
    ;               DSTATS = final OS status byte
    ; ----------------------------------------------------------
    sty YREG
    lda DSTATS
    sta DSTS

    ; Inspect Y: if bit 7 set, SIOV reported an error
    ldy YREG
    bmi @error

    ; Success — capture first two bytes of the sector payload
    lda SECBUF
    sta BUF0
    lda SECBUF+1
    sta BUF1
    lda #$01
    sta STATUS
    jmp @halt

@error:
    lda #$FF
    sta STATUS

@halt:
    jmp @halt
