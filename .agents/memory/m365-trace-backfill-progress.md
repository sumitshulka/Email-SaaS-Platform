---
name: Microsoft 365 trace backfill progress
description: How to report progress without implying access to Microsoft’s total result count.
---

Represent backfill progress by the date range the worker has successfully advanced through. Microsoft Graph's paging link is opaque, and the rows Mailflow stores are only matched campaign traces, so neither page totals nor stored-row counts are a trustworthy measure of all provider work.

**Why:** A percentage based on provider pages or matched rows would imply a total that the API does not provide.

**How to apply:** Persist the original requested range separately from the worker's current date cursor; report legacy backfills as unavailable when their original range was not captured.
