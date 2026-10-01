import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeliveryReports } from "../src/lib/delivery-report-parser.ts";

describe("parseDeliveryReports CSV formats", () => {
  it("accepts documented shared recipient headers for generic and Workspace imports", () => {
    for (const format of ["generic_csv", "google_workspace_csv"]) {
      const result = parseDeliveryReports(
        format,
        "Message ID,RecipientAddress,Status\n<tracked@example.test>,person@example.test,Delivered\n",
      );
      assert.equal(result.reports.length, 1);
      assert.equal(result.reports[0].recipientEmail, "person@example.test");
      assert.equal(result.reports[0].messageId, "<tracked@example.test>");
      assert.equal(result.reports[0].outcome, "delivered");
    }
  });

  it("parses Microsoft headers and preserves escaped CSV fields", () => {
    const result = parseDeliveryReports(
      "microsoft_365_csv",
      [
        "MessageId,RecipientAddress,Status,Timestamp",
        '"<message, ""one"">",person@example.com,Failed,2025-01-02T03:04:05Z',
        "msg-2,second@example.com,Delivered,2025-01-02",
      ].join("\r\n"),
    );

    assert.equal(result.reports.length, 2);
    assert.equal(result.reports[0].messageId, '<message, "one">');
    assert.equal(result.reports[0].outcome, "failed");
    assert.equal(result.reports[0].deliveryScope, "unspecified");
    assert.equal(result.reports[0].occurredAt.toISOString(), "2025-01-02T03:04:05.000Z");
    assert.equal(result.reports[1].outcome, "delivered");
  });

  it("maps Google Workspace outcomes and skips internal-server confirmation", () => {
    const result = parseDeliveryReports(
      "google_workspace_csv",
      [
        "Message ID,Recipient,Event status",
        "g-1,mailbox@example.com,Delivered to Gmail inbox",
        "g-2,server@example.com,Delivered to SMTP server",
        "g-3,ordinary@example.com,Delivered",
        "g-4,internal@example.com,Delivered to a Google internal server",
        "g-5,bounce@example.com,Bounced",
      ].join("\n"),
    );

    assert.deepEqual(
      result.reports.map(({ outcome, deliveryScope }) => [outcome, deliveryScope]),
      [
        ["delivered", "mailbox"],
        ["delivered", "receiving_server"],
        ["delivered", "unspecified"],
        ["bounced", "unspecified"],
      ],
    );
    assert.equal(result.warnings.length, 1);
  });

  it("accepts only explicit generic outcomes and returns warnings for partial rows", () => {
    const result = parseDeliveryReports(
      "generic_csv",
      [
        "message_id,recipient_email,status,timestamp",
        "good-1,good@example.com,delayed,not-a-date",
        "good-2,other@example.com,failed,",
        ",missing-id@example.com,delivered,",
        "good-3,unknown@example.com,delivery confirmed,",
      ].join("\n"),
    );

    assert.deepEqual(
      result.reports.map((report) => report.outcome),
      ["delayed", "failed"],
    );
    assert.equal(result.reports[0].occurredAt, null);
    assert.ok(result.warnings.some((warning) => warning.includes("timestamp")));
    assert.ok(result.warnings.some((warning) => warning.includes("missing")));
    assert.ok(result.warnings.some((warning) => warning.includes("unsupported")));
  });

  it("ignores Microsoft initial-receipt timestamps even when they are valid ISO dates", () => {
    const result = parseDeliveryReports(
      "microsoft_365_csv",
      [
        "message_id,recipient_address,status,Received",
        "m-1,first@example.com,Delivered,2025-03-04T05:06:07+02:00",
        "m-2,second@example.com,Delivered,2025-03-04 05:06:07",
        "m-3,third@example.com,Delivered,2025-03-04",
      ].join("\n"),
    );

    assert.equal(result.reports[0].occurredAt, null);
    assert.equal(result.reports[1].occurredAt, null);
    assert.equal(result.reports[2].occurredAt, null);
    assert.equal(result.warnings.length, 3);
    assert.ok(result.warnings.every((warning) => warning.includes("not a delivery-event timestamp")));
  });

  it("parses the native Microsoft summary Recipient_status shape conservatively", () => {
    const result = parseDeliveryReports(
      "microsoft_365_csv",
      [
        "origin_timestamp,sender_address,Recipient_status,message_id",
        '2025-03-04T05:06:07Z,sender@example.com,"<delivered@example.com>##Receive, Deliver; failed@example.com##Receive, Fail; deferred@example.com##Receive, Defer",m-summary',
        '2025-03-04T05:06:07Z,sender@example.com,"conflict@example.com##Receive, Deliver; conflict@example.com##Receive, Fail; send@example.com##Receive, Send",m-conflict',
        '2025-03-04T05:06:07Z,sender@example.com,"malformed status",m-malformed',
      ].join("\n"),
    );

    assert.deepEqual(
      result.reports.map(({ recipientEmail, outcome, deliveryScope, occurredAt }) => [
        recipientEmail,
        outcome,
        deliveryScope,
        occurredAt,
      ]),
      [
        ["delivered@example.com", "delivered", "mailbox", null],
        ["failed@example.com", "failed", "unspecified", null],
        ["deferred@example.com", "delayed", "unspecified", null],
      ],
    );
    assert.ok(result.warnings.some((warning) => warning.includes("conflicting")));
    assert.ok(result.warnings.some((warning) => warning.includes("no final delivery event")));
    assert.ok(result.warnings.some((warning) => warning.includes("origin_timestamp")));
  });

  it("parses Microsoft extended terminal event IDs for semicolon-separated recipients", () => {
    const result = parseDeliveryReports(
      "microsoft_365_csv",
      [
        "event_id,recipient_address,message_id,date_time,origin_timestamp",
        "DELIVER,one@example.com; two@example.com,m-deliver,2025-04-05T06:07:08Z,2025-04-05T01:00:00Z",
        "FAIL,failed@example.com,m-fail,,",
        "DEFER,deferred@example.com,m-defer,,",
        "SEND,send@example.com,m-send,,",
        "RECEIVE,receive@example.com,m-receive,,",
        "DSN,dsn@example.com,m-dsn,,",
      ].join("\n"),
    );

    assert.deepEqual(
      result.reports.map(({ recipientEmail, outcome, deliveryScope }) => [
        recipientEmail,
        outcome,
        deliveryScope,
      ]),
      [
        ["one@example.com", "delivered", "mailbox"],
        ["two@example.com", "delivered", "mailbox"],
        ["failed@example.com", "failed", "unspecified"],
        ["deferred@example.com", "delayed", "unspecified"],
      ],
    );
    assert.equal(
      result.reports[0].occurredAt.toISOString(),
      "2025-04-05T06:07:08.000Z",
    );
    assert.ok(result.warnings.some((warning) => warning.includes("origin_timestamp")));
    assert.equal(result.warnings.filter((warning) => warning.includes("unsupported status")).length, 3);
  });

  it("does not treat Google Date as a confirmed delivery timestamp", () => {
    const result = parseDeliveryReports(
      "google_workspace_csv",
      [
        "Message ID,Recipient,Event status,Date",
        "g-date,user@example.com,Delivered,2025-04-05T06:07:08Z",
      ].join("\n"),
    );
    assert.equal(result.reports[0].occurredAt, null);
    assert.ok(
      result.warnings.some((warning) =>
        warning.toLowerCase().includes("date is not a delivery-event timestamp"),
      ),
    );
  });

  it("rejects ambiguous columns and malformed CSV explicitly", () => {
    assert.throws(
      () =>
        parseDeliveryReports(
          "microsoft_365_csv",
          "MessageId,message_id,RecipientAddress,Status\nx,x,a@example.com,Delivered",
        ),
      /unambiguous message ID/,
    );
    assert.throws(
      () =>
        parseDeliveryReports(
          "generic_csv",
          'message_id,recipient,status\nid,a@example.com,"Delivered',
        ),
      /Invalid CSV at row/,
    );
  });
});

