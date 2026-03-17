
VARIANT     ?= bsw
DRIVE       ?= drv1541
INPUT       ?= joydrv

AS           = ca65
LD           = ld65
C1541        = c1541
PUCRUNCH     = pucrunch
EXOMIZER     = exomizer
D64_RESULT   = geos.d64
ATR_RESULT   = geos.atr
DESKTOP_CVT  = desktop.cvt
ATARI_DISK_TOOL = tools/atari_geos_disk.py
ATARIXL_DISK_NAME ?= GEOSXL
ATARIXL_CVT_FILES ?=

ifeq ($(VARIANT),atarixl)
DISK_RESULT = $(ATR_RESULT)
else
DISK_RESULT = $(D64_RESULT)
endif

ifeq ($(VARIANT),bsw128)
D64_TEMPLATE = GEOS128.D64
else
D64_TEMPLATE = GEOS64.D64
endif

ASFLAGS      = -I inc -I . $(EXTRA_ASFLAGS)

# code that is in front bank of all variants
KERNAL_SOURCES= \
	kernal/bitmask/bitmask2.s \
	kernal/conio/conio1.s \
	kernal/conio/conio2.s \
	kernal/conio/conio3a.s \
	kernal/conio/conio4.s \
	kernal/conio/conio6.s \
	kernal/dlgbox/dlgbox1a.s \
	kernal/dlgbox/dlgbox1b.s \
	kernal/dlgbox/dlgbox1c.s \
	kernal/dlgbox/dlgbox1d.s \
	kernal/dlgbox/dlgbox1e1.s \
	kernal/dlgbox/dlgbox1e2.s \
	kernal/dlgbox/dlgbox1f.s \
	kernal/dlgbox/dlgbox1g.s \
	kernal/dlgbox/dlgbox1h.s \
	kernal/dlgbox/dlgbox1i.s \
	kernal/dlgbox/dlgbox1j.s \
	kernal/dlgbox/dlgbox1k.s \
	kernal/dlgbox/dlgbox2.s \
	kernal/files/files10.s \
	kernal/files/files1a2a.s \
	kernal/files/files1a2b.s \
	kernal/files/files1b.s \
	kernal/files/files2.s \
	kernal/files/files3.s \
	kernal/files/files6a.s \
	kernal/files/files6b.s \
	kernal/files/files6c.s \
	kernal/files/files7.s \
	kernal/files/files8.s \
	kernal/graph/clrscr.s \
	kernal/graph/inlinefunc.s \
	kernal/graph/graphicsstring.s \
	kernal/graph/graph2l1.s \
	kernal/graph/pattern.s \
	kernal/graph/inline.s \
	kernal/header/header.s \
	kernal/hw/hw1a.s \
	kernal/hw/hw1b.s \
	kernal/hw/hw2.s \
	kernal/hw/hw3.s \
	kernal/icon/icon1.s \
	kernal/icon/icon2.s \
	kernal/init/init1.s \
	kernal/init/init2.s \
	kernal/init/init3.s \
	kernal/init/init4.s \
	kernal/jumptab/jumptab.s \
	kernal/load/deskacc.s \
	kernal/load/load1a.s \
	kernal/load/load1b.s \
	kernal/load/load1c.s \
	kernal/load/load2.s \
	kernal/load/load3.s \
	kernal/load/load4b.s \
	kernal/mainloop/mainloop1.s \
	kernal/mainloop/mainloop3.s \
	kernal/math/shl.s \
	kernal/math/shr.s \
	kernal/math/muldiv.s \
	kernal/math/neg.s \
	kernal/math/dec.s \
	kernal/math/random.s \
	kernal/math/crc.s \
	kernal/memory/memory1a.s \
	kernal/memory/memory1b.s \
	kernal/memory/memory2.s \
	kernal/memory/memory3.s \
	kernal/menu/menu1.s \
	kernal/menu/menu2.s \
	kernal/menu/menu3.s \
	kernal/misc/misc.s \
	kernal/mouse/mouse1.s \
	kernal/mouse/mouse2.s \
	kernal/mouse/mouse3.s \
	kernal/mouse/mouse4.s \
	kernal/mouse/mouseptr.s \
	kernal/panic/panic.s \
	kernal/patterns/patterns.s \
	kernal/process/process1.s \
	kernal/process/process2.s \
	kernal/process/process3a.s \
	kernal/process/process3aa.s \
	kernal/process/process3b.s \
	kernal/process/process3c.s \
	kernal/reu/reu.s \
	kernal/serial/serial1.s \
	kernal/serial/serial2.s \
	kernal/time/time1.s \
	kernal/time/time2.s \
	kernal/tobasic/tobasic2.s \
	kernal/vars/vars.s

