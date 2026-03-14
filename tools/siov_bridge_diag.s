; tools/siov_bridge_diag.s
;
; Diagnostic: isolate which part of the SIO bridge setup breaks SIOV.
; Code at $0A00-$0BFF (512 bytes).
;
; Result bytes (all zeroed on entry):
;   $04D0  PHASE1_STATUS  $01=pass $FF=fail $00=not reached
;   $04D1  PHASE1_YREG
;   $04D2  PHASE2_STATUS  after PORTB cycle (ROM off→on)
;   $04D3  PHASE2_YREG
;   $04D4  PHASE3_STATUS  after full bridge-sim (no page-2 swap)
;   $04D5  PHASE3_YREG
;   $04D6  PHASE4_STATUS  after full bridge-sim + page-2 vector swap
;   $04D7  PHASE4_YREG

SIOV    = $E459
PORTB   = $D301
PBCTL   = $D303
SKCTL   = $D20F
IRQEN   = $D20E
NMIEN   = $D40E

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

SECBUF  = $0780          ; 128-byte sector buffer

; Result locations
P1_STAT = $04D0
P1_YREG = $04D1
P2_STAT = $04D2
P2_YREG = $04D3
P3_STAT = $04D4
P3_YREG = $04D5
P4_STAT = $04D6
P4_YREG = $04D7

; Scratch storage for bridge sim (use top of our code range = $0BE0+)
SAVED_PORTB  = $04D8
SAVED_NMIEN  = $04D9
SAVED_PBCTL  = $04DA
VVBLKI_SNAP  = $04DB  ; 4 bytes: VVBLKI lo/hi, VVBLKD lo/hi
VIMIRQ_SNAP  = $04DF  ; 2 bytes

; Page-2 vector save area (38 bytes $0200-$0225)
P2_SAVE      = $04E1  ; 38 bytes (fits in $04E1-$0506)
P2_OS        = $0507  ; OS vector image (38 bytes, $0507-$052C)

.segment "CODE"

Entry:
    sei
    cld
    ldx #$FF
    txs

    ; Zero all result bytes
    lda #$00
    ldx #$07
@clr:
    sta $04D0,x
    dex
    bpl @clr

; ---------------------------------------------------------------
; PHASE 1: Plain SIOV (baseline, must match siov_minimal_test)
; ---------------------------------------------------------------
Phase1:
    jsr ResetSio
    jsr FillDcb
    cli
    jsr SIOV
    sei
    sty P1_YREG
    bmi @err
    lda #$01
    sta P1_STAT
    jmp Phase2
@err:
    lda #$FF
    sta P1_STAT

; ---------------------------------------------------------------
; PHASE 2: Cycle PORTB bit 0 (ROM off → on), then SIOV
; Does the ROM-bank toggle break the subsequent SIOV?
; ---------------------------------------------------------------
Phase2:
    jsr ResetSio
    ; disable OS ROM
    lda PORTB
    pha
    and #$FE
    sta PORTB
    ; immediately re-enable OS ROM
    pla
    ora #$01
    sta PORTB
    ; now SIOV
    jsr FillDcb
    cli
    jsr SIOV
    sei
    sty P2_YREG
    bmi @err
    lda #$01
    sta P2_STAT
    jmp Phase3
@err:
    lda #$FF
    sta P2_STAT

; ---------------------------------------------------------------
; PHASE 3: Full bridge sim WITHOUT page-2 vector swap
; Exactly: PBCTL=$3c, PORTB save/disable/re-enable, NMIEN save/$00/$40,
; SKCTL=$03, cli, SIOV — but skip the page-2 memcpy
; ---------------------------------------------------------------
Phase3:
    jsr ResetSio
    ; --- Bridge preamble (no vector swap) ---
    lda NMIEN
    sta SAVED_NMIEN
    lda PBCTL
    sta SAVED_PBCTL
    lda #$3c
    sta PBCTL
    lda PORTB
    sta SAVED_PORTB
    lda #$00
    sta NMIEN
    lda SAVED_PORTB
    ora #$83
    sta PORTB
    ; write SKCTL
    lda #$03
    sta SKCTL
    ; enable NMI and interrupts
    lda #$40
    sta NMIEN
    jsr FillDcb
    cli
    jsr SIOV
    sei
    sty P3_YREG
    php
    ; restore
    lda #$00
    sta NMIEN
    lda SAVED_PORTB
    sta PORTB
    lda SAVED_PBCTL
    sta PBCTL
    lda SAVED_NMIEN
    sta NMIEN
    plp
    bmi @err
    lda #$01
    sta P3_STAT
    jmp Phase4
