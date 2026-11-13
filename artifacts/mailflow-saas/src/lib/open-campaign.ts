import Papa from 'papaparse';
import type { OpenCampaignRecipientInput } from '@workspace/api-client-react';
import { escapeHtml } from '@/components/campaign-placeholders';

export type OpenRecipientIssue = { row: number; value: string; reason: string };
export type OpenRecipientParseResult = {
  fileName: string;
  recipients: OpenCampaignRecipientInput[];
  totalRows: number;
  blankRows: number;
  duplicateCount: number;
  invalid: OpenRecipientIssue[];
  /** A problem that prevents using the file at all (missing email column, unreadable file). */
  fatal: string | null;
};

const EMAIL_HEADERS = new Set(['email', 'emailid', 'emailaddress', 'mail', 'e-mail']);
const FIRST_HEADERS = new Set(['firstname', 'first', 'givenname', 'fname']);
const LAST_HEADERS = new Set(['lastname', 'last', 'surname', 'familyname', 'lname']);
const EMAIL_PATTERN = /^[^\s@"<>(),;:]+@[^\s@"<>(),;:]+\.[^\s@"<>(),;:]{2,}$/;
export const OPEN_CAMPAIGN_FILE_MAX_BYTES = 10 * 1024 * 1024;

const headerKey = (header: string) => header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_.-]+/g, '');

export function normalizeOpenEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function parseOpenRecipientsFile(file: File): Promise<OpenRecipientParseResult> {
  const base: OpenRecipientParseResult = { fileName: file.name, recipients: [], totalRows: 0, blankRows: 0, duplicateCount: 0, invalid: [], fatal: null };
  const isWorkbook = /\.xlsx$/i.test(file.name);
  if (!isWorkbook && !/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    return { ...base, fatal: 'Choose a .csv or .xlsx file. Legacy .xls files are not supported; save them as .xlsx first.' };
  }
  if (file.size === 0) return { ...base, fatal: 'This file is empty. Add a header row with an email column and at least one recipient.' };
  if (file.size > OPEN_CAMPAIGN_FILE_MAX_BYTES) return { ...base, fatal: 'This file is larger than 10 MB. Split it or remove unused columns, then upload again.' };
  let text: string;
  try {
    if (isWorkbook) {
      const { readSheet } = await import('read-excel-file/browser');
      const rows = await readSheet<string>(file, 1, { parseNumber: value => value, trim: true });
      // Reuse CSV's header mapping, validation and duplicate handling. Workbook
      // formulas are never executed; unsupported cell types become empty values.
      text = Papa.unparse(rows.map(row => row.map(cell => typeof cell === 'string' ? cell : '')));
    } else {
      text = await file.text();
    }
  } catch {
    return { ...base, fatal: isWorkbook
      ? 'This workbook could not be read. Upload a valid, unencrypted .xlsx file with recipients on the first worksheet.'
      : 'The file could not be read. Try uploading it again.' };
  }
  return new Promise(resolve => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: false,
      complete: results => {
        const fields = results.meta.fields ?? [];
        const emailField = fields.find(field => EMAIL_HEADERS.has(headerKey(field)));
        const firstField = fields.find(field => FIRST_HEADERS.has(headerKey(field)));
        const lastField = fields.find(field => LAST_HEADERS.has(headerKey(field)));
        if (!emailField) {
          resolve({ ...base, fatal: `No email column was found. Name one column "email" or "email id". Columns found: ${fields.filter(Boolean).slice(0, 8).join(', ') || 'none'}.` });
          return;
        }
        const seen = new Set<string>();
        const result: OpenRecipientParseResult = { ...base };
        results.data.forEach((row, index) => {
          const rowNumber = index + 2; // header is row 1
          const values = Object.values(row ?? {}).map(value => String(value ?? '').trim());
          if (!values.some(Boolean)) { result.blankRows += 1; return; }
          result.totalRows += 1;
          const rawEmail = String(row[emailField] ?? '').trim();
          const email = normalizeOpenEmail(rawEmail);
          if (!email) { result.invalid.push({ row: rowNumber, value: '', reason: 'Email is missing' }); return; }
          if (email.length > 254 || !EMAIL_PATTERN.test(email)) { result.invalid.push({ row: rowNumber, value: rawEmail, reason: 'Not a valid email address' }); return; }
          const firstName = firstField ? String(row[firstField] ?? '').trim() : '';
          const lastName = lastField ? String(row[lastField] ?? '').trim() : '';
          if (firstName.length > 100 || lastName.length > 100) { result.invalid.push({ row: rowNumber, value: rawEmail, reason: 'First or last name is longer than 100 characters' }); return; }
          if (seen.has(email)) { result.duplicateCount += 1; return; }
          seen.add(email);
          result.recipients.push({ email, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) });
        });
        if (!result.totalRows) result.fatal = 'No recipient rows were found below the header row.';
        else if (!result.recipients.length) result.fatal = 'No valid email addresses were found. Fix the rows listed below and upload again.';
        resolve(result);
      },
      error: (error: Error) => resolve({ ...base, fatal: `The file could not be read: ${error.message}` }),
    });
  });
}

