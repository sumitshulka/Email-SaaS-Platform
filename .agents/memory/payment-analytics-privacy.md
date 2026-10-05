---
name: Sanitized billing analytics
description: Privacy limits for payment-related custom analytics.
---

Payment-related custom events use fixed names and no properties. Never include customer, payment, or package identifiers, free-form provider messages, or payment details. Track lifecycle outcomes separately, and emit activation only after server-confirmed success.

**Why:** Aggregate payment diagnostics should not expose customer-level or transaction-level information.

**How to apply:** When adding billing analytics, route fixed outcomes through a helper that cannot accept metadata, and test exact event arguments plus the absence of activation events for non-success outcomes.
