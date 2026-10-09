---
name: Paid plan change expiry
description: Integrity rules for paid primary plan changes and capture-time source validation.
---

A paid primary-plan upgrade charges only the server-calculated remaining-term difference in the target currency and starts immediately after verified capture, retaining the exact source expiry. Capture must reject when the source plan has expired or its expiry changed after checkout; do not grant a replacement term or derive a new end date. Paid lower-limit changes charge the full target price and start exactly at the active source plan's expiry; capture must confirm that same source is still active and its expiry is unchanged before scheduling. An already-expired source at checkout is a full-price purchase, and a cross-currency change is scheduled at the full target price rather than prorated.

When Razorpay confirms capture but the package or source-plan checks fail, record the payment as captured and require support review without activating a subscription. Do not leave the payment unsettled by throwing from the shared capture handler; webhook retries cannot repair stale checkout state.

**Why:** Upgrade pricing depends on the source plan's unused term, while scheduled changes depend on its exact expiry. A source change after checkout can otherwise undercharge or grant access on the wrong schedule. Once Razorpay has captured funds, leaving a stale payment unsettled causes repeated webhook retries without making it activatable.

**How to apply:** Preserve the order-time source ID and expiry for paid primary plan changes, then compare them with the locked, still-active source subscription during capture. Treat expired subscriptions and currency mismatches as non-prorated plan changes. Use the shared capture handler for verification and webhook settlement so stale confirmed charges consistently become captured payments requiring review, with no new subscription.