export function openPlaceholderAvailability(recipients: OpenCampaignRecipientInput[]) {
  const hasAll = (key: 'firstName' | 'lastName') => recipients.length > 0 && recipients.every(recipient => Boolean(recipient[key]?.trim()));
  const firstName = hasAll('firstName');
  const lastName = hasAll('lastName');
  return { email: true, firstName, lastName, fullName: firstName && lastName } as Record<string, boolean>;
}

export function openPlaceholderReason(token: string) {
  const key = token.replace(/[{}\s]/g, '');
  if (key === 'firstName') return 'Every uploaded row needs a first name to use this field.';
  if (key === 'lastName') return 'Every uploaded row needs a last name to use this field.';
  if (key === 'fullName') return 'Every uploaded row needs both a first and last name to use this field.';
  return 'Uploaded recipients only include email and optional names.';
}

export const OPTIONAL_PLACEHOLDER_KEYS = ['firstName', 'lastName', 'fullName', 'companyName', 'phoneNumber', 'linkedinUrl'] as const;
export type OptionalPlaceholderKey = typeof OPTIONAL_PLACEHOLDER_KEYS[number];
export type PlaceholderFallbackMap = Partial<Record<OptionalPlaceholderKey, string>>;
export const OPEN_NAME_PLACEHOLDER_KEYS: OptionalPlaceholderKey[] = ['firstName', 'lastName', 'fullName'];
const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function hasFallback(fallbacks: PlaceholderFallbackMap | undefined, key: string) {
  return Boolean((fallbacks as Record<string, string | undefined> | undefined)?.[key]?.trim());
}

/** Placeholder keys used anywhere in the given texts, in first-seen order. */
export function findUsedPlaceholders(texts: string[]) {
  const found = new Set<string>();
  for (const text of texts) {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = text;
    for (const match of decoder.value.matchAll(TOKEN_PATTERN)) found.add(match[1]!);
  }
  return [...found];
}

/** Optional placeholders used in the texts that still need an explicit, non-blank fallback. Email is exempt. */
export function findMissingPlaceholderFallbacks(texts: string[], fallbacks: PlaceholderFallbackMap = {}) {
  const optional = new Set<string>(OPTIONAL_PLACEHOLDER_KEYS);
  return findUsedPlaceholders(texts).filter(key => optional.has(key) && !hasFallback(fallbacks, key)) as OptionalPlaceholderKey[];
}

/** Trimmed, non-blank fallbacks suitable for API payloads. */
export function cleanPlaceholderFallbacks(fallbacks: PlaceholderFallbackMap = {}): PlaceholderFallbackMap {
  const result: PlaceholderFallbackMap = {};
  for (const key of OPTIONAL_PLACEHOLDER_KEYS) {
    const value = fallbacks[key]?.trim();
    if (value) result[key] = value;
  }
  return result;
}

