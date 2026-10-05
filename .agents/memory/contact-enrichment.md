---
name: Contact enrichment scope
description: Project scope for professional, company, social, and CRM contact enrichment.
---

Keep contact enrichment business-focused. Social and profile URLs must appear as complete visible plain text, not hidden behind icons or links. Do not add personal street addresses or inferred sensitive traits.

**Why:** The contact data should support future AI controls without collecting sensitive personal information.

**How to apply:** When extending contact enrichment fields and pages, preserve full URL visibility and keep added data professional, company, social, or CRM-focused.

Tenant-managed master values apply to exactly Lifecycle Stage, Lead Status, Lead Source, Job Title, and Preferred Language. Preserve existing saved values when unchanged, but require configured values for new or changed entries and imports. Time Zone must use standard time-zone identifiers, not tenant-specific options.

**Why:** This is the user's stated product scope; preserving unchanged legacy values avoids disrupting existing contact records.

**How to apply:** Keep option storage and validation tenant-scoped for those five fields only, and use the standard time-zone list everywhere contact forms or imports accept a time zone.