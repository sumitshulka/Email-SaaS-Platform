---
name: Revenue environment isolation
description: Superadmin dashboard revenue must reflect only the currently active Razorpay environment.
---

Revenue totals, trends, and per-currency summaries must include only payments tagged with the active Razorpay environment. Never mix sandbox and production payment records in the same dashboard view. If no environment is active, show no revenue data.

**Why:** The user needs the dashboard to make it clear whether values represent sandbox tests or production payments.

**How to apply:** Use the platform's active environment setting as the filter for every revenue metric, trend, and currency summary; label the displayed environment and keep currencies separate.
