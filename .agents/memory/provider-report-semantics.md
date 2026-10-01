---
name: Provider report semantics
description: External reporting limitations and timestamp meanings that matter when adding provider adapters.
---

Validate native provider report semantics before equating a logged event or timestamp with recipient delivery.

**Why:** Microsoft trace exports distinguish mailbox DELIVER from SEND to another destination. Their Received/origin_timestamp is initial service receipt, not the final delivery-event time. Google Workspace ELS exports include delivery steps but omit post-delivery details, and display dates in the administrator device's timezone. Synthetic normalized CSV examples can hide these differences.

**How to apply:** Before adding an automatic adapter or broadening CSV support, verify native samples against current official documentation. Never use Microsoft initial-receipt timestamps as final-outcome times or treat transmission as proof of mailbox delivery. Do not infer inbox placement or reading from Workspace ELS exports.

Official references checked on 2026-10-01:
- https://learn.microsoft.com/en-us/exchange/monitoring/trace-an-email-message/message-trace-modern-eac
- https://knowledge.workspace.google.com/admin/gmail/advanced/understand-email-log-search-results