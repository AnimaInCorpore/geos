; GEOS Input Driver Jump Tab
; reassembled by Maciej 'YTM/Alliance' Witkowiak

; Atari XL low-RAM smoke harness (OS ROM still active)
.ifdef atarixl_input_smoketest
MouseInit       =       $2000
SlowMouse       =       $2003
UpdateMouse     =       $2006
SetMouse        =       $2009

; for C64
.elseif .defined(atarixl)
MouseInit       =       $fe80
SlowMouse       =       $fe83
UpdateMouse     =       $fe86
SetMouse        =       $fe89

; for C64
.else
MouseInit       =       $fe80
SlowMouse       =       $fe83
UpdateMouse     =       $fe86
SetMouse        =       $fe89
.endif

; for C128
MouseInit_128   =       $fd00
SlowMouse_128   =       $fd03
UpdateMouse_128 =       $fd06
SetMouse_128    =       $fd09
