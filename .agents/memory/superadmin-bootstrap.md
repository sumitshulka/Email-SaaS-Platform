---
name: Superadmin bootstrap decision
description: Project decision on the initial superadmin account and first-login credential rotation.
---

Keep the existing startup-seeded superadmin and forced first-login credential change as implemented.

**Why:** On 2026-10-07, the user said this is acceptable for the SaaS application because superadmin login is a one-time setup job.

**How to apply:** Do not replace or remove the current bootstrap flow solely because it uses a default initial credential; preserve the forced credential rotation.
