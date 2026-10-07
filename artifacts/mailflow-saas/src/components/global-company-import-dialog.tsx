import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { useBulkImportGlobalCompanies } from '@workspace/api-client-react';
import type { GlobalCompanyBulkImportRowResult } from '@workspace/api-client-react';
import {
  GLOBAL_COMPANY_IMPORT_BATCH_SIZE,
  GlobalCompanyImportFileError,
  parseGlobalCompanyFile,
  globalCompanyImportTemplateCsv,
  type ParsedGlobalCompanyImport,
} from '@/lib/global-company-import';

type Issue = { rowNumber: number; companyName: string; status: string; reason: string };
type Report = {
  imported: number;
  duplicates: number;
  invalid: number;
  unconfirmed: number;
  notSubmitted: number;
  issues: Issue[];
  failure: string | null;
};

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55';
const primary = `${button} border-[#286d5b] bg-[#286d5b] text-white hover:bg-[#205a4b]`;
const outline = `${button} border-[#d5e1da] bg-white text-[#506b5f] hover:bg-[#f5f9f6]`;

function Stat({ label, value, tone = '#29443b', id }: { label: string; value: number; tone?: string; id: string }) {
  return <div className="rounded-lg border border-[#e3ebe6] bg-white p-3">
    <div className="text-[11px] text-[#71847a]">{label}</div>
    <div data-testid={id} className="display mt-1 text-[22px] font-bold" style={{ color: tone }}>{value.toLocaleString()}</div>
  </div>;
}

