---
name: Browser test reliability
description: Reuse managed Vite and fixture shared app-shell APIs to avoid misleading browser failures.
---

When running Mailflow browser tests interactively alongside the managed web workflow, prefer the test harness's existing-server mode instead of starting a second Vite server.

For authenticated pages, stub the shared shell and route-gate requests (including maintenance status and notification history) as well as the feature-specific APIs. A 404 from a missing fixture can leave the app shell mounted while the page content never appears, making later UI assertions misleading.

**Why:** In this workspace, a second dev server plus headless Chromium caused prolonged startup timeouts, and missing app-shell fixtures caused a blank protected-page body without an obvious page error.

**How to apply:** Use the harness's supported base URL setting for a focused run when the web workflow is healthy. Keep default server startup for isolated CI or standalone use, and inspect failed API responses before treating a missing control as a UI regression.
