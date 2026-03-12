; GEOS KERNAL by Berkeley Softworks
; Atari XL RAM vectors for OS-off execution

.include "config.inc"

.import _NMIHandler
.import _IRQVectorHandler
.import _ResetHandle

.segment "vectors_atari"

	.word _NMIHandler
	.word _ResetHandle
	.word _IRQVectorHandler
