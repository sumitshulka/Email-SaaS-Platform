import assert from "node:assert/strict";
import test from "node:test";
import { verifyContactEmail } from "../src/lib/contact-email-verifier.ts";

test("rejects malformed stored addresses without contacting a mail server", async () => {
  const result = await verifyContactEmail("not-an-email");
  assert.equal(result.status, "inconclusive");
  assert.equal(result.mailServer, null);
  assert.match(result.message, /not in a verifiable email format/i);
});

test("reports no-mail-server domains and flags no-reply-style local parts", async () => {
  const result = await verifyContactEmail("no-reply@example.invalid");
  assert.equal(result.status, "no_mail_server");
  assert.equal(result.noReplyStyle, true);
  assert.equal(result.catchAll, false);
});
