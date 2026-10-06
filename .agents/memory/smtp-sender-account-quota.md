---
name: SMTP sender account quota
description: The package email-account limit applies only to SMTP campaign sender accounts.
---

Package email-account limits count SMTP campaign sender connections only. Gmail OAuth and bounce-monitoring connections are outside this quota.

**Why:** the user selected “SMTP campaign senders only” for which connections consume a plan account slot.

**How to apply:** enforce and display plan capacity for SMTP senders in Email Setup, campaign sending, and package changes; do not count Gmail OAuth or Microsoft 365 trace connections.
