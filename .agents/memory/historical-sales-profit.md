---
name: Historical sales profit
description: Why report profit is based on purchase costs captured when sale lines are recorded and how to treat older sales.
---

Persist each sold item's purchase rate at checkout. Gross profit uses that immutable cost snapshot; invoices without complete snapshots are excluded from profit totals and explicitly counted as unavailable. Never backfill or estimate those invoices from the batch's current purchase rate.

**Why:** Restocking can update a batch's purchase rate after older units were sold, so using the latest rate would rewrite historical margins and produce misleading reports.

**How to apply:** Preserve sale-time cost in future sales, returns, and analytics. If a historical cost cannot be proven, report it as unavailable rather than substituting a current or average batch cost.