ifneq ($(VARIANT), atarixl)
	KERNAL_SOURCES += \
	kernal/sprites/sprites.s \
	kernal/keyboard/keyboard1.s \
	kernal/keyboard/keyboard2.s \
	kernal/keyboard/keyboard3.s \
	kernal/irq/irq.s
endif

# code that is in front bank of C64 only
ifneq ($(VARIANT), bsw128)
ifneq ($(VARIANT), atarixl)
	KERNAL_SOURCES += \
	kernal/start/start64.s
endif
	KERNAL_SOURCES += \
	kernal/bitmask/bitmask1.s \
	kernal/bitmask/bitmask3.s \
	kernal/bswfont/bswfont.s \
	kernal/conio/conio3b.s \
	kernal/conio/conio5.s \
	kernal/files/files9.s \
	kernal/fonts/fonts1.s \
	kernal/fonts/fonts2.s \
	kernal/fonts/fonts3.s \
	kernal/fonts/fonts4.s \
	kernal/fonts/fonts4a.s \
	kernal/fonts/fonts4b.s \
	kernal/graph/bitmapclip.s \
	kernal/graph/bitmapup.s \
	kernal/graph/line.s \
	kernal/graph/point.s \
	kernal/graph/rect.s \
	kernal/graph/scanline.s \
	kernal/mainloop/mainloop2.s \
	kernal/ramexp/ramexp1.s \
	kernal/ramexp/ramexp2.s \
	kernal/rename.s \
	kernal/tobasic/tobasic1.s
endif

ifeq ($(VARIANT), atarixl)
	KERNAL_SOURCES += \
	kernal/hw/hw_atari.s \
	kernal/irq/irq_atari.s \
	kernal/keyboard/keyboard_atari.s \
	kernal/sprites/sprites_atari.s \
	kernal/start/vectors_atari.s \
	kernal/start/start_atari.s \
	kernal/vars/vars_atari.s
endif

# code that is in front bank of C128 only
ifeq ($(VARIANT), bsw128)
	KERNAL_SOURCES += \
	kernal/start/start128.s \
	kernal/128k/bank_jmptab_front.s \
	kernal/128k/banking.s \
	kernal/128k/cbm_jmptab.s \
	kernal/c128/iojmptab.s \
	kernal/c128/iowrapper.s \
	kernal/c128/irq_front.s \
	kernal/c128/junk_front.s \
	kernal/c128/low_jmptab.s \
	kernal/c128/mouseproxy.s \
	kernal/c128/vdc_base.s \
	kernal/c128/vdc_init.s \
	kernal/c128/vectors_front.s \
	kernal/files/compat.s \
	kernal/graph/normalize.s \
	kernal/graph/mode.s \
	kernal/memory/memory_128.s
endif

# code that is in C128 back bank
KERNAL2_SOURCES= \
	kernal/128k/bank_jmptab_back.s \
	kernal/128k/cache.s \
	kernal/128k/swapdiskdriver.s \
	kernal/640/bswfont80.s \
	kernal/bitmask/bitmask1.s \
	kernal/bitmask/bitmask2.s \
	kernal/bitmask/bitmask3.s \
	kernal/bswfont/bswfont.s \
	kernal/c128/irq_back.s \
	kernal/c128/junk_back.s \
	kernal/c128/softsprites.s \
	kernal/c128/vdc.s \
	kernal/c128/vdc_base.s \
	kernal/c128/vectors_back.s \
	kernal/conio/conio3b.s \
	kernal/conio/conio5.s \
	kernal/files/files1a2a.s \
	kernal/files/files9.s \
	kernal/fonts/fonts1.s \
	kernal/fonts/fonts2.s \
	kernal/fonts/fonts3.s \
	kernal/fonts/fonts4.s \
	kernal/fonts/fonts4a.s \
	kernal/fonts/fonts4b.s \
	kernal/graph/line.s \
	kernal/graph/rect.s \
	kernal/graph/scanline.s \
	kernal/graph/graph2p.s \
	kernal/graph/bitmapclip.s \
	kernal/graph/bitmapup.s \
	kernal/graph/point.s \
	kernal/graph/normalize.s \
	kernal/math/shl.s \
	kernal/math/neg.s \
	kernal/memory/backram.s \
	kernal/tobasic/tobasic2_128.s

