---
name: Global company privacy
description: Product privacy and linking rules for Mailflow's superadmin-managed global company catalog
---

The global company catalog contains company profile data only. A customer company enters it only after the user explicitly chooses to share the profile; otherwise it remains tenant-private. Shared profiles are visible to superadmins and available for other workspaces to add. The catalog must not store or expose tenant contacts, contact identifiers, contact counts, notes, list membership, or engagement data. Each customer workspace owns its local company row and keeps its contacts private.

Global profiles are live-linked: superadmin profile edits update linked workspace company profiles, but never modify contact data. If a global entry is deleted, detach linked workspace rows while preserving each row's last profile snapshot and all tenant contact records and associations.

**Why:** The user requires contact data to remain private from superadmins and other tenants, and chose live-linked global profiles.

**How to apply:** Require explicit user consent before making a company profile global; keep global company endpoints and tables profile-only; propagate profile edits only to tenant-owned company rows; preserve workspace snapshots and contacts when removing a catalog entry.
