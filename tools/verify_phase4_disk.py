#!/usr/bin/env python3
"""Verify the Atari XL Phase 4 disk smoketest ATR contents."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


ATR_HEADER_SIZE = 16
BLOCK_SIZE = 256
SECTORS_PER_TRACK = 18
DIR_TRACK = 18
DIR_HEADER_BLOCK = (DIR_TRACK - 1) * SECTORS_PER_TRACK
DIR_FIRST_BLOCK = DIR_HEADER_BLOCK + 1
OFF_CFILE_TYPE = 0
OFF_DE_TR_SC = 1
OFF_FNAME = 3
OFF_GSTRUC_TYPE = 21
SEQUENTIAL = 0


def block_from_ts(track: int, sector: int) -> int:
    if track <= 0:
        raise ValueError(f"invalid track value: {track}")
    if sector >= SECTORS_PER_TRACK:
        raise ValueError(f"invalid sector value: {sector}")
    return (track - 1) * SECTORS_PER_TRACK + sector


def decode_name(raw: bytes) -> str:
    return raw.rstrip(b"\xA0").decode("ascii", "strict")


@dataclass
class DirEntry:
    name: str
    structure: int
    data_track: int
    data_sector: int


class AtariGeosImage:
    def __init__(self, image_path: Path) -> None:
        data = image_path.read_bytes()
        if len(data) < ATR_HEADER_SIZE + BLOCK_SIZE:
            raise ValueError(f"{image_path} is too small to be an ATR image")

        payload = data[ATR_HEADER_SIZE:]
        if len(payload) % BLOCK_SIZE != 0:
            raise ValueError(f"{image_path} payload length is not a multiple of {BLOCK_SIZE}")

        self.blocks = [
            payload[index : index + BLOCK_SIZE]
            for index in range(0, len(payload), BLOCK_SIZE)
        ]

    def read_block(self, block_index: int) -> bytes:
        return self.blocks[block_index]

    def iter_directory(self) -> list[DirEntry]:
        entries: list[DirEntry] = []
        block_index = DIR_FIRST_BLOCK
        while True:
            block = self.read_block(block_index)
            for offset in range(2, BLOCK_SIZE, 32):
                entry = block[offset : offset + 32]
                if entry[OFF_CFILE_TYPE] == 0:
                    continue
                entries.append(
                    DirEntry(
                        name=decode_name(entry[OFF_FNAME : OFF_FNAME + 16]),
                        structure=entry[OFF_GSTRUC_TYPE],
                        data_track=entry[OFF_DE_TR_SC],
                        data_sector=entry[OFF_DE_TR_SC + 1],
                    )
                )

            next_track = block[0]
            next_sector = block[1]
            if next_track == 0:
                break
            block_index = block_from_ts(next_track, next_sector)

        return entries

    def read_sequential_file(self, entry: DirEntry) -> bytes:
        if entry.structure != SEQUENTIAL:
            raise ValueError(f"{entry.name} is not a sequential GEOS file")

        data = bytearray()
        block_index = block_from_ts(entry.data_track, entry.data_sector)

        while True:
            block = self.read_block(block_index)
            next_track = block[0]
            next_sector = block[1]
            if next_track == 0:
                used = max(0, block[1] - 1)
                data.extend(block[2 : 2 + used])
                break

            data.extend(block[2:])
            block_index = block_from_ts(next_track, next_sector)

        return bytes(data)


def verify_phase4(image_path: Path) -> None:
    image = AtariGeosImage(image_path)
    entries = image.iter_directory()
    names = [entry.name for entry in entries]

    if "PH4TEST" not in names:
        raise SystemExit("PH4TEST is missing from the smoketest ATR")

    fill_entries = [entry for entry in entries if entry.name.startswith("PH4FIL")]
    if not fill_entries:
        raise SystemExit("no PH4FIL* fill files were written to the smoketest ATR")

    ph4test = next(entry for entry in entries if entry.name == "PH4TEST")
    payload = image.read_sequential_file(ph4test)
    expected = bytes(index & 0xFF for index in range(600))
    if payload != expected:
        raise SystemExit("PH4TEST payload does not match the expected 600-byte pattern")

    print(f"Verified {image_path}")
    print(f"Directory entries: {len(entries)}")
    print(f"Fill files: {len(fill_entries)}")
    print("PH4TEST payload matches expected data")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="ATR image written by the Phase 4 smoketest")
    args = parser.parse_args()
    verify_phase4(args.image)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
