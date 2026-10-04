---
name: Gmail mailbox replacement
description: Safety rules for replacing an existing Gmail mailbox through OAuth.
---

When a saved Gmail mailbox exists, a replacement that fails identity verification must not trigger Google token revocation. The new token cannot be trusted to identify a separate grant, so revoking it could revoke access for the saved mailbox. Keep the existing mailbox record and encrypted refresh token unchanged.

**Why:** Google grants may overlap across OAuth authorizations, and the identity check that would establish which mailbox is being replaced has failed.

**How to apply:** In Gmail OAuth callback failure paths, preserve the prior connection and avoid revocation unless identity is verified and it is safe to distinguish the grant.