---
name: Zero-priced package activation
description: Billing contract for customer-activated free subscription packages.
---

An active package priced at zero is activated directly by the customer, without a Razorpay order or payment record. It provides subscription access but is not payment revenue. The free term starts after any unexpired current term, and repeating activation of the same active or scheduled free package returns the existing subscription instead of granting another term.

**Why:** The user required zero-price packages without the Razorpay order flow. Recording a payment would misstate revenue, and duplicate terms from repeated clicks would grant unintended access.

**How to apply:** Keep admin package validation open to zero, route free selection to direct activation, and reject zero-price packages from paid order creation. Preserve the existing term-scheduling rules and never create a payment row for free access.
