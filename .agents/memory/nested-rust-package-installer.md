---
name: Nested Rust package installer
description: Avoid root Cargo project pollution when installing Tauri dependencies in the pnpm monorepo.
---

From the workspace root, Replit's Rust package installer may run `cargo init .` and add a dependency to a new root Cargo package instead of the nested Tauri crate; the installer has no manifest-path argument.

**Why:** This monorepo keeps its Rust application below the workspace root, so a root-level install can create unrelated manifests, lockfiles, and source files.

**How to apply:** Install Rust dependencies only through a flow that explicitly targets the Tauri manifest. If the root installer has already run, inspect and remove only the generated root Cargo files before continuing.