---
name: Tauri Rust build environment
description: Rust, native GTK dialog, linker, and Linux bundle constraints for the Tauri pharmacy app in this Replit container.
---

Use Rust 1.90.0 as the default toolchain for this project. Rust 1.98.1 failed to start here with `cannot allocate memory in static TLS block`.

Some shells can report the `rust-stable` module as installed while `rustup` has no installed or default toolchain. If Cargo reports that no default is configured, install and select the pinned project version with `rustup toolchain install 1.90.0 --profile minimal && rustup default 1.90.0`.

The `zlib` system dependency can be present in the Nix store while Cargo test linking still fails to find `-lz`. Run linked Rust tests with `LIBRARY_PATH="$(pkg-config --variable=libdir zlib)"` set for the command. `cargo check` does not link the test harness and can pass without that setting.

For a Linux Debian bundle, run `cd apps/medicine-inventory-pos && LIBRARY_PATH="$(pkg-config --variable=libdir zlib)" pnpm exec tauri build --bundles deb`. Do not use `pnpm run tauri:build -- --bundles deb`: the extra separator is forwarded through Tauri to Cargo instead of setting Tauri's bundle option.

GTK native file dialogs in the Replit Linux container need `gsettings-desktop-schemas`, `hicolor-icon-theme`, and `adwaita-icon-theme`. Nix keeps GTK and desktop schemas in package-specific directories under `share/gsettings-schemas/.../glib-2.0/schemas`; combining both packages' XML files into a temporary directory and running `glib-compile-schemas --strict` makes `org.gtk.Settings.FileChooser` available. Use that merged directory as `GSETTINGS_SCHEMA_DIR` with `GSETTINGS_BACKEND=memory` for the smoke-test process.

For close-hook tests, send the window manager's normal Alt+F4 close request. `xdotool windowclose` can destroy the X window without reaching Tauri's `CloseRequested` handler.

**Why:** The compiler startup failure, missing rustup selection, and Nix linker search-path gap are container-specific, not source-code errors; the file chooser also requires schemas that are split across Nix packages, and direct X window destruction skipped the app's close event.

**How to apply:** Keep the project on Rust 1.90 in this environment. Confirm `rustc --version` before building; use ordinary `cargo check`; when running `cargo test` or producing a Linux bundle, include the `LIBRARY_PATH` derived from `pkg-config`. For native dialog tests, merge GTK and desktop schemas first and close with Alt+F4.