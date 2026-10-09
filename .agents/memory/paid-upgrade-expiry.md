---
name: Paid plan upgrade expiry
description: Integrity rules for paid primary upgrades and capture-time source validation.
---

A paid primary-plan upgrade charges only the server-calculated remaining-term difference in the target currency and starts immediately after verified capture, retaining the exact source expiry. Capture must reject when the source plan has expired or its expiry changed after checkout; do not grant a replacement term or derive a new end date. An already-expired source at checkout is a full-price purchase, and a cross-currency change is scheduled at the full target price rather than prorated.

**Why:** The upgrade amount is calculated against the source plan's unused term. Extending or changing that term after checkout can undercharge or grant unintended access.

**How to apply:** Preserve the order-time source expiry as part of the upgrade payment record and compare it with the locked source subscription during capture. Treat expired subscriptions and currency mismatches as non-prorated plan changes.
