---
name: Isolated API helper checks
description: A Node/esbuild quirk encountered when running isolated checks for API crypto helpers.
---

When testing pure API helpers, avoid importing a service module that pulls in PostgreSQL internals through the database package. In this workspace, an esbuild ESM bundle containing `pg` hit Node's unsupported dynamic-require path, while a CommonJS bundle ran successfully.

**Why:** A standalone verification of payment signatures and credential encryption took several attempts before the CommonJS bundle worked.

**How to apply:** Prefer testing pure crypto helpers without database imports. For temporary Node checks of a module that still includes PostgreSQL code, use CommonJS output; this is not a substitute for committed automated or provider integration tests.