---
name: Phase 1 scope language
description: Product boundary for what the Mailflow Phase 1 interface may claim is available.
---

Do not present later-phase sending, campaign, contact, billing, or delivery-reporting capabilities as active until the related flows are implemented and backed by real data.

SMTP provider presets only prefill public connection settings; they do not provide mailbox credentials or an OAuth connection. Do not claim a provider is connected until valid credentials have been saved and a real test send succeeds.

**Why:** Placeholder metrics and progress figures can make users believe unavailable features are working; the Phase 1 dashboard was changed to show verified account and access information instead.

**How to apply:** When adding a later phase, enable its dashboard claims only alongside the working tenant-isolated backend flow and persisted results. For SMTP, distinguish preset configuration from authenticated delivery and document OAuth limitations where relevant.