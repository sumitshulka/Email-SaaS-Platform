import {
  CsvSyntaxError,
  normalizeCsvHeader,
  parseCsvRecords,
} from "./contact-csv";

export type ParsedDeliveryReport = {
  recipientEmail: string;
  messageId: string | null;
  envelopeId: string | null;
  outcome: "delivered" | "bounced" | "delayed" | "failed";
  source:
    | "dsn"
    | "microsoft_365_csv"
    | "microsoft_365_graph"
    | "google_workspace_csv"
    | "generic_csv";
  diagnostic: string | null;
  enhancedStatus: string | null;
  occurredAt: Date | null;
  deliveryScope: "mailbox" | "receiving_server" | "unspecified";
};

export type DeliveryReportFormat =
  | "dsn"
  | "microsoft_365_csv"
  | "google_workspace_csv"
  | "generic_csv";

type DsnRecipient = {
  recipient: string | null;
  action: string | null;
  status: string | null;
  diagnostic: string | null;
  occurredAt: string | null;
};

type DsnPart = {
  messageId: string | null;
  envelopeId: string | null;
  recipients: DsnRecipient[];
};

type MimeCollection = {
  dsnParts: DsnPart[];
  attachedMessageIds: string[];
  warnings: string[];
};

const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_REPORTS = 1000;
const MAX_DIAGNOSTIC_LENGTH = 1000;
const MAX_WARNINGS = 30;
const MAX_MIME_DEPTH = 5;

function addWarning(warnings: string[], warning: string): void {
  if (warnings.length < MAX_WARNINGS) warnings.push(warning);
}

function requiredValue(fields: Map<string, string[]>, name: string): string | null {
  const values = fields.get(name.toLowerCase());
  if (!values || values.length !== 1) return null;
  const value = values[0]!.trim();
  return value.length > 0 && value.length <= 1000 ? value : null;
}

function parseHeaderFields(block: string): Map<string, string[]> | null {
  const fields = new Map<string, string[]>();
  let currentName: string | null = null;
  for (const line of block.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line)) {
      if (!currentName) return null;
      const values = fields.get(currentName)!;
      values[values.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (line.trim() === "") continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!match) return null;
    currentName = match[1]!.toLowerCase();
    const values = fields.get(currentName) ?? [];
    values.push(match[2]!.trim());
    fields.set(currentName, values);
  }
  return fields;
}

function splitHeaderBody(value: string): { headers: string; body: string } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(value);
  if (!match || match.index === undefined) return null;
  return {
    headers: value.slice(0, match.index),
    body: value.slice(match.index + match[0].length),
  };
}