@err:
    lda #$FF
    sta P3_STAT

; ---------------------------------------------------------------
; PHASE 4: Full bridge sim WITH page-2 vector swap
; Snapshot VVBLKI/VVBLKD/VIMIRQ, then save + swap page-2,
; then SIOV, then restore.
; ---------------------------------------------------------------
Phase4:
    jsr ResetSio
    ; --- Snapshot boot-time VBI/IRQ vectors (live page-2 values) ---
    ldy #3
@snapVbi:
    lda $0222,y          ; VVBLKI = $0222, VVBLKD = $0224
    sta VVBLKI_SNAP,y
    dey
    bpl @snapVbi
    lda $0216
    sta VIMIRQ_SNAP
    lda $0217
    sta VIMIRQ_SNAP+1
    ; --- Bridge preamble ---
    lda NMIEN
    sta SAVED_NMIEN
    lda PBCTL
    sta SAVED_PBCTL
    lda #$3c
    sta PBCTL
    lda PORTB
    sta SAVED_PORTB
    lda #$00
    sta NMIEN
    lda SAVED_PORTB
    ora #$83
    sta PORTB
    ; --- Save live page-2 to P2_SAVE, copy to P2_OS ---
    ldy #37
@prepVec:
    lda $0200,y
    sta P2_SAVE,y
    sta P2_OS,y
    dey
    bpl @prepVec
    ; Patch OS VBI vectors into P2_OS
    ldy #3
@patchVbi:
    lda VVBLKI_SNAP,y
    sta P2_OS+($0222-$0200),y
    dey
    bpl @patchVbi
    ; Patch VIMIRQ
    lda VIMIRQ_SNAP
    sta P2_OS+($0216-$0200)
    lda VIMIRQ_SNAP+1
    sta P2_OS+($0216-$0200)+1
    ; Install P2_OS into page-2
    ldy #37
@swapVec:
    lda P2_OS,y
    sta $0200,y
    dey
    bpl @swapVec
    ; write SKCTL
    lda #$03
    sta SKCTL
    ; enable NMI and interrupts
    lda #$40
    sta NMIEN
    jsr FillDcb
    cli
    jsr SIOV
    sei
    sty P4_YREG
    php
    ; --- Restore page-2 ---
    ldy #37
@restVec:
    lda P2_SAVE,y
    sta $0200,y
    dey
    bpl @restVec
    ; restore PORTB, PBCTL, NMIEN
    lda #$00
    sta NMIEN
    lda SAVED_PORTB
    sta PORTB
    lda SAVED_PBCTL
    sta PBCTL
    lda SAVED_NMIEN
    sta NMIEN
    plp
    bmi @err
    lda #$01
    sta P4_STAT
    jmp @halt
@err:
    lda #$FF
    sta P4_STAT
@halt:
    jmp @halt

; ---------------------------------------------------------------
; Subroutines
; ---------------------------------------------------------------
ResetSio:
    lda #$00
    sta SKCTL       ; serial port reset (clears jsA8E SIO state machine)
    lda #$03
    sta SKCTL       ; re-enable normal POKEY mode
    rts

FillDcb:
    lda #$31
    sta DDEVIC
    lda #$01
    sta DUNIT
    lda #$52
    sta DCOMND
    lda #$40
    sta DSTATS
    lda #<SECBUF
    sta DBUFLO
    lda #>SECBUF
    sta DBUFHI
    lda #$07
    sta DTIMLO
    lda #$80
    sta DBYTLO
    lda #$00
    sta DBYTHI
    sta DAUX2
    lda #$01
    sta DAUX1
    rts
