---
name: Campaign audience exclusions
description: Campaign audience behavior while drafts use live contact-list membership.
---

Campaign drafts keep selected lists live until queueing. Contact-level deselections are stored as exclusions; bounced and unsubscribed contacts remain visible in review but cannot be included. Recheck eligibility and suppression when queueing so a status change after draft editing cannot make an ineligible recipient sendable.

**Why:** The user chose live list membership with explicit exclusions so newly added list contacts can join a draft audience without restoring contacts the user intentionally deselected.

**How to apply:** When changing campaign audience selection or queue logic, preserve live list membership, apply the exclusions before recipient deduplication, and revalidate current contact status at the queue boundary.
