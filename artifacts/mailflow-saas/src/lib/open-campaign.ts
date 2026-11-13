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

/** Returns placeholder keys used in the given texts that are not available for this uploaded audience. */
export function findUnavailableOpenPlaceholders(texts: string[], recipients: OpenCampaignRecipientInput[]) {
  const available = openPlaceholderAvailability(recipients);
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      const key = match[1]!;
      if (!available[key]) found.add(key);
    }
  }
  return [...found];
}

function fill(text: string, recipient: OpenCampaignRecipientInput, html: boolean) {
  const values: Record<string, string> = {
    email: recipient.email,
    firstName: recipient.firstName ?? '',
    lastName: recipient.lastName ?? '',
    fullName: [recipient.firstName, recipient.lastName].filter(Boolean).join(' '),
  };
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (token, key: string) => {
    const value = values[key];
    if (value === undefined) return token;
    return html ? escapeHtml(value) : value;
  });
}

/** Local approximation of the delivered message for an uploaded recipient. */
export function renderOpenRecipientPreview(
  content: { subject: string; greeting: string; signature: string; textBody: string; htmlBody: string },
  recipient: OpenCampaignRecipientInput,
) {
  const greeting = fill(content.greeting.trim(), recipient, false);
  const signature = fill(content.signature.trim(), recipient, false);
  const textBody = [greeting, fill(content.textBody.trim(), recipient, false), signature].filter(Boolean).join('\n\n');
  const htmlParts = [
    greeting ? `<p>${escapeHtml(greeting)}</p>` : '',
    content.htmlBody.trim() ? fill(content.htmlBody, recipient, true) : '',
    signature ? `<p>${signature.split('\n').map(escapeHtml).join('<br>')}</p>` : '',
  ].filter(Boolean);
  return { subject: fill(content.subject, recipient, false), htmlBody: htmlParts.length ? htmlParts.join('') : null, textBody };
}
