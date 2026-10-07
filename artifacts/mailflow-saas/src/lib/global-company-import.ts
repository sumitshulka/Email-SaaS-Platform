import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { GlobalCompanyBulkImportRowInput, GlobalCompanyInput } from '@workspace/api-client-react';

export const GLOBAL_COMPANY_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const GLOBAL_COMPANY_IMPORT_MAX_ROWS = 10_000;
export const GLOBAL_COMPANY_IMPORT_BATCH_SIZE = 25;

const FIELDS = [
  { key: 'companyName', label: 'Company Name', aliases: ['companyname', 'company', 'name', 'organization', 'organisation'], max: 200 },
  { key: 'companyWebsiteUrl', label: 'Website URL', aliases: ['website', 'websiteurl', 'companywebsite', 'companywebsiteurl', 'organizationwebsite', 'organizationwebsiteurl'], max: 2048 },
  { key: 'companyDomain', label: 'Domain', aliases: ['domain', 'companydomain'], max: 255 },
  { key: 'companyIndustry', label: 'Industry', aliases: ['industry', 'companyindustry'], max: 120 },
  { key: 'companySize', label: 'Company size', aliases: ['size', 'companysize', 'employees'], max: 80 },
  { key: 'companyRevenueRange', label: 'Revenue range', aliases: ['revenue', 'revenuerange', 'companyrevenuerange'], max: 80 },
  { key: 'companyLocation', label: 'Location', aliases: ['location', 'companylocation', 'headquarters'], max: 200 },
  { key: 'companyPhoneNumber', label: 'Phone number', aliases: ['phone', 'telephone', 'companyphone', 'companyphonenumber'], max: 40 },
  { key: 'companyLinkedinUrl', label: 'LinkedIn URL', aliases: ['linkedin', 'linkedinurl', 'companylinkedin', 'companylinkedinurl'], max: 2048 },
  { key: 'companyDescription', label: 'Description', aliases: ['description', 'companydescription'], max: 10_000 },
] as const;

type FieldKey = typeof FIELDS[number]['key'];
type ParsedCompanyRow = GlobalCompanyBulkImportRowInput;
export type GlobalCompanyImportIssue = { rowNumber: number; companyName: string; reason: string; status: 'duplicate' | 'invalid' };
export type ParsedGlobalCompanyImport = {
  fileName: string;
  kind: 'csv' | 'xlsx';
  sheetNote: string;
  valid: ParsedCompanyRow[];
  errors: GlobalCompanyImportIssue[];
  totalRows: number;
  ignoredHeaders: string[];
  warnings: string[];
};

