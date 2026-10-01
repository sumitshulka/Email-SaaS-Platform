---
name: pg-mem with Drizzle
description: Compatibility details for isolated Drizzle tests using pg-mem's node-postgres adapter.
---

When using pg-mem 3.x with Drizzle's node-postgres driver, intercept pool and connected-client queries to remove the unsupported `types` and `rowMode` options. For `rowMode: "array"` queries, convert pg-mem's object rows to arrays in their existing property order, which follows the selected-column order expected by Drizzle.

**Why:** pg-mem's adapter rejects both options, and its optional wire-protocol server has failed on parameterized comparisons with a missing execution context. The direct in-memory adapter avoids a real or production database while preserving route-level database behavior.

**How to apply:** Keep test DB injection guarded by `NODE_ENV === "test"`, install it before importing routes, and run the test suite against that isolated database rather than connecting to the configured application database. Reduced test table definitions must also include columns with Drizzle `$onUpdate` callbacks; Drizzle may write those columns during an update to a different field.