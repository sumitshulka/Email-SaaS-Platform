---
name: Shared company linking
description: Product rules for converting legacy contact company details into tenant-scoped shared company records.
---

Automatically link legacy contact company profiles only when their normalized domains match. Never infer a relationship from company name alone. Leave incomplete or conflicting profiles unlinked and unchanged.

Manual unlinking restores the shared company profile to the contact's legacy fields and suppresses future automatic backfills from re-linking that contact. An explicit later link opts the contact back into the shared relationship.

**Why:** Domain-only matching avoids guessing between similarly named organizations, while preserving the profile on unlink prevents data loss and honors the user's explicit choice.

**How to apply:** Keep backfill rules, contact association behavior, and the Companies UI consistent with these constraints. Do not weaken matching to company names or silently replace conflicting values.