# code that is in Wheels front bank only
ifeq ($(VARIANT), wheels)
KERNAL_SOURCES += \
	kernal/wheels/wheels.s \
	kernal/wheels/ram.s \
	kernal/wheels/devnum.s \
	kernal/wheels/format.s \
	kernal/wheels/partition.s \
	kernal/wheels/directory.s \
	kernal/wheels/validate.s \
	kernal/wheels/copydisk.s \
	kernal/wheels/copyfile.s \
	kernal/wheels/loadb.s \
	kernal/wheels/tobasicb.s \
	kernal/wheels/reux.s
endif

ifeq ($(VARIANT), bsw128)
RELOCATOR_SOURCES = \
	kernal/start/relocator128.s
endif

DRIVER_SOURCES= \
	drv/drv1050.bin \
	drv/drv1541.bin \
	drv/drv1571.bin \
	drv/drv1581.bin \
	input/joydrv_atari.bin \
	input/mse_stmouse.bin \
	input/joydrv.bin \
	input/amigamse.bin \
	input/lightpen.bin \
	input/mse1351.bin \
	input/koalapad.bin \
	input/pcanalog.bin

DEPS= \
	config.inc \
	inc/c64.inc \
	inc/atari.inc \
	inc/const.inc \
	inc/diskdrv.inc \
	inc/geosmac.inc \
	inc/geossym.inc \
	inc/inputdrv.inc \
	inc/jumptab.inc \
	inc/kernal.inc \
	inc/printdrv.inc

KERNAL_OBJS=$(KERNAL_SOURCES:.s=.o)
KERNAL2_OBJS=$(KERNAL2_SOURCES:.s=.o)
RELOCATOR_OBJS=$(RELOCATOR_SOURCES:.s=.o)
DRIVER_OBJS=$(DRIVER_SOURCES:.s=.o)
ALL_OBJS=$(KERNAL_OBJS) $(DRIVER_OBJS)

BUILD_DIR=build/$(VARIANT)
BUILD_FLAGS_FILE=$(BUILD_DIR)/.build-flags

PREFIXED_KERNAL_OBJS = $(addprefix $(BUILD_DIR)/, $(KERNAL_OBJS))
PREFIXED_KERNAL2_OBJS = $(addprefix $(BUILD_DIR)/, $(KERNAL2_OBJS))
PREFIXED_RELOCATOR_OBJS = $(addprefix $(BUILD_DIR)/, $(RELOCATOR_OBJS))

ALL_BINS= \
	$(BUILD_DIR)/kernal/kernal.bin \
	$(BUILD_DIR)/drv/drv1050.bin \
	$(BUILD_DIR)/drv/drv1541.bin \
	$(BUILD_DIR)/drv/drv1571.bin \
	$(BUILD_DIR)/drv/drv1581.bin \
	$(BUILD_DIR)/input/joydrv_atari.bin \
	$(BUILD_DIR)/input/mse_stmouse.bin \
	$(BUILD_DIR)/input/joydrv.bin \
	$(BUILD_DIR)/input/amigamse.bin \
	$(BUILD_DIR)/input/lightpen.bin \
	$(BUILD_DIR)/input/mse1351.bin \
	$(BUILD_DIR)/input/koalapad.bin \
	$(BUILD_DIR)/input/pcanalog.bin

ifeq ($(VARIANT), bsw128)
	ALL_BINS += \
	$(BUILD_DIR)/kernal/kernal2.bin \
	$(BUILD_DIR)/kernal/relocator.bin
endif

all: $(BUILD_DIR)/$(DISK_RESULT)

atarixl:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari all

atarixl-smoketest:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari EXTRA_ASFLAGS='-D atarixl_smoketest=1' build/atarixl/phase2_smoketest.xex

atarixl-input-smoketest:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari INPUTCFG=input/inputdrv_atarixl_smoketest.cfg EXTRA_ASFLAGS='-D atarixl_input_smoketest=1' build/atarixl/phase3_input_smoketest.xex

atarixl-disk-smoketest:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari EXTRA_ASFLAGS='-D atarixl_disk_smoketest=1' build/atarixl/phase4_disk_smoketest.xex build/atarixl/phase4_disk_test.atr