export class GlobalCompanyImportFileError extends Error {}

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function normalizedDomain(value: string) {
  if (!value.trim()) return null;
  try {
    const source = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : `https://${source}`);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return hostname && !/\s/.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

function mapHeaders(header: string[]) {
  const aliases = new Map<string, FieldKey>();
  for (const field of FIELDS) for (const alias of field.aliases) aliases.set(alias, field.key);
  const mapping = new Map<FieldKey, number>();
  const ignored: string[] = [];
  const duplicates: string[] = [];
  header.forEach((raw, index) => {
    const label = raw.trim();
    if (!label) return;
    const key = aliases.get(normalizeHeader(label));
    if (!key) { ignored.push(label); return; }
    if (mapping.has(key)) duplicates.push(FIELDS.find(field => field.key === key)!.label);
    else mapping.set(key, index);
  });
  if (duplicates.length) throw new GlobalCompanyImportFileError(`Duplicate or ambiguous columns for: ${Array.from(new Set(duplicates)).join(', ')}. Keep one column per field.`);
  if (!mapping.has('companyName')) throw new GlobalCompanyImportFileError('Missing required column: Company Name.');
  return { mapping, ignored };
}

function buildRows(
  records: string[][],
  fileName: string,
  kind: 'csv' | 'xlsx',
  sheetNote: string,
  warnings: string[],
  unsafeRows = new Set<number>(),
): ParsedGlobalCompanyImport {
  if (!records.length) throw new GlobalCompanyImportFileError('The file is empty.');
  const { mapping, ignored } = mapHeaders(records[0]);
  const valid: ParsedCompanyRow[] = [];
  const errors: GlobalCompanyImportIssue[] = [];
  const seenDomains = new Map<string, number>();
  let totalRows = 0;

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    if (record.every(cell => cell.trim() === '')) continue;
    totalRows++;
    if (totalRows > GLOBAL_COMPANY_IMPORT_MAX_ROWS) {
      throw new GlobalCompanyImportFileError(`This file has more than ${GLOBAL_COMPANY_IMPORT_MAX_ROWS.toLocaleString()} data rows. Split it into smaller files.`);
    }
    const rowNumber = index + 1;
    const companyNameColumn = mapping.get('companyName');
    const companyName = (record[companyNameColumn ?? -1] ?? '').trim();
    const problems: string[] = [];

    if (kind === 'csv') {
      const headerWidth = records[0].length;
      const lastFilled = record.reduce((last, cell, column) => cell.trim() ? column + 1 : last, 0);
      if (lastFilled > headerWidth) problems.push(`Row has ${lastFilled} filled columns but the header has ${headerWidth}; check for an unquoted delimiter or shifted data`);
      if (companyNameColumn !== undefined && record.length <= companyNameColumn) problems.push('Malformed row: Company Name column is missing');
    }
    if (unsafeRows.has(rowNumber)) problems.push('Date, boolean, or unsupported spreadsheet cells must be formatted as text');
    if (!companyName) problems.push('Company Name is required');

    const values = new Map<FieldKey, string>();
    for (const field of FIELDS) {
      const column = mapping.get(field.key);
      if (column === undefined) continue;
      const value = (record[column] ?? '').trim();
      values.set(field.key, value);
      if (value.length > field.max) problems.push(`${field.label} exceeds ${field.max.toLocaleString()} characters`);
    }
    for (const key of ['companyDomain', 'companyWebsiteUrl'] as const) {
      const value = values.get(key);
      if (value && !normalizedDomain(value)) problems.push(`${FIELDS.find(field => field.key === key)!.label} is not a valid domain or URL`);
    }

    const companyDomain = values.get('companyDomain') ?? '';
    const website = values.get('companyWebsiteUrl') ?? '';
    const domainKey = normalizedDomain(companyDomain) ?? normalizedDomain(website);
    if (!problems.length && domainKey) {
      const firstRow = seenDomains.get(domainKey);
      if (firstRow !== undefined) problems.push(`Duplicate domain from row ${firstRow} in this file`);
      else seenDomains.set(domainKey, rowNumber);
    }
    if (problems.length) {
      errors.push({
        rowNumber,
        companyName: companyName || '(blank company name)',
        reason: problems.join('; '),
        status: problems.some(problem => problem.startsWith('Duplicate domain')) ? 'duplicate' : 'invalid',
      });
      continue;
    }

    const company = Object.fromEntries(
      FIELDS.flatMap(field => {
        const value = values.get(field.key);
        return value ? [[field.key, value]] : [];
      }),
    ) as unknown as GlobalCompanyInput;
    valid.push({ rowNumber, company });
  }

  if (!totalRows) throw new GlobalCompanyImportFileError('The file has headers but no company rows.');
  return { fileName, kind, sheetNote, valid, errors, totalRows, ignoredHeaders: ignored, warnings };
}

export async function parseGlobalCompanyFile(file: File): Promise<ParsedGlobalCompanyImport> {
  const lowerName = file.name.toLowerCase();
  if (file.size > GLOBAL_COMPANY_IMPORT_MAX_FILE_BYTES) throw new GlobalCompanyImportFileError('This file is larger than 5 MB. Split it into smaller files.');
  if (file.size === 0) throw new GlobalCompanyImportFileError('The file is empty.');
  if (lowerName.endsWith('.xls')) throw new GlobalCompanyImportFileError('Legacy .xls files are not supported. Save the sheet as .xlsx or .csv and try again.');

  if (lowerName.endsWith('.xlsx')) {
    let data: unknown[][];
    try {
      data = await readSheet<unknown>(file, 1, { parseNumber: (value: string) => value, trim: true });
    } catch {
      throw new GlobalCompanyImportFileError('This workbook could not be read. Confirm it is a valid .xlsx file.');
    }
    const unsafeRows = new Set<number>();
    const records = data.map((row, rowIndex) => row.map(cell => {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'string') return cell;
      if (typeof cell === 'boolean' || typeof cell === 'object') {
        if (rowIndex > 0) unsafeRows.add(rowIndex + 1);
        return '=';
      }
      return String(cell);
    }));
    return buildRows(
      records,
      file.name,
      'xlsx',
      'Only the first worksheet is read.',
      ['Format phone numbers as text in Excel to preserve leading zeros and plus signs.'],
      unsafeRows,
    );
  }

  if (!lowerName.endsWith('.csv')) throw new GlobalCompanyImportFileError('Choose a .csv or .xlsx file.');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(text, {
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: false,
  });
  const fatal = result.errors.find(error => error.type === 'Quotes');
  if (fatal) throw new GlobalCompanyImportFileError(`The CSV has a quoting problem near row ${(fatal.row ?? 0) + 1}: ${fatal.message}.`);
  return buildRows(
    result.data.map(row => row.map(cell => String(cell ?? ''))),
    file.name,
    'csv',
    'CSV file',
    [],
  );
}

export function globalCompanyImportTemplateCsv() {
  return '\uFEFF' + FIELDS.map(field => field.label).join(',') + '\r\n';
}
