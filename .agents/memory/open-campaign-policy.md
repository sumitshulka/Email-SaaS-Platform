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

Name personalization must be unavailable when the relevant uploaded name data is
absent. Do not silently invent recipient names or create saved contacts to support
personalization, reporting, or unsubscribe behavior.

**Why:** The user introduced open campaigns for direct uploaded audiences and
explicitly chose term-based allowance accounting while requiring separate
recipient storage and the existing sending/scheduling logic.

**How to apply:** Preserve these distinctions when extending package settings,
audience imports, templates, follow-ups, suppression, and reporting.
