---
name: MY MEDICAL Phase 3 scope
description: User-stated preservation and data-access boundaries for purchase and supplier work.
---

For MY MEDICAL Phase 3, keep Home and all completed Phase 1/2 behavior unchanged. Do not add renderer SQL; database access must go through typed native commands.

**Why:** The user made these boundaries authoritative for the pharmacy work.

**How to apply:** Keep purchase/supplier changes within their screens, native services, schema, and related backup flows. Avoid Home, checkout, and completed inventory behavior unless the user explicitly expands the scope.