---
name: Gmail sync diagnostic privacy
description: Privacy and outcome rules for user-visible Gmail mailbox sync diagnostics.
---

Persist only fixed outcome categories and aggregate counts. Never include message bodies, raw provider responses, recipient addresses, credentials, or other provider payload details. Distinguish Gmail API/history failures from empty results and from parser or matching outcomes; use null counts when a sync fails before message totals are known.

**Why:** Users need to understand why a bounce notice was not added without exposing tenant email content or confusing a service failure with an empty mailbox result.

**How to apply:** Keep diagnostics tenant-scoped and update them for both background polling and user-triggered rescans. Test the serialized shape whenever sync status, support output, or retry guidance changes.
