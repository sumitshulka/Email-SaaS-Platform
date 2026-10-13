import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { useBulkImportGlobalCompanies } from '@workspace/api-client-react';
import type { GlobalCompanyBulkImportRowInput, GlobalCompanyBulkImportRowResult } from '@workspace/api-client-react';
import {
  GLOBAL_COMPANY_IMPORT_BATCH_SIZE, GlobalCompanyImportFileError, parseGlobalCompanyFile,
  revalidateGlobalCompanyRows, type ParsedGlobalCompanyImport,
} from '@/lib/global-company-import';

const fields = [
  ['companyName', 'Company Name'], ['companyWebsiteUrl', 'Website URL'], ['companyDomain', 'Domain'],
  ['companyIndustry', 'Industry'], ['companySize', 'Company size'], ['companyRevenueRange', 'Revenue range'],
  ['companyLocation', 'Location'], ['companyPhoneNumber', 'Phone number'],
  ['companyLinkedinUrl', 'LinkedIn URL'], ['companyDescription', 'Description'],
] as const;
type Field = typeof fields[number][0];
type Issue = { rowNumber: number; companyName: string; status: string; reason: string };
type Report = { imported: number; duplicates: number; invalid: number; unconfirmed: number; notSubmitted: number; issues: Issue[]; failure: string | null };
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55';
const primary = `${button} border-[#286d5b] bg-[#286d5b] text-white hover:bg-[#205a4b]`;
const outline = `${button} border-[#d5e1da] bg-white text-[#506b5f] hover:bg-[#f5f9f6]`;
const issueText = (row: GlobalCompanyBulkImportRowResult): Issue => ({ rowNumber: row.rowNumber, companyName: row.companyName, status: row.status, reason: row.reason ?? `Row marked ${row.status}.` });
const makeCsv = (rows: Issue[]) => '\uFEFF' + [['Row','Company name','Result','Reason'], ...rows.map(row => [String(row.rowNumber), row.companyName, row.status, row.reason])]
  .map(row => row.map(value => `"${value.replaceAll('"','""')}"`).join(',')).join('\r\n');

