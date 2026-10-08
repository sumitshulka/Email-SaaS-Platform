import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GmailApiError,
  GmailHistoryExpiredError,
  GmailRecentScanLimitError,
  GMAIL_RECENT_SCAN_DAYS,
  GMAIL_RECENT_SCAN_MAX_MESSAGES,
  rescanRecentGmailMessages,
  syncGmailHistory,
} from "../src/lib/gmail-api.ts";

const envelopeId = "a1234567-b123-4123-8123-a123456789ab";
const dsn = [
  "From: Mail Delivery Subsystem <mailer@example.test>",
  'Content-Type: multipart/report; boundary="dsn-boundary"; report-type="delivery-status"',
  "",
  "--dsn-boundary",
  "Content-Type: text/plain",
  "",
  "Delivery status notification",
  "--dsn-boundary",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; mx.example.test",
  `Original-Envelope-Id: ${envelopeId}`,
  "",
  "Final-Recipient: rfc822; bounced@example.test",
  "Action: failed",
  "Status: 5.1.1",
  "Diagnostic-Code: smtp; 550 mailbox not found",
  "",
  "--dsn-boundary--",
  "",
].join("\r\n");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Gmail history sync", () => {
  it("fetches raw content only for delivery-status messages and parses DSNs", async () => {
    const calls = [];
    const encodedDsn = Buffer.from(dsn).toString("base64url");
    const fetcher = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          historyId: "history-101",
          history: [
            {
              messagesAdded: [
                { message: { id: "ordinary" } },
                { message: { id: "dsn-one" } },
              ],
            },
          ],
        });
      }
      const messageId = url.pathname.split("/").pop();
      if (url.searchParams.get("format") === "metadata") {
        return jsonResponse({
          id: messageId,
          payload: {
            headers: [
              {
                name: "Content-Type",
                value:
                  messageId === "dsn-one"
                    ? 'multipart/report; boundary="dsn-boundary"; report-type="delivery-status"'
                    : "text/plain",
              },
            ],
          },
        });
      }
      if (url.searchParams.get("format") === "raw") {
        assert.equal(messageId, "dsn-one");
        return jsonResponse({ id: messageId, raw: encodedDsn });
      }
      throw new Error(`Unexpected Gmail API call: ${url}`);
    };

    const ingested = [];
    const result = await syncGmailHistory({
      accessToken: "test-token",
      startHistoryId: "history-100",
      fetcher,
      ingest: async (reports) => {
        ingested.push(...reports);
        return {
          imported: reports.length,
          duplicates: 0,
          unmatched: 0,
          ignored: 0,
          warnings: [],
        };
      },
    });

    assert.equal(result.historyId, "history-101");
    assert.equal(result.messagesChecked, 2);
    assert.equal(result.candidateMessages, 1);
    assert.equal(result.imported, 1);
    assert.equal(ingested.length, 1);
    assert.equal(ingested[0].recipientEmail, "bounced@example.test");
    assert.equal(ingested[0].envelopeId, envelopeId);
    assert.deepEqual(
      calls
        .filter((url) => url.searchParams.get("format") === "raw")
        .map((url) => url.pathname.split("/").pop()),
      ["dsn-one"],
    );
    assert.deepEqual(
      calls
        .filter((url) => url.searchParams.get("format") === "metadata")
        .map((url) => url.searchParams.getAll("metadataHeaders")),
      [["Content-Type"], ["Content-Type"]],
    );
  });

  it("does not advance past an expired Gmail history checkpoint", async () => {
    let ingested = false;
    await assert.rejects(
      syncGmailHistory({
        accessToken: "test-token",
        startHistoryId: "expired-history-id",
        fetcher: async () => jsonResponse({ error: { status: "NOT_FOUND" } }, 404),
        ingest: async () => {
          ingested = true;
          return { imported: 0, duplicates: 0, unmatched: 0, ignored: 0, warnings: [] };
        },
      }),
      GmailHistoryExpiredError,
    );
    assert.equal(ingested, false);
  });

  it("does not ingest a partial paginated history when a later page fails", async () => {
    let ingested = false;
    await assert.rejects(
      syncGmailHistory({
        accessToken: "test-token",
        startHistoryId: "history-100",
        fetcher: async (input) => {
          const url = new URL(String(input));
          if (!url.pathname.endsWith("/history")) {
            throw new Error("Messages must not be loaded before history pagination completes.");
          }
          if (!url.searchParams.has("pageToken")) {
            return jsonResponse({
              historyId: "history-101",
              nextPageToken: "next",
              history: [{ messagesAdded: [{ message: { id: "dsn-one" } }] }],
            });
          }
          return jsonResponse({ error: { status: "INTERNAL" } }, 500);
        },
        ingest: async () => {
          ingested = true;
          return { imported: 0, duplicates: 0, unmatched: 0, ignored: 0, warnings: [] };
        },
      }),
      (error) => error instanceof GmailApiError && error.status === 500,
    );
    assert.equal(ingested, false);
  });
});

