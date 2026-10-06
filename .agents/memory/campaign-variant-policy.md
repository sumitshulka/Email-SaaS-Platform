---
name: Campaign variant policy
description: Compliant boundaries for campaign content variants, reporting, and unsubscribe handling
---

Campaign subject, greeting, and signature variants use stable recipient-level assignments per campaign; they do not rotate on each send. Report assignment counts and SMTP/provider outcomes only, without implying inbox placement or engagement. Every campaign includes a tenant-scoped unsubscribe link; ordinary GET displays confirmation only, while the signed one-click POST records the choice.

**Why:** Per-send variant rotation was requested to evade spam checks; stable A/B testing was selected instead so each recipient gets consistent content and a clear opt-out.

**How to apply:** Keep future campaign testing and reporting within these limits. Do not add per-send rotation or opens/clicks/inbox-placement tracking as part of this feature.