function splitDsnBlocks(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function dsnAddress(value: string | null): string | null {
  if (!value) return null;
  const match = /^\s*rfc822\s*;\s*(.*?)\s*$/i.exec(value);
  if (!match) return null;
  let address = match[1]!.trim();
  if (address.startsWith("<") && address.endsWith(">")) {
    address = address.slice(1, -1).trim();
  }
  return isMailbox(address) ? address : null;
}

function isMailbox(value: string): boolean {
  if (value.length > 320 || /[\s<>(),;:\u0000-\u001f\u007f]/.test(value)) return false;
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (local.length > 64 || domain.length > 255) return false;
  const atom = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+$/i;
  const label = /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i;
  return (
    local.split(".").every((part) => atom.test(part)) &&
    domain.split(".").every((part) => label.test(part))
  );
}

function cleanId(value: string | null): string | null {
  if (!value || value.length > 1000 || /[\r\n\u0000]/.test(value)) return null;
  return value.trim() || null;
}

function parseStrictIsoTimestamp(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== "Z" &&
      (Number(zone.slice(1, 3)) > 14 ||
        Number(zone.slice(4, 6)) > 59 ||
        (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4, 6)) !== 0)))
  ) {
    return null;
  }
  const datePart = `${year}-${month}-${day}`;
  const calendarDate = new Date(`${datePart}T00:00:00Z`);
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== datePart
  ) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseRfcDateTime(value: string): Date | null {
  const match =
    /^(?:[A-Za-z]{3},[ \t]*)?(\d{1,2})[ \t]+([A-Za-z]{3})[ \t]+(\d{4})[ \t]+(\d{2}):(\d{2}):(\d{2})[ \t]+(Z|UT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{4})(?:[ \t]+\([A-Za-z]{1,8}\))?$/i.exec(
      value,
    );
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText, secondText, zoneText] =
    match;
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const month = months.indexOf(monthText!.toLowerCase());
  const year = Number(yearText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 0 || hour > 23 || minute > 59 || second > 59) return null;
  const monthNumber = month + 1;
  const checkDate = new Date(`${yearText}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
  if (
    !Number.isFinite(checkDate.getTime()) ||
    checkDate.toISOString().slice(0, 10) !==
      `${yearText}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  ) {
    return null;
  }

  const namedOffsets: Record<string, number> = {
    z: 0,
    ut: 0,
    utc: 0,
    gmt: 0,
    est: -5 * 60,
    edt: -4 * 60,
    cst: -6 * 60,
    cdt: -5 * 60,
    mst: -7 * 60,
    mdt: -6 * 60,
    pst: -8 * 60,
    pdt: -7 * 60,
  };
  const zone = zoneText!.toUpperCase();
  let offsetMinutes: number;
  if (zone.toLowerCase() in namedOffsets) {
    offsetMinutes = namedOffsets[zone.toLowerCase()]!;
  } else {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetRemainder = Number(zone.slice(3, 5));
    if (
      offsetHours > 14 ||
      offsetRemainder > 59 ||
      (offsetHours === 14 && offsetRemainder !== 0)
    ) {
      return null;
    }
    const direction = zone[0] === "+" ? 1 : -1;
    offsetMinutes = direction * (offsetHours * 60 + offsetRemainder);
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  date.setTime(date.getTime() - offsetMinutes * 60_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseCsvTimestamp(
  raw: string | null,
  warnings: string[],
  label: string,
): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  const date = parseStrictIsoTimestamp(value);
  if (!date) {
    addWarning(warnings, `${label} timestamp is malformed or not a full ISO value with timezone; ignored.`);
  }
  return date;
}

function parseDsnTimestamp(
  raw: string | null,
  warnings: string[],
): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  const date = parseStrictIsoTimestamp(value) ?? parseRfcDateTime(value);
  if (!date) {
    addWarning(warnings, "DSN timestamp is malformed or has no recognized timezone; ignored.");
  }
  return date;
}

function parseDsnFields(text: string, strict: boolean): DsnPart | null {
  const blocks = splitDsnBlocks(text);
  const parsed = blocks.map(parseHeaderFields);
  if (blocks.length === 0 || (strict && parsed.some((fields) => fields === null))) {
    return null;
  }

  let messageId: string | null = null;
  let envelopeId: string | null = null;
  const recipients: DsnRecipient[] = [];
  for (const fields of parsed) {
    if (!fields) continue;
    messageId ??= cleanId(requiredValue(fields, "original-message-id"));
    envelopeId ??= cleanId(requiredValue(fields, "original-envelope-id"));

    const finalRecipientValues = fields.get("final-recipient");
    const originalRecipientValues = fields.get("original-recipient");
    const recipientField =
      finalRecipientValues?.length === 1
        ? finalRecipientValues[0]!
        : !finalRecipientValues && originalRecipientValues?.length === 1
          ? originalRecipientValues[0]!
          : null;
    const action = requiredValue(fields, "action");
    const status = requiredValue(fields, "status");
    if (recipientField !== null || action !== null || status !== null) {
      recipients.push({
        recipient: dsnAddress(recipientField),
        action,
        status,
        diagnostic:
          requiredValue(fields, "diagnostic-code")?.slice(0, MAX_DIAGNOSTIC_LENGTH) ??
          null,
        occurredAt:
          requiredValue(fields, "last-attempt-date") ??
          requiredValue(fields, "arrival-date"),
      });
    }
  }
  if (recipients.length === 0) return null;
  return { messageId, envelopeId, recipients };
}

