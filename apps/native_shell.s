; Minimal GEOS-native Shell application for Atari XL
; This application registers itself as the GEOS shell.

.include "const.inc"
.include "geossym.inc"
.include "atari.inc"
.include "jumptab.inc"

.import _MNLP
.import ClrScr

.segment "CODE"
; GEOS Application Header
.byte $00, $00 ; Load address
.word _StartAppl ; Start vector
.byte $06      ; Type: Application
.byte $00      ; String type
.byte "NativeShell", 0
.byte "1.0", 0

_StartAppl:
    ; 1. Minimal display setup
    jsr ClrScr
    
    ; 3. Enter the main loop
    jmp _MNLP

.segment "START"
    ; Placeholder for startup initialization if needed
    rts
