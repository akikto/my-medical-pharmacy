---
name: MY MEDICAL Phase 3 scope
description: User-stated preservation and data-access boundaries for purchase and supplier work.
---

For MY MEDICAL Phase 3, keep Home and all completed Phase 1/2 behavior unchanged. Do not add renderer SQL; database access must go through typed native commands.

**Why:** The user made these boundaries authoritative for the pharmacy work.

**How to apply:** Keep purchase/supplier changes within their screens, native services, schema, and related backup flows. Avoid Home, checkout, and completed inventory behavior unless the user explicitly expands the scope.

The user explicitly wants both stock-entry paths: optional opening stock while adding a medicine and the existing Purchases stock-in workflow.

**Why:** They chose to allow initial stock during medicine setup without replacing Purchases for later stock-in.

**How to apply:** Keep opening stock optional and batch-aware; do not remove or repurpose the Purchases stock-in flow.