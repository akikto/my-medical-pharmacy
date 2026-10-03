---
name: GST calculation parity
description: Keep GST shown during checkout aligned with authoritative invoice tax snapshots.
---

GST is calculated independently in the TypeScript checkout preview and the Rust native checkout. Keep both paths aligned on integer-paise arithmetic, rate precedence, discount allocation, inclusive/exclusive rounding, and local versus interstate tax splits. Do not introduce a numeric default rate unless the user supplies one.

**Why:** The renderer shows the live payable amount, while the native transaction persists the invoice and receipt totals. Any calculation drift would leave the customer-facing total inconsistent with the saved sale.

**How to apply:** When changing GST calculations, update both implementations and verify stored sale snapshots with native checkout tests.