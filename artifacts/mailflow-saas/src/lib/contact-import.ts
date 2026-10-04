import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const BATCH_SIZE = 200;
export const OPTIONAL_IMPORT_FIELDS = [
  'companyName', 'linkedinUrl', 'phoneNumber', 'jobTitle', 'department', 'seniority',
  'mobilePhone', 'websiteUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl', 'location',
  'preferredLanguage', 'timeZone', 'lifecycleStage', 'leadStatus', 'leadSource',
  'interests', 'goals', 'painPoints', 'personalizationContext', 'notes',
  'companyWebsiteUrl', 'companyDomain', 'companyIndustry', 'companySize',
  'companyRevenueRange', 'companyDescription', 'companyPhoneNumber',
  'companyLinkedinUrl', 'companyLocation',
] as const;
export type OptionalImportField = typeof OPTIONAL_IMPORT_FIELDS[number];
export type ImportField = 'firstName' | 'lastName' | 'email' | OptionalImportField;
export type ParsedRow = {
  rowNumber: number;
  email: string;
  firstName: string;
  lastName: string;
} & Partial<Record<OptionalImportField, string | null>>;
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
  phoneNumber: ['phonenumber', 'phone', 'telephone', 'tel'],
  jobTitle: ['jobtitle', 'title', 'position'],
  department: ['department', 'team'],
  seniority: ['seniority', 'senioritylevel'],
  mobilePhone: ['mobilephone', 'mobile', 'mobilenumber', 'cellphone'],
  websiteUrl: ['websiteurl', 'personalwebsite', 'personalwebsiteurl', 'website'],
  twitterUrl: ['twitter', 'twitterurl', 'twitterprofile', 'twitterprofileurl'],
  facebookUrl: ['facebook', 'facebookurl', 'facebookprofile', 'facebookprofileurl'],
  instagramUrl: ['instagram', 'instagramurl', 'instagramprofile', 'instagramprofileurl'],
  location: ['location', 'contactlocation'],
  preferredLanguage: ['preferredlanguage', 'language'],
  timeZone: ['timezone', 'tz'],
  lifecycleStage: ['lifecyclestage', 'stage'],
  leadStatus: ['leadstatus'],
  leadSource: ['leadsource'],
  interests: ['interests'],
  goals: ['goals'],
  painPoints: ['painpoints'],
  personalizationContext: ['personalizationcontext'],
  notes: ['notes'],
  companyWebsiteUrl: ['companywebsite', 'companywebsiteurl', 'organizationwebsite', 'organizationwebsiteurl'],
  companyDomain: ['companydomain', 'domain'],
  companyIndustry: ['companyindustry', 'industry'],
  companySize: ['companysize', 'employees'],
  companyRevenueRange: ['companyrevenuerange', 'revenuerange', 'revenue'],
  companyDescription: ['companydescription'],
  companyPhoneNumber: ['companyphone', 'companyphonenumber'],
  companyLinkedinUrl: ['companylinkedin', 'companylinkedinurl', 'linkedincompanyurl', 'companylinkedinprofile'],
  companyLocation: ['companylocation', 'headquarters'],
};
const FIELD_LOOKUP = new Map<string, ImportField>();
(Object.keys(ALIASES) as ImportField[]).forEach(f => ALIASES[f].forEach(a => FIELD_LOOKUP.set(a, f)));
const LABELS: Record<ImportField, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  companyName: 'Company Name',
  linkedinUrl: 'LinkedIn URL',
  phoneNumber: 'Phone Number',
  jobTitle: 'Job Title',
  department: 'Department',
  seniority: 'Seniority',
  mobilePhone: 'Mobile Phone',
  websiteUrl: 'Personal Website URL',
  twitterUrl: 'Twitter URL',
  facebookUrl: 'Facebook URL',
  instagramUrl: 'Instagram URL',
  location: 'Location',
  preferredLanguage: 'Preferred Language',
  timeZone: 'Time Zone',
  lifecycleStage: 'Lifecycle Stage',
  leadStatus: 'Lead Status',
  leadSource: 'Lead Source',
  interests: 'Interests',
  goals: 'Goals',
  painPoints: 'Pain Points',
  personalizationContext: 'Personalization Context',
  notes: 'Notes',
  companyWebsiteUrl: 'Company Website URL',
  companyDomain: 'Company Domain',
  companyIndustry: 'Company Industry',
  companySize: 'Company Size',
  companyRevenueRange: 'Company Revenue Range',
  companyDescription: 'Company Description',
  companyPhoneNumber: 'Company Phone Number',
  companyLinkedinUrl: 'Company LinkedIn URL',
  companyLocation: 'Company Location',
};
const REQUIRED: ImportField[] = ['firstName', 'lastName', 'email'];
const LIMITS: Record<ImportField, number> = {
  firstName: 100, lastName: 100, email: 254, companyName: 200, linkedinUrl: 2048,
  phoneNumber: 40, jobTitle: 200, department: 120, seniority: 80, mobilePhone: 40,
  websiteUrl: 2048, twitterUrl: 2048, facebookUrl: 2048, instagramUrl: 2048,
  location: 200, preferredLanguage: 80, timeZone: 100, lifecycleStage: 80,
  leadStatus: 80, leadSource: 120, interests: 10000, goals: 10000, painPoints: 10000,
  personalizationContext: 10000, notes: 10000, companyWebsiteUrl: 2048,
  companyDomain: 255, companyIndustry: 120, companySize: 80, companyRevenueRange: 80,
  companyDescription: 10000, companyPhoneNumber: 40, companyLinkedinUrl: 2048,
  companyLocation: 200,
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TEMPLATE_HEADERS = [
  'First Name', 'Last Name', 'Email',
  ...OPTIONAL_IMPORT_FIELDS.map(field => LABELS[field]),
] as const;

export class ImportFileError extends Error {}

const normalizeHeader = (h: string) => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function templateCsv() {
  const sample: Record<ImportField, string> = {
    firstName: 'Mara',
    lastName: 'Linden',
    email: 'mara.linden@example.com',
    companyName: 'Linden Freight',
    linkedinUrl: 'https://www.linkedin.com/in/maralinden',
    phoneNumber: '+44 20 7946 0123',
    jobTitle: '',
    department: '',
    seniority: '',
    mobilePhone: '',
    websiteUrl: '',
    twitterUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    location: '',
    preferredLanguage: '',
    timeZone: '',
    lifecycleStage: '',
    leadStatus: '',
    leadSource: '',
    interests: '',
    goals: '',
    painPoints: '',
    personalizationContext: '',
    notes: '',
    companyWebsiteUrl: '',
    companyDomain: '',
    companyIndustry: '',
    companySize: '',
    companyRevenueRange: '',
    companyDescription: '',
    companyPhoneNumber: '',
    companyLinkedinUrl: '',
    companyLocation: '',
  };
  const fields: ImportField[] = ['firstName', 'lastName', 'email', ...OPTIONAL_IMPORT_FIELDS];
  return '\uFEFF' + TEMPLATE_HEADERS.join(',') + '\r\n' + fields.map(field => sample[field]).join(',') + '\r\n';
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
    const enrichment = Object.fromEntries(
      OPTIONAL_IMPORT_FIELDS.map(field => [field, get(field) || null]),
    ) as Partial<Record<OptionalImportField, string | null>>;
    valid.push({ rowNumber, email, firstName: get('firstName'), lastName: get('lastName'), ...enrichment });
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
