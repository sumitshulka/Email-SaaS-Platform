---
name: Tenant AI provider scope
description: Which AI features may use customer-owned provider keys and which must remain platform-managed.
---

Tenant-owned AI keys apply only to private, tenant-scoped features such as campaign drafting and contact buying-intent analysis. Shared Company Intelligence research remains platform-managed.

**Why:** Shared company research creates reusable global results available to multiple accounts; charging one tenant's provider key for that shared work would make usage costs unfair and ambiguous.

**How to apply:** Route future tenant-specific AI calls through the tenant provider resolver and preserve package limits. Keep global/shared research on the platform provider unless the user changes this policy.
