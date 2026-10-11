---
name: Microsoft 365 trace scheduled runner
description: Production Microsoft 365 trace polling runs independently from the Autoscale API process.
---

Run Microsoft 365 trace polling as a one-shot Replit Scheduled Deployment on the one-minute cadence. The API process must not start a local timer for it. The scheduled run invokes the API package's dedicated trace runner; database tenant leases remain the cross-process overlap guard.

**Why:** Autoscale API instances can scale down between requests, so a process-local interval cannot guarantee continued production polling.

**How to apply:** Keep the runner bundled with the API package and configure it as a separate scheduled deployment; do not replace the web/API Autoscale deployment with a scheduled target.
