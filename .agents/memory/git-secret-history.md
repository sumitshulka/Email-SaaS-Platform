---
name: Git secret history cleanup
description: Remove committed credentials from pushable history without rewriting the shared upstream.
---

When a credential file was committed and later deleted, a push still includes the original blob. Rewrite the commits being pushed, but keep the remote-tracking upstream history unchanged. Verify the file path is absent from the push branch's reachable objects and that the upstream remains an ancestor of the rewritten branch. Add a narrow ignore rule to prevent the downloaded credential file from being staged again. Do not read or print the credential contents.

**Why:** Rewriting the entire local branch history also changed shared ancestors, turning a normal fast-forward push into a divergent history that required recovery.

**How to apply:** Check whether the remote branch contains the blob first. Restrict cleanup to the outgoing branch range and preserve unrelated task branches and internal backup refs unless the user explicitly asks to rewrite them too. Do not force-push unless separately authorized.
