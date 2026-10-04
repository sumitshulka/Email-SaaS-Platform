import { parseDeliveryReports } from "./delivery-report-parser";
import type { ParsedDeliveryReport } from "./delivery-report-parser";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const MAX_MESSAGES_PER_SYNC = 500;
const MAX_RAW_MESSAGE_BYTES = 1024 * 1024;

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  historyId?: string;
  payload?: { headers?: GmailHeader[] };
  raw?: string;
};
type GmailHistory = {
  messagesAdded?: Array<{ message?: { id?: string } }>;
};
type HistoryResponse = {
  history?: GmailHistory[];
  historyId?: string;
  nextPageToken?: string;
};

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history checkpoint expired; reconnect to establish a new baseline.");
    this.name = "GmailHistoryExpiredError";
  }
}

function headerValue(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function isDeliveryStatusContentType(value: string): boolean {
  return /(?:multipart\/report[^;\r\n]*;[^;\r\n]*report-type\s*=\s*"?delivery-status"?|message\/delivery-status)/i.test(
    value,
  );
}

async function requestJson<T>(
  url: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GmailApiError("Could not reach the Gmail API.", 0);
  }
  if (!response.ok) {
    let providerCode: string | undefined;
    try {
      const body = (await response.json()) as {
        error?: { status?: string; code?: number };
      };
      providerCode = body.error?.status;
    } catch {
      // Do not retain Gmail response bodies, which may include account data.
    }
    throw new GmailApiError(
      `Gmail API request failed with status ${response.status}.`,
      response.status,
      providerCode,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new GmailApiError("Gmail API returned an invalid response.", 502);
  }
}

async function loadHistory(
  accessToken: string,
  startHistoryId: string,
  fetcher: typeof fetch,
): Promise<{ messageIds: string[]; historyId: string }> {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let currentHistoryId = startHistoryId;
  let pages = 0;
  do {
    const url = new URL(`${GMAIL_API}/users/me/history`);
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let result: HistoryResponse;
    try {
      result = await requestJson<HistoryResponse>(
        url.toString(),
        accessToken,
        fetcher,
      );
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        throw new GmailHistoryExpiredError();
      }
      throw error;
    }
    if (result.historyId) currentHistoryId = result.historyId;
    for (const entry of result.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id) messageIds.add(id);
      }
    }
    if (messageIds.size > MAX_MESSAGES_PER_SYNC) {
      throw new GmailApiError(
        "Too many new messages for one safe sync window; the checkpoint was not advanced.",
        429,
      );
    }
    pageToken = result.nextPageToken;
    pages += 1;
    if (pages > 20) {
      throw new GmailApiError(
        "Gmail history has too many pages for one safe sync window; the checkpoint was not advanced.",
        429,
      );
    }
  } while (pageToken);
  return { messageIds: [...messageIds], historyId: currentHistoryId };
}

async function loadMetadata(
  accessToken: string,
  messageId: string,
  fetcher: typeof fetch,
): Promise<GmailMessage> {
  const url = new URL(`${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Content-Type");
  return requestJson<GmailMessage>(url.toString(), accessToken, fetcher);
}

async function loadRaw(
  accessToken: string,
  messageId: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const url = new URL(`${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "raw");
  const message = await requestJson<GmailMessage>(url.toString(), accessToken, fetcher);
  if (!message.raw || !/^[A-Za-z0-9_-]+={0,2}$/.test(message.raw)) return null;
  const decoded = Buffer.from(message.raw, "base64url");
  if (decoded.byteLength > MAX_RAW_MESSAGE_BYTES) return null;
  return decoded.toString("utf8");
}

export async function syncGmailHistory(options: {
  accessToken: string;
  startHistoryId: string;
  fetcher?: typeof fetch;
  ingest: (reports: ParsedDeliveryReport[]) => Promise<{
    imported: number;
    duplicates: number;
    unmatched: number;
    ignored: number;
    warnings: string[];
  }>;
}): Promise<{
  historyId: string;
  messagesChecked: number;
  candidateMessages: number;
  imported: number;
  duplicates: number;
  unmatched: number;
  ignored: number;
  warningCount: number;
}> {
  const fetcher = options.fetcher ?? fetch;
  const history = await loadHistory(
    options.accessToken,
    options.startHistoryId,
    fetcher,
  );
  let candidateMessages = 0;
  let imported = 0;
  let duplicates = 0;
  let unmatched = 0;
  let ignored = 0;
  let warningCount = 0;

  const parsedByMessage: Array<ParsedDeliveryReport[]> = [];
  for (let start = 0; start < history.messageIds.length; start += 8) {
    const batch = history.messageIds.slice(start, start + 8);
    const reports = await Promise.all(
      batch.map(async (messageId) => {
        let metadata: GmailMessage;
        try {
          metadata = await loadMetadata(options.accessToken, messageId, fetcher);
        } catch (error) {
          if (error instanceof GmailApiError && error.status === 404) return [];
          throw error;
        }
        const contentType = headerValue(metadata, "Content-Type");
        if (!isDeliveryStatusContentType(contentType)) return [];

        candidateMessages += 1;
        let raw: string | null;
        try {
          raw = await loadRaw(options.accessToken, messageId, fetcher);
        } catch (error) {
          if (error instanceof GmailApiError && error.status === 404) {
            warningCount += 1;
            return [];
          }
          throw error;
        }
        if (!raw) {
          warningCount += 1;
          return [];
        }
        try {
          const parsed = parseDeliveryReports("dsn", raw);
          warningCount += parsed.warnings.length;
          if (parsed.reports.length === 0) warningCount += 1;
          return parsed.reports;
        } catch {
          warningCount += 1;
          return [];
        }
      }),
    );
    parsedByMessage.push(...reports);
  }

  for (const reports of parsedByMessage) {
    if (reports.length === 0) continue;
    const result = await options.ingest(reports);
    imported += result.imported;
    duplicates += result.duplicates;
    unmatched += result.unmatched;
    ignored += result.ignored;
    warningCount += result.warnings.length;
  }

  return {
    historyId: history.historyId,
    messagesChecked: history.messageIds.length,
    candidateMessages,
    imported,
    duplicates,
    unmatched,
    ignored,
    warningCount,
  };
}