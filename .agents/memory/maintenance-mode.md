---
name: Maintenance mode
description: Product policy for access and campaign delivery while Mailflow maintenance is active.
---

Maintenance mode is an operational gate, not a forced logout. Existing authenticated users keep access until they log out; only superadmins may start a new session, and registration is blocked. Queued campaign delivery pauses without discarding recipients and resumes after maintenance is switched off. A delivery already in progress may finish.

**Why:** The user wants current sessions to remain usable while preventing new customer access and pausing campaigns without losing queued work.

**How to apply:** Keep the maintenance status visible to all clients, preserve active sessions, enforce the superadmin-only login rule server-side, and gate delivery claims rather than deleting or terminally updating queued recipients.