function parseBareDsn(text: string): DsnPart | null {
  const blocks = splitDsnBlocks(text);
  if (blocks.length === 0) return null;
  const allowedFields = new Set([
    "reporting-mta",
    "original-envelope-id",
    "original-message-id",
    "arrival-date",
    "final-recipient",
    "original-recipient",
    "action",
    "status",
    "remote-mta",
    "diagnostic-code",
    "last-attempt-date",
    "will-retry-until",
  ]);
  const parsed = blocks.map(parseHeaderFields);
  if (
    parsed.some(
      (fields) =>
        !fields || [...fields.keys()].some((name) => !allowedFields.has(name)),
    )
  ) {
    return null;
  }
  const combined = new Map<string, string[]>();
  for (const fields of parsed) {
    if (!fields) continue;
    for (const [name, values] of fields) {
      combined.set(name, [...(combined.get(name) ?? []), ...values]);
    }
  }
  if (
    !requiredValue(combined, "original-message-id") &&
    !requiredValue(combined, "original-envelope-id")
  ) {
    return null;
  }
  return parseDsnFields(text, true);
}

function decodeTransferEncoding(
  body: string,
  encoding: string,
  warnings: string[],
): string | null {
  const normalized = encoding.trim().toLowerCase();
  let decoded: string;
  if (!normalized || ["7bit", "8bit", "binary"].includes(normalized)) {
    decoded = body;
  } else if (normalized === "base64") {
    const compact = body.replace(/\s/g, "");
    if (
      compact.length > MAX_CONTENT_BYTES * 2 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
      compact.length % 4 === 1
    ) {
      addWarning(warnings, "Malformed MIME base64 part was ignored.");
      return null;
    }
    decoded = Buffer.from(compact, "base64").toString("utf8");
  } else if (normalized === "quoted-printable") {
    if (/=(?![0-9A-Fa-f]{2}|\r?\n)/.test(body)) {
      addWarning(warnings, "Malformed MIME quoted-printable part was ignored.");
      return null;
    }
    const withoutSoftBreaks = body.replace(/=\r?\n/g, "");
    const latin1 = withoutSoftBreaks.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    decoded = Buffer.from(latin1, "latin1").toString("utf8");
  } else {
    addWarning(warnings, `Unsupported MIME transfer encoding "${normalized}" was ignored.`);
    return null;
  }
  if (Buffer.byteLength(decoded, "utf8") > MAX_CONTENT_BYTES) {
    addWarning(warnings, "Oversized decoded MIME part was ignored.");
    return null;
  }
  return decoded;
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (line === `--${boundary}` || line === `--${boundary}--`) {
      if (current) parts.push(current.join("\r\n"));
      current = line.endsWith("--") ? null : [];
    } else if (current) {
      current.push(line);
    }
  }
  return parts;
}

function parseOriginalMessageId(text: string, headersOnly: boolean): string | null {
  const split = splitHeaderBody(text);
  const headerText = split ? split.headers : headersOnly ? text : text;
  const fields = parseHeaderFields(headerText);
  return fields ? cleanId(requiredValue(fields, "message-id")) : null;
}

function collectMime(
  raw: string,
  depth: number,
  collection: MimeCollection,
  isRoot = false,
): void {
  if (depth > MAX_MIME_DEPTH) {
    addWarning(collection.warnings, "MIME nesting exceeded the supported depth; part ignored.");
    return;
  }
  const split = splitHeaderBody(raw);
  if (!split) {
    if (isRoot) {
      const plain = parseBareDsn(raw);
      if (plain) collection.dsnParts.push(plain);
    }
    return;
  }
  const outerHeaders = parseHeaderFields(split.headers);
  if (!outerHeaders) {
    addWarning(collection.warnings, "Malformed MIME headers were ignored.");
    return;
  }
  const contentType = requiredValue(outerHeaders, "content-type") ?? "text/plain";
  const transferEncoding =
    requiredValue(outerHeaders, "content-transfer-encoding") ?? "7bit";
  const body = decodeTransferEncoding(split.body, transferEncoding, collection.warnings);
  if (body === null) return;

  if (/^multipart\//i.test(contentType)) {
    const boundaryMatch = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(
      contentType,
    );
    const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? boundaryMatch?.[3];
    if (!boundary || boundary.length > 200) {
      addWarning(collection.warnings, "Multipart MIME boundary is missing or invalid.");
      return;
    }
    for (const part of splitMultipart(body, boundary)) {
      collectMime(part, depth + 1, collection);
    }
    return;
  }

  const mediaType = contentType.split(";")[0]!.trim().toLowerCase();
  if (mediaType === "message/delivery-status") {
    const dsn = parseDsnFields(body, true);
    if (dsn) collection.dsnParts.push(dsn);
    else addWarning(collection.warnings, "Malformed delivery-status part was ignored.");
  } else if (mediaType === "message/rfc822") {
    const messageId = parseOriginalMessageId(body, false);
    if (messageId) collection.attachedMessageIds.push(messageId);
  } else if (
    mediaType === "text/rfc822-headers" ||
    mediaType === "message/global-headers"
  ) {
    const messageId = parseOriginalMessageId(body, true);
    if (messageId) collection.attachedMessageIds.push(messageId);
  }
}

