const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TOKEN_ROOT = "https://login.microsoftonline.com";
const TRACE_COLLECTION_PATH = "/v1.0/admin/exchange/tracing/messageTraces";
const REQUIRED_PERMISSION = "ExchangeMessageTrace.Read.All";

export type Microsoft365Credentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type Microsoft365Trace = {
  id: string;
  messageId: string;
  recipientAddress: string;
  receivedDateTime: string;
  status?: string;
};

export type Microsoft365TraceDetail = {
  messageId?: string;
  dateTime?: string;
  event?: string;
  action?: string;
  description?: string;
};

export type Microsoft365Evidence = {
  outcome: "delivered" | "failed" | "delayed";
  occurredAt: Date;
  deliveryScope: "mailbox" | "receiving_server" | "unspecified";
  diagnostic: string;
  terminal: boolean;
};

type ODataCollection<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
};

export class Microsoft365TraceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "Microsoft365TraceApiError";
  }
}

function safeProviderCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(code)
    ? code
    : undefined;
}

function retryDelay(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function readJson<T>(
  response: Response,
  service: "identity" | "trace",
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Microsoft365TraceApiError(
      service === "trace"
        ? "Microsoft Graph message-trace API returned an invalid response."
        : "Microsoft identity service returned an invalid response.",
      response.status || 502,
    );
  }
  if (!response.ok) {
    const status = response.status;
    const message =
      status === 401 || status === 403
        ? "Microsoft did not authorize Exchange message-trace access. Check the tenant admin consent and Exchange trace service-principal setup."
        : status === 429
          ? "Microsoft is throttling message-trace requests."
      : service === "trace"
        ? `Microsoft Graph message-trace request failed with status ${status}.`
        : `Microsoft identity request failed with status ${status}.`;
    throw new Microsoft365TraceApiError(
      message,
      status,
      safeProviderCode(body),
      retryDelay(response),
    );
  }
  return body as T;
}

