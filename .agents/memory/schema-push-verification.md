---
name: Schema push verification
description: Avoid assuming schema pushes are atomic or that their exit code proves success.
---

Treat schema-push output and the actual database schema as authoritative, not the shell exit code alone.

**Why:** A development Drizzle push returned exit code zero while reporting a composite foreign-key error. Earlier additive column changes had already been applied. Assuming either complete success or complete rollback would have been wrong.

**How to apply:** If a push reports an SQL error, inspect the relevant columns and constraints before retrying or applying additional changes. Avoid forced or destructive pushes merely to resolve unrelated constraint ordering.