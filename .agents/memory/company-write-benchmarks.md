---
name: Company write benchmarks
description: Method and interpretation rules for company index-cost comparisons.
---

When measuring the cost of a company-table index, keep the full current company schema and every other production index in both comparison cases; toggle only the index being evaluated. Report fixture size and workload, and label batched SQL timings separately from end-to-end API latency.

**Why:** An isolated reduced-schema baseline can understate write costs when other production indexes are enabled, while raw SQL statements omit API transaction, tenant-lock, duplicate-check, and request-handling costs.

**How to apply:** Use this approach for future company index changes, and do not describe batch measurements as single-company save latency.
