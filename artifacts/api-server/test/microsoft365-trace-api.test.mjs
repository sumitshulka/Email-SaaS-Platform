import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveMicrosoft365Evidence,
  getMicrosoft365TraceDetails,
  listMicrosoft365Traces,
  requestMicrosoft365AccessToken,
} from "../src/lib/microsoft365-trace-api.ts";

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Microsoft 365 Exchange trace API", () => {
  it("uses app-only client credentials against the specified tenant", async () => {
    let request;
    const token = await requestMicrosoft365AccessToken(
      {
        tenantId: "12345678-1234-4234-8234-123456789abc",
        clientId: "22345678-1234-4234-8234-123456789abc",
        clientSecret: "test-secret-value",
      },
      async (url, init) => {
        request = { url: String(url), init };
        return jsonResponse({ access_token: "test-access-token" });
      },
    );

    assert.equal(token, "test-access-token");
    assert.equal(
      request.url,
      "https://login.microsoftonline.com/12345678-1234-4234-8234-123456789abc/oauth2/v2.0/token",
    );
    assert.equal(request.init.method, "POST");
    const body = new URLSearchParams(request.init.body);
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("scope"), "https://graph.microsoft.com/.default");
    assert.equal(body.get("client_secret"), "test-secret-value");
  });

  it("limits trace searches to a valid 10-day window and follows only Graph trace links", async () => {
    const calls = [];
    const startAt = new Date("2026-09-01T00:00:00.000Z");
    const endAt = new Date("2026-09-02T00:00:00.000Z");
    const result = await listMicrosoft365Traces({
      accessToken: "test-token",
      startAt,
      endAt,
      pageSize: 17,
      fetcher: async (url) => {
        calls.push(String(url));
        return jsonResponse({
          value: [{ id: "trace-1", messageId: "<m1>", recipientAddress: "a@example.test", receivedDateTime: "2026-09-01T01:00:00Z" }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces?$skiptoken=next",
        });
      },
    });

    const requested = new URL(calls[0]);
    assert.equal(requested.searchParams.get("$top"), "17");
    assert.match(requested.searchParams.get("$filter"), /receivedDateTime ge 2026-09-01T00:00:00.000Z/);
    assert.equal(result.traces[0].id, "trace-1");
    assert.equal(result.nextLink, "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces?$skiptoken=next");
    await assert.rejects(
      listMicrosoft365Traces({
        accessToken: "test-token",
        startAt,
        endAt: new Date(startAt.getTime() + 11 * 24 * 60 * 60_000),
        fetcher: async () => {
          throw new Error("Invalid windows must be rejected before making a request.");
        },
      }),
      /10 days/,
    );
    await assert.rejects(
      listMicrosoft365Traces({
        accessToken: "test-token",
        nextLink: "https://attacker.example/v1.0/admin/exchange/tracing/messageTraces",
        fetcher: async () => {
          throw new Error("Untrusted links must be rejected before making a request.");
        },
      }),
      /untrusted paging link/,
    );
  });

  it("encodes recipient detail requests and maps only detail event times to outcomes", async () => {
    let requestedUrl = "";
    const details = await getMicrosoft365TraceDetails({
      accessToken: "test-token",
      traceId: "trace/with space",
      recipientAddress: "person+tag@example.test",
      fetcher: async (url) => {
        requestedUrl = String(url);
        return jsonResponse({ value: [{ event: "DELIVER", dateTime: "2026-09-04T13:10:00Z" }] });
      },
    });
    assert.match(requestedUrl, /trace%2Fwith%20space\/getDetailsByRecipient/);
    assert.match(requestedUrl, /person%2Btag%40example.test/);
    assert.equal(deriveMicrosoft365Evidence(details).occurredAt.toISOString(), "2026-09-04T13:10:00.000Z");
    assert.equal(deriveMicrosoft365Evidence(details).deliveryScope, "mailbox");
  });

  it("distinguishes SEND, DELIVER, FAIL, and DEFER without treating FAIL as a DSN bounce", () => {
    const send = deriveMicrosoft365Evidence([
      { event: "SEND", dateTime: "2026-09-04T13:00:00Z" },
    ]);
    const fail = deriveMicrosoft365Evidence([
      { event: "FAIL", dateTime: "2026-09-04T13:01:00Z" },
    ]);
    const defer = deriveMicrosoft365Evidence([
      { event: "DEFER", dateTime: "2026-09-04T13:02:00Z" },
    ]);

    assert.equal(send.outcome, "delivered");
    assert.equal(send.deliveryScope, "receiving_server");
    assert.equal(fail.outcome, "failed");
    assert.notEqual(fail.outcome, "bounced");
    assert.equal(defer.outcome, "delayed");
    assert.equal(defer.terminal, false);
  });
});