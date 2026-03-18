#!/usr/bin/env python3
"""
make_geos_cvt.py – Build a GEOS CVT (Convert 2.5) file from a raw binary.

Usage:
    python3 make_geos_cvt.py [options] input.bin output.cvt

Options:
    --dos-name NAME     DOS directory name, max 16 chars (default: input basename)
    --class-name NAME   GEOS class name, max 20 chars (default: same as dos-name)
    --load-addr ADDR    Load address in hex (default: 0x0400)
    --start-vec  ADDR   Start vector in hex (default: same as load-addr)
    --geos-type  N      GEOS type byte: 6=APPLICATION, 8=DESK_ACC, etc. (default: 6)
    --str-type   N      Structure type: 0=SEQ, 1=VLIR (default: 0)

CVT file layout (each block = 254 bytes):
    Block 0  : CVT marker block
    Block 1  : GEOS fileinfo sector (254 bytes)
    Block 2+ : raw binary payload, padded to 254-byte blocks
"""

import argparse
import math
import os
import struct
import sys
from datetime import date

BLOCK = 254  # GEOS block size in CVT files


def pad(data: bytes, size: int, fill: int = 0xA0) -> bytes:
    """Pad or truncate *data* to exactly *size* bytes."""
    return (data + bytes([fill] * size))[:size]


def dos_name_bytes(name: str) -> bytes:
    """Return 16-byte padded CBM DOS filename (PETSCII, pad with $A0)."""
    # ASCII upper-case maps 1:1 to PETSCII for the printable range we need.
    upper = name.upper()[:16].encode("ascii", errors="replace")
    return pad(upper, 16, 0xA0)


def make_cvt(
    payload: bytes,
    dos_name: str,
    class_name: str,
    load_addr: int,
    start_vec: int,
    geos_type: int,
    str_type: int,
) -> bytes:
    """Return the complete CVT file as bytes."""
    today = date.today()

    # ------------------------------------------------------------------ #
    # Block 0 – CVT marker block (254 bytes)                              #
    # ------------------------------------------------------------------ #
    # Byte layout (subset that matters to GEOS and atari_geos_disk.py):
    #   [0]      $83   – CVT file marker
    #   [1]      $15   – CBM file type (PRG with closed/locked bits)
    #   [2]      $00   – unused
    #   [3:19]   DOS name, 16 bytes, $A0-padded
    #   [19]     $00   – rel record size (unused for non-REL)
    #   [20]     $00   – unused
    #   [21]     str_type  (0=SEQ, 1=VLIR)
    #   [22]     geos_type (6=APPLICATION, etc.)
    #   [23]     day
    #   [24]     month
    #   [25:27]  year (little-endian word)
    #   rest     $00
    # ------------------------------------------------------------------ #
    blk0 = bytearray(BLOCK)
    blk0[0] = 0x83
    blk0[1] = 0x82   # CBM PRG, closed+locked
    blk0[2] = 0x00
    blk0[3:19] = dos_name_bytes(dos_name)
    blk0[19] = 0x00
    blk0[20] = 0x00
    blk0[21] = str_type & 0xFF
    blk0[22] = geos_type & 0xFF
    blk0[23] = today.day & 0xFF
    blk0[24] = today.month & 0xFF
    blk0[25] = today.year & 0xFF
    blk0[26] = (today.year >> 8) & 0xFF
    # bytes 27-253 remain $00

    # ------------------------------------------------------------------ #
    # Block 1 – fileinfo sector (254 bytes)                               #
    # ------------------------------------------------------------------ #
    # atari_geos_disk.py writes the disk block as: header[0:2]=$00,$FF
    # then header[2:] = fileinfo.  So fileHeader[N] = fileinfo[N-2].
    # To target fileHeader[K] (from const.inc), write fileinfo[K-2].
    #   fileinfo[0:63]  – icon bitmap (3×21 bytes), left zeroed
    #   fileinfo[66]    – O_GHCMDR_TYPE ($82 = CBM PRG)
    #   fileinfo[67]    – O_GHGEOS_TYPE (GEOS type byte)
    #   fileinfo[68]    – O_GHSTR_TYPE  (structure byte)
    #   fileinfo[69:71] – O_GHST_ADDR   (load address LE)
    #   fileinfo[71:73] – O_GHEND_ADDR  (end address LE)
    #   fileinfo[73:75] – O_GHST_VEC    (start vector LE)
    #   fileinfo[75:95] – O_GHFNAME     (class name, 20 bytes, $A0-padded)
    # ------------------------------------------------------------------ #
    # fileHeader[N] = fileinfo[N-2]  (atari_geos_disk.py writes header[2:]=fileinfo)
    # So fileinfo[K] = fileHeader[K+2]; to target fileHeader[offset], use fileinfo[offset-2].
    # From const.inc: O_GHCMDR_TYPE=68, O_GHGEOS_TYPE=69, O_GHSTR_TYPE=70,
    #                  O_GHST_ADDR=71, O_GHEND_ADDR=73, O_GHST_VEC=75, O_GHFNAME=77
    FI_CBM_TYPE   = 66    # fileHeader[68] = O_GHCMDR_TYPE
    FI_GEOS_TYPE  = 67    # fileHeader[69] = O_GHGEOS_TYPE
    FI_STR_TYPE   = 68    # fileHeader[70] = O_GHSTR_TYPE
    FI_LOAD_LO    = 69    # fileHeader[71] = O_GHST_ADDR lo
    FI_LOAD_HI    = 70    # fileHeader[72] = O_GHST_ADDR hi
    FI_END_LO     = 71    # fileHeader[73] = O_GHEND_ADDR lo
    FI_END_HI     = 72    # fileHeader[74] = O_GHEND_ADDR hi
    FI_VEC_LO     = 73    # fileHeader[75] = O_GHST_VEC lo
    FI_VEC_HI     = 74    # fileHeader[76] = O_GHST_VEC hi
    FI_CLASS_START = 75   # fileHeader[77] = O_GHFNAME (20 bytes)

    end_addr = load_addr + len(payload)

    blk1 = bytearray(BLOCK)
    blk1[FI_CBM_TYPE]   = 0x82
    blk1[FI_GEOS_TYPE]  = geos_type & 0xFF
    blk1[FI_STR_TYPE]   = str_type & 0xFF
    blk1[FI_LOAD_LO]    = load_addr & 0xFF
    blk1[FI_LOAD_HI]    = (load_addr >> 8) & 0xFF
    blk1[FI_END_LO]     = end_addr & 0xFF
    blk1[FI_END_HI]     = (end_addr >> 8) & 0xFF
    blk1[FI_VEC_LO]     = start_vec & 0xFF
    blk1[FI_VEC_HI]     = (start_vec >> 8) & 0xFF
    class_bytes = class_name.upper()[:20].encode("ascii", errors="replace")
    blk1[FI_CLASS_START:FI_CLASS_START + 20] = pad(class_bytes, 20, 0xA0)

    # ------------------------------------------------------------------ #
    # Payload blocks – pad binary to multiple of BLOCK                    #
    # ------------------------------------------------------------------ #
    num_payload_blocks = math.ceil(len(payload) / BLOCK)
    padded_payload = pad(payload, num_payload_blocks * BLOCK, 0x00)

    return bytes(blk0) + bytes(blk1) + padded_payload