function csvCell(value: string) {
  const safeValue = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function issueCsv(issues: Issue[]) {
  return '\uFEFF' + [
    ['Row', 'Company name', 'Result', 'Reason'].map(csvCell).join(','),
    ...issues.map(issue => [String(issue.rowNumber), issue.companyName, issue.status, issue.reason].map(csvCell).join(',')),
  ].join('\r\n');
}

function apiIssue(row: GlobalCompanyBulkImportRowResult): Issue {
  return {
    rowNumber: row.rowNumber,
    companyName: row.companyName,
    status: row.status,
    reason: row.reason ?? `Row was marked ${row.status}.`,
  };
}

export function GlobalCompanyImportDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const importer = useBulkImportGlobalCompanies();
  const fileRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [parsed, setParsed] = useState<ParsedGlobalCompanyImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<Report | null>(null);

  const close = () => { if (!running && !reading) onClose(); };
  const reset = () => {
    if (running || reading) return;
    setParsed(null);
    setFileError(null);
    setReport(null);
    setProgress({ done: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = '';
  };
  const pick = async (file: File | undefined) => {
    if (!file || running) return;
    setReport(null);
    setParsed(null);
    setFileError(null);
    setReading(true);
    try {
      setParsed(await parseGlobalCompanyFile(file));
    } catch (error) {
      setFileError(error instanceof GlobalCompanyImportFileError ? error.message : 'This file could not be read.');
    } finally {
      setReading(false);
    }
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([globalCompanyImportTemplateCsv()], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mailflow-global-companies-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadIssues = () => {
    if (!report?.issues.length) return;
    const url = URL.createObjectURL(new Blob([issueCsv(report.issues)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mailflow-global-company-import-results.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!parsed || submitting.current || !parsed.valid.length) return;
    submitting.current = true;
    setRunning(true);
    const issues: Issue[] = parsed.errors.map(issue => ({
      rowNumber: issue.rowNumber,
      companyName: issue.companyName,
      status: issue.status,
      reason: issue.reason,
    }));
    const result: Report = {
      imported: 0,
      duplicates: parsed.errors.filter(issue => issue.status === 'duplicate').length,
      invalid: parsed.errors.filter(issue => issue.status === 'invalid').length,
      unconfirmed: 0,
      notSubmitted: 0,
      issues,
      failure: null,
    };
    setProgress({ done: 0, total: parsed.valid.length });

    for (let index = 0; index < parsed.valid.length; index += GLOBAL_COMPANY_IMPORT_BATCH_SIZE) {
      const batch = parsed.valid.slice(index, index + GLOBAL_COMPANY_IMPORT_BATCH_SIZE);
      try {
        const response = await importer.mutateAsync({ data: { rows: batch } });
        result.imported += response.imported;
        result.duplicates += response.duplicates;
        result.invalid += response.invalid;
        result.issues.push(...response.rows.filter(row => row.status !== 'imported').map(apiIssue));
        setProgress({ done: Math.min(index + batch.length, parsed.valid.length), total: parsed.valid.length });
        onChanged();
      } catch (error) {
        const later = parsed.valid.slice(index + batch.length);
        result.unconfirmed = batch.length;
        result.notSubmitted = later.length;
        result.issues.push(...batch.map(row => ({
          rowNumber: row.rowNumber,
          companyName: row.company.companyName,
          status: 'unconfirmed',
          reason: 'The request failed and the server may or may not have saved this row. Check the catalog before retrying.',
        })));
        result.issues.push(...later.map(row => ({
          rowNumber: row.rowNumber,
          companyName: row.company.companyName,
          status: 'not submitted',
          reason: 'Not submitted because an earlier batch had an unconfirmed outcome.',
        })));
        result.failure = `${error instanceof Error ? error.message : 'The request failed.'} Batch ${Math.floor(index / GLOBAL_COMPANY_IMPORT_BATCH_SIZE) + 1} has an unconfirmed outcome; ${later.length.toLocaleString()} later rows were not submitted. Nothing is retried automatically.`;
        onChanged();
        break;
      }
    }
    result.issues.sort((left, right) => left.rowNumber - right.rowNumber);
    setReport(result);
    setRunning(false);
    submitting.current = false;
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#1b352e]/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="global-company-import-title" data-testid="dialog-import-global-companies" className="my-auto max-h-[94dvh] w-full max-w-[800px] overflow-y-auto rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 shadow-2xl sm:p-7">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#638a7b]">PLATFORM / COMPANY CATALOG</div>
          <h2 id="global-company-import-title" className="display text-[23px] font-extrabold tracking-[-.03em] text-[#1e3b32]">Bulk upload companies</h2>
          <p className="mt-1.5 text-[12px] text-[#71847a]">Add trusted company profiles to the shared catalog. Contact data is not accepted or imported.</p>
        </div>
        <button type="button" data-testid="button-close-global-company-import" disabled={running || reading} onClick={close} aria-label="Close" className="rounded-md p-2 text-[#71847a] hover:bg-[#edf4ef] disabled:opacity-40"><X className="h-4 w-4"/></button>
      </header>

      {!report && <>
        <div className="rounded-lg border border-[#e3ebe6] bg-white p-4 text-[12px] leading-5 text-[#536d61]">
          <p><b>Required:</b> Company Name. Optional columns: Website URL, Domain, Industry, Company size, Revenue range, Location, Phone number, LinkedIn URL, and Description. Headers match common variations such as <code>company_name</code> or <code>website</code>.</p>
          <p className="mt-1.5">Files may be up to 5 MB and 10,000 rows. CSV and .xlsx are supported; only the first worksheet is read. Existing or repeated domains are skipped. Rows without a domain or website cannot be reliably deduplicated.</p>
          {parsed?.ignoredHeaders.length ? <p className="mt-2 text-[#9a6440]">Unrecognized columns will be ignored: {parsed.ignoredHeaders.join(', ')}</p> : null}
          <button type="button" data-testid="button-download-global-company-template" onClick={downloadTemplate} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#286d5b] hover:underline"><Download className="h-3.5 w-3.5"/>Download CSV template</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} id="global-company-import-file" data-testid="input-global-company-import-file" type="file" accept=".csv,.xlsx" disabled={running || reading} onChange={event => void pick(event.target.files?.[0])} className="sr-only"/>
          <label htmlFor="global-company-import-file" className={`${outline} cursor-pointer ${running || reading ? 'pointer-events-none opacity-55' : ''}`}>{reading ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}{reading ? 'Reading file…' : parsed ? 'Choose another file' : 'Choose CSV or Excel file'}</label>
          {parsed && <span className="inline-flex items-center gap-1.5 text-[12px] text-[#536d61]"><FileSpreadsheet className="h-4 w-4"/>{parsed.fileName}</span>}
        </div>
        {fileError && <div role="alert" data-testid="status-global-company-import-file-error" className="mt-4 flex items-start gap-2 rounded-lg border border-[#ead2c2] bg-[#fff8f2] px-3 py-2.5 text-[12px] text-[#945b37]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>{fileError}</div>}
      </>}

      {parsed && !report && <div className="mt-5 space-y-4" data-testid="section-global-company-import-preview">
        <p className="text-[11px] text-[#71847a]">{parsed.sheetNote}</p>
        {parsed.warnings.map(warning => <p key={warning} className="rounded-lg bg-[#fff8f2] px-3 py-2 text-[11px] leading-5 text-[#945b37]">{warning}</p>)}
        <div className="grid grid-cols-3 gap-3">
          <Stat id="text-global-company-import-total" label="Rows found" value={parsed.totalRows}/>
          <Stat id="text-global-company-import-ready" label="Ready to import" value={parsed.valid.length} tone="#397050"/>
          <Stat id="text-global-company-import-errors" label="Skipped in preview" value={parsed.errors.length} tone="#a95218"/>
        </div>
        {parsed.valid.length > 0 && <div className="overflow-x-auto rounded-lg border border-[#e3ebe6] bg-white">
          <table className="w-full min-w-[580px] text-left text-[11px]"><thead className="bg-[#f5f9f6] text-[10px] uppercase tracking-[.1em] text-[#819188]"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">Domain</th><th className="px-3 py-2">Industry</th><th className="px-3 py-2">Location</th></tr></thead>
            <tbody className="divide-y divide-[#edf2ee]">{parsed.valid.slice(0, 5).map(row => <tr key={row.rowNumber}><td className="px-3 py-2 text-[#829188]">{row.rowNumber}</td><td className="px-3 py-2 font-semibold text-[#29443b]">{row.company.companyName}</td><td className="px-3 py-2 text-[#536d61]">{row.company.companyDomain || row.company.companyWebsiteUrl || '—'}</td><td className="px-3 py-2 text-[#536d61]">{row.company.companyIndustry || '—'}</td><td className="px-3 py-2 text-[#536d61]">{row.company.companyLocation || '—'}</td></tr>)}</tbody>
          </table>
          {parsed.valid.length > 5 && <p className="border-t border-[#edf2ee] px-3 py-2 text-[10px] text-[#829188]">Showing 5 of {parsed.valid.length.toLocaleString()} rows ready to import.</p>}
        </div>}
        {parsed.errors.length > 0 && <div><div className="mb-1.5 text-[12px] font-semibold text-[#344f45]">Rows that will be skipped</div><ul data-testid="list-global-company-import-preview-errors" className="max-h-40 divide-y divide-[#f1e3d6] overflow-y-auto rounded-lg border border-[#ead2c2] bg-[#fffaf5] text-[11px] text-[#945b37]">{parsed.errors.map(issue => <li key={issue.rowNumber} className="px-3 py-1.5">Row {issue.rowNumber} ({issue.companyName}): {issue.reason}</li>)}</ul></div>}
        {running && <div role="status" data-testid="status-global-company-import-progress" className="flex items-center gap-2 text-[12px] text-[#286d5b]"><LoaderCircle className="h-4 w-4 animate-spin"/>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows. Keep this window open.</div>}
      </div>}

      {report && <div data-testid="section-global-company-import-report" className="space-y-4">
        <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] ${report.failure ? 'border-[#ead2c2] bg-[#fff8f2] text-[#945b37]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>
          {report.failure ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/>}
          <span data-testid="text-global-company-import-summary">{report.failure ?? 'Upload finished.'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat id="text-global-company-imported" label="Imported" value={report.imported} tone="#397050"/>
          <Stat id="text-global-company-duplicates" label="Duplicates skipped" value={report.duplicates}/>
          <Stat id="text-global-company-invalid" label="Invalid" value={report.invalid} tone="#a95218"/>
          <Stat id="text-global-company-unconfirmed" label="Outcome unconfirmed" value={report.unconfirmed} tone="#a95218"/>
          <Stat id="text-global-company-not-submitted" label="Not submitted" value={report.notSubmitted} tone="#a95218"/>
        </div>
        {report.issues.length > 0 && <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><div className="text-[12px] font-semibold text-[#344f45]">Rows not imported or needing review</div><button type="button" data-testid="button-download-global-company-import-results" onClick={downloadIssues} className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#286d5b] hover:underline"><Download className="h-3.5 w-3.5"/>Download results</button></div>
          <ul data-testid="list-global-company-import-report-issues" className="max-h-52 divide-y divide-[#f1e3d6] overflow-y-auto rounded-lg border border-[#ead2c2] bg-[#fffaf5] text-[11px] text-[#945b37]">{report.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`} className="px-3 py-1.5">Row {issue.rowNumber} ({issue.companyName}) — {issue.status}: {issue.reason}</li>)}</ul>
        </div>}
      </div>}

      <footer className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[#e5ede8] pt-4">
        {!report && <button type="button" data-testid="button-reset-global-company-import" disabled={running || reading || (!parsed && !fileError)} onClick={reset} className={outline}>Reset</button>}
        {report && <button type="button" data-testid="button-import-another-global-company-file" disabled={reading} onClick={reset} className={outline}>Import another file</button>}
        <button type="button" data-testid="button-cancel-global-company-import" disabled={running || reading} onClick={close} className={outline}>{report ? 'Done' : 'Cancel'}</button>
        {!report && <button type="button" data-testid="button-start-global-company-import" disabled={running || !parsed || parsed.valid.length === 0} onClick={() => void run()} className={primary}>{running && <LoaderCircle className="h-4 w-4 animate-spin"/>}{running ? 'Importing…' : parsed ? `Import ${parsed.valid.length.toLocaleString()} rows` : 'Import companies'}</button>}
      </footer>
    </section>
  </div>;
}
