import assert from "node:assert/strict";
import test from "node:test";
import {
  assessEmailRisks,
  classifySmtpProbeEvidence,
  identifyMailProvider,
  verifyContactEmail,
} from "../src/lib/contact-email-verifier.ts";

test("requires consistent replies before calling a mailbox rejected", () => {
  const rejection = {
    recipientCode: 550,
    recipientText: "550 5.1.1 Recipient not found",
    catchAllCode: 550,
    catchAllText: "550 5.1.1 Recipient not found",
    mailServer: "mx.example",
  };
  assert.equal(classifySmtpProbeEvidence([rejection], 0), "rejected");
  assert.equal(classifySmtpProbeEvidence([rejection], 1), "inconclusive");
  assert.equal(classifySmtpProbeEvidence([rejection, {
    recipientCode: 451,
    recipientText: "451 4.7.0 Please try again later",
    catchAllCode: 550,
    catchAllText: "550 5.1.1 Recipient not found",
    mailServer: "mx2.example",
  }], 0), "inconclusive");
  assert.equal(classifySmtpProbeEvidence([{
    recipientCode: 550,
    recipientText: "550 5.7.1 Access denied by policy",
    catchAllCode: 550,
    catchAllText: "550 5.7.1 Access denied by policy",
    mailServer: "mx.example",
  }], 0), "inconclusive");
  assert.equal(classifySmtpProbeEvidence([{
    recipientCode: 250,
    recipientText: "250 2.1.5 Recipient OK",
    catchAllCode: 550,
    catchAllText: "550 5.1.1 Recipient not found",
    mailServer: "mx.example",
  }], 1), "accepted");
  assert.equal(classifySmtpProbeEvidence([{
    recipientCode: 550,
    recipientText: "550 5.1.1 Recipient not found",
    catchAllCode: 250,
    catchAllText: "250 2.1.5 Recipient OK",
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

test("flags disposable domains, role addresses, and likely provider typos without changing the address", () => {
  assert.deepEqual(
    assessEmailRisks("Jamie@mailinator.com").riskFlags,
    ["disposable_domain"],
  );
  assert.deepEqual(
    assessEmailRisks("support+campaign@example.com").riskFlags,
    ["role_based_address"],
  );
  assert.deepEqual(assessEmailRisks("person@gmial.com"), {
    riskFlags: ["likely_domain_typo"],
    suggestedEmail: "person@gmail.com",
  });
  assert.equal(
    assessEmailRisks("person@hotmial.com").suggestedEmail,
    "person@hotmail.com",
  );
  assert.equal(
    assessEmailRisks("person@custom-company.example").suggestedEmail,
    null,
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
