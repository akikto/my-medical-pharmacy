---
name: MY MEDICAL Phase 3 scope
description: User-stated preservation and data-access boundaries for purchase and supplier work.
---

For MY MEDICAL, the updated backup/integration Home and Dashboard are the intended final version. Keep the new Home options and Weekly Sales, preserve all existing Dashboard functionality, and do not revert Home to origin/main's older version. Do not add renderer SQL; database access must go through typed native commands.

**Why:** The user explicitly approved the updated backup/integration Home as the desired final version.

**How to apply:** Keep unrelated redesigns out of scope; retain the added order-list, customer-credit, expenses, and Weekly Sales paths alongside the existing Home behavior. Keep purchase/supplier changes within their screens, native services, schema, and related backup flows.

The user explicitly wants both stock-entry paths: optional opening stock while adding a medicine and the existing Purchases stock-in workflow.

**Why:** They chose to allow initial stock during medicine setup without replacing Purchases for later stock-in.

**How to apply:** Keep opening stock optional and batch-aware; do not remove or repurpose the Purchases stock-in flow.