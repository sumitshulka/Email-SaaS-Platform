---
name: Payment capture timestamps
description: Reliable capture timestamps in Mailflow's Razorpay payment ledger.
---

Use the linked subscription's `createdAt` as the capture timestamp when available; fall back to the payment row's `updatedAt` only for incomplete legacy records.

**Why:** `payments.updatedAt` can change during unrelated updates, such as backfilling the Razorpay environment, and would move the apparent capture time.

**How to apply:** Finance reports and capture-date filters should anchor to subscription creation time, use UTC date boundaries, and recognize the fallback is less precise.