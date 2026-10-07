---
name: Company intelligence policy
description: Explicit company research, master-data separation and evidence/privacy requirements
---

Company intelligence is an explicitly requested, confirmed, reusable company-level asset. Opening, searching, editing or selecting a company must not trigger research, and future email generation must consume stored intelligence rather than research per email.

Keep researched intelligence separate from company master fields; a failed refresh must preserve the last successful profile and successful versions must remain available. Private companies must not become global through research.

Every factual claim needs source provenance; technology adoption cannot be guessed, current signals need real dates, and AI opportunities must be identified as inference. Do not include key people or tenant contact data. Users must not receive internal cost or requester metadata.

**Why:** The supplied specification prioritizes reusable intelligence, explicit research resource use, auditable evidence, and preservation of existing company/contact privacy.

**How to apply:** Require a new confirmed action for each research job, retain successful history, and separate global company evidence from tenant-owned relationship/contact information when extending AI workflows.

Backup analysis should reuse the already collected evidence rather than repeat web discovery.

**Why:** This avoids spending another web-search budget on an analysis failure. Provider-controlled query counts (notably Gemini) are not equivalent to an enforceable hosted-tool-call cap.

**How to apply:** Keep fallback analysis source-linked to the same evidence; disclose provider-specific search-budget limitations rather than silently treating observed queries as a hard cap.
