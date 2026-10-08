---
name: Mailflow add-on entitlement lifecycle
description: Business rules for add-on eligibility, usage, and resuming allowances after a primary subscription expires.
---

Add-ons require an active paid primary subscription; a free primary does not qualify. A free add-on activates directly without payment processing, but only for an eligible paid-primary subscriber.

Add-on entitlements persist independently of the primary subscription term. When the primary expires or the user is on a free primary, add-on credits and mailbox slots become inactive but are not forfeited. Unused allowances resume when the user next has an active paid primary. Do not reset or expire add-on balances at primary renewal.

Additional SMTP slots augment the primary package's mailbox count. Sending caps remain independent per configured mailbox; add-on slots do not pool hourly or daily caps.

AI Email Assist credits are consumed only after a successful, validated draft. Release a reservation when generation fails or the returned draft is invalid.

**Why:** the product owner explicitly chose suspension without forfeiture so remaining allowances are available again after re-subscribing.

**How to apply:** gate add-on purchase and use on an active paid primary, preserve entitlement snapshots and usage across terms, and resume only unused balances when paid access returns.
