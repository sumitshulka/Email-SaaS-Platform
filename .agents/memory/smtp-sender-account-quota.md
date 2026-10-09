---
name: SMTP sender account behavior
description: Campaign-level SMTP selection and subscription-slot scope.
---

Each campaign can select its own configured SMTP sender account, so different campaigns can use different accounts.

Package email-account limits count SMTP campaign sender connections only. Gmail OAuth and bounce-monitoring connections are outside this quota.

The platform-configured rolling hourly and 24-hour sending caps apply independently to each SMTP mailbox. Campaigns using the same mailbox share that mailbox's cap; separate mailboxes do not share a tenant-wide cap. Retries count as attempts.

ZeptoMail is available only as a superadmin-managed application/system SMTP provider, not as a user campaign sender. Zoho's published terms prohibit marketing campaigns, newsletters, and mass email through ZeptoMail.

For an MFA-protected Microsoft 365 mailbox, the user confirmed that an app password successfully passed Mailflow's password-based SMTP connection check after the regular account password failed. A successful web-portal login does not confirm SMTP AUTH access.

**Why:** the user explicitly praised separate SMTP account selection per campaign, chose SMTP-only package slots, clarified that each configured mailbox receives its own copy of the platform caps, approved ZeptoMail only for transactional system email, and confirmed the M365 app-password path worked.

**How to apply:** keep sender selection at the campaign level; enforce and display per-mailbox usage and package capacity in Email Setup, campaign sending, and package changes. Do not count Gmail OAuth or Microsoft 365 trace connections. When troubleshooting password-based M365 SMTP, an app password can work if the tenant allows it; it remains legacy SMTP authentication and is distinct from Microsoft 365 message-trace OAuth. Do not expose ZeptoMail in tenant campaign-provider contracts or UI.
