---
name: Campaign claim atomicity
description: Preserve single-recipient ownership across overlapping campaign workers.
---

Campaign workers must win a conditional queued-to-sending database transition before inserting an attempt or calling SMTP. A worker that loses the claim must leave no attempt row.

**Why:** Concurrent workers can both observe a queued recipient; recording attempts before the conditional claim can produce duplicate SMTP sends and inconsistent attempt history.

**How to apply:** Keep the claim transition, attempt insertion, and related campaign state changes in one transaction. Treat external delivery as permitted only after the transaction returns the successful claim.

The campaign test database does not model blocking row locks: simultaneous claims can both pass a `FOR UPDATE` check in memory. Keep same-process claims serialized by tenant as well as the database tenant-row lock; the database lock is still needed across server instances.

**Why:** The memory database allowed concurrent claims for distinct recipients to read the shared attempt ledger before either inserted its attempt.

**How to apply:** When changing claim coordination or the test database, keep a simultaneous distinct-recipient rate-limit test. Preserve database-level locking for deployments with multiple server instances.