atarixl-desktop-bootstrap:
	@mkdir -p build/atarixl
	@PHASE5_CVT="$(ATARIXL_CVT_FILES)"; \
	if [ -z "$$PHASE5_CVT" ]; then \
		if [ -e $(DESKTOP_CVT) ]; then \
			PHASE5_CVT="$(DESKTOP_CVT)"; \
		elif [ -e GEOS64/GEOS64.D64 ]; then \
			echo "Extracting DESK TOP convert file from GEOS64/GEOS64.D64"; \
			$(C1541) GEOS64/GEOS64.D64 -geosread "DESK TOP" build/atarixl/desktop.cvt >/dev/null; \
			PHASE5_CVT="build/atarixl/desktop.cvt"; \
		fi; \
	fi; \
	$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari EXTRA_ASFLAGS='-D atarixl_desktop_smoketest=1' ATARIXL_CVT_FILES="$$PHASE5_CVT" build/atarixl/phase5_desktop_bootstrap.xex build/atarixl/geos.atr

atarixl-desktop-smoke-bootstrap:
	@mkdir -p build/atarixl
	@PHASE5_CVT="$(ATARIXL_CVT_FILES)"; \
	if [ -z "$$PHASE5_CVT" ]; then \
		if [ -e $(DESKTOP_CVT) ]; then \
			PHASE5_CVT="$(DESKTOP_CVT)"; \
		elif [ -e GEOS64/GEOS64.D64 ]; then \
			echo "Extracting DESK TOP convert file from GEOS64/GEOS64.D64"; \
			$(C1541) GEOS64/GEOS64.D64 -geosread "DESK TOP" build/atarixl/desktop.cvt >/dev/null; \
			PHASE5_CVT="build/atarixl/desktop.cvt"; \
		fi; \
	fi; \
	$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari EXTRA_ASFLAGS='-D atarixl_desktop_smoketest=1 -D atarixl_desktop_smoke_frame=1' ATARIXL_CVT_FILES="$$PHASE5_CVT" build/atarixl/phase5_desktop_bootstrap.xex build/atarixl/geos.atr

atarixl-desktop-run:
	@$(MAKE) atarixl-desktop-bootstrap
	node tools/phase5_desktop_run.js

atarixl-desktop-smoke-run:
	@$(MAKE) atarixl-desktop-smoke-bootstrap
	node tools/phase5_desktop_run.js --allow-smoke-frame

atarixl-disk-smoketest-matrix:
	@$(MAKE) atarixl-disk-smoketest
	node tools/phase4_disk_matrix_run.js

atarixl-siov-minimal-test:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari build/atarixl/siov_minimal_test.xex build/atarixl/phase4_disk_test.atr

atarixl-siov-bridge-diag:
	@$(MAKE) VARIANT=atarixl DRIVE=drv1050 INPUT=joydrv_atari build/atarixl/siov_bridge_diag.xex build/atarixl/phase4_disk_test.atr

regress:
	@echo "********** Building variant 'bsw'"
	@$(MAKE) VARIANT=bsw all
	./regress.sh bsw
	@echo "********** Building variant 'wheels'"
	@$(MAKE) VARIANT=wheels all
	./regress.sh wheels

clean:
	rm -rf build

ifeq ($(VARIANT),bsw128)
$(BUILD_DIR)/$(D64_RESULT): $(BUILD_DIR)/kernal_compressed.prg
	@if [ -e $(D64_TEMPLATE) ]; then \
		cp $(D64_TEMPLATE) $@; \
		echo delete geos128 geoboot128 | $(C1541) $@ ;\
		echo write $< geos128 | $(C1541) $@ ;\
		echo \*\*\* Created $@ based on $(D64_TEMPLATE).; \
	else \
		echo format geos,00 d64 $@ | $(C1541) >/dev/null; \
		echo write $< geos128 | $(C1541) $@ >/dev/null; \
		if [ -e $(DESKTOP_CVT) ]; then echo geoswrite $(DESKTOP_CVT) | $(C1541) $@; fi >/dev/null; \
		echo \*\*\* Created fresh $@.; \
	fi;
else
ifeq ($(VARIANT),atarixl)
$(BUILD_DIR)/$(ATR_RESULT): $(BUILD_DIR)/kernal_combined.prg $(ATARI_DISK_TOOL) $(ATARIXL_CVT_FILES)
	@echo Creating $@
	python3 $(ATARI_DISK_TOOL) --disk-name $(ATARIXL_DISK_NAME) $@ $(ATARIXL_CVT_FILES)
else
$(BUILD_DIR)/$(D64_RESULT): $(BUILD_DIR)/kernal_compressed.prg
	@if [ -e $(D64_TEMPLATE) ]; then \
		cp $(D64_TEMPLATE) $@; \
		echo delete geos geoboot | $(C1541) $@ ;\
		echo write $< geos | $(C1541) $@ ;\
		echo \*\*\* Created $@ based on $(D64_TEMPLATE).; \
	else \
		echo format geos,00 d64 $@ | $(C1541) >/dev/null; \
		echo write $< geos | $(C1541) $@ >/dev/null; \
		if [ -e $(DESKTOP_CVT) ]; then echo geoswrite $(DESKTOP_CVT) | $(C1541) $@; fi >/dev/null; \
		echo \*\*\* Created fresh $@.; \
	fi;
