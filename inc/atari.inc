.include "config.inc"

; Atari hardware and OS equates for the Atari XL port.

; -----------------------------------------------
; GTIA ($D000)
; -----------------------------------------------
; NOTE: Several Atari registers are read/write aliases at the same address.
; Prefer *_R / *_W names in new code to avoid accidental read/write misuse.
HPOSP0   = $D000 ; Player 0 horizontal position (write)
HPOSP1   = $D001
HPOSP2   = $D002
HPOSP3   = $D003
HPOSM0   = $D004 ; Missile 0 horizontal position (write)
HPOSM1   = $D005
HPOSM2   = $D006
HPOSM3   = $D007
SIZEP0   = $D008 ; Player 0 size
SIZEP1   = $D009
SIZEP2   = $D00A
SIZEP3   = $D00B
SIZEM    = $D00C ; Missile size (write)
GRAFP0_W = $D00D ; Player 0 graphics data (write)
GRAFP1_W = $D00E
GRAFP2_W = $D00F
GRAFP3_W = $D010
GRAFM_W  = $D011 ; Missile graphics data (write) — read alias at same addr is TRIG1_R
TRIG0_R  = $D010 ; Joystick 0 trigger (read, active low: 0=pressed)
TRIG1_R  = $D011 ; Joystick 1 trigger (read, active low)
TRIG2_R  = $D012 ; Joystick 2 trigger / light-gun trigger (read, active low)
TRIG3_R  = $D013 ; Joystick 3 trigger / light-gun trigger (read, active low)
PAL_R    = $D014 ; Hardware video standard (read): bit3=0 → PAL, bit3=1 → NTSC
                  ; (write at $D014 is COLPM2 — unrelated register)
GRAFP0   = GRAFP0_W
GRAFP1   = GRAFP1_W
GRAFP2   = GRAFP2_W
GRAFP3   = GRAFP3_W
GRAFM    = GRAFM_W
TRIG0    = TRIG0_R
TRIG1    = TRIG1_R
TRIG2    = TRIG2_R
TRIG3    = TRIG3_R
COLPM0   = $D012 ; Player 0 color
COLPM1   = $D013
COLPM2   = $D014
COLPM3   = $D015
COLPF0   = $D016 ; Playfield color 0
COLPF1   = $D017
COLPF2   = $D018 ; Playfield color 2 (foreground pixel color in mode $0F)
COLPF3   = $D019
COLBK    = $D01A ; Background color
PRIOR    = $D01B ; Priority control
VDELAY   = $D01C ; Vertical delay
GRACTL   = $D01D ; Graphics control:
                  ; bit0=enable missile graphics display latching (GRAFM writes)
                  ; bit1=enable player graphics display latching (GRAFPx writes)
                  ; bit2=latch paddle/trigger inputs
HITCLR   = $D01E ; Write: clear collision registers
CONSOL   = $D01F ; Console keys (Start/Select/Option, read active-low)

; -----------------------------------------------
; POKEY ($D200)
; -----------------------------------------------
POT0_R    = $D200 ; Paddle 0 value (read after POTGO)
POT1_R    = $D201
POT2_R    = $D202
POT3_R    = $D203
POT4_R    = $D204
POT5_R    = $D205
POT6_R    = $D206
POT7_R    = $D207
ALLPOT_R  = $D208 ; Potentiometer port status (read)
KBCODE    = $D209 ; Last keyboard scan code latched by POKEY (0-$3F)
                   ; Does NOT indicate "no key" - use CH ($02FC) for that
RANDOM    = $D20A ; Random number (read)
POTGO     = $D20B ; Write: start potentiometer scan
AUDF1_W   = $D200 ; Audio frequency channel 1 (write)
AUDC1_W   = $D201 ; Audio control channel 1 (write)
AUDF2_W   = $D202
AUDC2_W   = $D203
AUDF3_W   = $D204
AUDC3_W   = $D205
AUDF4_W   = $D206
AUDC4_W   = $D207
AUDCTL_W  = $D208 ; Audio control (write)
STIMER_W  = $D209 ; Write: start POKEY timers (read alias at same addr is KBCODE)
SKRES_W   = $D20A ; Write: reset SKSTAT error bits (read alias is RANDOM)
SEROUT_W  = $D20D ; Serial output data (write)
SERIN_R   = $D20D ; Serial input data (read)
IRQEN_W   = $D20E ; IRQ enable mask (write)
IRQST_R   = $D20E ; IRQ status (read, active-low bits)
SKSTAT_R  = $D20F ; Serial/keyboard status (bit2=0 key down, bit3=0 shift down)
SKCTL_W   = $D20F ; Serial/keyboard control (write)
POT0      = POT0_R
POT1      = POT1_R
POT2      = POT2_R
POT3      = POT3_R
POT4      = POT4_R
POT5      = POT5_R
POT6      = POT6_R
POT7      = POT7_R
ALLPOT    = ALLPOT_R
AUDF1     = AUDF1_W
AUDC1     = AUDC1_W
AUDF2     = AUDF2_W
AUDC2     = AUDC2_W
AUDF3     = AUDF3_W
AUDC3     = AUDC3_W
AUDF4     = AUDF4_W
AUDC4     = AUDC4_W
AUDCTL    = AUDCTL_W
IRQEN     = IRQEN_W
IRQST     = IRQST_R
SKSTAT    = SKSTAT_R
SKCTL     = SKCTL_W

