---
name: Timezone-bound analytics queries
description: Database and test-adapter constraints for timezone-aware date grouping.
---

When building account-local date-range queries, compute the UTC start and exclusive end instants in application code, then compare the database timestamp column directly. If a timezone expression in `SELECT` is parameterized, explicitly alias it and group by that alias rather than rebuilding the expression.

**Why:** pg-mem rejected PostgreSQL date/time casts, and PostgreSQL treats separately-bound timezone parameters in otherwise identical grouped expressions as distinct, causing a `GROUP BY` error. pg-mem also failed on ordinal grouping for the derived date.

**How to apply:** Prefer indexed `created_at >= start` and `created_at < endExclusive` predicates with timezone-aware UTC `Date` values. Explicitly alias timezone-derived date expressions and group by the alias; test daylight-saving boundaries and use a real PostgreSQL check when available.
