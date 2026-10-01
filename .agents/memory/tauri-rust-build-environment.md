---
name: Tauri Rust build environment
description: Toolchain and native linker constraints for compiling the Tauri pharmacy app in this Replit container.
---

Use Rust 1.90.0 as the default toolchain for this project. Rust 1.98.1 failed to start here with `cannot allocate memory in static TLS block`.

Some shells can report the `rust-stable` module as installed while `rustup` has no installed or default toolchain. If Cargo reports that no default is configured, install and select the pinned project version with `rustup toolchain install 1.90.0 --profile minimal && rustup default 1.90.0`.

The `zlib` system dependency can be present in the Nix store while Cargo test linking still fails to find `-lz`. Run linked Rust tests with `LIBRARY_PATH="$(pkg-config --variable=libdir zlib)"` set for the command. `cargo check` does not link the test harness and can pass without that setting.

**Why:** The compiler startup failure, missing rustup selection, and Nix linker search-path gap are container-specific, not source-code errors; repeating a normal dependency install may not fix them.

**How to apply:** Keep the project on Rust 1.90 in this environment. Confirm `rustc --version` before building; use ordinary `cargo check`; when running `cargo test`, include the `LIBRARY_PATH` derived from `pkg-config`.