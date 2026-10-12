---
name: Provider report semantics
description: External reporting limitations and timestamp meanings that matter when adding provider adapters.
---

Validate native provider report semantics before equating a logged event or timestamp with recipient delivery.

**Why:** Microsoft trace exports distinguish mailbox DELIVER from SEND to another destination. Their Received/origin_timestamp is initial service receipt, not the final delivery-event time. Google Workspace ELS exports include delivery steps but omit post-delivery details, and display dates in the administrator device's timezone. Synthetic normalized CSV examples can hide these differences.

**How to apply:** Before adding an automatic adapter or broadening CSV support, verify native samples against current official documentation. Never use Microsoft initial-receipt timestamps as final-outcome times or treat transmission as proof of mailbox delivery. Do not infer inbox placement or reading from Workspace ELS exports.

Microsoft Graph `FAIL` events are projected as generic `failed` evidence, not automatically as bounced-address evidence. Keep bounce suppression tied to reports explicitly classified as `bounced`.

**Why:** A trace failure does not by itself establish that a recipient address permanently bounced; treating all failures as bounces would suppress contacts without sufficient evidence.

**How to apply:** When testing or extending Microsoft trace ingestion, preserve the `failed` versus `bounced` distinction unless a separately validated provider signal supports bounce classification.

Campaign summaries may count a matched, latest provider-reported `bounced` or `failed` outcome in Rejected / failed while retaining SMTP acceptance as a separate transport metric.

**Why:** A provider bounce can arrive after SMTP accepted the message, so both facts remain true. Adding report outcomes to the summary must not erase transport history or make recipient progress exceed the audience size.

**How to apply:** Count each recipient once in Rejected / failed when either SMTP status or the current report projection is terminally failed. Treat accepted and rejected/failed as potentially overlapping metrics; calculate progress from recipient lifecycle state, not by summing those counters.

Official references checked on 2026-10-01:
- https://learn.microsoft.com/en-us/exchange/monitoring/trace-an-email-message/message-trace-modern-eac
- https://knowledge.workspace.google.com/admin/gmail/advanced/understand-email-log-search-results