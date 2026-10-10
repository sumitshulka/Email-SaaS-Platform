---
name: Contact bounce consent
description: Mailflow's distinction between delivery bounces and recipient unsubscribe consent.
---

Keep `bounced` separate from `unsubscribed`: confirmed bounced addresses must be blocked from future sends, but a bounce is not an opt-out. An unsubscribe link click records `unsubscribed`.

**Why:** The user explicitly requires bounced contacts to be suppressed and shown as bounced, while reserving “unsubscribed” for a recipient who clicks the unsubscribe link.

**How to apply:** When processing confirmed bounce evidence, suppress queued/future deliveries and mark the contact bounced without overwriting an existing unsubscribe. Preserve the separate consent meaning in filters, status badges, exports, and future list changes.