; -----------------------------------------------
; PIA ($D300)
; -----------------------------------------------
PORTA    = $D300 ; Port A: joystick 0 (bits 0-3), joystick 1 (bits 4-7), active-low
PORTB    = $D301 ; Port B: bit0=OS ROM select, bit1=BASIC ROM select, bit7=self-test
PACTL    = $D302 ; Port A control
PBCTL    = $D303 ; Port B control

; -----------------------------------------------
; ANTIC ($D400)
; -----------------------------------------------
DMACTL   = $D400 ; DMA control
CHACTL   = $D401 ; Character control
DLISTL   = $D402 ; Display list address low byte
DLISTH   = $D403 ; Display list address high byte
HSCROL   = $D404 ; Horizontal scroll
VSCROL   = $D405 ; Vertical scroll
PMBASE   = $D407 ; Player/missile base address (high byte only, 2 KB aligned)
CHBASE   = $D409 ; Character set base address (high byte)
WSYNC    = $D40A ; Write: halt CPU until next horizontal blank
VCOUNT   = $D40B ; Vertical line counter (read)
PENH     = $D40C ; Light pen horizontal position (read)
PENV     = $D40D ; Light pen vertical position (read)
NMIEN    = $D40E ; NMI enable: bit6=VBI, bit5=DLI
NMIST    = $D40F ; NMI status (read): bit7=DLI pending, bit6=VBI pending
NMIRES   = $D40F ; NMI acknowledge/reset (write; use for VBI acknowledge)

; -----------------------------------------------
; Atari OS variables (valid when OS ROM active)
; -----------------------------------------------
SIOV     = $E459 ; OS SIO entry point (fixed address in Atari OS ROM)
SETVBV   = $E45C ; OS: set VBI vector (XL/XE ROM)
XITVBV   = $E462 ; OS: VBI exit (XL/XE ROM)
VVBLKI   = $0222 ; Immediate VBI vector (2-byte pointer, OS-managed)
VVBLKD   = $0224 ; Deferred VBI vector (2-byte pointer, OS-managed)
VIMIRQ   = $0216 ; IRQ dispatch vector used by the OS IRQ handler
RTCLOK   = $0012 ; 3-byte real-time clock incremented each VBI ($12/$13/$14)
CDTMV1   = $0218 ; 16-bit countdown timer 1, lo byte first; decremented each VBI
CDTMV2   = $021A ; 16-bit countdown timer 2
CDTMV3   = $021C ; 16-bit countdown timer 3
CDTMV4   = $021E ; 16-bit countdown timer 4
CDTMV5   = $0220 ; 16-bit countdown timer 5 — SIOV uses this for read/write timeouts
CH       = $02FC ; OS keyboard shadow: $FF = no key pending, else ATASCII code
KEYREP   = $02DA ; OS keyboard repeat counter

; Low-RAM ROM-banking bridge for OS-assisted SIO calls.
; Keep the code and scratch below $3F40 so it does not overlap icon data.
SIO_BRIDGE_BASE        = $3DC0
SIO_BRIDGE_SAVED_NMIEN = SIO_BRIDGE_BASE + $E0
SIO_BRIDGE_SAVED_PBCTL = SIO_BRIDGE_BASE + $E1
SIO_BRIDGE_SAVED_PORTB = SIO_BRIDGE_BASE + $E2
SIO_BRIDGE_SAVED_A     = SIO_BRIDGE_BASE + $E3
SIO_BRIDGE_SAVED_Y     = SIO_BRIDGE_BASE + $E4
SIO_BRIDGE_SAVED_SSKCTL = SIO_BRIDGE_BASE + $E5
SIO_BRIDGE_OS_VBI_VECTORS = SIO_BRIDGE_BASE + $E6 ; 4 bytes: boot-time VVBLKI/VVBLKD
SIO_BRIDGE_OS_VIMIRQ   = SIO_BRIDGE_BASE + $EA ; 2 bytes: boot-time VIMIRQ
SIO_BRIDGE_OS_WORKSPACE = SIO_BRIDGE_BASE + $EC ; spare scratch bytes
SIO_BRIDGE_OS_VECTORS  = SIO_BRIDGE_BASE + $F0 ; 38 bytes: $0200-$0225
SIO_BRIDGE_SAVED_VECTORS = SIO_BRIDGE_BASE + $116 ; 38 bytes: $0200-$0225
SIO_BRIDGE_OS_TOP_VECTORS = SIO_BRIDGE_BASE + $13C ; 6 bytes: $FFFA-$FFFF
SIO_BRIDGE_SAVED_TOP_VECTORS = SIO_BRIDGE_BASE + $142 ; 6 bytes: $FFFA-$FFFF
