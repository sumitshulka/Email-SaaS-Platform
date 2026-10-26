---
name: SMTP setup versus campaign readiness
description: Distinguishes the onboarding email setup step from campaign sender verification.
---

A successful SMTP connection check against saved settings completes the Getting Started email setup step. It verifies SMTP authentication without sending a message. Campaign sending separately requires the SMTP server to accept a test email for the saved sender settings; acceptance does not prove inbox delivery.

**Why:** The user explicitly wants the onboarding step to complete on successful connection checks, while the app currently requires a test-email acceptance to enable campaign sending.

**How to apply:** Keep onboarding progress responsive after successful checks, and label campaign sender status as requiring a test email until `verifiedAt` is set. If a check uses unsaved values, explain that saved settings remain unchanged and do not count it as persistent setup completion.
