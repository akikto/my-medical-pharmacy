---
name: Tauri browser preview limitation
description: Browser-only previews cannot exercise the pharmacy app's Tauri SQL bridge.
---

Opening the Vite frontend in ordinary Chromium does not provide the native Tauri bridge. Calls through the SQL plugin therefore fail before data-backed screens can render; this is a preview-environment limitation, not evidence that the local database or dashboard is broken.

**Why:** The app's local database access is supplied by the native Tauri host, which standard browser previews do not provide.

**How to apply:** Validate data-backed UI inside the Tauri host with its local database, or use an explicit isolated test harness. Do not change the product's data path just to make a browser-only preview work.