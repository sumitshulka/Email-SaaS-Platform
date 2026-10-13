import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { useGetContactFieldOptions, useImportContacts } from '@workspace/api-client-react';
import type { ContactImportInput } from '@workspace/api-client-react';
import {
  BATCH_SIZE, ImportFileError, MAX_ROWS, OPTIONAL_IMPORT_FIELDS, parseContactFile,
  type ParsedImport, type RowError,
} from '@/lib/contact-import';

type Report = { imported: number; duplicate: number; invalid: number; limitReached: number; notSubmitted: number; unconfirmed: number; issues: RowError[]; quotaText: string; failure: string | null };
type Row = ContactImportInput['contacts'][number];

const btn = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55';
const primary = `${btn} border-[#174f99] bg-[#174f99] text-white hover:bg-[#103f7e]`;
const outline = `${btn} border-[#d7dce3] bg-white text-[#283545] hover:bg-[#f7f9fb]`;

function Stat({ label, value, tone = '#192638', id }: { label: string; value: number; tone?: string; id: string }) {
  return <div className="rounded-md border border-[#e3e7eb] p-3"><div className="text-[11px] text-[#778291]">{label}</div><div data-testid={id} className="display mt-1 text-[22px] font-bold" style={{ color: tone }}>{value.toLocaleString()}</div></div>;
}

