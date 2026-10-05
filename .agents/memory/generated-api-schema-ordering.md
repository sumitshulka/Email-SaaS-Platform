---
name: Generated API schema ordering
description: TypeScript declaration-order failures in generated OpenAPI-to-Zod output.
---

When `pnpm run typecheck:libs` reports TS2448 or TS2454 in generated API-Zod output, check whether a response-property maximum-length constant appears after the schema that references it. Move the constant before the object initializer and rebuild shared library declarations before checking dependent apps.

**Why:** A newly generated unlinked-company response placed a `const` maximum after its schema, which blocked shared declarations and made the frontend report stale/missing API exports.

**How to apply:** Run the shared library typecheck after OpenAPI schema changes, fix generated declaration order when needed, then typecheck the consuming artifact.
