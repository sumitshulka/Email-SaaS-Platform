---
name: Browser-test resource contention
description: Running browser tests beside the managed Vite workflow can cause slow starts in this workspace.
---

When running Mailflow browser tests interactively alongside the managed web workflow, prefer the test harness's existing-server mode instead of starting a second Vite server.

**Why:** In this Replit workspace, a second dev server plus headless Chromium caused prolonged startup and page-navigation timeouts; the same notice scenario passed against the already-running server.

**How to apply:** Use the harness's supported base URL setting for a focused run when the web workflow is healthy. Keep the default server startup for isolated CI or standalone use.