describe("bounded recent Gmail rescan", () => {
  it("paginates the 14-day search, skips ordinary bodies, and counts replays as duplicates", async () => {
    const calls = [];
    const seenReports = new Set();
    const encodedDsn = Buffer.from(dsn).toString("base64url");
    const fetcher = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/messages") && !url.pathname.includes("/messages/")) {
        assert.equal(url.searchParams.get("q"), `newer_than:${GMAIL_RECENT_SCAN_DAYS}d`);
        assert.equal(url.searchParams.get("maxResults"), "100");
        if (!url.searchParams.has("pageToken")) {
          return jsonResponse({
            messages: [{ id: "ordinary" }, { id: "bounce-one" }],
            nextPageToken: "next-page",
          });
        }
        assert.equal(url.searchParams.get("pageToken"), "next-page");
        return jsonResponse({ messages: [{ id: "bounce-two" }] });
      }

      const messageId = url.pathname.split("/").pop();
      if (url.searchParams.get("format") === "metadata") {
        return jsonResponse({
          id: messageId,
          payload: {
            headers: [{
              name: "Content-Type",
              value: messageId === "ordinary"
                ? "text/plain"
                : messageId === "bounce-two"
                  ? 'multipart/report; report-type="delivery-status"; boundary="dsn-boundary"'
                  : 'multipart/report; boundary="dsn-boundary"; report-type="delivery-status"',
            }],
          },
        });
      }
      if (url.searchParams.get("format") === "raw") {
        assert.notEqual(messageId, "ordinary");
        return jsonResponse({ id: messageId, raw: encodedDsn });
      }
      throw new Error(`Unexpected Gmail API call: ${url}`);
    };

    const scan = () => rescanRecentGmailMessages({
      accessToken: "test-token",
      fetcher,
      ingest: async (reports) => {
        let imported = 0;
        let duplicates = 0;
        for (const report of reports) {
          const key = `${report.recipientEmail}:${report.envelopeId}`;
          if (seenReports.has(key)) duplicates += 1;
          else {
            seenReports.add(key);
            imported += 1;
          }
        }
        return {
          imported,
          duplicates,
          unmatched: 0,
          ignored: 0,
          warnings: [],
        };
      },
    });

    const first = await scan();
    assert.equal(first.messagesChecked, 3);
    assert.equal(first.candidateMessages, 2);
    assert.equal(first.imported, 1);
    assert.equal(first.duplicates, 1);
    assert.equal(first.ignored, 1);

    const second = await scan();
    assert.equal(second.messagesChecked, 3);
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 2);
    assert.deepEqual(
      calls
        .filter((url) => url.searchParams.get("format") === "raw")
        .map((url) => url.pathname.split("/").pop()),
      ["bounce-one", "bounce-two", "bounce-one", "bounce-two"],
    );
  });

  it("stops at the 500-message cap before fetching metadata or ingesting a partial scan", async () => {
    let listCalls = 0;
    let metadataCalls = 0;
    let ingestCalls = 0;
    const fetcher = async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/messages") || url.pathname.includes("/messages/")) {
        metadataCalls += 1;
        throw new Error("Metadata must not be loaded until list pagination finishes.");
      }
      listCalls += 1;
      const pageNumber = url.searchParams.has("pageToken")
        ? Number(url.searchParams.get("pageToken").replace("page-", ""))
        : 1;
      return jsonResponse({
        messages: Array.from({ length: 100 }, (_, index) => ({
          id: `message-${pageNumber}-${index}`,
        })),
        nextPageToken: `page-${pageNumber + 1}`,
      });
    };

    await assert.rejects(
      rescanRecentGmailMessages({
        accessToken: "test-token",
        fetcher,
        ingest: async () => {
          ingestCalls += 1;
          return {
            imported: 0,
            duplicates: 0,
            unmatched: 0,
            ignored: 0,
            warnings: [],
          };
        },
      }),
      (error) =>
        error instanceof GmailRecentScanLimitError &&
        error instanceof GmailApiError &&
        error.status === 413 &&
        error.message.includes(String(GMAIL_RECENT_SCAN_MAX_MESSAGES)),
    );
    assert.equal(listCalls, 5);
    assert.equal(metadataCalls, 0);
    assert.equal(ingestCalls, 0);
  });
});