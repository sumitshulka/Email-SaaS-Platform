---
name: Campaign mailbox pacing
description: Mailflow's randomized campaign email spacing and its relationship to mailbox caps.
---

Every send through an SMTP mailbox, including sends from different campaigns using that mailbox, must be followed by a randomized 5–15 minute gap. Measure the gap from the prior send's completion; if an SMTP attempt is still pending, defer and recheck. The selected delay must be stable across worker retries, and retries continue to count as mailbox sends. Apply the stricter of this delay and the existing platform/package per-mailbox caps.

**Why:** The user requested randomized campaign timing to avoid a fixed send cadence; applying it per mailbox prevents simultaneous campaigns from bypassing the pacing.

**How to apply:** Keep worker claims serialized and ensure estimates account for the average gap. A stricter configured hourly/daily cap may legitimately delay the next message beyond 15 minutes.
