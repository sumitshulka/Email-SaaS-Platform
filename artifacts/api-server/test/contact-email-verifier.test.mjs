import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySmtpProbeEvidence,
  identifyMailProvider,
  verifyContactEmail,
} from "../src/lib/contact-email-verifier.ts";

test("requires consistent replies before calling a mailbox rejected", () => {
  const rejection = { recipientCode: 550, catchAllCode: 550, mailServer: "mx.example" };
  assert.equal(classifySmtpProbeEvidence([rejection], 0), "rejected");
  assert.equal(classifySmtpProbeEvidence([rejection], 1), "inconclusive");
  assert.equal(classifySmtpProbeEvidence([rejection, {
    recipientCode: 451,
    catchAllCode: 550,
    mailServer: "mx2.example",
  }], 0), "inconclusive");
  assert.equal(classifySmtpProbeEvidence([{
    recipientCode: 250,
    catchAllCode: 550,
    mailServer: "mx.example",
  }], 1), "accepted");
  assert.equal(classifySmtpProbeEvidence([{
    recipientCode: 550,
    catchAllCode: 250,
    mailServer: "mx.example",
  }], 0), "catch_all");
});

test("identifies common mailbox providers from their published MX hosts", () => {
  assert.equal(
    identifyMailProvider(["aspmx.l.google.com"], "workspace.example").name,
    "Google Workspace",
  );
  assert.equal(
    identifyMailProvider(["alt1.aspmx.l.google.com"], "gmail.com").name,
    "Gmail",
  );
  assert.equal(
    identifyMailProvider(["tenant.mail.protection.outlook.com"], "example.com").name,
    "Microsoft 365",
  );
  assert.equal(
    identifyMailProvider(["mx.zoho.com"], "example.com").name,
    "Zoho Mail",
  );
  assert.match(
    identifyMailProvider(["tenant.mail.protection.outlook.com"], "example.com").method,
    /Microsoft 365 MX SMTP/,
  );
});

test("rejects malformed stored addresses without contacting a mail server", async () => {
  const result = await verifyContactEmail("not-an-email");
  assert.equal(result.status, "inconclusive");
  assert.equal(result.providerName, null);
  assert.equal(result.verificationMethod, "Email format check");
  assert.equal(result.mailServer, null);
  assert.match(result.message, /not in a verifiable email format/i);
});

test("reports no-mail-server domains and flags no-reply-style local parts", async () => {
  const result = await verifyContactEmail("no-reply@example.invalid");
  assert.equal(result.status, "no_mail_server");
  assert.equal(result.noReplyStyle, true);
  assert.equal(result.catchAll, false);
});
