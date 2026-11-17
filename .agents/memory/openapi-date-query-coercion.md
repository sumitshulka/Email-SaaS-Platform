---
name: OpenAPI date query coercion
description: Generated OpenAPI query validators may expect JavaScript Date objects for date-formatted query parameters.
---

Convert date query strings from Express before parsing them with the generated Zod schema. Validate the exact `YYYY-MM-DD` form and reject invalid dates instead of allowing JavaScript's permissive date parser to normalize them.

**Why:** With `useDates` enabled, generated Zod schemas can use `z.date()` even though HTTP query parameters arrive as strings. This mismatch otherwise rejects valid browser date filters.

**How to apply:** At the route boundary, normalize date-formatted query fields into valid `Date` instances before `safeParse`; keep the generated OpenAPI/client types and request parameters as strings.
