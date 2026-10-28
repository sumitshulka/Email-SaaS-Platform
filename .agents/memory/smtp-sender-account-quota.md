---
name: SMTP sender account behavior
description: Campaign-level SMTP selection and subscription-slot scope.
---

Each campaign can select its own configured SMTP sender account, so different campaigns can use different accounts.

Package email-account limits count SMTP campaign sender connections only. Gmail OAuth and bounce-monitoring connections are outside this quota.

The platform-configured rolling hourly and 24-hour sending caps apply independently to each SMTP mailbox. Campaigns using the same mailbox share that mailbox's cap; separate mailboxes do not share a tenant-wide cap. Retries count as attempts.

ZeptoMail is available only as a superadmin-managed application/system SMTP provider, not as a user campaign sender. Zoho's published terms prohibit marketing campaigns, newsletters, and mass email through ZeptoMail.

For an MFA-protected Microsoft 365 mailbox, the user confirmed that an app password successfully passed Mailflow's password-based SMTP connection check after the regular account password failed. A successful web-portal login does not confirm SMTP AUTH access.

For Microsoft 365 onboarding, use the mailbox password first, suggest an app password only if allowed, then offer Microsoft sign-in. Microsoft sign-in must use application-wide setup, not require administrator configuration for every attempt.

**Why:** the user explicitly requested this order and one generic application-level Microsoft sign-in setup.

**How to apply:** preserve user-initiated fallback steps and explain organization-policy restrictions rather than promising that a correct password alone guarantees SMTP access.

Campaign `Reply-To` must always match the configured sender mailbox (`From` address), so replies return to the inbox being monitored.

**Why:** the user explicitly praised separate SMTP account selection per campaign, chose SMTP-only package slots, clarified that each configured mailbox receives its own copy of the platform caps, approved ZeptoMail only for transactional system email, confirmed the M365 app-password path worked, and required replies to return to the sending mailbox.

**How to apply:** keep sender selection at the campaign level; enforce and display per-mailbox usage and package capacity in Email Setup, campaign sending, and package changes. Set campaign `Reply-To` to the selected sender's `From` address. Do not count Gmail OAuth or Microsoft 365 trace connections. When troubleshooting password-based M365 SMTP, an app password can work if the tenant allows it; it remains legacy SMTP authentication and is distinct from Microsoft 365 message-trace OAuth. Do not expose ZeptoMail in tenant campaign-provider contracts or UI.
