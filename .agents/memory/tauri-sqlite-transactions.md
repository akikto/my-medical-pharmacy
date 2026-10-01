---
name: Tauri SQLite transactions
description: Why multi-statement local SQLite writes need a native transaction bridge in the Tauri desktop app.
---

The JavaScript API of `@tauri-apps/plugin-sql` exposes `select` and `execute` operations over a connection pool but does not expose a transaction handle. Do not emulate a transaction by calling `BEGIN`, several `execute` calls, and `COMMIT`: the pool may run each call on a different SQLite connection.

Database location is part of the shared connection contract: `Database.load("sqlite:pharmacy.db")` resolves the file under Tauri's `AppConfigDir`. A native Rust connection that accesses the same database must open `app_config_dir()/pharmacy.db`; `app_data_dir()` is a different file.

**Why:** Stock changes and their related sale or purchase rows must commit or roll back together. Separate pooled calls cannot guarantee that boundary.

**Why:** If the JavaScript plugin and native commands use different base directories, migrations and reads can succeed against one database while checkout writes to another.

**How to apply:** Keep multi-statement write sets inside the app's native SQLite transaction command (or another API that pins one connection). Use the plugin's queries for ordinary reads and single-statement writes. When changing the database URL or Rust path, verify both resolve to the same absolute file.