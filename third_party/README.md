# Third-Party Assets

This directory is intentionally kept small. Only project-relevant third-party
sources should live here; unpacked toolchains, local emulator installs, and build
artifacts should stay outside the repository.

## Tracked entries

- `A8E/`: git submodule used for the browser-based `jsA8E` smoke-test path.
- `Altirra-4.40-src/`: reference snapshot of the Altirra source tree. Keep only
  upstream source files here; generated `obj/`, `out/`, `lib/`, and similar local
  build output must remain untracked.

## Local tools

Use a normal system install for `ca65`/`ld65`, and keep local Altirra binaries or
portable installs outside this folder unless you explicitly need a temporary local
test setup.
