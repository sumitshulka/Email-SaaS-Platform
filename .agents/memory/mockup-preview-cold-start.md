---
name: Mockup preview cold starts
description: Diagnosing a blank mockup screenshot during initial Vite dependency optimization.
---

If a newly opened mockup frame is blank and Vite logs show dependency optimization or a client reload, let the reload finish and capture it again before editing the component.

**Why:** On 2026-10-05, the first screenshot coincided with Vite's dependency optimization and appeared blank; a fresh capture after the reload rendered normally.

**How to apply:** Check the mockup workflow logs when a first capture is blank. If dependency optimization is still running, wait for it to settle and retry once before changing preview code.
