---
name: Radix dropdown browser checks
description: Browser-test behavior for reopening contact-list action menus after an activation change.
---

In the contact-list browser test, a pointer click on the same action-menu trigger did not reopen its Radix menu after an activate/deactivate mutation and list refetch; keyboard Enter did. Do not assume that a passing keyboard path proves pointer reopening works.

**Why:** The status update refreshes list data while the menu has just closed, and this browser sequence behaved differently for a pointer click and keyboard activation.

**How to apply:** When changing or expanding list-menu interactions, check pointer and keyboard opening independently and investigate any difference before treating it as test flakiness.
