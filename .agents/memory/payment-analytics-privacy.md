---
name: Sanitized billing analytics
description: Privacy limits for payment-related custom analytics.
---

Payment lifecycle events use fixed names and no properties. SMTP sender setup and retention events may include aggregate account counts, the package sender-account limit, and a fixed outcome value only. Never include customer, payment, or package identifiers, email addresses, hostnames, credentials, free-form text, or payment details. Emit outcomes only after the corresponding server-confirmed success.

**Why:** Aggregate setup and retention metrics can inform package limits without exposing customer-level, sender-account, or transaction-level information.

**How to apply:** Keep payment lifecycle events property-free. For SMTP account analytics, allow only counts, the sender-account limit, and a fixed outcome enum; test exact arguments and ensure rejected operations are not recorded as successes.
