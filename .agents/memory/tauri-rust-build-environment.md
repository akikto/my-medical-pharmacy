---
name: Tauri Rust build environment
description: Toolchain and native linker constraints for compiling the Tauri pharmacy app in this Replit container.
---

Use Rust 1.90.0 as the default toolchain for this project. Rust 1.98.1 failed to start here with `cannot allocate memory in static TLS block`.

The `zlib` system dependency can be present in the Nix store while Cargo test linking still fails to find `-lz`. Run linked Rust tests with `LIBRARY_PATH="$(pkg-config --variable=libdir zlib)"` set for the command. `cargo check` does not link the test harness and can pass without that setting.

**Why:** The compiler startup failure and Nix linker search-path gap are container-specific, not source-code errors; repeating a normal dependency install may not fix the linker invocation.

**How to apply:** Keep the project on Rust 1.90 in this environment. Use ordinary `cargo check`; when running `cargo test`, include the `LIBRARY_PATH` derived from `pkg-config`.