function dsnOutcome(
  actionRaw: string | null,
  statusRaw: string | null,
): "delivered" | "bounced" | "delayed" | null {
  if (!actionRaw || !statusRaw) return null;
  const action = actionRaw.trim().toLowerCase();
  const statusMatch = /^([245])\.\d{1,3}\.\d{1,3}$/.exec(statusRaw.trim());
  if (!statusMatch) return null;
  const statusClass = statusMatch[1];
  if (action === "delivered" && statusClass === "2") return "delivered";
  if (action === "failed" && statusClass === "5") return "bounced";
  if (action === "delayed" && statusClass === "4") return "delayed";
  return null;
}

function parseDsn(
  content: string,
  warnings: string[],
): ParsedDeliveryReport[] {
  const collection: MimeCollection = {
    dsnParts: [],
    attachedMessageIds: [],
    warnings,
  };
  const strictPlainDsn = parseBareDsn(content);
  if (strictPlainDsn) {
    collection.dsnParts.push(strictPlainDsn);
  } else {
    collectMime(content, 0, collection, true);
  }

  const attachedMessageIds = new Set(collection.attachedMessageIds);
  if (attachedMessageIds.size > 1) {
    addWarning(warnings, "Conflicting attached original message IDs were found.");
  }
  const attachedMessageId =
    attachedMessageIds.size === 1
      ? collection.attachedMessageIds[0] ?? null
      : null;

  const reports: ParsedDeliveryReport[] = [];
  for (const part of collection.dsnParts) {
    for (const recipient of part.recipients) {
      const action = recipient.action?.trim().toLowerCase() ?? "";
      if (action === "relayed" || action === "expanded") {
        addWarning(warnings, `Non-final DSN action "${action}" was ignored.`);
        continue;
      }
      const outcome = dsnOutcome(recipient.action, recipient.status);
      if (!outcome) {
        addWarning(warnings, "DSN action and enhanced status were missing or inconsistent.");
        continue;
      }
      if (!recipient.recipient) {
        addWarning(warnings, "DSN recipient was missing or invalid.");
        continue;
      }
      if (attachedMessageIds.size > 1) {
        addWarning(warnings, "DSN report with ambiguous attached original IDs was ignored.");
        continue;
      }
      if (
        part.messageId &&
        attachedMessageId &&
        part.messageId !== attachedMessageId
      ) {
        addWarning(warnings, "DSN original message ID conflicts with its attached original; ignored.");
        continue;
      }
      const messageId = part.messageId ?? attachedMessageId;
      if (!messageId && !part.envelopeId) {
        addWarning(warnings, "DSN report without an original message or envelope ID was ignored.");
        continue;
      }
      if (reports.length >= MAX_REPORTS) {
        addWarning(warnings, "Report limit reached; remaining DSN reports were ignored.");
        return reports;
      }
      reports.push({
        recipientEmail: recipient.recipient,
        messageId,
        envelopeId: part.envelopeId,
        outcome,
        source: "dsn",
        diagnostic: recipient.diagnostic,
        enhancedStatus: recipient.status,
        occurredAt: parseDsnTimestamp(recipient.occurredAt, warnings),
        deliveryScope: "unspecified",
      });
    }
  }
  return reports;
}

type CsvStatusResult = {
  outcome: ParsedDeliveryReport["outcome"];
  deliveryScope: ParsedDeliveryReport["deliveryScope"];
} | null;

