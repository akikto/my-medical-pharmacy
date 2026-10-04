---
name: Business reset stock preservation
description: The business-data reset must preserve current stock independently of cleared history.
---

Reset scopes may clear sales, purchases, stock adjustments, order-list history, and supplier balances as explicitly selected, but they must not recalculate or reset on-hand stock. Keep medicines, batches, supplier master records, settings, schema, and backups unless a separate authorized operation says otherwise. Create and validate a local backup first; abort before mutation if that fails.

**Why:** Independent stock adjustments make it unsafe to reconstruct on-hand quantities from sales or purchase history alone.

**How to apply:** Future data-reset or history-cleanup changes should preserve current stock, state this clearly before confirmation, and keep quantity changes in a separate audited inventory action.