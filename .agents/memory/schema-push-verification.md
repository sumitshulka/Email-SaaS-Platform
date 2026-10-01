---
name: Schema push verification
description: Avoid assuming schema pushes are atomic or that their exit code proves success.
---

Treat schema-push output and the actual database schema as authoritative, not the shell exit code alone.

**Why:** Development Drizzle pushes have returned exit code zero while reporting composite foreign-key or existing-index errors. Earlier additive column and table changes had already been applied. Assuming either complete success or complete rollback would have been wrong.

**How to apply:** If a push reports an SQL error, inspect the relevant columns, defaults, foreign keys, and unique indexes before retrying or applying additional changes. A table existing is not enough to prove that its deduplication index exists. Avoid forced or destructive pushes merely to resolve unrelated constraint ordering.