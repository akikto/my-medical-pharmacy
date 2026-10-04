---
name: Tauri dialog reverse Tab
description: Linux Tauri/WebKit emits a distinct keyboard event for reverse Tab navigation.
---

In the Linux Tauri/WebKit session used for visual QA, Shift+Tab can arrive with `KeyboardEvent.key` set to `ISO_Left_Tab` rather than `Tab`. A dialog focus trap should treat `Tab` and `ISO_Left_Tab` as tab keys and treat either `shiftKey` or `ISO_Left_Tab` as reverse navigation.

**Why:** Checking only `key === "Tab"` left focus escaping at the start of dialogs during reverse navigation, while ordinary forward wrapping appeared correct.

**How to apply:** When implementing or adjusting dialog focus traps for this app, handle both keyboard event representations and verify reverse wrapping inside the real Tauri host on Linux.