---
name: Phase 1 scope language
description: Product boundary for what the Mailflow Phase 1 interface may claim is available.
---

Do not present email-sending, campaign, or delivery-reporting capabilities as active until the related flows are implemented and backed by real data. Customer contact management is active. Subscription purchase depends on Razorpay being configured.

SMTP provider presets only prefill public connection settings; they do not provide mailbox credentials or an OAuth connection. Do not claim a provider is connected until valid credentials have been saved and a real test send succeeds.

**Why:** Placeholder metrics and progress figures can make users believe unavailable features are working. Contacts and subscription package flows now have persisted, tenant-scoped behavior, while sending and campaign reporting remain unavailable.

**How to apply:** Enable each capability's dashboard claims only alongside the working tenant-isolated backend flow and persisted results. For SMTP, distinguish preset configuration from authenticated delivery and document OAuth limitations where relevant.