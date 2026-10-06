---
name: Password-rotation redirects
description: Prevent route guards from undoing navigation after a required password change.
---

After a successful required password change, update the cached authenticated user's `mustChangeCredentials` state to false before navigating away from the profile. Invalidating the user query alone is asynchronous; a route guard can still read the old true value and send the user back to the profile.

**Why:** Browser testing showed that the ticket return route was briefly entered, then the forced-rotation guard redirected back using stale cached auth state.

**How to apply:** Any flow that releases a user from a mandatory credential-rotation screen must synchronously clear the cached gate condition before navigating to its intended destination.
