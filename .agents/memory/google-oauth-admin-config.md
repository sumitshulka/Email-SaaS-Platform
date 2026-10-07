---
name: Google OAuth admin setup
description: The product requirement for configuring Gmail bounce-monitoring OAuth credentials.
---

Google OAuth client values for Gmail bounce monitoring must be entered and managed by a superadmin in the app, not through Replit Secrets. Keep the client secret encrypted at rest and never return it in API responses.

**Why:** The user explicitly requested an in-app setup flow and rejected configuring these values through Replit Secrets or another external setup path.

**How to apply:** Keep future changes to Gmail OAuth configuration within the superadmin-managed app settings flow. Use the app's existing credential encryption mechanism; do not introduce new OAuth environment variables.

OAuth consent-test failures should be mapped to fixed, allowlisted diagnostic codes. Never return or log raw provider response bodies, error descriptions, authorization codes, or tokens.

**Why:** A generic failure hid which verification step failed, while raw OAuth responses and callback values can contain sensitive account or project details.

**How to apply:** Record only the failing stage, HTTP status, and recognized provider error code; show the superadmin an actionable message based on a fixed reason code.