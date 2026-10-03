---
name: Financial report SQL testing
description: Tests needed to catch runtime-only SQL column-index mismatches.
---

Report aggregation queries that rely on numeric database column indexes need SQLite-backed fixtures for empty and populated ranges; Rust compilation cannot validate those indexes.

**Why:** A purchase-summary column index mismatch passed compilation and failed only when the report query ran.

**How to apply:** When changing native report SQL, exercise it against the current schema with representative transactions and assert the returned totals.
