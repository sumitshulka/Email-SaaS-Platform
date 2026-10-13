---
name: Gift subscription semantics
description: Product contract for superadmin subscription grants and their billing treatment.
---

Only superadmins can grant an existing subscription package to tenant accounts. The grant must produce the same active subscription access and recipient-facing state as a captured purchase; do not expose a gift marker to the recipient.

Use the package's configured period. A Primary gift replaces an active Free Primary term immediately; an active paid Primary term runs to its end before the gift starts. With no active term, the gift starts immediately. A grant is not a payment, so do not create payment records or count gift value as revenue. Keep an internal audit record of the superadmin action.

**Why:** The user explicitly required immediate admin-gift access for Free-plan recipients while preserving the paid term for paid subscribers; a fabricated capture would overstate cash revenue.

**How to apply:** Preserve this timing distinction when changing billing UI, entitlement checks, finance reporting, or future subscription management.