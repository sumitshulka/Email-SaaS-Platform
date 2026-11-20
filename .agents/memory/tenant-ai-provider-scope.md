---
name: Tenant AI provider scope
description: Which AI features may use customer-owned provider keys and which must remain platform-managed.
---

Tenant-owned AI keys apply only to private, tenant-scoped features such as campaign drafting and contact buying-intent analysis. When an active package enables tenant-owned AI, those actions must use only the tenant's configured provider; a missing, invalid, or failing tenant configuration must never fall back to platform AI. Shared Company Intelligence research remains platform-managed.

**Why:** Shared company research creates reusable global results available to multiple accounts; charging one tenant's provider key for that shared work would make usage costs unfair and ambiguous. For private AI actions, platform fallback on a tenant-key package could unexpectedly use platform resources instead of the provider the package and tenant selected.

**How to apply:** Route future tenant-specific AI calls through the tenant provider resolver and preserve package limits. A package without the tenant-key entitlement may use platform AI; a package with it must require a usable tenant configuration. On public pricing, list BYOK-enabled packages only in their separately headed section (default heading: “Bring Your Own AI Plans”), configurable from Superadmin → Packages. Keep global/shared research on the platform provider unless the user changes this policy.
