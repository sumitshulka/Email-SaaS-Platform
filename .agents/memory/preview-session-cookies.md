---
name: Preview session cookies
description: Cookie policy for authenticated apps embedded in secure Replit development previews.
---

Use `SameSite=None; Secure` for session cookies on HTTPS development-preview requests; preserve `Lax` for plain HTTP local development and production.

**Why:** Authentication succeeded and created unexpired server-side sessions while protected preview requests returned 401, pointing to cookie delivery in the embedded preview rather than the API port.

**How to apply:** When debugging preview-only authentication failures, check proxy-aware `req.secure` and the cookie's `SameSite`/`Secure` attributes before changing port routing or API clients. Keep same-origin request protection in place.
