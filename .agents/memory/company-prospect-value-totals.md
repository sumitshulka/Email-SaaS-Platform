---
name: Company prospect value totals
description: Defines tenant company-page TPV and TRV semantics for linked prospect records.
---

TPV sums expected deal values from all non-archived prospects linked to the company's contacts. TRV sums expected deal values only from prospects in a won terminal outcome. Keep each currency separate; do not combine currencies or imply a currency conversion.

**Why:** The user selected won expected deal values for TRV, and the company page has no actual revenue amount to report. TPV remains the sum of linked, non-archived prospect values.

**How to apply:** Reuse these definitions in company-level summaries, exports, and future reporting. Archived prospects are excluded from totals; lost prospects remain in TPV but not TRV.
