#!/usr/bin/env python3
"""Build a GEOS-format Atari ATR from cc65 GEOS .cvt files."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


LOGICAL_TRACKS = 20
SECTORS_PER_TRACK = 18
LOGICAL_BLOCKS = LOGICAL_TRACKS * SECTORS_PER_TRACK
DIR_TRACK = 18
DIR_HEADER_BLOCK = (DIR_TRACK - 1) * SECTORS_PER_TRACK
DIR_FIRST_BLOCK = DIR_HEADER_BLOCK + 1
BLOCK_SIZE = 256
BLOCK_PAYLOAD = 254
ATR_SECTOR_SIZE = 128
ATR_HEADER_SIZE = 16
ATR_DATA_SIZE = LOGICAL_BLOCKS * BLOCK_SIZE
GEOS_ID = b"GEOS format V1.0\x00"

OFF_TO_BAM = 4
OFF_DISK_NAME = 144
OFF_OP_TR_SC = 171
OFF_GS_ID = 173

OFF_CFILE_TYPE = 0
OFF_DE_TR_SC = 1
OFF_FNAME = 3
OFF_GHDR_PTR = 19
OFF_GSTRUC_TYPE = 21
OFF_GFILE_TYPE = 22
OFF_SIZE = 28


def pad_a0(text: str, size: int) -> bytes:
    raw = text.encode("ascii", "strict")[:size]
    return raw + bytes([0xA0]) * (size - len(raw))


def ts_from_block(block_index: int) -> tuple[int, int]:
    return (block_index // SECTORS_PER_TRACK) + 1, block_index % SECTORS_PER_TRACK


def build_chain_blocks(payload: bytes) -> list[bytearray]:
    chunks = [payload[i : i + BLOCK_PAYLOAD] for i in range(0, len(payload), BLOCK_PAYLOAD)]
    if not chunks:
        chunks = [b""]
    blocks: list[bytearray] = []
    for index, chunk in enumerate(chunks):
        block = bytearray(BLOCK_SIZE)
        block[2 : 2 + len(chunk)] = chunk
        if index == len(chunks) - 1:
            block[0] = 0
            block[1] = len(chunk) + 1 if chunk else 1
        blocks.append(block)
    return blocks


@dataclass
class CvtFile:
    path: Path
    dos_name: bytes
    structure: int
    geos_type: int
    date: bytes
    fileinfo: bytes
    seq_payload: bytes
    vlir_sizes: list[int]
    vlir_payload: bytes

    @classmethod
    def parse(cls, path: Path) -> "CvtFile":
        data = path.read_bytes()
        if len(data) < 2 * BLOCK_PAYLOAD:
            raise ValueError(f"{path} is too small to be a GEOS .cvt file")
        if data[0] != 0x83:
            raise ValueError(f"{path} does not start with a Convert v2.5 GEOS marker")

        dos_name = data[3:19]
        structure = data[21]
        geos_type = data[22]
        date = data[23:28]
        fileinfo = data[BLOCK_PAYLOAD : 2 * BLOCK_PAYLOAD]
        payload = data[2 * BLOCK_PAYLOAD :]

        vlir_sizes: list[int] = []
        seq_payload = payload
        vlir_payload = b""
        if structure == 1:
            raise ValueError(f"{path} is a VLIR .cvt file; the Atari converter currently supports sequential .cvt inputs only")

        return cls(
            path=path,
            dos_name=dos_name,
            structure=structure,
            geos_type=geos_type,
            date=date,
            fileinfo=fileinfo,
            seq_payload=seq_payload,
            vlir_sizes=vlir_sizes,
            vlir_payload=vlir_payload,
        )


class AtariGeosDisk:
    def __init__(self, disk_name: str) -> None:
        self.disk_name = disk_name
        self.blocks = [bytearray(BLOCK_SIZE) for _ in range(LOGICAL_BLOCKS)]
        self.used = [False] * LOGICAL_BLOCKS
        self.directory_entries: list[bytes] = []
        self.reserve_block(DIR_HEADER_BLOCK)
        self.reserve_block(DIR_FIRST_BLOCK)
        self.blocks[DIR_FIRST_BLOCK][1] = 0xFF

    def reserve_block(self, block_index: int) -> None:
        self.used[block_index] = True

    def allocate_block(self) -> int:
        for track in range(1, LOGICAL_TRACKS + 1):
            if track == DIR_TRACK:
                continue
            for sector in range(SECTORS_PER_TRACK):
                block = (track - 1) * SECTORS_PER_TRACK + sector
                if not self.used[block]:
                    self.used[block] = True
                    return block
        raise ValueError("Atari GEOS disk is full")

    def write_chain(self, chain_blocks: list[bytearray]) -> tuple[int, int]:
        allocated = [self.allocate_block() for _ in chain_blocks]
        for index, block_index in enumerate(allocated):
            block = chain_blocks[index]
            if index < len(allocated) - 1:
                next_track, next_sector = ts_from_block(allocated[index + 1])
                block[0] = next_track
                block[1] = next_sector
            self.blocks[block_index][:] = block
        return ts_from_block(allocated[0])

    def add_cvt(self, cvt: CvtFile) -> None:
        header_block = self.allocate_block()
        header = bytearray(BLOCK_SIZE)
        header[0] = 0
        header[1] = 0xFF
        header[2:] = cvt.fileinfo
        self.blocks[header_block][:] = header

        if cvt.structure == 0:
            data_track, data_sector = self.write_chain(build_chain_blocks(cvt.seq_payload))
            total_blocks = 1 + len(build_chain_blocks(cvt.seq_payload))
        else:
            raise ValueError(f"{cvt.path} uses unsupported GEOS structure {cvt.structure}")

        dir_entry = bytearray(32)
        dir_entry[OFF_CFILE_TYPE] = header[68]
        dir_entry[OFF_DE_TR_SC] = data_track
        dir_entry[OFF_DE_TR_SC + 1] = data_sector
        dir_entry[OFF_FNAME : OFF_FNAME + 16] = cvt.dos_name
        hdr_track, hdr_sector = ts_from_block(header_block)
        dir_entry[OFF_GHDR_PTR] = hdr_track
        dir_entry[OFF_GHDR_PTR + 1] = hdr_sector
        dir_entry[OFF_GSTRUC_TYPE] = cvt.structure
        dir_entry[OFF_GFILE_TYPE] = cvt.geos_type
        dir_entry[23:28] = cvt.date
        dir_entry[OFF_SIZE] = total_blocks & 0xFF
        dir_entry[OFF_SIZE + 1] = total_blocks >> 8
        self.directory_entries.append(bytes(dir_entry[:30]))

    def _build_directory_chain(self) -> None:
        dir_blocks = [DIR_FIRST_BLOCK]
        needed = max(1, (len(self.directory_entries) + 7) // 8)
        while len(dir_blocks) < needed:
            next_block = self.allocate_block()
            dir_blocks.append(next_block)

        for index, block_index in enumerate(dir_blocks):
            block = bytearray(BLOCK_SIZE)
            if index < len(dir_blocks) - 1:
                next_track, next_sector = ts_from_block(dir_blocks[index + 1])
                block[0] = next_track
                block[1] = next_sector
            else:
                block[0] = 0
                block[1] = 0xFF
            for entry_index in range(8):
                source_index = index * 8 + entry_index
                if source_index >= len(self.directory_entries):
                    break
                offset = 2 + (entry_index * 32)
                block[offset : offset + 30] = self.directory_entries[source_index]
            self.blocks[block_index][:] = block

    def _build_dir_header(self) -> None:
        header = bytearray(BLOCK_SIZE)
        for track in range(1, LOGICAL_TRACKS + 1):
            bam_offset = OFF_TO_BAM + ((track - 1) * 4)
            free_count = 0
            bitmap = [0, 0, 0]
            for sector in range(SECTORS_PER_TRACK):
                block = (track - 1) * SECTORS_PER_TRACK + sector
                if not self.used[block]:
                    free_count += 1
                    bitmap[sector >> 3] |= 1 << (sector & 7)
            header[bam_offset] = free_count
            header[bam_offset + 1 : bam_offset + 4] = bytes(bitmap)

        header[OFF_DISK_NAME : OFF_DISK_NAME + 16] = pad_a0(self.disk_name, 16)
        header[OFF_OP_TR_SC : OFF_OP_TR_SC + 2] = bytes(ts_from_block(self._first_free_hint()))
        header[OFF_GS_ID : OFF_GS_ID + len(GEOS_ID)] = GEOS_ID
        self.blocks[DIR_HEADER_BLOCK][:] = header

    def _first_free_hint(self) -> int:
        for track in list(range(DIR_TRACK + 1, LOGICAL_TRACKS + 1)) + list(range(1, DIR_TRACK)):
            for sector in range(SECTORS_PER_TRACK):
                block = (track - 1) * SECTORS_PER_TRACK + sector
                if not self.used[block]:
                    return block
        return DIR_FIRST_BLOCK

    def build(self) -> bytes:
        self._build_directory_chain()
        self._build_dir_header()

        atr = bytearray(ATR_HEADER_SIZE + ATR_DATA_SIZE)
        paragraphs = ATR_DATA_SIZE // 16
        atr[0] = 0x96
        atr[1] = 0x02
        atr[2] = paragraphs & 0xFF
        atr[3] = (paragraphs >> 8) & 0xFF
        atr[4] = ATR_SECTOR_SIZE & 0xFF
        atr[5] = (ATR_SECTOR_SIZE >> 8) & 0xFF

        offset = ATR_HEADER_SIZE
        for block in self.blocks:
            atr[offset : offset + ATR_SECTOR_SIZE] = block[:ATR_SECTOR_SIZE]
            offset += ATR_SECTOR_SIZE
            atr[offset : offset + ATR_SECTOR_SIZE] = block[ATR_SECTOR_SIZE:]
            offset += ATR_SECTOR_SIZE
        return bytes(atr)


def build_disk(output: Path, disk_name: str, cvt_paths: Iterable[Path]) -> None:
    disk = AtariGeosDisk(disk_name)
    for path in cvt_paths:
        disk.add_cvt(CvtFile.parse(path))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(disk.build())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Output ATR image path")
    parser.add_argument("cvt_files", type=Path, nargs="*", help="GEOS Convert v2.5 .cvt files to add")
    parser.add_argument("--disk-name", default="GEOSXL", help="GEOS disk name (max 16 chars)")
    args = parser.parse_args()

    build_disk(args.output, args.disk_name, args.cvt_files)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
