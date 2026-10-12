---
name: Settings snapshot concurrency
description: Prevent full settings snapshots from overwriting changes saved by another administrator.
---

When an endpoint replaces a complete settings object, compare the submitted snapshot version against the current settings while holding the row lock; reject stale snapshots rather than merging unknown intent.

**Why:** Serialized writes do not prevent a later stale form from restoring older values. Timestamp versions may be null before initialization or fail to reflect content-only equality reliably.

**How to apply:** For full-object settings updates, derive a stable revision from validated configuration values, return it with the settings, require it on writes, and check it inside the locked transaction.