/** Whether a name placeholder may be offered for an uploaded audience (every row has it, or a fallback is set). */
export function openPlaceholderUsable(key: string, recipients: OpenCampaignRecipientInput[], fallbacks: PlaceholderFallbackMap = {}) {
  if (key === 'email') return true;
  if (!OPEN_NAME_PLACEHOLDER_KEYS.includes(key as OptionalPlaceholderKey)) return false;
  return Boolean(openPlaceholderAvailability(recipients)[key]) || hasFallback(fallbacks, key);
}

/** Returns placeholder keys used in the given texts that are not available for this uploaded audience. */
export function findUnavailableOpenPlaceholders(texts: string[], recipients: OpenCampaignRecipientInput[], fallbacks: PlaceholderFallbackMap = {}) {
  return findUsedPlaceholders(texts).filter(key => !openPlaceholderUsable(key, recipients, fallbacks));
}

function fill(text: string, recipient: OpenCampaignRecipientInput, html: boolean, fallbacks: PlaceholderFallbackMap) {
  const first = recipient.firstName?.trim() ?? '';
  const last = recipient.lastName?.trim() ?? '';
  const values: Record<string, string> = {
    email: recipient.email,
    firstName: first,
    lastName: last,
    fullName: first && last ? `${first} ${last}` : '',
  };
  // Single pass: substituted values are never re-scanned for tokens.
  return text.replace(TOKEN_PATTERN, (token, key: string) => {
    const actual = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    const fallback = Object.prototype.hasOwnProperty.call(fallbacks, key) ? (fallbacks as Record<string, string | undefined>)[key] : undefined;
    let value: string | undefined;
    if (actual !== undefined && actual.trim()) value = actual;
    else if (fallback?.trim()) value = fallback.trim();
    else if (actual !== undefined) value = actual;
    if (value === undefined) return token;
    return html ? escapeHtml(value) : value;
  });
}

function safePreviewHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['a', 'b', 'blockquote', 'br', 'em', 'h1', 'h2', 'h3', 'i', 'li', 'ol', 'p', 'strong', 'u', 'ul']);
  for (const element of [...parsed.body.querySelectorAll('*')].reverse()) {
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'].includes(tag)) { element.remove(); continue; }
    if (!allowed.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      if (tag !== 'a' || !['href', 'title', 'target', 'rel'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (tag === 'a') {
      const href = (element.getAttribute('href') ?? '').replace(/[\u0000-\u0020]/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto):/i.test(href)) element.removeAttribute('href');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return parsed.body.innerHTML;
}

/** Local approximation of the delivered message for an uploaded recipient. */
export function renderOpenRecipientPreview(
  content: { subject: string; greeting: string; signature: string; textBody: string; htmlBody: string; placeholderFallbacks?: PlaceholderFallbackMap },
  recipient: OpenCampaignRecipientInput,
) {
  const fb = content.placeholderFallbacks ?? {};
  const greeting = fill(content.greeting.trim(), recipient, false, fb);
  const signature = fill(content.signature.trim(), recipient, false, fb);
  const textBody = [greeting, fill(content.textBody.trim(), recipient, false, fb), signature].filter(Boolean).join('\n\n');
  const htmlParts = [
    greeting ? `<p>${escapeHtml(greeting)}</p>` : '',
    content.htmlBody.trim() ? fill(safePreviewHtml(content.htmlBody), recipient, true, fb) : '',
    signature ? `<p>${signature.split('\n').map(escapeHtml).join('<br>')}</p>` : '',
  ].filter(Boolean);
  return { subject: fill(content.subject, recipient, false, fb), htmlBody: htmlParts.length ? safePreviewHtml(htmlParts.join('')) : null, textBody };
}
