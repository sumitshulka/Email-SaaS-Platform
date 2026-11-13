---
name: Open campaign policy
description: Product rules for file-based audiences and package-term allowances.
---

Open campaigns use uploaded email addresses and optional first/last names, without
requiring saved contacts. Uploaded recipients must stay separate from the Contacts
library and remain linked to their campaign. They otherwise use the platform's
standard campaign content, sending, and scheduling behavior, including competition
with existing running and scheduled campaigns.

Package definitions have an open-campaign allowance and a recipient limit per
open campaign. The user explicitly selected **per package term**, not a concurrent
active-campaign limit. Completing a campaign therefore does not restore allowance.
Do not assume the user's example Free=1 and Basic=2 authorizes changing existing
package definitions automatically.

The per-campaign recipient count is a **maximum**, not an exact required count:
the user clarified that fewer than or equal to the package allowance is allowed.
Make that maximum visible before upload so users can prepare a suitable file.

Exhausted term allowance must not prevent creating or editing open-campaign
drafts; it only prevents queueing/scheduling until allowance becomes available.
Follow-ups must only target original campaign recipients, never new addresses
introduced by a replacement upload.

**Why:** The user explicitly confirmed both rules after reviewing the audit.

Name personalization must be unavailable when uploaded name data is absent unless
the user explicitly sets a fallback for that field. Hide contact-only fields in
open campaigns. The user selected **user-defined fallbacks**, not automatic
generic defaults, for missing values in both campaign types.
Do not silently invent recipient names or create saved contacts to support
personalization, reporting, or unsubscribe behavior.

**Why:** The user introduced open campaigns for direct uploaded audiences and
explicitly chose term-based allowance accounting while requiring separate
recipient storage and the existing sending/scheduling logic. The user later
requested explicit defaults wherever personalization data might be absent.

**How to apply:** Preserve these distinctions when extending package settings,
audience imports, templates, follow-ups, suppression, and reporting.