def main():
    parser = argparse.ArgumentParser(
        description="Create a GEOS CVT file from a raw binary.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", help="Raw binary input file")
    parser.add_argument("output", help="CVT output file")
    parser.add_argument("--dos-name", default=None,
                        help="DOS directory name (max 16 chars)")
    parser.add_argument("--class-name", default=None,
                        help="GEOS class name (max 20 chars)")
    parser.add_argument("--load-addr", default="0x0400",
                        help="Load address in hex (default: 0x0400)")
    parser.add_argument("--start-vec", default=None,
                        help="Start vector in hex (default: same as load-addr)")
    parser.add_argument("--geos-type", type=int, default=6,
                        help="GEOS type byte: 6=APPLICATION (default)")
    parser.add_argument("--str-type", type=int, default=0,
                        help="Structure: 0=SEQ (default), 1=VLIR")
    args = parser.parse_args()

    load_addr = int(args.load_addr, 0)
    start_vec = int(args.start_vec, 0) if args.start_vec else load_addr

    dos_name = args.dos_name or os.path.splitext(os.path.basename(args.input))[0]
    class_name = args.class_name or dos_name

    try:
        with open(args.input, "rb") as f:
            payload = f.read()
    except OSError as e:
        print(f"error: cannot read {args.input}: {e}", file=sys.stderr)
        sys.exit(1)

    if not payload:
        print("error: input file is empty", file=sys.stderr)
        sys.exit(1)

    cvt_data = make_cvt(
        payload=payload,
        dos_name=dos_name,
        class_name=class_name,
        load_addr=load_addr,
        start_vec=start_vec,
        geos_type=args.geos_type,
        str_type=args.str_type,
    )

    try:
        with open(args.output, "wb") as f:
            f.write(cvt_data)
    except OSError as e:
        print(f"error: cannot write {args.output}: {e}", file=sys.stderr)
        sys.exit(1)

    print(
        f"wrote {args.output}: {len(cvt_data)} bytes "
        f"({(len(cvt_data)//BLOCK)} blocks), "
        f"dos='{dos_name}', load=${load_addr:04X}, vec=${start_vec:04X}"
    )


if __name__ == "__main__":
    main()
