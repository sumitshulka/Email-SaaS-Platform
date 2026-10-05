---
name: Zero-priced package activation
description: Billing contract for customer-activated free subscription packages.
---

At most one zero-priced package may exist in the catalog, whether active or inactive. An active package priced at zero is activated directly by the customer, without a Razorpay order or payment record. It provides subscription access but is not payment revenue. The free term starts after any unexpired current term, and repeating activation of the same active or scheduled free package returns the existing subscription instead of granting another term.

**Why:** The user required a single zero-priced package and a free flow without Razorpay orders. Recording a payment would misstate revenue, and duplicate terms from repeated clicks would grant unintended access.

**How to apply:** Enforce the one-free-package limit for all catalog records in both the database and admin flow. Keep admin validation open to zero, route free selection to direct activation, and reject zero-price packages from paid order creation. Preserve term scheduling and never create a payment row for free access.
