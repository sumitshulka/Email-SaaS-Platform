---
name: Campaign wizard submit transitions
description: Prevent accidental form submission when a multistep campaign editor advances to its final step.
---

Render a step-advance control and the final submit control as distinct button elements, and cancel the default action while advancing. Do not reuse the same button DOM node while changing its type from `button` to `submit`.

**Why:** In the campaign editor, advancing into Review unexpectedly submitted the form and closed the editor. Separating the controls and preventing the advance click's default action kept Review open in a browser regression test.

**How to apply:** Use this safeguard in campaign wizard footers and other forms that replace a non-submit step button with a submit button during the same state transition.
