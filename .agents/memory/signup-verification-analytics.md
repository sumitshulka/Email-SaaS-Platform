---
name: Signup verification analytics
description: Keep verified-signup events distinct from other email verification outcomes.
---

Only count a verified signup when a successful verification follows a registration that was waiting for email verification. The same verification flow can also complete an email change, and checkout can create an account after email was already verified. Carry forward only validated fixed page and placement attribution.

**Why:** Counting every successful verification as a signup would inflate the funnel with email changes and would attribute checkout registrations to a verification step they did not complete.

**How to apply:** For signup-completion analytics, keep a registration-specific pending marker until the server confirms verification. Do not emit the signup event for verification without that marker, and clear it once consumed.
