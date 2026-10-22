---
name: Inactivity lifecycle
description: Product decisions for manually managed inactivity notices, suspension, and delayed account removal.
---

Superadmins initiate eligibility checks and send warning or suspension notices from Accounts; do not add an automatic scheduler. Defaults are three months before warning, fifteen days before suspension review, and seven days before removal eligibility, all configurable in Platform Settings. Successful user sign-in resets an unsuspended warning cycle. Suspension disables access and revokes sessions. The later removal action must use the existing recoverable soft-delete behavior; permanent deletion is deferred.

**Why:** The product owner explicitly chose human review, recoverable deletion, and deferred permanent erasure.

**How to apply:** Preserve these lifecycle stages and timing defaults when changing account management, notice templates, or removal behavior.
