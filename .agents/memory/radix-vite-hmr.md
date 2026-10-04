---
name: Radix and Vite HMR
description: Diagnosing invalid-hook errors that appear after a Radix dependency is newly optimized by Vite.
---

When an invalid-hook error appears immediately after Vite newly optimizes a Radix component, first verify that React and ReactDOM versions match and Vite deduplicates both. If they do, restart the artifact's web workflow once before replacing UI components or changing dependency versions.

**Why:** On 2026-10-04, using the existing Radix dialog-based sheet triggered an invalid-hook error during dependency optimization. The installed React versions were aligned, and a clean web-workflow restart cleared the runtime error.

**How to apply:** Use this as an initial diagnostic for similar dev-only errors after adding or importing Radix UI. If the error remains after one clean restart, continue with normal React duplicate/version diagnosis rather than repeating restarts.