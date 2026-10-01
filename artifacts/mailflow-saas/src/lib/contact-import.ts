import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const BATCH_SIZE = 200;
export const TEMPLATE_HEADERS = ['First Name', 'Last Name', 'Email', 'Company Name', 'LinkedIn', 'Phone Number'] as const;

export type ImportField = 'firstName' | 'lastName' | 'email' | 'companyName' | 'linkedinUrl' | 'phoneNumber';
export type ParsedRow = { rowNumber: number; email: string; firstName: string; lastName: string; companyName: string | null; linkedinUrl: string | null; phoneNumber: string | null };
export type RowError = { rowNumber: number; reason: string };
export type ParsedImport = {
  fileName: string; kind: 'csv' | 'xlsx'; sheetNote: string;
  valid: ParsedRow[]; errors: RowError[]; totalRows: number; ignoredHeaders: string[]; warnings: string[];
};

const ALIASES: Record<ImportField, string[]> = {
  firstName: ['firstname', 'first', 'givenname', 'forename'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'mail'],
  companyName: ['companyname', 'company', 'organization', 'organisation', 'employer'],
  linkedinUrl: ['linkedin', 'linkedinurl', 'linkedinprofile', 'linkedinprofileurl'],
  phoneNumber: ['phonenumber', 'phone', 'mobile', 'mobilenumber', 'telephone', 'tel'],
};
const FIELD_LOOKUP = new Map<string, ImportField>();
(Object.keys(ALIASES) as ImportField[]).forEach(f => ALIASES[f].forEach(a => FIELD_LOOKUP.set(a, f)));
const LABELS: Record<ImportField, string> = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', companyName: 'Company Name', linkedinUrl: 'LinkedIn', phoneNumber: 'Phone Number' };
const REQUIRED: ImportField[] = ['firstName', 'lastName', 'email'];
const LIMITS: Record<ImportField, number> = { firstName: 100, lastName: 100, email: 254, companyName: 200, linkedinUrl: 2048, phoneNumber: 40 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ImportFileError extends Error {}

const normalizeHeader = (h: string) => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function templateCsv() {
  return '\uFEFF' + TEMPLATE_HEADERS.join(',') + '\r\n' + 'Mara,Linden,mara.linden@example.com,Linden Freight,https://www.linkedin.com/in/maralinden,+44 20 7946 0123\r\n';
}

function mapHeaders(header: string[]) {
  const mapping = new Map<ImportField, number>();
  const ignored: string[] = [];
  const dupes: string[] = [];
  header.forEach((raw, idx) => {
    const text = raw.trim();
    if (!text) return;
    const field = FIELD_LOOKUP.get(normalizeHeader(text));
    if (!field) { ignored.push(text); return; }
    if (mapping.has(field)) dupes.push(LABELS[field]); else mapping.set(field, idx);
  });
  if (dupes.length) throw new ImportFileError(`Duplicate or ambiguous columns for: ${Array.from(new Set(dupes)).join(', ')}. Keep one column per field.`);
  const missing = REQUIRED.filter(f => !mapping.has(f));
  if (missing.length) throw new ImportFileError(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.map(f => LABELS[f]).join(', ')}.`);
  return { mapping, ignored };
}

function buildRows(records: string[][], fileName: string, kind: 'csv' | 'xlsx', sheetNote: string, extraWarnings: string[], unsafeRows = new Set<number>()): ParsedImport {
  if (!records.length) throw new ImportFileError('The file is empty.');
  const { mapping, ignored } = mapHeaders(records[0]);
  const valid: ParsedRow[] = []; const errors: RowError[] = [];
  let total = 0;
  const seenEmails = new Map<string, number>();
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every(c => c.trim() === '')) continue;
    total++;
    if (total > MAX_ROWS) throw new ImportFileError(`This file has more than ${MAX_ROWS.toLocaleString()} data rows. Split it into smaller files.`);
    const rowNumber = i + 1;
    if (kind === 'csv') {
      const width = records[0].length;
      const lastFilled = rec.reduce((n, c, k) => (c.trim() ? k + 1 : n), 0);
      if (lastFilled > width) { errors.push({ rowNumber, reason: `Row has ${lastFilled} filled columns but the header has ${width}; check for an unquoted delimiter or shifted data` }); continue; }
      const need = Math.max(...REQUIRED.map(f => (mapping.get(f) ?? 0) + 1));
      if (rec.length < need) { errors.push({ rowNumber, reason: `Malformed row: only ${rec.length} columns, but required fields need ${need}` }); continue; }
    }
    const get = (f: ImportField) => { const idx = mapping.get(f); return idx === undefined ? '' : (rec[idx] ?? '').trim(); };
    const problems: string[] = [];
    if (unsafeRows.has(rowNumber)) problems.push('Date or boolean cells are not supported; format contact details as text');
    (Object.keys(LABELS) as ImportField[]).forEach(f => {
      if (!mapping.has(f)) return;
      const v = get(f);
      if (REQUIRED.includes(f) && !v) problems.push(`${LABELS[f]} is required`);
      if (v.length > LIMITS[f]) problems.push(`${LABELS[f]} exceeds ${LIMITS[f]} characters`);
    });
    const email = get('email');
    if (email && !EMAIL_RE.test(email)) problems.push('Email address is not valid');
    const key = email.toLowerCase();
    if (email && !problems.length) {
      const first = seenEmails.get(key);
      if (first) problems.push(`Duplicate of row ${first} in this file`); else seenEmails.set(key, rowNumber);
    }
    if (problems.length) { errors.push({ rowNumber, reason: problems.join('; ') }); continue; }
    valid.push({ rowNumber, email, firstName: get('firstName'), lastName: get('lastName'), companyName: get('companyName') || null, linkedinUrl: get('linkedinUrl') || null, phoneNumber: get('phoneNumber') || null });
  }
  if (!total) throw new ImportFileError('The file has headers but no contact rows.');
  return { fileName, kind, sheetNote, valid, errors, totalRows: total, ignoredHeaders: ignored, warnings: extraWarnings };
}

export async function parseContactFile(file: File): Promise<ParsedImport> {
  const lower = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError('This file is larger than 5 MB. Split it into smaller files.');
  if (file.size === 0) throw new ImportFileError('The file is empty.');
  if (lower.endsWith('.xls')) throw new ImportFileError('Legacy .xls files are not supported. Save the sheet as .xlsx or .csv and try again.');
  if (lower.endsWith('.xlsx')) {
    let data;
    try {
      // parseNumber keeps numeric cells as their stored text; we never convert phones to numbers.
      data = await readSheet<string>(file, 1, { parseNumber: (s: string) => s, trim: true });
    } catch {
      throw new ImportFileError('This workbook could not be read. Confirm it is a valid .xlsx file.');
    }
    const records: string[][] = [];
    const bad: string[] = [];
    const unsafeRows = new Set<number>();
    data.forEach((row, r) => {
      records.push(row.map((cell, c) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'string') return cell;
        if (typeof cell === 'boolean' || typeof cell === 'object') { if (r > 0) { bad.push(`row ${r + 1}`); unsafeRows.add(r + 1); } return '='; }
        return String(cell);
      }));
    });
    const built = buildRows(records, file.name, 'xlsx', 'Reading the first sheet of the workbook only.', ['Store phone numbers as text in Excel so leading zeros and plus signs survive. Numeric phone cells are imported exactly as stored in the file.'], unsafeRows);
    if (bad.length) built.warnings.push(`Date or boolean cells cannot be represented safely and were rejected (${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', ...' : ''}).`);
    return built;
  }
  if (!lower.endsWith('.csv')) throw new ImportFileError('Choose a .csv or .xlsx file.');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(text, { delimitersToGuess: [',', ';', '\t', '|'], skipEmptyLines: false });
  const fatal = result.errors.find(e => e.type === 'Quotes');
  if (fatal) throw new ImportFileError(`The CSV has a quoting problem near row ${(fatal.row ?? 0) + 1}: ${fatal.message}.`);
  return buildRows(result.data.map(r => r.map(c => String(c ?? ''))), file.name, 'csv', 'CSV file', []);
}