function csvStatus(
  format: DeliveryReportFormat,
  status: string,
): CsvStatusResult {
  const value = status.trim().toLowerCase();
  if (format === "microsoft_365_csv") {
    if (value === "delivered") return { outcome: "delivered", deliveryScope: "unspecified" };
    if (value === "failed") return { outcome: "failed", deliveryScope: "unspecified" };
    return null;
  }
  if (format === "google_workspace_csv") {
    if (value === "bounced") return { outcome: "bounced", deliveryScope: "unspecified" };
    if (value === "delivered to gmail inbox") {
      return { outcome: "delivered", deliveryScope: "mailbox" };
    }
    if (value === "delivered to smtp server") {
      return { outcome: "delivered", deliveryScope: "receiving_server" };
    }
    if (value === "delivered") return { outcome: "delivered", deliveryScope: "unspecified" };
    return null;
  }
  if (format === "generic_csv") {
    if (value === "delivered") return { outcome: "delivered", deliveryScope: "unspecified" };
    if (value === "bounced") return { outcome: "bounced", deliveryScope: "unspecified" };
    if (value === "delayed") return { outcome: "delayed", deliveryScope: "unspecified" };
    if (value === "failed") return { outcome: "failed", deliveryScope: "unspecified" };
  }
  return null;
}

function normalizeReportMailbox(raw: string): string | null {
  let value = raw.trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
  return isMailbox(value) ? value : null;
}

function splitSemicolonLimited(
  value: string,
  limit = MAX_REPORTS,
): { entries: string[]; truncated: boolean } {
  const entries: string[] = [];
  let start = 0;
  while (entries.length < limit) {
    const separator = value.indexOf(";", start);
    if (separator < 0) {
      entries.push(value.slice(start));
      return { entries, truncated: false };
    }
    entries.push(value.slice(start, separator));
    start = separator + 1;
  }
  return { entries, truncated: start < value.length };
}

function parseMicrosoftSummaryCell(
  raw: string,
  rowNumber: number,
  warnings: string[],
): Array<{ recipientEmail: string; outcome: ParsedDeliveryReport["outcome"]; deliveryScope: ParsedDeliveryReport["deliveryScope"] }> {
  const { entries, truncated } = splitSemicolonLimited(raw);
  if (truncated) {
    addWarning(warnings, `CSV row ${rowNumber} has too many recipient entries; extras were ignored.`);
  }
  const recipients = new Map<
    string,
    Set<ParsedDeliveryReport["outcome"]>
  >();
  for (const entry of entries) {
    const separator = entry.indexOf("##");
    if (separator <= 0 || separator !== entry.lastIndexOf("##")) {
      addWarning(warnings, `CSV row ${rowNumber} has a malformed recipient-status entry; ignored.`);
      continue;
    }
    const recipientEmail = normalizeReportMailbox(entry.slice(0, separator));
    if (!recipientEmail) {
      addWarning(warnings, `CSV row ${rowNumber} has an invalid recipient; ignored.`);
      continue;
    }
    const tokens = entry
      .slice(separator + 2)
      .split(",")
      .map((token) => token.trim().toLowerCase());
    if (
      tokens.length === 0 ||
      tokens.some((token) => !["receive", "send", "deliver", "fail", "defer"].includes(token))
    ) {
      addWarning(warnings, `CSV row ${rowNumber} has unsupported recipient-status tokens; ignored.`);
      continue;
    }
    const outcomes = new Set<ParsedDeliveryReport["outcome"]>();
    if (tokens.includes("deliver")) outcomes.add("delivered");
    if (tokens.includes("fail")) outcomes.add("failed");
    if (tokens.includes("defer")) outcomes.add("delayed");
    if (outcomes.size === 0) {
      addWarning(warnings, `CSV row ${rowNumber} has no final delivery event; ignored.`);
      continue;
    }
    const priorOutcomes = recipients.get(recipientEmail) ?? new Set();
    for (const outcome of outcomes) priorOutcomes.add(outcome);
    recipients.set(recipientEmail, priorOutcomes);
  }

  const reports: Array<{
    recipientEmail: string;
    outcome: ParsedDeliveryReport["outcome"];
    deliveryScope: ParsedDeliveryReport["deliveryScope"];
  }> = [];
  for (const [recipientEmail, outcomes] of recipients) {
    if (outcomes.size !== 1) {
      addWarning(warnings, `CSV row ${rowNumber} has conflicting recipient outcomes; ignored.`);
      continue;
    }
    const outcome = [...outcomes][0]!;
    reports.push({
      recipientEmail,
      outcome,
      deliveryScope: outcome === "delivered" ? "mailbox" : "unspecified",
    });
  }
  return reports;
}

