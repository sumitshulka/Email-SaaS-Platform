---
name: pg-mem timezone ranges
description: A test compatibility constraint for timezone-aware analytics date filtering.
---

When building account-local date-range queries, compute the UTC start and exclusive end instants in application code, then compare the database timestamp column directly. Keep timezone conversion for grouping if the test adapter supports it.

**Why:** pg-mem rejected both `date::text` and `timestamp AT TIME ZONE` casts that PostgreSQL supports, preventing API integration tests from exercising the date aggregation.

**How to apply:** Prefer indexed `created_at >= start` and `created_at < endExclusive` predicates with timezone-aware UTC `Date` values. Validate the conversion around daylight-saving boundaries and keep the production query’s grouping semantics explicit.
