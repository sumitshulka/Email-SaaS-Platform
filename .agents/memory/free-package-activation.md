---
name: Zero-priced package activation
description: Billing contract for zero-priced primary subscription activation and login-time renewal.
---

At most one zero-priced package may exist in the catalog, whether active or inactive. An active package priced at zero is activated directly by the customer, without a Razorpay order or payment record. It provides subscription access but is not payment revenue. The free term starts after any unexpired current term, and repeating activation of the same active or scheduled free package returns the existing subscription instead of granting another term.

When a user's active zero-priced primary term has expired, renew it on successful login, not through a scheduler. Catch up every missed term as a separate subscription revision, with each new `startsAt` equal to the preceding term's `endsAt`; do not reset the activation date to login time.

**Why:** A single zero-priced package and a direct activation flow avoid misrepresenting free access as revenue or creating duplicate terms. The user also specified login-time catch-up and expiry-chained revisions for missed free-plan renewals.

**How to apply:** Enforce the one-free-package limit for all catalog records in both the database and admin flow. Keep admin validation open to zero, route free selection to direct activation, and reject zero-price packages from paid order creation. Renew expired free primary access during login with one revision per missed period, preserve expiry-based starts, and never create a payment row for free access.