export function ContactImportDialog({ onClose, onChanged, listIds = [] }: { onClose: () => void; onChanged: () => void; listIds?: string[] }) {
  const importer = useImportContacts();
  const fieldOptionsQuery = useGetContactFieldOptions();
  const fileRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const [previewPage, setPreviewPage] = useState(0);

  const reset = () => { if (running || reading) return; setParsed(null); setTemplateId(null); setFileError(null); setReport(null); setSubscribed(false); setPreviewPage(0); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { if (!running && !reading) onClose(); };

  const pick = async (file: File | undefined) => {
    if (!file || running) return;
    setReport(null); setParsed(null); setTemplateId(null); setFileError(null); setReading(true);
    try {
      const match = file.name.match(/^mailflow-contacts-template-([0-9a-f-]{36})\.xlsx$/i);
      if (!match) throw new ImportFileError('Only the latest XLSX template downloaded from this workspace can be imported. Download a fresh template if needed.');
      setTemplateId(match[1]);
      const parsedFile = await parseContactFile(file);
      const availableOptions = fieldOptionsQuery.data?.options ?? (await fieldOptionsQuery.refetch()).data?.options;
      if (!availableOptions) throw new ImportFileError('Contact field choices could not be loaded. Retry before reviewing this file.');
      const managedFields = ['jobTitle', 'preferredLanguage', 'lifecycleStage', 'leadStatus', 'leadSource'];
      const listErrors = parsedFile.allRows.flatMap(row => managedFields.flatMap(field => {
        const value = row[field as keyof typeof row];
        if (typeof value !== 'string' || !value || !availableOptions.some(option => option.field === field)) return [];
        if (availableOptions.some(option => option.field === field && option.value === value)) return [];
        const label = fieldOptionsQuery.data?.options.find(option => option.field === field)?.field ?? field;
        return [{ rowNumber: row.rowNumber, reason: `${label}: choose a value from the saved list` }];
      }));
      const errors = [...parsedFile.errors, ...listErrors].sort((a, b) => a.rowNumber - b.rowNumber);
      const invalidRows = new Set(errors.map(error => error.rowNumber));
      setParsed({ ...parsedFile, errors, valid: parsedFile.allRows.filter(row => !invalidRows.has(row.rowNumber)) });
      setPreviewPage(0);
    }
    catch (e) { setFileError(e instanceof ImportFileError ? e.message : 'This file could not be read.'); }
    finally { setReading(false); }
  };

  const editRow = (rowNumber: number, field: string, value: string) => {
    if (!parsed) return;
    const allRows = parsed.allRows.map(row => row.rowNumber === rowNumber ? { ...row, [field]: value } : row);
    const fieldOptions = fieldOptionsQuery.data?.options ?? [];
    const errors: RowError[] = [];
    const seen = new Map<string, number>();
    const valid = allRows.filter(row => {
      const problems: string[] = [];
      if (!row.firstName.trim()) problems.push('First Name is required');
      if (!row.lastName.trim()) problems.push('Last Name is required');
      if (!row.email.trim()) problems.push('Email is required');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) problems.push('Email address is not valid');
      for (const [fieldKey, label] of [['jobTitle', 'Job Title'], ['preferredLanguage', 'Preferred Language'], ['lifecycleStage', 'Lifecycle Stage'], ['leadStatus', 'Lead Status'], ['leadSource', 'Lead Source']]) {
        const cell = row[fieldKey as keyof typeof row];
        if (typeof cell === 'string' && cell && fieldOptions.some(item => item.field === fieldKey) &&
            !fieldOptions.some(item => item.field === fieldKey && item.value === cell)) {
          problems.push(`${label} must match a saved list value`);
        }
      }
      const normalized = row.email.trim().toLowerCase();
      if (normalized && !problems.length) {
        const first = seen.get(normalized);
        if (first) problems.push(`Duplicate of row ${first} in this file`);
        else seen.set(normalized, row.rowNumber);
      }
      if (problems.length) errors.push({ rowNumber: row.rowNumber, reason: problems.join('; ') });
      return problems.length === 0;
    });
    setParsed({ ...parsed, allRows, valid, errors });
  };

  const downloadTemplate = async () => {
    setFileError(null);
    try {
      const response = await fetch('/api/contacts/import-template', { credentials: 'include' });
      if (!response.ok) throw new Error('The template could not be downloaded. Please try again.');
      const blob = await response.blob();
      const name = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'mailflow-contacts-template.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      setParsed(null);
      setTemplateId(null);
      setReport(null);
      setPreviewPage(0);
      if (fileRef.current) fileRef.current.value = '';
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The template could not be downloaded.');
    }
  };

  const run = async () => {
    if (!parsed || submitting.current || !parsed.valid.length) return;
    submitting.current = true; setRunning(true);
    const rows: Row[] = parsed.valid.map(r => ({
      rowNumber: r.rowNumber,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      ...Object.fromEntries(
        OPTIONAL_IMPORT_FIELDS.flatMap(field => r[field] ? [[field, r[field]]] : []),
      ),
      listIds,
      subscribed,
    } as Row));
    const acc: Report = { imported: 0, duplicate: 0, invalid: parsed.errors.length, limitReached: 0, notSubmitted: 0, unconfirmed: 0, issues: [...parsed.errors], quotaText: '', failure: null };
    setProgress({ done: 0, total: rows.length });
    const importSessionId = crypto.randomUUID();
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      try {
        const res = await importer.mutateAsync({ data: {
          contacts: batch,
          templateId,
          importSessionId,
          finalBatch: i + batch.length >= rows.length,
        } as never });
        onChanged();
        acc.imported += res.imported;
        if ("rejected" in res) {
          acc.invalid += res.rejected.length;
          acc.issues.push(...res.rejected.map(({ rowNumber, reason }) => ({ rowNumber, reason })));
        } else {
          acc.duplicate += res.duplicate;
          acc.invalid += res.invalid;
          acc.limitReached += res.limitReached;
          acc.issues.push(...res.issues);
        }
        acc.quotaText = res.quota.limit ? `${res.quota.used.toLocaleString()} of ${res.quota.limit.toLocaleString()} contacts used, ${res.quota.remaining.toLocaleString()} remaining${res.quota.requiresSubscription ? ' (subscription required for more)' : ''}` : '';
        setProgress({ done: Math.min(i + BATCH_SIZE, rows.length), total: rows.length });
      } catch (e) {
        const later = rows.slice(i + batch.length);
        acc.notSubmitted = later.length;
        acc.unconfirmed = batch.length;
        acc.issues.push(...batch.map(r => ({ rowNumber: r.rowNumber, reason: 'Outcome not confirmed: the request failed, so the server may or may not have saved this row. Check the contact list before re-importing' })));
        acc.issues.push(...later.map(r => ({ rowNumber: r.rowNumber, reason: 'Not submitted because an earlier request failed' })));
        onChanged();
        acc.failure = `${e instanceof Error ? e.message : 'The request failed.'} Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rows) has an unconfirmed outcome; ${later.length} later rows were never sent. Nothing is retried automatically.`;
        break;
      }
    }
    acc.issues.sort((a, b) => a.rowNumber - b.rowNumber);
    setReport(acc); setRunning(false); submitting.current = false;
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#172334]/35 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-label="Import contacts" data-testid="dialog-import-contacts" className="my-auto w-full max-w-[1040px] rounded-xl border border-[#dfe4ea] bg-white p-5 shadow-xl sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#788596]">AUDIENCE / IMPORT</div><h2 className="display text-[23px] font-bold text-[#172334]">Import contacts</h2><p className="mt-1.5 text-[12px] text-[#748090]">Upload the latest XLSX template. Review and correct everything before anything is saved.</p></div>
        <button type="button" data-testid="button-close-import" disabled={running || reading} onClick={close} className="rounded-md p-2 text-[#778291] hover:bg-[#f3f5f7] disabled:opacity-40" aria-label="Close"><X className="h-4 w-4"/></button>
      </div>

      {!report && <>
        <div className="rounded-md border border-[#e3e7eb] bg-[#fafbfc] p-4 text-[12px] leading-5 text-[#5f6e7f]">
          <p>Required columns: <b>First Name, Last Name, Email</b>. The template includes only contact fields with saved list values; those columns have dropdowns in Excel.</p>
          <p className="mt-1">Download a fresh template for each import. A new download replaces the previous one, and each template can be imported once. Limits: 5 MB and {MAX_ROWS.toLocaleString()} rows. Keep the downloaded filename unchanged.</p>
          <button type="button" data-testid="button-download-template" onClick={() => void downloadTemplate()} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#245b9b] hover:underline"><Download className="h-3.5 w-3.5"/>Download XLSX template</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} data-testid="input-import-file" type="file" accept=".xlsx" disabled={running || reading} onChange={e => void pick(e.target.files?.[0])} className="sr-only" id="contact-import-file"/>
          <label htmlFor="contact-import-file" className={`${outline} cursor-pointer ${running || reading ? 'pointer-events-none opacity-55' : ''}`}>{reading ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}{reading ? 'Reading file' : parsed ? 'Choose a different file' : 'Choose file'}</label>
          {parsed && <span className="inline-flex items-center gap-1.5 text-[12px] text-[#536172]"><FileSpreadsheet className="h-4 w-4"/>{parsed.fileName}</span>}
        </div>
        {fileError && <div role="alert" data-testid="status-import-file-error" className="mt-4 flex items-start gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] text-[#99501e]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>{fileError}</div>}
      </>}

      {parsed && !report && <div className="mt-5 space-y-4" data-testid="section-import-preview">
        <p className="text-[11px] text-[#788392]">{parsed.sheetNote} Review and correct rows before saving. The table is paged so large files remain responsive.</p>
        <div className="grid grid-cols-3 gap-3"><Stat id="text-preview-total" label="Rows found" value={parsed.totalRows}/><Stat id="text-preview-valid" label="Ready to import" value={parsed.valid.length} tone="#397050"/><Stat id="text-preview-errors" label="Rows with errors" value={parsed.errors.length} tone="#a95218"/></div>
        {parsed.warnings.map(w => <p key={w} className="rounded-md bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">{w}</p>)}
        {parsed.ignoredHeaders.length > 0 && <p className="text-[11px] text-[#788392]">Ignored columns: {parsed.ignoredHeaders.join(', ')}</p>}
        {parsed.allRows.length > 0 && <div className="overflow-x-auto rounded-md border border-[#e3e7eb]"><table className="w-full min-w-[760px] text-left text-[11px]"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.1em] text-[#647184]"><tr><th className="px-2 py-2">Row</th><th className="px-2 py-2">First name</th><th className="px-2 py-2">Last name</th><th className="px-2 py-2">Email</th>{(fieldOptionsQuery.data?.options ?? []).filter((item,index,arr)=>arr.findIndex(other=>other.field===item.field)===index).map(option=><th className="px-2 py-2" key={option.field}>{option.field}</th>)}<th className="px-2 py-2">Review</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{parsed.allRows.slice(previewPage * 100, previewPage * 100 + 100).map(row => { const issue=parsed.errors.find(error=>error.rowNumber===row.rowNumber); return <tr key={row.rowNumber} className={issue?'bg-[#fffaf5]':''}><td className="px-2 py-2 text-[#788392]">{row.rowNumber}</td>{(['firstName','lastName','email'] as const).map(field=><td key={field} className="px-1 py-1"><input aria-label={`${field} row ${row.rowNumber}`} value={row[field] ?? ''} onChange={e=>editRow(row.rowNumber,field,e.target.value)} className="w-full min-w-[130px] rounded border border-[#d9e0e7] px-2 py-1.5"/></td>)}{(fieldOptionsQuery.data?.options ?? []).filter((item,index,arr)=>arr.findIndex(other=>other.field===item.field)===index).map(option=>{const options=(fieldOptionsQuery.data?.options ?? []).filter(item=>item.field===option.field); const value=row[option.field as keyof typeof row]; return <td key={option.field} className="px-1 py-1"><select aria-label={`${option.field} row ${row.rowNumber}`} value={typeof value==='string'?value:''} onChange={e=>editRow(row.rowNumber,option.field,e.target.value)} className="min-w-[145px] rounded border border-[#d9e0e7] bg-white px-2 py-1.5"><option value="">—</option>{typeof value==='string'&&value&&!options.some(item=>item.value===value)&&<option value={value}>Invalid: {value}</option>}{options.map(item=><option key={item.id} value={item.value}>{item.value}</option>)}</select></td>})}<td className={`max-w-[260px] px-2 py-2 ${issue?'font-medium text-[#99501e]':'text-[#397050]'}`}>{issue?.reason ?? 'Ready'}</td></tr>})}</tbody></table><div className="flex items-center justify-between border-t border-[#e3e7eb] px-3 py-2 text-[11px] text-[#657386]"><span>Rows {previewPage*100+1}–{Math.min((previewPage+1)*100,parsed.totalRows)} of {parsed.totalRows}</span><div className="flex gap-2"><button type="button" disabled={previewPage===0} onClick={()=>setPreviewPage(page=>page-1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={(previewPage+1)*100>=parsed.allRows.length} onClick={()=>setPreviewPage(page=>page+1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button></div></div></div>}
        <label className="flex items-start gap-2 rounded-md border border-[#e3e7eb] p-3 text-[12px] text-[#445267]"><input data-testid="checkbox-import-subscribed" type="checkbox" checked={subscribed} disabled={running} onChange={e => setSubscribed(e.target.checked)} className="mt-0.5 accent-[#174f99]"/><span>These contacts have opted in to receive email. If unchecked, they are imported as unsubscribed and will not receive campaigns.</span></label>
        {running && <div role="status" data-testid="status-import-progress" className="flex items-center gap-2 text-[12px] text-[#245b9b]"><LoaderCircle className="h-4 w-4 animate-spin"/>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows. Keep this window open.</div>}
      </div>}

      {report && <div data-testid="section-import-report" className="space-y-4">
        <div role="status" className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12px] ${report.failure ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{report.failure ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/>}<span data-testid="text-import-summary">{report.failure ?? 'Import finished.'}</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Stat id="text-report-imported" label="Imported" value={report.imported} tone="#397050"/><Stat id="text-report-duplicate" label="Duplicates skipped" value={report.duplicate}/><Stat id="text-report-invalid" label="Invalid" value={report.invalid} tone="#a95218"/><Stat id="text-report-limit" label="Blocked by plan limit" value={report.limitReached} tone="#a95218"/><Stat id="text-report-unconfirmed" label="Outcome unconfirmed" value={report.unconfirmed} tone="#a95218"/><Stat id="text-report-not-submitted" label="Not submitted" value={report.notSubmitted} tone="#a95218"/></div>
        {report.quotaText && <p className="text-[11px] text-[#788392]">{report.quotaText}</p>}
        {report.issues.length > 0 && <div><div className="mb-1.5 text-[12px] font-semibold text-[#344154]">Rows that were not imported</div><ul data-testid="list-report-issues" className="max-h-52 divide-y divide-[#f1e3d6] overflow-y-auto rounded-md border border-[#f0d5bd] bg-[#fffaf5] text-[11px] text-[#99501e]">{report.issues.map((e, i) => <li key={`${e.rowNumber}-${i}`} className="px-3 py-1.5">Row {e.rowNumber}: {e.reason}</li>)}</ul></div>}
      </div>}

      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[#edf0f2] pt-4">
        {!report && <button type="button" data-testid="button-reset-import" disabled={running || reading || (!parsed && !fileError)} onClick={reset} className={outline}>Reset</button>}
        {report && <button type="button" data-testid="button-import-another" disabled={reading} onClick={reset} className={outline}>Import another file</button>}
        <button type="button" data-testid="button-cancel-import" disabled={running || reading} onClick={close} className={outline}>{report ? 'Done' : 'Cancel'}</button>
        {!report && <button type="button" data-testid="button-start-import" disabled={running || !parsed || parsed.valid.length === 0} onClick={() => void run()} className={primary}>{running && <LoaderCircle className="h-4 w-4 animate-spin"/>}{running ? 'Importing' : parsed ? `Import ${parsed.valid.length.toLocaleString()} contacts` : 'Import contacts'}</button>}
      </div>
    </section>
  </div>;
}