endif
endif

$(BUILD_DIR)/kernal_compressed.prg: $(BUILD_DIR)/kernal_combined.prg
	@echo Creating $@
ifeq ($(VARIANT), bsw128)
	# start address ($4800) is underneath BASIC ROM on the 128; turn off BASIC
	# and KERNAL before jumping to unpacked code
	$(EXOMIZER) sfx 0x4800 -t128 -Di_ram_exit='$$3e' -o $@ $<
else ifeq ($(VARIANT), atarixl)
	# pucrunch is optional in local setups; use exomizer for atarixl bring-up
	$(EXOMIZER) sfx 0x5000 -t64 -o $@ $<
else
	$(PUCRUNCH) -f -c64 -x0x5000 $< $@ 2> /dev/null
endif

$(BUILD_DIR)/kernal_combined.prg: $(ALL_BINS)
ifeq ($(VARIANT), bsw128)
	@echo Creating $@ from kernal.bin $(DRIVE).bin kernal2.bin relocator.bin $(INPUT).bin
	printf "\x00\x48" > $(BUILD_DIR)/tmp.bin
# relocator.bin($4800) @ $4800-$4C00 -> $4800
	cat $(BUILD_DIR)/kernal/relocator.bin /dev/zero | dd bs=1 count=1024 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal.bin($5000)    @ $5000-$5400 -> $4C00
	cat $(BUILD_DIR)/kernal/kernal.bin /dev/zero | dd bs=1 count=1024 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal.bin($5000)    @ $C000-$FD00 -> $5000
	cat $(BUILD_DIR)/kernal/kernal.bin /dev/zero | dd bs=1 count=15616 skip=28672 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# input*.bin($FD00)    @ $FD00-$FE80 -> $8D00
	cat $(BUILD_DIR)/input/$(INPUT).bin /dev/zero | dd bs=1 count=384 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal.bin($5000)    @ $FE80-$0000 -> $8E80
	cat $(BUILD_DIR)/kernal/kernal.bin /dev/zero | dd bs=1 count=384 skip=44672 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# drv*.bin($9000)      @ $9000-$9D80 -> $9000
	cat $(BUILD_DIR)/drv/$(DRIVE).bin /dev/zero | dd bs=1 count=3456 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal.bin($5000)    @ $9D80-$A000 -> $9D80
	cat $(BUILD_DIR)/kernal/kernal.bin /dev/zero | dd bs=1 count=640 skip=19840 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal2.bin($C000)   @ $E000-$0000 -> $A000
	cat $(BUILD_DIR)/kernal/kernal2.bin /dev/zero | dd bs=1 count=8192 skip=8192 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
# kernal2.bin($C000)   @ $C000-$E000 -> $C000
	cat $(BUILD_DIR)/kernal/kernal2.bin /dev/zero | dd bs=1 count=8192 >> $(BUILD_DIR)/tmp.bin 2> /dev/null

	@mv $(BUILD_DIR)/tmp.bin $(BUILD_DIR)/kernal_combined.prg

else
	@echo Creating $@ from kernal.bin $(DRIVE).bin $(INPUT).bin
	printf "\x00\x50" > $(BUILD_DIR)/tmp.bin
	dd if=$(BUILD_DIR)/kernal/kernal.bin bs=1 count=16384 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
	cat $(BUILD_DIR)/drv/$(DRIVE).bin /dev/zero | dd bs=1 count=3456 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
	cat $(BUILD_DIR)/kernal/kernal.bin /dev/zero | dd bs=1 count=24832 skip=19840 >> $(BUILD_DIR)/tmp.bin 2> /dev/null
	@cat $(BUILD_DIR)/input/$(INPUT).bin >> $(BUILD_DIR)/tmp.bin 2> /dev/null
	@mv $(BUILD_DIR)/tmp.bin $(BUILD_DIR)/kernal_combined.prg
endif

ifeq ($(VARIANT),atarixl)
INPUTCFG ?= input/inputdrv_atarixl.cfg
else ifeq ($(VARIANT),bsw128)
INPUTCFG ?= input/inputdrv_bsw128.cfg
else
INPUTCFG ?= input/inputdrv.cfg
endif