export async function requestMicrosoft365AccessToken(
  credentials: Microsoft365Credentials,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(
      `${TOKEN_ROOT}/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Microsoft365TraceApiError(
      "Could not reach Microsoft's identity service.",
      0,
    );
  }
  const token = await readJson<{ access_token?: unknown }>(response, "identity");
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Microsoft365TraceApiError(
      "Microsoft identity service did not return an access token.",
      502,
    );
  }
  return token.access_token;
}

async function graphGet<T>(
  accessToken: string,
  url: string,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Microsoft365TraceApiError(
      "Could not reach the Microsoft Graph message-trace API.",
      0,
    );
  }
  return readJson<T>(response, "trace");
}

function trustedNextLink(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Microsoft365TraceApiError(
      "Microsoft Graph returned an invalid paging link.",
      502,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "graph.microsoft.com" ||
    !parsed.pathname.startsWith(TRACE_COLLECTION_PATH)
  ) {
    throw new Microsoft365TraceApiError(
      "Microsoft Graph returned an untrusted paging link.",
      502,
    );
  }
  return parsed.toString();
}

export async function listMicrosoft365Traces(options: {
  accessToken: string;
  startAt?: Date;
  endAt?: Date;
  pageSize?: number;
  nextLink?: string | null;
  fetcher?: typeof fetch;
}): Promise<{ traces: Microsoft365Trace[]; nextLink: string | null }> {
  const fetcher = options.fetcher ?? fetch;
  let url: string;
  if (options.nextLink) {
    url = trustedNextLink(options.nextLink);
  } else {
    if (!options.startAt || !options.endAt) {
      throw new Error("A message-trace time window is required.");
    }
    const duration = options.endAt.getTime() - options.startAt.getTime();
    if (duration <= 0 || duration > 10 * 24 * 60 * 60 * 1000) {
      throw new Error("Microsoft trace windows must be from 0 to 10 days.");
    }
    const query = new URLSearchParams();
    query.set(
      "$filter",
      `receivedDateTime ge ${options.startAt.toISOString()} and receivedDateTime le ${options.endAt.toISOString()}`,
    );
    const pageSize = options.pageSize ?? 5000;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
      throw new Error("Microsoft trace page sizes must be from 1 to 5,000.");
    }
    query.set("$top", String(pageSize));
    url = `${GRAPH_ROOT}/admin/exchange/tracing/messageTraces?${query}`;
  }

  const result = await graphGet<ODataCollection<Microsoft365Trace>>(
    options.accessToken,
    url,
    fetcher,
  );
  return {
    traces: Array.isArray(result.value) ? result.value : [],
    nextLink: result["@odata.nextLink"]
      ? trustedNextLink(result["@odata.nextLink"])
      : null,
  };
}

export async function getMicrosoft365TraceDetails(options: {
  accessToken: string;
  traceId: string;
  recipientAddress: string;
  fetcher?: typeof fetch;
}): Promise<Microsoft365TraceDetail[]> {
  const fetcher = options.fetcher ?? fetch;
  const recipient = options.recipientAddress.replace(/'/g, "''");
  const url =
    `${GRAPH_ROOT}/admin/exchange/tracing/messageTraces/` +
    `${encodeURIComponent(options.traceId)}/getDetailsByRecipient(` +
    `recipientAddress='${encodeURIComponent(recipient)}')`;
  const result = await graphGet<ODataCollection<Microsoft365TraceDetail>>(
    options.accessToken,
    url,
    fetcher,
  );
  return Array.isArray(result.value) ? result.value : [];
}

function validEventTime(value: string | undefined): Date | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time : null;
}

function cleanDiagnostic(value: string | undefined): string {
  return (
    value
      ?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000) ?? ""
  );
}

export function deriveMicrosoft365Evidence(
  details: Microsoft365TraceDetail[],
): Microsoft365Evidence | null {
  const candidates = details
    .map((detail) => ({
      detail,
      event: detail.event?.trim().toLowerCase() ?? "",
      occurredAt: validEventTime(detail.dateTime),
    }))
    .filter((entry) => entry.occurredAt !== null)
    .sort(
      (left, right) =>
        left.occurredAt!.getTime() - right.occurredAt!.getTime(),
    );
  let evidence: Microsoft365Evidence | null = null;

  for (const { detail, event, occurredAt } of candidates) {
    const timestamp = occurredAt!;
    const description = cleanDiagnostic(detail.description);
    if (event === "deliver") {
      evidence = {
        outcome: "delivered",
        occurredAt: timestamp,
        deliveryScope: "mailbox",
        diagnostic: description || "Exchange trace recorded a DELIVER event.",
        terminal: true,
      };
    } else if (event === "send") {
      evidence = {
        outcome: "delivered",
        occurredAt: timestamp,
        deliveryScope: "receiving_server",
        diagnostic:
          description ||
          "Exchange trace recorded SEND (transmission to another server), not mailbox delivery.",
        terminal: true,
      };
    } else if (event === "fail") {
      evidence = {
        outcome: "failed",
        occurredAt: timestamp,
        deliveryScope: "unspecified",
        diagnostic: description || "Exchange trace recorded a FAIL event.",
        terminal: true,
      };
    } else if (event === "defer") {
      evidence = {
        outcome: "delayed",
        occurredAt: timestamp,
        deliveryScope: "unspecified",
        diagnostic: description || "Exchange trace recorded a DEFER event.",
        terminal: false,
      };
    }
  }
  return evidence;
}

export const microsoft365TraceMetadata = {
  source: "microsoft_365_graph" as const,
  evidenceVerification: "microsoft365_authorized" as const,
  permission: REQUIRED_PERMISSION,
  apiBaseUrl: GRAPH_ROOT,
  maxRetentionDays: 90,
  maxWindowDays: 10,
  maxPageSize: 5000,
  listAndDetailsRequestsPerFiveMinutes: 100,
  traceServicePrincipalAppId: "8bd644d1-64a1-4d4b-ae52-2e0cbf64e373",
};