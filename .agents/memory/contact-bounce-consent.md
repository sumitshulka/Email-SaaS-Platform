---
name: Contact bounce consent
description: Mailflow's distinction between delivery bounces and recipient unsubscribe consent.
---

Keep `bounced` separate from `unsubscribed`: confirmed bounced addresses must be blocked from future sends, but a bounce is not an opt-out. An unsubscribe link click records `unsubscribed`. Account owners may also explicitly change subscription status, including in bulk; resubscribing requires confirmed permission and must not clear an unchanged bounced address.

Delivery reports apply to the recipient-address snapshot on the campaign row. Suppress queued rows for the bounced address only; a late report about an old address must not block campaigns queued to a corrected address.

**Why:** The user requires bounced contacts to be suppressed and shown as bounced, not treated as recipient opt-outs. They also explicitly requested owner-controlled bulk subscribed/unsubscribed changes.

**How to apply:** When processing confirmed bounce evidence, match suppression to the recipient's saved email as well as contact and tenant. Update the contact only when its current email still matches the bounced address, without overwriting an existing unsubscribe. Preserve the separate consent meaning in filters, status badges, exports, and future list changes.
