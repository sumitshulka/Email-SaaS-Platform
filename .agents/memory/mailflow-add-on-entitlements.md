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

Superadmin may gift add-on allowances only when the recipient has an active paid-priced primary package. The primary may have been purchased or gifted by an administrator; a free primary does not qualify. Gifts add allowance records without creating payment or revenue records.

**Why:** the product owner explicitly confirmed that admin-gifted paid plans count for add-on gifts, while free plans remain ineligible.

**How to apply:** check the active primary package and its configured price at gift time; keep admin-gifted add-on balances additive and under the same pause/resume lifecycle as other add-on entitlements.

Partial refunds to paid add-ons reduce each allowance in proportion to the amount retained, rounding down each whole-unit allowance independently. Persist cumulative refunds monotonically so later refunds recalculate against the original charge. Keep consumed usage as history; remaining balances cannot go below zero. Free add-ons are unaffected.

**Why:** paid add-on value and usable units should change together, including across multiple partial refunds, without trying to reverse usage that already happened.

**How to apply:** use the same prorated entitlement calculation for research, AI-assist, and mailbox limits in dashboard and enforcement paths. Treat full refunds as zero usable paid allowance.

AI Email Assist reservation recovery must wait for the greater of its 15-minute minimum and the provider request timeout plus a 60-second settle grace. Keep regression tests tied to the provider timeout and simulate a provider timeout above the minimum; the current shorter provider timeout is otherwise masked by the minimum.

**Why:** a test using only today's shorter provider timeout cannot catch a future change that makes the recovery threshold shorter than a long-running request.

**How to apply:** have recovery and tests share the same effective-timeout calculation, then check both a real provider-window reservation and the case where the provider window exceeds the minimum.
