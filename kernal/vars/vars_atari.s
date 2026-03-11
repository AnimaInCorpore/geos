; GEOS KERNAL by Berkeley Softworks
; Atari XL internal variables

.include "config.inc"

.global nmiDisableDepth
.global nmiEnableMask

.segment "vars"

nmiDisableDepth: .byte 0
nmiEnableMask:   .byte 0