$(BUILD_DIR)/drv/drv1050.bin: $(BUILD_DIR)/drv/drv1050.o drv/drv1050.cfg $(DEPS)
	$(LD) -C drv/drv1050.cfg $(BUILD_DIR)/drv/drv1050.o -o $@

$(BUILD_DIR)/drv/drv1541.bin: $(BUILD_DIR)/drv/drv1541.o drv/drv1541.cfg $(DEPS)
	$(LD) -C drv/drv1541.cfg $(BUILD_DIR)/drv/drv1541.o -o $@

$(BUILD_DIR)/drv/drv1571.bin: $(BUILD_DIR)/drv/drv1571.o drv/drv1571.cfg $(DEPS)
	$(LD) -C drv/drv1571.cfg $(BUILD_DIR)/drv/drv1571.o -o $@

$(BUILD_DIR)/drv/drv1581.bin: $(BUILD_DIR)/drv/drv1581.o drv/drv1581.cfg $(DEPS)
	$(LD) -C drv/drv1581.cfg $(BUILD_DIR)/drv/drv1581.o -o $@

$(BUILD_DIR)/input/joydrv_atari.bin: $(BUILD_DIR)/input/joydrv_atari.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/joydrv_atari.o -o $@

$(BUILD_DIR)/input/mse_stmouse.bin: $(BUILD_DIR)/input/mse_stmouse.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/mse_stmouse.o -o $@

$(BUILD_DIR)/input/amigamse.bin: $(BUILD_DIR)/input/amigamse.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/amigamse.o -o $@

$(BUILD_DIR)/input/joydrv.bin: $(BUILD_DIR)/input/joydrv.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/joydrv.o -o $@

$(BUILD_DIR)/input/lightpen.bin: $(BUILD_DIR)/input/lightpen.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/lightpen.o -o $@

$(BUILD_DIR)/input/mse1351.bin: $(BUILD_DIR)/input/mse1351.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/mse1351.o -o $@

$(BUILD_DIR)/input/koalapad.bin: $(BUILD_DIR)/input/koalapad.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/koalapad.o -o $@

$(BUILD_DIR)/input/pcanalog.bin: $(BUILD_DIR)/input/pcanalog.o $(INPUTCFG) $(DEPS)
	$(LD) -C $(INPUTCFG) $(BUILD_DIR)/input/pcanalog.o -o $@

.PHONY: FORCE
FORCE:

$(BUILD_FLAGS_FILE): Makefile FORCE
	@mkdir -p $$(dirname $@)
	@printf '%s\n' \
		'VARIANT=$(VARIANT)' \
		'DRIVE=$(DRIVE)' \
		'INPUT=$(INPUT)' \
		'INPUTCFG=$(INPUTCFG)' \
		'EXTRA_ASFLAGS=$(EXTRA_ASFLAGS)' \
		'ASFLAGS=$(ASFLAGS)' > $@.tmp
	@cmp -s $@.tmp $@ || mv $@.tmp $@
	@rm -f $@.tmp

$(BUILD_DIR)/%.o: %.s $(DEPS) $(BUILD_FLAGS_FILE)
	@mkdir -p `dirname $@`
	$(AS) -D $(VARIANT)=1 -D $(DRIVE)=1 -D $(INPUT)=1 $(ASFLAGS) $< -o $@

$(BUILD_DIR)/kernal/kernal.bin: $(PREFIXED_KERNAL_OBJS) kernal/kernal_$(VARIANT).cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal_$(VARIANT).cfg $(PREFIXED_KERNAL_OBJS) -o $@ -m $(BUILD_DIR)/kernal/kernal.map -Ln $(BUILD_DIR)/kernal/kernal.lab

ifeq ($(VARIANT),atarixl)
$(BUILD_DIR)/kernal/phase2_smoketest.bin: $(PREFIXED_KERNAL_OBJS) kernal/kernal_atarixl_smoketest.cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal_atarixl_smoketest.cfg $(PREFIXED_KERNAL_OBJS) -o $@ -m $(BUILD_DIR)/kernal/phase2_smoketest.map -Ln $(BUILD_DIR)/kernal/phase2_smoketest.lab

