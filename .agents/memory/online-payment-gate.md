---
name: Online payment availability
description: Default and boundaries of the superadmin-controlled payment switch.
---

The online-payment gate is enabled when no saved setting exists so existing checkout behavior remains intact. A superadmin can disable it to stop only new paid subscription orders. Free-plan activation stays available; previously created orders can still be verified and settled, and superadmin connection tests remain available.

**Why:** The setting controls whether customers can start new paid checkouts, not whether Mailflow can manage free plans, finish transactions already in flight, or diagnose credentials. A backward-compatible default avoids surprising paid users when the new setting has never been saved.

**How to apply:** Keep the server-side check authoritative on order creation. Treat gateway tests and verification/webhooks for existing orders as separate from new customer checkout availability. The user Plans page should show the active superadmin contact email and keep free packages usable.
