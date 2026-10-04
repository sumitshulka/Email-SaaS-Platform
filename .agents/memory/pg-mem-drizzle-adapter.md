---
name: pg-mem with Drizzle
description: Compatibility details for isolated Drizzle tests using pg-mem's node-postgres adapter.
---

When using pg-mem 3.x with Drizzle's node-postgres driver, intercept pool and connected-client queries to remove the unsupported `types` and `rowMode` options. For `rowMode: "array"` queries, convert pg-mem's object rows to arrays in their existing property order, which follows the selected-column order expected by Drizzle. pg-mem also does not support `FOR UPDATE SKIP LOCKED`; test adapters may reduce it to `FOR UPDATE` when lock skipping itself is not under test.

For one-time database claims, pg-mem 3.x reports the existing row from `INSERT ... ON CONFLICT DO NOTHING RETURNING` as if it were inserted. Prefer a conditional `UPDATE ... WHERE consumed_at IS NULL RETURNING` for consume-once state, or add a test-adapter shim if insertion itself is required.

**Why:** pg-mem's adapter rejects both options and the `SKIP LOCKED` clause, and its optional wire-protocol server has failed on parameterized comparisons with a missing execution context. The direct in-memory adapter avoids a real or production database while preserving route-level database behavior. Its conflict-returning behavior can also invalidate otherwise-correct single-use tests.

**How to apply:** Keep test DB injection guarded by `NODE_ENV === "test"`, install it before importing routes, and run the test suite against that isolated database rather than connecting to the configured application database. Reduced test table definitions must also include columns with Drizzle `$onUpdate` callbacks; Drizzle may write those columns during an update to a different field. Strip `SKIP LOCKED` only in test adapters; preserve production locking semantics.