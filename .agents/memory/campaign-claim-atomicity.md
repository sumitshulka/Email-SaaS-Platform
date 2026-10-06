---
name: Campaign claim atomicity
description: Preserve single-recipient ownership across overlapping campaign workers.
---

Campaign workers must win a conditional queued-to-sending database transition before inserting an attempt or calling SMTP. A worker that loses the claim must leave no attempt row.

**Why:** Concurrent workers can both observe a queued recipient; recording attempts before the conditional claim can produce duplicate SMTP sends and inconsistent attempt history.

**How to apply:** Keep the claim transition, attempt insertion, and related campaign state changes in one transaction. Treat external delivery as permitted only after the transaction returns the successful claim.
