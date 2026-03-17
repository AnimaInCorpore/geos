; GEOS KERNAL by Berkeley Softworks
; reverse engineered by Maciej Witkowiak, Michael Steil
;
; Main Loop

.include "const.inc"
.include "geossym.inc"
.include "geosmac.inc"
.include "config.inc"
.include "kernal.inc"
.include "c64.inc"
.ifdef atarixl
.include "atari.inc"
.endif

.import _MainLoop
.ifdef atarixl
.import atari_dlist
.endif

.global _MainLoop2

.segment "mainloop2"

.if (!.defined(wheels)) && (!.defined(bsw128))
_MainLoop2:
	START_IO_X
.ifdef atarixl
	lda #<atari_dlist
	sta DLISTL
	sta $0230
	lda #>atari_dlist
	sta DLISTH
	sta $0231
	lda #$3e
	sta DMACTL
	sta $022f
.else
	lda grcntrl1
	and #%01111111
	sta grcntrl1
.endif
	END_IO_X
	jmp _MainLoop
.endif
