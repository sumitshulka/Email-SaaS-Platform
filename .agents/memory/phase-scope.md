---
name: Phase 1 scope language
description: Product boundary for what the Mailflow Phase 1 interface may claim is available.
---

Describe email sending, campaign management, and delivery reporting as active only where they are backed by tenant-scoped persisted workflows. Campaign status must distinguish acceptance by an SMTP provider from confirmed inbox delivery.

SMTP provider presets only prefill public connection settings; they do not provide mailbox credentials or an OAuth connection. Do not claim a provider is connected until valid credentials have been saved and a real test send succeeds.

**Why:** Placeholder metrics can make users believe unavailable features are working, and SMTP acceptance alone does not confirm inbox delivery. Contact management and campaign sending/reporting now have persisted, tenant-scoped workflows; subscription purchase still depends on Razorpay being configured.

**How to apply:** Enable each capability's dashboard claims only alongside the working tenant-isolated backend flow and persisted results. For SMTP, distinguish preset configuration from authenticated delivery and document OAuth limitations where relevant.