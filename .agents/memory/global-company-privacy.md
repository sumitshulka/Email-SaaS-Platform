---
name: Global company privacy
description: Product privacy and linking rules for Mailflow's superadmin-managed global company catalog
---

The global company catalog contains company profile data only. It must not store or expose tenant contacts, contact identifiers, contact counts, notes, list membership, or engagement data. Each customer workspace owns its local company row and keeps its contacts private.

Global profiles are live-linked: superadmin profile edits update linked workspace company profiles, but never modify contact data. If a global entry is deleted, detach linked workspace rows while preserving each row's last profile snapshot and all tenant contact records and associations.

User-side sharing of a private company into the global catalog is a later phase, not part of the current scope.

**Why:** The user requires contact data to remain private from superadmins and other tenants, and chose live-linked global profiles.

**How to apply:** Keep global company endpoints and tables profile-only; propagate profile edits only to tenant-owned company rows; preserve workspace snapshots and contacts when removing a catalog entry.
