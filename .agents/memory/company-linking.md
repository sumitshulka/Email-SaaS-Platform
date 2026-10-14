---
name: Shared company linking
description: Product rules for converting legacy contact company details into tenant-scoped shared company records.
---

Automatically link legacy contact company profiles only when their normalized domains match. Never infer a relationship from company name alone. Leave incomplete or conflicting profiles unlinked and unchanged.

Manual unlinking restores the shared company profile to the contact's legacy fields and suppresses future automatic backfills from re-linking that contact. An explicit later link opts the contact back into the shared relationship.

From a company details page, offer only currently unlinked contacts for direct attachment. Moving a contact from another company must be a separate, explicit action.

When legacy company details conflict with a selected shared company, offer replacement after an explicit confirmation. Explain that confirming permanently removes the legacy profile and uses the selected shared company instead. Cancelling must leave both records unchanged.

For company creation and import, treat the same normalized website host/domain as a hard duplicate even when URL paths differ. Similar company names are warnings only; they never create or link records automatically. Let users explicitly approve a different company, and hold similar-name import rows for individual approval while unaffected rows proceed.

Company details must be role-specific: customer users see their workspace company and contact associations; superadmins see only the corresponding Global Company profile, never tenant contacts.

**Why:** The user chose confirmed replacement rather than permanently blocking links to a different company. Ordinary linking must still preserve legacy details or reject conflicts; the replacement decision must never be inferred from a normal contact save.

**Why:** Domain-only matching avoids guessing between similarly named organizations. Preserving profile data on unlink prevents data loss, and not moving already-linked contacts implicitly protects existing relationships.

**Why:** The user confirmed that URLs on the same host are duplicates, even when paths differ, and chose individual approval for similar-name rows during imports.

**Why:** The user specified that company details should work for the signed-in role: superadmins need the admin/global profile view, while regular users keep their workspace view.

**How to apply:** Keep backfill rules, contact association behavior, and the Companies UI consistent with these constraints. Do not weaken matching to company names, silently replace conflicting values, or silently move an existing company link. For company creation/import, enforce host duplicates independently of the fuzzy-name warning; never auto-link on a name match. Keep global detail responses free of tenant contact and campaign data.