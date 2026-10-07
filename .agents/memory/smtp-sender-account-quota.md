---
name: SMTP sender account behavior
description: Campaign-level SMTP selection and subscription-slot scope.
---

Each campaign can select its own configured SMTP sender account, so different campaigns can use different accounts.

Package email-account limits count SMTP campaign sender connections only. Gmail OAuth and bounce-monitoring connections are outside this quota.

The platform-configured rolling hourly and 24-hour sending caps apply independently to each SMTP mailbox. Campaigns using the same mailbox share that mailbox's cap; separate mailboxes do not share a tenant-wide cap. Retries count as attempts.

**Why:** the user explicitly praised separate SMTP account selection per campaign, chose SMTP-only package slots, and clarified that each configured mailbox receives its own copy of the platform caps.

**How to apply:** keep sender selection at the campaign level; enforce and display per-mailbox usage and package capacity in Email Setup, campaign sending, and package changes. Do not count Gmail OAuth or Microsoft 365 trace connections.
