---
name: Google OAuth admin setup
description: The product requirement for configuring Gmail bounce-monitoring OAuth credentials.
---

Google OAuth client values for Gmail bounce monitoring must be entered and managed by a superadmin in the app, not through Replit Secrets. Keep the client secret encrypted at rest and never return it in API responses.

**Why:** The user explicitly requested an in-app setup flow and rejected configuring these values through Replit Secrets or another external setup path.

**How to apply:** Keep future changes to Gmail OAuth configuration within the superadmin-managed app settings flow. Use the app's existing credential encryption mechanism; do not introduce new OAuth environment variables.