$(BUILD_DIR)/phase2_smoketest.xex: $(BUILD_DIR)/kernal/phase2_smoketest.bin
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x00\x05\xFF\x1F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 count=6912 >> $@ 2> /dev/null
	printf "\x80\x9D\xFF\x9F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 skip=6912 count=640 >> $@ 2> /dev/null
	printf "\x40\x3F\xFF\x3F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 skip=7552 count=192 >> $@ 2> /dev/null
	printf "\x00\xC0\xFF\xC0" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 skip=7744 count=256 >> $@ 2> /dev/null
	printf "\x00\xC1\xFF\xFF" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 skip=8000 count=16128 >> $@ 2> /dev/null
	printf "\x00\xD0\xFF\xFF" >> $@
	dd if=$(BUILD_DIR)/kernal/phase2_smoketest.bin bs=1 skip=24128 count=12288 >> $@ 2> /dev/null
	printf "\xE0\x02\xE1\x02\x01\x05" >> $@

$(BUILD_DIR)/kernal/phase3_input_smoketest.bin: $(PREFIXED_KERNAL_OBJS) kernal/kernal_atarixl_smoketest.cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal_atarixl_smoketest.cfg $(PREFIXED_KERNAL_OBJS) -o $@ -m $(BUILD_DIR)/kernal/phase3_input_smoketest.map -Ln $(BUILD_DIR)/kernal/phase3_input_smoketest.lab

$(BUILD_DIR)/phase3_input_smoketest.xex: $(BUILD_DIR)/kernal/phase3_input_smoketest.bin $(BUILD_DIR)/input/$(INPUT).bin
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x00\x05\xFF\x1F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 count=6912 >> $@ 2> /dev/null
	printf "\x80\x9D\xFF\x9F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 skip=6912 count=640 >> $@ 2> /dev/null
	printf "\x40\x3F\xFF\x3F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 skip=7552 count=192 >> $@ 2> /dev/null
	printf "\x00\xC0\xFF\xC0" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 skip=7744 count=256 >> $@ 2> /dev/null
	printf "\x00\xC1\xFF\xFF" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 skip=8000 count=16128 >> $@ 2> /dev/null
	printf "\x00\xD0\xFF\xFF" >> $@
	dd if=$(BUILD_DIR)/kernal/phase3_input_smoketest.bin bs=1 skip=24128 count=12288 >> $@ 2> /dev/null
	printf "\x00\x20\x7F\x21" >> $@
	dd if=$(BUILD_DIR)/input/$(INPUT).bin bs=1 count=384 >> $@ 2> /dev/null
	printf "\xE0\x02\xE1\x02\x01\x05" >> $@

$(BUILD_DIR)/kernal/phase4_disk_smoketest.bin: $(PREFIXED_KERNAL_OBJS) kernal/kernal_atarixl_phase4_smoketest.cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal_atarixl_phase4_smoketest.cfg $(PREFIXED_KERNAL_OBJS) -o $@ -m $(BUILD_DIR)/kernal/phase4_disk_smoketest.map -Ln $(BUILD_DIR)/kernal/phase4_disk_smoketest.lab

$(BUILD_DIR)/phase4_disk_smoketest.xex: $(BUILD_DIR)/kernal/phase4_disk_smoketest.bin $(BUILD_DIR)/drv/$(DRIVE).bin tools/phase4_disk_smoketest.atdbg
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x80\x08\xFF\x1F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase4_disk_smoketest.bin bs=1 count=6016 >> $@ 2> /dev/null
	printf "\x00\x20\xFF\x5F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase4_disk_smoketest.bin bs=1 skip=6848 count=16384 >> $@ 2> /dev/null
	printf "\x00\x90\x7F\x9D" >> $@
	cat $(BUILD_DIR)/drv/$(DRIVE).bin /dev/zero | dd bs=1 count=3456 >> $@ 2> /dev/null
	printf "\x80\x9D\xFF\x9F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase4_disk_smoketest.bin bs=1 skip=6016 count=640 >> $@ 2> /dev/null
	printf "\x40\x3F\xFF\x3F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase4_disk_smoketest.bin bs=1 skip=6656 count=192 >> $@ 2> /dev/null
	printf "\xE0\x02\xE1\x02\x81\x08" >> $@
	cp tools/phase4_disk_smoketest.atdbg $(BUILD_DIR)/phase4_disk_smoketest.xex.atdbg

