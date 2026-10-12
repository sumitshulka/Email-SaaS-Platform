---
name: Contact email verification
description: User-approved scope and limits for checking a contact address without sending messages.
---

Offer verification only for an individually selected contact. The no-message SMTP probe may issue `MAIL FROM` and `RCPT TO` checks but must stop before `DATA`; it must not send email. Compare the stored address with a random recipient to identify some catch-all servers. Treat accepted/rejected replies as best-effort evidence, not proof of inbox delivery or future sendability. A no-reply-style local part is only a heuristic; actual reply behavior cannot be verified without sending.

**Why:** The user requested contact-level verification without actual emails and approved a per-contact SMTP probe after being informed that catch-all and privacy-protecting servers can make existence inconclusive.

**How to apply:** Do not add this to contact imports or bulk actions. Keep inconclusive and catch-all outcomes explicit; never change subscription, bounce, or unsubscribe status based on a probe. Detect provider from MX records and probe its advertised hosts without requesting mailbox-directory permissions. The user chose consent-free checks; do not add Microsoft Graph directory scopes unless they explicitly revisit that choice.
