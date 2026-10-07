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

PostgreSQL race tests should synchronize the worker immediately before its claim transaction, then confirm that it is blocked by the settings updater before allowing the updater to commit. Starting the worker and polling immediately can miss the intended ordering because candidate selection and pre-claim settings reads happen first.

**Why:** A timing-only test can observe neither the worker's lock wait nor the actual database serialization, even when the intended race is not yet in progress.

**How to apply:** Use the worker's pre-claim test hook as a barrier, observe the database wait against the updater connection, then commit and assert the queued recipient remains untouched.
