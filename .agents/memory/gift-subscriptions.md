---
name: Gift subscription semantics
description: Product contract for superadmin subscription grants and their billing treatment.
---

Only superadmins can grant an existing subscription package to tenant accounts. The grant must produce the same active subscription access and recipient-facing state as a captured purchase; do not expose a gift marker to the recipient.

Use the package's configured period. If an active subscription term is unexpired, the gift starts at its end; otherwise it starts immediately. A grant is not a payment, so do not create payment records or count gift value as revenue. Keep an internal audit record of the superadmin action.

**Why:** The user explicitly required identical paid access for recipients; a fabricated capture would overstate cash revenue.

**How to apply:** Preserve this boundary when changing billing UI, entitlement checks, finance reporting, or future subscription management.