function findColumn(
  headers: string[],
  aliases: string[],
): number | null {
  const matches = headers
    .map((header, index) => (aliases.includes(header) ? index : -1))
    .filter((index) => index >= 0);
  return matches.length === 1 ? matches[0]! : null;
}

function parseCsv(
  format: DeliveryReportFormat,
  content: string,
  warnings: string[],
): ParsedDeliveryReport[] {
  let records;
  try {
    records = parseCsvRecords(content);
  } catch (error) {
    if (error instanceof CsvSyntaxError) {
      throw new Error(`Invalid CSV at row ${error.rowNumber}: ${error.message}`);
    }
    throw error;
  }
  if (records.length === 0) return [];

  const headers = records[0]!.cells.map(normalizeCsvHeader);
  const idColumn = findColumn(headers, ["message_id", "messageid"]);
  const microsoftRecipientStatusMatches = headers
    .map((header, index) => (header === "recipient_status" ? index : -1))
    .filter((index) => index >= 0);
  if (
    format === "microsoft_365_csv" &&
    microsoftRecipientStatusMatches.length > 1
  ) {
    throw new Error("CSV has ambiguous Microsoft Recipient_status columns.");
  }
  const microsoftSummaryColumn =
    format === "microsoft_365_csv"
      ? microsoftRecipientStatusMatches[0] ?? null
      : null;
  const recipientAliases =
    format === "google_workspace_csv"
      ? ["recipient", "recipient_address", "recipientaddress"]
      : format === "microsoft_365_csv"
        ? ["recipient_address", "recipientaddress", "recipient"]
        : ["recipient_email", "recipient_address", "recipientaddress", "recipient", "email"];
  const recipientColumn = findColumn(headers, recipientAliases);
  const statusAliases =
    format === "google_workspace_csv"
      ? ["event_status", "status"]
      : format === "microsoft_365_csv"
        ? ["status", "event_status", "event_id"]
        : ["status", "event_status"];
  const statusColumn = findColumn(headers, statusAliases);
  const timestampAliases = [
    "occurred_at",
    "timestamp",
    "event_time",
    "event_timestamp",
    "date_time",
  ];
  const timestampColumn = findColumn(headers, timestampAliases);
  if (
    timestampColumn === null &&
    headers.filter((header) => timestampAliases.includes(header)).length > 1
  ) {
    addWarning(warnings, "CSV has ambiguous timestamp columns; timestamps were ignored.");
  }
  if (
    idColumn === null ||
    (microsoftSummaryColumn === null &&
      (recipientColumn === null || statusColumn === null))
  ) {
    throw new Error(
      `CSV is missing an unambiguous message ID, recipient, or status column for ${format}.`,
    );
  }
  const source =
    format === "microsoft_365_csv"
      ? "microsoft_365_csv"
      : format === "google_workspace_csv"
        ? "google_workspace_csv"
        : "generic_csv";
  const reports: ParsedDeliveryReport[] = [];
  for (const record of records.slice(1)) {
    const messageId = cleanId(record.cells[idColumn]?.trim() ?? null);
    if (!messageId) {
      addWarning(warnings, `CSV row ${record.rowNumber} is missing a valid message ID; ignored.`);
      continue;
    }

    for (const ignoredHeader of [
      "date",
      ...(format === "microsoft_365_csv"
        ? ["origin_timestamp", "received"]
        : []),
    ]) {
      const ignoredColumn = headers.indexOf(ignoredHeader);
      if (
        ignoredColumn >= 0 &&
        (record.cells[ignoredColumn]?.trim() ?? "") !== ""
      ) {
        addWarning(
          warnings,
          `CSV row ${record.rowNumber} ${ignoredHeader} is not a delivery-event timestamp; ignored.`,
        );
      }
    }
    const timestamp =
      timestampColumn === null ? null : record.cells[timestampColumn]?.trim() || null;
    const occurredAt = parseCsvTimestamp(
      timestamp,
      warnings,
      `CSV row ${record.rowNumber}`,
    );

    if (microsoftSummaryColumn !== null) {
      const summary = record.cells[microsoftSummaryColumn]?.trim() ?? "";
      if (!summary) {
        addWarning(warnings, `CSV row ${record.rowNumber} has no Recipient_status entries; ignored.`);
        continue;
      }
      const outcomes = parseMicrosoftSummaryCell(summary, record.rowNumber, warnings);
      for (const outcome of outcomes) {
        if (reports.length >= MAX_REPORTS) {
          addWarning(warnings, "Report limit reached; remaining CSV recipients were ignored.");
          break;
        }
        reports.push({
          recipientEmail: outcome.recipientEmail,
          messageId,
          envelopeId: null,
          outcome: outcome.outcome,
          source,
          diagnostic: null,
          enhancedStatus: null,
          occurredAt: occurredAt ? new Date(occurredAt.getTime()) : null,
          deliveryScope: outcome.deliveryScope,
        });
      }
      if (reports.length >= MAX_REPORTS) break;
      continue;
    }

    const recipientValue = record.cells[recipientColumn!]?.trim() ?? "";
    const status = record.cells[statusColumn!]?.trim() ?? "";
    if (!recipientValue || !status) {
      addWarning(warnings, `CSV row ${record.rowNumber} is missing a recipient or status; ignored.`);
      continue;
    }

    const isMicrosoftEventId =
      format === "microsoft_365_csv" && headers[statusColumn!] === "event_id";
    let mappedStatus = csvStatus(format, status);
    if (isMicrosoftEventId) {
      const event = status.toUpperCase();
      mappedStatus =
        event === "DELIVER"
          ? { outcome: "delivered", deliveryScope: "mailbox" }
          : event === "FAIL"
            ? { outcome: "failed", deliveryScope: "unspecified" }
            : event === "DEFER"
              ? { outcome: "delayed", deliveryScope: "unspecified" }
              : null;
    }
    if (!mappedStatus) {
      addWarning(warnings, `CSV row ${record.rowNumber} has an unsupported status; ignored.`);
      continue;
    }

    const recipients =
      format === "microsoft_365_csv"
        ? splitSemicolonLimited(recipientValue)
        : { entries: [recipientValue], truncated: false };
    if (recipients.truncated) {
      addWarning(warnings, `CSV row ${record.rowNumber} has too many recipients; extras were ignored.`);
    }
    for (const rawRecipient of recipients.entries) {
      const recipientEmail = normalizeReportMailbox(rawRecipient);
      if (!recipientEmail) {
        addWarning(warnings, `CSV row ${record.rowNumber} has an invalid recipient; ignored.`);
        continue;
      }
      if (reports.length >= MAX_REPORTS) {
        addWarning(warnings, "Report limit reached; remaining CSV recipients were ignored.");
        break;
      }
      reports.push({
        recipientEmail,
        messageId,
        envelopeId: null,
        outcome: mappedStatus.outcome,
        source,
        diagnostic: null,
        enhancedStatus: null,
        occurredAt: occurredAt ? new Date(occurredAt.getTime()) : null,
        deliveryScope: mappedStatus.deliveryScope,
      });
    }
    if (reports.length >= MAX_REPORTS) break;
  }
  return reports;
}

export function parseDeliveryReports(
  format: DeliveryReportFormat,
  content: string,
): { reports: ParsedDeliveryReport[]; warnings: string[] } {
  if (
    format !== "dsn" &&
    format !== "microsoft_365_csv" &&
    format !== "google_workspace_csv" &&
    format !== "generic_csv"
  ) {
    throw new Error("Unsupported delivery report format.");
  }
  if (typeof content !== "string") {
    throw new Error("Delivery report content must be text.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    throw new Error("Delivery report content exceeds the 1 MB limit.");
  }

  const warnings: string[] = [];
  const reports =
    format === "dsn"
      ? parseDsn(content, warnings)
      : parseCsv(format, content, warnings);
  if (reports.length === 0) {
    throw new Error("No interpretable delivery reports were found.");
  }
  return { reports, warnings };
}