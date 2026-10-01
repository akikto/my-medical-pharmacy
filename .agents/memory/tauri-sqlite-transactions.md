---
name: Tauri SQLite transactions
description: Why multi-statement local SQLite writes need a native transaction bridge in the Tauri desktop app.
---

The JavaScript API of `@tauri-apps/plugin-sql` exposes `select` and `execute` operations over a connection pool but does not expose a transaction handle. Do not emulate a transaction by calling `BEGIN`, several `execute` calls, and `COMMIT`: the pool may run each call on a different SQLite connection.

**Why:** Stock changes and their related sale or purchase rows must commit or roll back together. Separate pooled calls cannot guarantee that boundary.

**How to apply:** Keep multi-statement write sets inside the app's native SQLite transaction command (or another API that pins one connection). Use the plugin's queries for ordinary reads and single-statement writes.