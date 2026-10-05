---
name: Panel surface colors
description: How to apply and verify custom backgrounds on the reusable Panel component.
---

When a `Panel` needs a tinted surface, pass `backgroundColor` (and `borderColor`) through its React `style` prop rather than assuming a caller's Tailwind background class will override the base `bg-white`. Verify the computed color in the browser.

**Why:** Browser-computed styles showed the summary cards stayed white even though the caller supplied additional Tailwind background classes.

**How to apply:** For future colored `Panel` cards, use inline surface styles or another approach with confirmed precedence; add a browser style assertion when the background color is part of the requirement.
