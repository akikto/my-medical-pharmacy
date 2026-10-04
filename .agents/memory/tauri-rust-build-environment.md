---
name: Tauri Rust build environment
description: Rust, native GTK dialog, linker, and Linux bundle constraints for the Tauri pharmacy app in this Replit container.
---

Use Rust 1.90.0 as the default toolchain for this project. Rust 1.98.1 failed to start here with `cannot allocate memory in static TLS block`.

Rust 1.90.0 may be installed without its `rustfmt` component. If `cargo fmt` reports that `cargo-fmt` is missing, install it with `rustup component add rustfmt --toolchain 1.90.0` to keep the pinned compiler version.

**Why:** The pinned compiler can be usable even when optional tools are missing.

**How to apply:** Install only the `rustfmt` component if formatting checks require it; do not change the project’s pinned compiler version.

Shell executions may not share `rustup` state: a toolchain installed or selected in one invocation can be absent/defaultless in another. When Cargo metadata reports no selected toolchain, prefix the command with `RUSTUP_TOOLCHAIN=1.90.0`; this materializes and selects the pinned version for that invocation.

**Why:** Rust 1.90.0 worked in one shell, but a later Tauri build shell had no default and could not run `cargo metadata`; explicitly selecting the pinned toolchain made the package build succeed.

**How to apply:** Prefix Rust and Tauri build commands with `RUSTUP_TOOLCHAIN=1.90.0` when a shell reports no installed/default toolchain. Do not switch to latest stable.

The `zlib` system dependency can be present in the Nix store while Cargo test linking still fails to find `-lz`. Run linked Rust tests with `LIBRARY_PATH="$(pkg-config --variable=libdir zlib)"` set for the command. `cargo check` does not link the test harness and can pass without that setting.

For a Linux Debian bundle, run `cd apps/medicine-inventory-pos && LIBRARY_PATH="$(pkg-config --variable=libdir zlib)" pnpm exec tauri build --bundles deb`. Do not use `pnpm run tauri:build -- --bundles deb`: the extra separator is forwarded through Tauri to Cargo instead of setting Tauri's bundle option.

GTK native file dialogs in the Replit Linux container need GTK3 and desktop schemas plus `hicolor-icon-theme` and `adwaita-icon-theme`. Nix keeps GTK and desktop schemas in package-specific directories under `share/gsettings-schemas/.../glib-2.0/schemas`; merge all `*.xml` files (including companion enum XML, not just `*.gschema.xml`) from the GTK3 and desktop schema directories into a writable temporary directory, then run `glib-compile-schemas --strict` so `org.gtk.Settings.FileChooser` is available. Use that directory as `GSETTINGS_SCHEMA_DIR` with `GSETTINGS_BACKEND=memory`, and include the icon-theme package `share` paths in `XDG_DATA_DIRS` when needed.

The default VNC display is 800x600 while the Tauri window may remain 1440x960, clipping screenshots. Temporarily increase the display to 1280x960 for full UI inspection, then restore its original mode.

For close-hook tests, send the window manager's normal Alt+F4 close request. `xdotool windowclose` can destroy the X window without reaching Tauri's `CloseRequested` handler.

**Why:** The compiler startup failure, missing rustup selection, and Nix linker search-path gap are container-specific, not source-code errors; GTK enum definitions are separate XML files, the display-size mismatch clips the app without changing its layout, and direct X window destruction skipped the app's close event.

**How to apply:** Keep the project on Rust 1.90 in this environment. Confirm `rustc --version` before building; use ordinary `cargo check`; when running `cargo test` or producing a Linux bundle, include the `LIBRARY_PATH` derived from `pkg-config`. For native dialog tests, copy all XML files from GTK and desktop schema directories before strict compilation, set the schema and icon-theme environment, and close with Alt+F4. For full-window visual checks, temporarily set VNC to 1280x960 and restore the original mode afterward.