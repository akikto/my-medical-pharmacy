---
name: Supplier ledger migration
description: Preserve supplier balances when importing historical invoices into a new ledger.
---

When backfilling historical purchase debits, add an opening adjustment for the difference between the imported invoice total and the supplier's existing balance. Link imported purchase entries to their purchase records. The resulting ledger net should equal the legacy balance.

**Why:** Old databases may have payments or other balance changes that are not represented by invoice rows; adding invoice debits on top of the stored balance can change the amount owed.

**How to apply:** Before migrating legacy supplier accounts, snapshot each stored balance, import invoice entries, and reconcile the ledger to that balance rather than assuming invoices fully explain it.