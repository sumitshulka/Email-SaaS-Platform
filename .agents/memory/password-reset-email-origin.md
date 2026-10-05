---
name: Password reset email origin
description: The required sender and public origin for Mailflow password recovery emails.
---

Password recovery emails must use the superadmin-managed application email SMTP configuration, not support email or a tenant campaign sender. Build reset links from the currently hosted application origin rather than a hardcoded Replit or development domain.

**Why:** The user specified these requirements for Mailflow.

**How to apply:** Preserve them when changing password-reset email delivery, link generation, or production setup.
