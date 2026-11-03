---
name: Zero-priced package activation
description: Billing contract for zero-priced primary subscription activation and automatic expiry renewal.
---

At most one zero-priced package may exist in the catalog, whether active or inactive. An active package priced at zero is activated directly by the customer, without a Razorpay order or payment record. It provides subscription access but is not payment revenue. The free term starts after any unexpired current term, and repeating activation of the same active or scheduled free package returns the existing subscription instead of granting another term.

When a user's active zero-priced primary term expires, renew it automatically with a recurring API worker, independent of user login. The login path should also renew immediately when needed. Catch up every missed term as a separate subscription revision, with each new `startsAt` equal to the preceding term's `endsAt`; do not reset the term to the worker or login time. Free renewals never create payments, and paid plans remain non-renewing.

**Why:** A single zero-priced package and a direct activation flow avoid misrepresenting free access as revenue or creating duplicate terms. The user now requires free packages to renew automatically at expiry; login-only renewal would leave expired terms unchanged for users who do not sign in.

**How to apply:** Enforce the one-free-package limit for all catalog records in both the database and admin flow. Keep admin validation open to zero, route free selection to direct activation, and reject zero-price packages from paid order creation. Run the expiry-renewal worker from the API service and retain login-time catch-up for immediate access. Preserve expiry-based starts, lock per user to avoid duplicate renewals across API instances, and never create a payment row for free access.