export function GlobalCompanyImportDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const importer = useBulkImportGlobalCompanies();
  const fileRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [parsed, setParsed] = useState<ParsedGlobalCompanyImport | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const close = () => { if (!running && !reading) onClose(); };
  const reset = () => { if (running || reading) return; setParsed(null); setTemplateId(null); setFileError(null); setReport(null); setPage(0); if (fileRef.current) fileRef.current.value = ''; };
  const downloadTemplate = async () => {
    setFileError(null);
    try {
      const response = await fetch('/api/admin/global-companies/import-template', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not download the template. Please try again.');
      const blob = await response.blob();
      const name = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'mailflow-global-companies-template.xlsx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
      setParsed(null); setTemplateId(null); setReport(null); setPage(0); if (fileRef.current) fileRef.current.value = '';
    } catch (error) { setFileError(error instanceof Error ? error.message : 'Could not download the template.'); }
  };
  const pick = async (file?: File) => {
    if (!file || running) return;
    setParsed(null); setTemplateId(null); setReport(null); setFileError(null); setReading(true);
    try {
      const match = file.name.match(/^mailflow-global-companies-template-([0-9a-f-]{36})\.xlsx$/i);
      if (!match) throw new GlobalCompanyImportFileError('Only the latest XLSX template downloaded from this page can be imported.');
      const result = await parseGlobalCompanyFile(file);
      const checked = revalidateGlobalCompanyRows(result.allRows, result.unsafeRows);
      setParsed({ ...result, ...checked });
      setTemplateId(match[1]); setPage(0);
    } catch (error) {
      setFileError(error instanceof GlobalCompanyImportFileError ? error.message : 'This workbook could not be read.');
    } finally { setReading(false); }
  };
  const edit = (row: GlobalCompanyBulkImportRowInput, key: Field, value: string) => {
    if (!parsed) return;
    const allRows = parsed.allRows.map(item => item.rowNumber === row.rowNumber
      ? { ...item, company: { ...item.company, [key]: value } }
      : item);
    const unsafeRows = parsed.unsafeRows.filter(rowNumber => rowNumber !== row.rowNumber);
    setParsed({ ...parsed, allRows, unsafeRows, ...revalidateGlobalCompanyRows(allRows, unsafeRows) });
  };
  const run = async () => {
    if (!parsed || !templateId || parsed.errors.length || !parsed.valid.length || submitting.current) return;
    submitting.current = true; setRunning(true);
    const sessionId = crypto.randomUUID();
    const result: Report = { imported: 0, duplicates: 0, invalid: 0, unconfirmed: 0, notSubmitted: 0, issues: [], failure: null };
    setProgress({ done: 0, total: parsed.valid.length });
    for (let index = 0; index < parsed.valid.length; index += GLOBAL_COMPANY_IMPORT_BATCH_SIZE) {
      const batch = parsed.valid.slice(index, index + GLOBAL_COMPANY_IMPORT_BATCH_SIZE);
      try {
        const response = await importer.mutateAsync({ data: {
          templateId, importSessionId: sessionId, finalBatch: index + batch.length >= parsed.valid.length, rows: batch,
        } });
        result.imported += response.imported; result.duplicates += response.duplicates; result.invalid += response.invalid;
        result.issues.push(...response.rows.filter(row => row.status !== 'imported').map(issueText));
        setProgress({ done: index + batch.length, total: parsed.valid.length }); onChanged();
      } catch (error) {
        const later = parsed.valid.slice(index + batch.length);
        result.unconfirmed = batch.length; result.notSubmitted = later.length;
        result.issues.push(...batch.map(row => ({ rowNumber: row.rowNumber, companyName: row.company.companyName, status: 'unconfirmed', reason: 'The server outcome could not be confirmed; check the catalog before retrying.' })));
        result.issues.push(...later.map(row => ({ rowNumber: row.rowNumber, companyName: row.company.companyName, status: 'not submitted', reason: 'Not submitted because an earlier batch failed.' })));
        result.failure = `${error instanceof Error ? error.message : 'Import failed.'} No rows were retried automatically.`;
        onChanged(); break;
      }
    }
    result.issues.sort((a,b) => a.rowNumber - b.rowNumber);
    setReport(result); setRunning(false); submitting.current = false;
  };
  const visibleRows = parsed?.allRows.slice(page * 100, page * 100 + 100) ?? [];
  const pages = Math.max(1, Math.ceil((parsed?.allRows.length ?? 0) / 100));
  const downloadIssues = () => {
    if (!report?.issues.length) return;
    const url = URL.createObjectURL(new Blob([makeCsv(report.issues)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mailflow-global-company-import-results.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#1b352e]/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="global-company-import-title" data-testid="dialog-import-global-companies" className="my-auto max-h-[94dvh] w-full max-w-[1180px] overflow-y-auto rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 shadow-2xl sm:p-7">
      <header className="mb-5 flex items-start justify-between gap-4"><div><div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#638a7b]">PLATFORM / COMPANY CATALOG</div><h2 id="global-company-import-title" className="display text-[23px] font-extrabold tracking-[-.03em] text-[#1e3b32]">Bulk upload companies</h2><p className="mt-1.5 text-[12px] text-[#71847a]">Review every profile and correct problems before saving. Contact data is not accepted or imported.</p></div><button type="button" disabled={running || reading} onClick={close} aria-label="Close" className="rounded-md p-2 text-[#71847a] hover:bg-[#edf4ef] disabled:opacity-40"><X className="h-4 w-4"/></button></header>
      {!report && <>
        <div className="rounded-lg border border-[#e3ebe6] bg-white p-4 text-[12px] leading-5 text-[#536d61]"><p><b>Required:</b> Company Name. Optional columns include website, domain, industry, size, revenue range, location, phone, LinkedIn URL, and description.</p><p className="mt-1.5">Use the latest downloaded XLSX template. Up to 10,000 rows and 5 MB. Each template can be used once; downloading another replaces the previous one.</p><button type="button" onClick={() => void downloadTemplate()} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#286d5b] hover:underline"><Download className="h-3.5 w-3.5"/>Download XLSX template</button></div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><input ref={fileRef} id="global-company-import-file" data-testid="input-global-company-import-file" type="file" accept=".xlsx" disabled={running || reading} onChange={event => void pick(event.target.files?.[0])} className="sr-only"/><label htmlFor="global-company-import-file" className={`${outline} cursor-pointer ${running || reading ? 'pointer-events-none opacity-55' : ''}`}>{reading ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}{reading ? 'Reading file…' : parsed ? 'Choose another template' : 'Choose XLSX template'}</label>{parsed && <span className="inline-flex items-center gap-1.5 text-[12px] text-[#536d61]"><FileSpreadsheet className="h-4 w-4"/>{parsed.fileName}</span>}</div>
        {fileError && <div role="alert" className="mt-4 rounded-lg border border-[#ead2c2] bg-[#fff8f2] px-3 py-2.5 text-[12px] text-[#945b37]">{fileError}</div>}
      </>}
      {parsed && !report && <div className="mt-5 space-y-4" data-testid="section-global-company-import-preview">
        <div className="grid grid-cols-3 gap-3"><div className="rounded-lg border bg-white p-3"><div className="text-[11px] text-[#71847a]">Rows found</div><strong>{parsed.totalRows}</strong></div><div className="rounded-lg border bg-white p-3"><div className="text-[11px] text-[#71847a]">Ready</div><strong className="text-[#397050]">{parsed.valid.length}</strong></div><div className="rounded-lg border bg-white p-3"><div className="text-[11px] text-[#71847a]">Needs correction</div><strong className="text-[#a95218]">{parsed.errors.length}</strong></div></div>
        <p className="text-[11px] text-[#71847a]">{parsed.sheetNote} {parsed.warnings.join(' ')}</p>
        <div className="overflow-x-auto rounded-lg border border-[#e3ebe6] bg-white"><table className="w-full min-w-[1600px] text-left text-[10px]"><thead className="sticky top-0 bg-[#f5f9f6] text-[9px] uppercase tracking-wide text-[#71847a]"><tr><th className="p-2">Row</th>{fields.map(([key,label]) => <th key={key} className="p-2">{label}</th>)}<th className="p-2">Review</th></tr></thead><tbody className="divide-y divide-[#edf2ee]">{visibleRows.map(row => { const issue = parsed.errors.find(error => error.rowNumber === row.rowNumber); return <tr key={row.rowNumber} className={issue ? 'bg-[#fffaf5]' : ''}><td className="p-2 text-[#829188]">{row.rowNumber}</td>{fields.map(([key]) => <td key={key} className="p-1"><input aria-label={`Row ${row.rowNumber} ${key}`} value={String(row.company[key] ?? '')} onChange={event => edit(row,key,event.target.value)} className="w-full min-w-24 rounded border border-[#e1e8e3] px-2 py-1.5 text-[10px] text-[#29443b] outline-none focus:border-[#488875]"/></td>)}<td className="max-w-56 p-2 text-[10px] text-[#995b31]">{issue?.reason ?? <span className="text-[#397050]">Ready</span>}</td></tr>; })}</tbody></table></div>
        <div className="flex items-center justify-between text-[11px] text-[#71847a]"><span>Rows {(page * 100) + 1}–{Math.min((page + 1) * 100, parsed.allRows.length)} of {parsed.allRows.length}</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><span className="px-2 py-1">{page + 1} / {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div></div>
        {running && <div role="status" className="flex items-center gap-2 text-[12px] text-[#286d5b]"><LoaderCircle className="h-4 w-4 animate-spin"/>Importing {progress.done} of {progress.total}. Keep this window open.</div>}
      </div>}
      {report && <div className="space-y-4"><div role="status" className={`rounded-lg border px-3 py-2.5 text-[12px] ${report.failure ? 'border-[#ead2c2] bg-[#fff8f2] text-[#945b37]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{report.failure ?? 'Upload finished.'}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Imported',report.imported],['Duplicates',report.duplicates],['Invalid',report.invalid],['Unconfirmed',report.unconfirmed],['Not submitted',report.notSubmitted]].map(([label,value]) => <div key={label} className="rounded-lg border bg-white p-3 text-xs">{label}: <b>{value}</b></div>)}</div>{report.issues.length > 0 && <><button type="button" onClick={downloadIssues} className="text-xs font-semibold text-[#286d5b] underline">Download issue report</button><ul className="max-h-48 overflow-auto rounded border bg-white text-xs">{report.issues.map(issue => <li key={`${issue.rowNumber}-${issue.status}`} className="border-b p-2">Row {issue.rowNumber} · {issue.companyName} · {issue.status}: {issue.reason}</li>)}</ul></>}</div>}
      <footer className="mt-6 flex flex-col-reverse justify-between gap-2 border-t border-[#e5ede8] pt-4 sm:flex-row"><button type="button" onClick={reset} disabled={running || reading || !report} className={outline}>Start another import</button><div className="flex justify-end gap-2"><button type="button" onClick={close} disabled={running || reading} className={outline}>{report ? 'Close' : 'Cancel'}</button>{parsed && !report && <button type="button" disabled={running || parsed.errors.length > 0 || !parsed.valid.length} onClick={() => void run()} className={primary}>{running ? 'Importing…' : `Import ${parsed.valid.length.toLocaleString()} companies`}</button>}</div></footer>
    </section>
  </div>;
}
