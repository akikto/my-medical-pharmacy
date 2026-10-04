---
name: Future-schema backup tests
description: How to keep backup rejection tests valid as database migrations advance.
---

Build a backup fixture at the currently supported schema version before marking it as a future schema. Add exactly `LATEST_DATABASE_VERSION + 1` so the migration history remains contiguous and the restore path reaches the newer-version guard.

**Why:** A hard-coded future version became the current version when a migration was added, so restore accepted it. Raising only the marker on an older fixture instead created an incomplete migration history.

**How to apply:** When adding or changing migrations, update future-backup tests to create a current-version fixture and derive the next version from the shared latest-version constant.