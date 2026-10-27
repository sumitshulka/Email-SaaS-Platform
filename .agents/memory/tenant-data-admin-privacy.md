---
name: Tenant data in superadmin views
description: Superadmin account views must not expose tenant-owned contact records or campaign details.
---

Superadmin account screens may show aggregate account metrics such as contact and completed-campaign counts, but must not expose tenant-owned contact records or campaign details. Keep record-level data available only through the owning tenant's UI and APIs unless the user explicitly changes this rule.

**Why:** The user stated that private user data should not be visible in the UI, including to admins.

**How to apply:** Prefer aggregate counts for cross-account monitoring. Do not add superadmin detail dialogs, record links, or detail APIs that return tenant-owned contact or campaign content.