$(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin: $(PREFIXED_KERNAL_OBJS) kernal/kernal_atarixl_phase5_bootstrap.cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal_atarixl_phase5_bootstrap.cfg $(PREFIXED_KERNAL_OBJS) -o $@ -m $(BUILD_DIR)/kernal/phase5_desktop_bootstrap.map -Ln $(BUILD_DIR)/kernal/phase5_desktop_bootstrap.lab

$(BUILD_DIR)/phase5_desktop_bootstrap.xex: $(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin $(BUILD_DIR)/drv/$(DRIVE).bin $(BUILD_DIR)/input/$(INPUT).bin
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x80\x08\xFF\x1F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin bs=1 count=6016 >> $@ 2> /dev/null
	printf "\x00\x20\xFF\x77" >> $@
	dd if=$(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin bs=1 skip=6848 count=22528 >> $@ 2> /dev/null
	printf "\x00\x90\x7F\x9D" >> $@
	cat $(BUILD_DIR)/drv/$(DRIVE).bin /dev/zero | dd bs=1 count=3456 >> $@ 2> /dev/null
	printf "\x80\x9D\xFF\x9F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin bs=1 skip=6016 count=640 >> $@ 2> /dev/null
	printf "\x40\x3F\xFF\x3F" >> $@
	dd if=$(BUILD_DIR)/kernal/phase5_desktop_bootstrap.bin bs=1 skip=6656 count=192 >> $@ 2> /dev/null
	printf "\x00\x78\x7F\x79" >> $@
	cat $(BUILD_DIR)/input/$(INPUT).bin /dev/zero | dd bs=1 count=384 >> $@ 2> /dev/null
	printf "\xE0\x02\xE1\x02\x81\x08" >> $@

$(BUILD_DIR)/phase4_disk_test.atr: $(ATARI_DISK_TOOL)
	@echo Creating $@
	python3 $(ATARI_DISK_TOOL) --disk-name $(ATARIXL_DISK_NAME) $@

# Step 17a: standalone minimal SIOV test — no GEOS kernal, OS ROM stays active,
# no SIO bridge.  Tests whether jsA8E can complete a bare sector-read SIOV call.
$(BUILD_DIR)/siov_minimal_test.bin: tools/siov_minimal_test.s tools/siov_minimal_test.cfg
	@mkdir -p $(dir $@)
	$(AS) -I inc tools/siov_minimal_test.s -o $(BUILD_DIR)/siov_minimal_test.o
	$(LD) -C tools/siov_minimal_test.cfg $(BUILD_DIR)/siov_minimal_test.o \
	      -o $@ -m $(BUILD_DIR)/siov_minimal_test.map

$(BUILD_DIR)/siov_minimal_test.xex: $(BUILD_DIR)/siov_minimal_test.bin
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x00\x09\xFF\x09" >> $@
	cat $(BUILD_DIR)/siov_minimal_test.bin >> $@
	printf "\xE0\x02\xE1\x02\x00\x09" >> $@

# Step 17b: SIO bridge diagnostic — isolates which bridge step breaks SIOV.
# Code at $0A00-$0BFF; tests 4 phases (plain SIOV, PORTB cycle, bridge sim
# without page-2 swap, bridge sim with page-2 swap).
$(BUILD_DIR)/siov_bridge_diag.bin: tools/siov_bridge_diag.s tools/siov_bridge_diag.cfg
	@mkdir -p $(dir $@)
	$(AS) -I inc tools/siov_bridge_diag.s -o $(BUILD_DIR)/siov_bridge_diag.o
	$(LD) -C tools/siov_bridge_diag.cfg $(BUILD_DIR)/siov_bridge_diag.o \
	      -o $@ -m $(BUILD_DIR)/siov_bridge_diag.map

$(BUILD_DIR)/siov_bridge_diag.xex: $(BUILD_DIR)/siov_bridge_diag.bin
	@echo Creating $@
	printf "\xFF\xFF" > $@
	printf "\x00\x0A\xFF\x0B" >> $@
	cat $(BUILD_DIR)/siov_bridge_diag.bin >> $@
	printf "\xE0\x02\xE1\x02\x00\x0A" >> $@
endif

$(BUILD_DIR)/kernal/kernal2.bin: $(PREFIXED_KERNAL2_OBJS) kernal/kernal2_$(VARIANT).cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/kernal2_$(VARIANT).cfg $(PREFIXED_KERNAL2_OBJS) -o $@ -m $(BUILD_DIR)/kernal/kernal2.map  -Ln $(BUILD_DIR)/kernal/kernal2.lab

$(BUILD_DIR)/kernal/relocator.bin: $(PREFIXED_RELOCATOR_OBJS) kernal/relocator_$(VARIANT).cfg
	@mkdir -p $$(dirname $@)
	$(LD) -C kernal/relocator_$(VARIANT).cfg $(PREFIXED_RELOCATOR_OBJS) -o $@ -m $(BUILD_DIR)/kernal/relocator.map  -Ln $(BUILD_DIR)/kernal/relocator.lab

# a must!
love:	
	@echo "Not war, eh?"