describe("parseDeliveryReports DSN", () => {
  it("parses multiple MIME recipients and uses the attached original ID, not the bounce ID", () => {
    const content = [
      "From: mailer@example.net",
      "Message-ID: <outer-bounce@example.net>",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="report-boundary"',
      "",
      "This body is not a delivery report.",
      "--report-boundary",
      "Content-Type: text/plain",
      "",
      "Human-readable bounce text.",
      "--report-boundary",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.example.net",
      "Original-Envelope-Id: envelope-123",
      "",
      "Final-Recipient: rfc822; first@example.com",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 no such user",
      "Last-Attempt-Date: 2025-02-03T04:05:06Z",
      "",
      "Original-Recipient: rfc822; <second@example.com>",
      "Action: delayed",
      "Status: 4.2.0",
      "--report-boundary",
      "Content-Type: message/rfc822",
      "",
      "From: sender@example.com",
      "Message-ID: <original-message@example.com>",
      "Subject: Original message",
      "",
      "Original email body.",
      "--report-boundary--",
      "",
    ].join("\r\n");

    const result = parseDeliveryReports("dsn", content);
    assert.equal(result.reports.length, 2);
    assert.deepEqual(
      result.reports.map((report) => report.recipientEmail),
      ["first@example.com", "second@example.com"],
    );
    assert.deepEqual(
      result.reports.map((report) => report.messageId),
      ["<original-message@example.com>", "<original-message@example.com>"],
    );
    assert.equal(result.reports[0].envelopeId, "envelope-123");
    assert.equal(result.reports[0].outcome, "bounced");
    assert.equal(result.reports[0].diagnostic, "smtp; 550 no such user");
    assert.equal(result.reports[0].occurredAt.toISOString(), "2025-02-03T04:05:06.000Z");
    assert.equal(result.reports[1].outcome, "delayed");
    assert.equal(result.reports[0].deliveryScope, "unspecified");
  });

  it("decodes base64 DSN and quoted-printable original headers", () => {
    const dsnPart = [
      "Reporting-MTA: dns; mx.example.net",
      "Original-Envelope-Id: env-456",
      "",
      "Final-Recipient: rfc822; encoded@example.com",
      "Action: delivered",
      "Status: 2.0.0",
    ].join("\r\n");
    const encodedDsn = Buffer.from(dsnPart, "utf8").toString("base64");
    const content = [
      "From: mailer@example.net",
      'Content-Type: multipart/report; boundary="encoding-boundary"',
      "",
      "--encoding-boundary",
      "Content-Type: message/delivery-status",
      "Content-Transfer-Encoding: base64",
      "",
      encodedDsn,
      "--encoding-boundary",
      "Content-Type: text/rfc822-headers",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "From: sender@example.com",
      "Message-ID: <original=2Dqp@example.com>",
      "",
      "--encoding-boundary--",
      "",
    ].join("\r\n");

    const result = parseDeliveryReports("dsn", content);
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].messageId, "<original-qp@example.com>");
    assert.equal(result.reports[0].outcome, "delivered");
  });

  it("parses DSN RFC date-times only when they have an explicit recognized timezone", () => {
    const report = (timestamp) =>
      [
        "Original-Envelope-Id: env-date",
        "",
        "Final-Recipient: rfc822; user@example.com",
        "Action: delayed",
        "Status: 4.2.0",
        `Last-Attempt-Date: ${timestamp}`,
      ].join("\r\n");

    const numeric = parseDeliveryReports(
      "dsn",
      report("Fri, 21 Nov 1997 09:55:06 -0600"),
    );
    assert.equal(numeric.reports[0].occurredAt.toISOString(), "1997-11-21T15:55:06.000Z");

    const named = parseDeliveryReports(
      "dsn",
      report("Fri, 21 Nov 1997 09:55:06 EST"),
    );
    assert.equal(named.reports[0].occurredAt.toISOString(), "1997-11-21T14:55:06.000Z");

    const timezoneLess = parseDeliveryReports(
      "dsn",
      report("Fri, 21 Nov 1997 09:55:06"),
    );
    assert.equal(timezoneLess.reports[0].occurredAt, null);
    assert.ok(timezoneLess.warnings.some((warning) => warning.includes("timezone")));
  });

  it("rejects conflicting attached original IDs and explicit-to-attached ID conflicts", () => {
    const message = ({ explicitId, attachedIds }) =>
      [
        "From: mailer@example.net",
        'Content-Type: multipart/report; boundary="identity-boundary"',
        "",
        "--identity-boundary",
        "Content-Type: message/delivery-status",
        "",
        "Original-Envelope-Id: env-identity",
        ...(explicitId ? [`Original-Message-ID: ${explicitId}`] : []),
        "",
        "Final-Recipient: rfc822; user@example.com",
        "Action: failed",
        "Status: 5.1.1",
        ...attachedIds.flatMap((id) => [
          "--identity-boundary",
          "Content-Type: message/rfc822",
          "",
          "From: sender@example.com",
          `Message-ID: ${id}`,
          "",
          "Original message body.",
        ]),
        "--identity-boundary--",
        "",
      ].join("\r\n");

    assert.throws(
      () =>
        parseDeliveryReports(
          "dsn",
          message({ attachedIds: ["<original-a@example.com>", "<original-b@example.com>"] }),
        ),
      /No interpretable delivery reports/,
    );
    assert.throws(
      () =>
        parseDeliveryReports(
          "dsn",
          message({
            explicitId: "<explicit@example.com>",
            attachedIds: ["<attached@example.com>"],
          }),
        ),
      /No interpretable delivery reports/,
    );
    const duplicateIdentity = parseDeliveryReports(
      "dsn",
      message({
        explicitId: "<same@example.com>",
        attachedIds: ["<same@example.com>", "<same@example.com>"],
      }),
    );
    assert.equal(duplicateIdentity.reports[0].messageId, "<same@example.com>");
  });

  it("accepts bare DSN headers with an explicit Original-Message-ID", () => {
    const result = parseDeliveryReports(
      "dsn",
      [
        "Original-Message-ID: <original@example.com>",
        "",
        "Final-Recipient: rfc822; user@example.com",
        "Action: failed",
        "Status: 5.1.1",
        "Diagnostic-Code: smtp; rejected",
      ].join("\r\n"),
    );

    assert.equal(result.reports[0].messageId, "<original@example.com>");
    assert.equal(result.reports[0].outcome, "bounced");
  });

  it("ignores inconsistent, malformed, non-final and unconfirmed content", () => {
    const inconsistent = [
      "Original-Envelope-Id: env-1",
      "",
      "Final-Recipient: rfc822; user@example.com",
      "Action: failed",
      "Status: 2.1.5",
      "",
      "Final-Recipient: rfc822; malformed-address",
      "Action: delivered",
      "Status: 2.0.0",
      "",
      "Final-Recipient: rfc822; relay@example.com",
      "Action: relayed",
      "Status: 2.0.0",
    ].join("\r\n");
    assert.throws(
      () => parseDeliveryReports("dsn", inconsistent),
      /No interpretable delivery reports/,
    );

    const userBody = [
      "From: sender@example.com",
      "Message-ID: <outer-only@example.com>",
      "Content-Type: text/plain",
      "",
      "Original-Envelope-Id: body-only-envelope",
      "",
      "Final-Recipient: rfc822; user@example.com",
      "Action: failed",
      "Status: 5.1.1",
    ].join("\r\n");
    assert.throws(
      () => parseDeliveryReports("dsn", userBody),
      /No interpretable delivery reports/,
    );
  });

  it("requires an original ID or envelope ID and never uses the outer message ID", () => {
    const noOriginalId = [
      "From: mailer@example.net",
      "Message-ID: <bounce-only@example.net>",
      'Content-Type: multipart/report; boundary="id-boundary"',
      "",
      "--id-boundary",
      "Content-Type: message/delivery-status",
      "",
      "",
      "Final-Recipient: rfc822; user@example.com",
      "Action: failed",
      "Status: 5.1.1",
      "--id-boundary--",
    ].join("\r\n");

    assert.throws(
      () => parseDeliveryReports("dsn", noOriginalId),
      /No interpretable delivery reports/,
    );
  });
});

describe("parseDeliveryReports input bounds", () => {
  it("rejects invalid formats and oversized content", () => {
    assert.throws(
      () => parseDeliveryReports("other", ""),
      /Unsupported delivery report format/,
    );
    assert.throws(
      () => parseDeliveryReports("generic_csv", `x,${"a".repeat(1024 * 1024)}`),
      /1 MB limit/,
    );
  });
});