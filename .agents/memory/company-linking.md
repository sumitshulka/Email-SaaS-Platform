---
name: Shared company linking
description: Product rules for converting legacy contact company details into tenant-scoped shared company records.
---

Automatically link legacy contact company profiles only when their normalized domains match. Never infer a relationship from company name alone. Leave incomplete or conflicting profiles unlinked and unchanged.

Manual unlinking restores the shared company profile to the contact's legacy fields and suppresses future automatic backfills from re-linking that contact. An explicit later link opts the contact back into the shared relationship.

From a company details page, offer only currently unlinked contacts for direct attachment. Moving a contact from another company must be a separate, explicit action.

**Why:** Domain-only matching avoids guessing between similarly named organizations. Preserving profile data on unlink prevents data loss, and not moving already-linked contacts implicitly protects existing relationships.

**How to apply:** Keep backfill rules, contact association behavior, and the Companies UI consistent with these constraints. Do not weaken matching to company names, silently replace conflicting values, or silently move an existing company link.