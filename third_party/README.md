# Third-Party Assets

This directory is intentionally kept small. Only project-relevant third-party
sources should live here; unpacked toolchains, local emulator installs, and build
artifacts should stay outside the repository.

## Tracked entries

- `A8E/`: git submodule used for the browser-based `jsA8E` smoke-test path.
- `Altirra-4.40-src/`: reference snapshot of the Altirra source tree. Keep only
  upstream source files here; generated `obj/`, `out/`, `lib/`, and similar local
  build output must remain untracked.
- `geos/`: upstream GEOS repository available as a git submodule for easy updates.
- `desktop-disassembly/`: upstream desktop-disassembly repo with the disassembly of the GEOS desktop build.
- `geos-desktop2.1-master/`: mirror of the GEOS desktop 2.1 build sources for analysis.

## Local tools

Use a normal system install for `ca65`/`ld65`, and keep local Altirra binaries or
portable installs outside this folder unless you explicitly need a temporary local
test setup.
