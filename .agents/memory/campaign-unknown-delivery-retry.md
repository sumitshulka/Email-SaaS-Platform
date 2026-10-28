---
name: Campaign unknown-delivery retry
description: Safe user-confirmed recovery for email attempts whose SMTP outcome cannot be confirmed.
---

Retry only recipients with an unknown outcome, after warning that some messages may already have been accepted and duplicates are possible. Preserve the old attempt history, re-queue through the ordinary worker, and never clear a campaign's paused state as part of retrying.

**Why:** The user approved explicit retry with the normal send path after deployment or worker interruptions, while recognizing uncertain SMTP acceptance.

**How to apply:** Keep retries tenant-scoped and conditional on current `unknown` recipient state; recheck normal campaign eligibility, pacing, and send limits in the worker.
