---
name: PostgreSQL lock-race checks
description: Reliable assertions for row-lock concurrency tests against real PostgreSQL.
---

For PostgreSQL race tests, hold the target row lock in one transaction, confirm a separate `FOR UPDATE NOWAIT` attempt fails with SQLSTATE `55P03`, and verify callbacks remain unfinished until the holder commits or rolls back. Check the callbacks' persisted-but-unprocessed state before releasing the lock.

**Why:** In this Replit test setup, `pg_stat_activity` showed only background processes while node-postgres still had active connections and the callbacks resumed only after the lock was released.

**How to apply:** Prefer direct lock-conflict and callback-state assertions in real-database integration tests. Do not rely solely on `pg_stat_activity` to prove contention here.
