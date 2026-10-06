---
name: SMTP sender account behavior
description: Campaign-level SMTP selection and subscription-slot scope.
---

Each campaign can select its own configured SMTP sender account, so different campaigns can use different accounts.

Package email-account limits count SMTP campaign sender connections only. Gmail OAuth and bounce-monitoring connections are outside this quota.

**Why:** the user explicitly praised separate SMTP account selection per campaign and chose to count SMTP campaign senders only toward package limits.

**How to apply:** keep sender selection at the campaign level; enforce and display package capacity for SMTP senders in Email Setup, campaign sending, and package changes. Do not count Gmail OAuth or Microsoft 365 trace connections.
