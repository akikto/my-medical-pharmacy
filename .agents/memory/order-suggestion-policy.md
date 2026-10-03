---
name: Order suggestion policy
description: Deterministic restock quantity and scope for low-stock suggestions.
---

Order target stock is the greater of twice the medicine's reorder level or its units sold in the previous 30 days. Suggested additional quantity is the non-negative remainder after subtracting unexpired sellable stock and all pending order-list quantities. Fewer than seven distinct selling days in that period is marked as limited history. A suggestion only updates the local order list; it does not send an order or create a purchase invoice.

**Why:** The user requires suggestions to remain deterministic and to leave purchasing decisions as a separate manual action.

**How to apply:** Preserve this calculation and scope anywhere low-stock suggestions are shown or saved.