import { useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import { getGetOpenCampaignAllowanceQueryKey, useGetOpenCampaignAllowance } from '@workspace/api-client-react';
import type { OpenCampaignAllowance, OpenCampaignRecipientInput } from '@workspace/api-client-react';
import { openPlaceholderAvailability, parseOpenRecipientsFile, type OpenRecipientParseResult } from '@/lib/open-campaign';

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export function openCampaignsEnabled(allowance: OpenCampaignAllowance | undefined) {
  return Boolean(allowance && allowance.allowance > 0 && allowance.recipientLimit > 0);
}

function termEnd(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

export function OpenCampaignAllowanceSummary({ allowance, loading, error, retry, compact = false }: { allowance?: OpenCampaignAllowance; loading: boolean; error: boolean; retry: () => void; compact?: boolean }) {
  if (loading) return <div aria-label="Loading open campaign allowance" className="h-14 animate-pulse rounded-md bg-[#edf0f3]"/>;
  if (error || !allowance) return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]">
    <span>Your open campaign allowance couldn’t be loaded.</span>
    <button type="button" data-testid="button-retry-open-campaign-allowance" onClick={retry} className="rounded border border-[#e7c7a8] bg-white px-2 py-1 text-[10px] font-semibold">Retry</button>
  </div>;
  if (!openCampaignsEnabled(allowance)) return <div data-testid="status-open-campaign-not-included" className="flex items-start gap-2 rounded-md border border-[#e3e8ed] bg-[#f7f9fb] px-3 py-2.5 text-[11px] leading-5 text-[#5f6d7d]">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#8a95a1]"/>
    <span>Your current plan doesn’t include open campaigns. Choose a plan with open campaigns on the Plans page to upload recipients.</span>
  </div>;
  const end = termEnd(allowance.termEndsAt);
  return <div data-testid="panel-open-campaign-allowance" className={cx('grid gap-2 rounded-md border border-[#d7e4f3] bg-[#f3f8fd] px-3 py-2.5 text-[11px] text-[#3f5872]', compact ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
    <div><div className="text-[10px] text-[#6c8199]">Open campaigns this term</div><div data-testid="text-open-campaign-used" className="mt-0.5 text-[14px] font-bold text-[#1f4f84]">{allowance.used.toLocaleString()} <span className="text-[11px] font-medium text-[#6c8199]">of {allowance.allowance.toLocaleString()} used</span></div></div>
    <div><div className="text-[10px] text-[#6c8199]">Remaining</div><div data-testid="text-open-campaign-remaining" className={cx('mt-0.5 text-[14px] font-bold', allowance.remaining > 0 ? 'text-[#1f4f84]' : 'text-[#a95218]')}>{allowance.remaining.toLocaleString()}</div></div>
    <div><div className="text-[10px] text-[#6c8199]">Recipients per campaign</div><div data-testid="text-open-campaign-recipient-limit" className="mt-0.5 text-[14px] font-bold text-[#1f4f84]">{allowance.recipientLimit.toLocaleString()}</div></div>
    {!compact && <div className="text-[10px] leading-4 text-[#6c8199]">Counted once, when a campaign is first queued. Drafts, pauses, resumes, and retries don’t use more.{end ? ` Resets after ${end}.` : ''}</div>}
  </div>;
}

export function OpenCampaignEntitlement({ allowance, recipientLimit }: { allowance: number; recipientLimit: number }) {
  const enabled = allowance > 0 && recipientLimit > 0;
  const usage = useGetOpenCampaignAllowance({ query: { queryKey: getGetOpenCampaignAllowanceQueryKey(), enabled, staleTime: 0 } });
  return <p data-testid="text-current-subscription-open-campaigns" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]">
    <Upload className="h-3.5 w-3.5"/>
    {!enabled ? 'Open campaigns to uploaded recipients are not included this term'
      : `${allowance.toLocaleString()} open campaign${allowance === 1 ? '' : 's'} this term, up to ${recipientLimit.toLocaleString()} recipients each${usage.data ? ` · ${usage.data.used.toLocaleString()} used, ${usage.data.remaining.toLocaleString()} remaining` : ''}`}
  </p>;
}

export function OpenCampaignAudience({
  recipients, onChange, allowance, allowanceLoading, allowanceError, retryAllowance, savedLoading, savedError, retrySaved, isExistingDraft,
}: {
  recipients: OpenCampaignRecipientInput[];
  onChange: (recipients: OpenCampaignRecipientInput[]) => void;
  allowance?: OpenCampaignAllowance;
  allowanceLoading: boolean;
  allowanceError: boolean;
  retryAllowance: () => void;
  savedLoading: boolean;
  savedError: boolean;
  retrySaved: () => void;
  isExistingDraft: boolean;
}) {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<OpenRecipientParseResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const enabled = openCampaignsEnabled(allowance);
  const overLimit = Boolean(allowance && recipients.length > allowance.recipientLimit);
  const noneRemaining = Boolean(allowance && enabled && allowance.remaining === 0);
  const uploadBlocked = !enabled || parsing;
  const placeholders = openPlaceholderAvailability(recipients);

  const handleFile = async (file: File) => {
    if (uploadBlocked) return;
    setParsing(true);
    try {
      const parsed = await parseOpenRecipientsFile(file);
      if (!parsed.fatal && allowance && parsed.recipients.length > allowance.recipientLimit) {
        parsed.fatal = `This file has ${parsed.recipients.length.toLocaleString()} unique valid addresses, but your plan allows ${allowance.recipientLimit.toLocaleString()} per open campaign. Remove ${(parsed.recipients.length - allowance.recipientLimit).toLocaleString()} rows and upload again.`;
      }
      setResult(parsed);
      if (!parsed.fatal) onChange(parsed.recipients);
    } catch {
      setResult({ fileName: file.name, recipients: [], totalRows: 0, blankRows: 0, duplicateCount: 0, invalid: [], fatal: 'This file could not be read. Upload a valid CSV or XLSX file and try again.' });
    } finally {
      setParsing(false);
    }
  };

  return <section data-testid="panel-open-campaign-audience" aria-label="Uploaded recipients" className="space-y-3 sm:col-span-2">
    <OpenCampaignAllowanceSummary allowance={allowance} loading={allowanceLoading} error={allowanceError} retry={retryAllowance}/>
    {noneRemaining && <div role="status" data-testid="status-open-campaign-none-remaining" className="flex items-start gap-2 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2 text-[11px] leading-5 text-[#895b2f]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>You’ve used every open campaign in this term. You can save this draft, but it can only be queued after your allowance resets or your plan changes.</span></div>}
    {savedLoading && <p role="status" className="flex items-center gap-2 rounded-md bg-[#f7f9fb] px-3 py-2 text-[11px] text-[#6f7b88]"><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>Loading the saved recipients for this draft…</p>}
    {savedError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>The saved recipients for this draft couldn’t be loaded. Retry, or upload a replacement file.</span><button type="button" data-testid="button-retry-open-campaign-recipients" onClick={retrySaved} className="rounded border border-[#e7c7a8] bg-white px-2 py-1 text-[10px] font-semibold">Retry</button></div>}

    <label
      data-testid="dropzone-open-campaign-csv"
      onDragOver={event => { event.preventDefault(); if (!uploadBlocked) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void handleFile(file); }}
      className={cx('flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition', uploadBlocked ? 'cursor-not-allowed border-[#dfe4ea] bg-[#fafbfc] opacity-60' : dragging ? 'cursor-pointer border-[#3b73b8] bg-[#eef5fd]' : 'cursor-pointer border-[#c9d7e5] bg-[#fbfcfe] hover:border-[#9abbe1] hover:bg-[#f4f8fc]')}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#edf4fc] text-[#245b9b]">{parsing ? <LoaderCircle className="h-5 w-5 animate-spin"/> : <FileSpreadsheet className="h-5 w-5"/>}</span>
      <span className="text-[12px] font-semibold text-[#26364a]">{parsing ? 'Reading your file…' : recipients.length ? 'Replace recipients with a new CSV or XLSX' : 'Upload a recipient CSV or XLSX'}</span>
      <span className="max-w-md text-[11px] leading-5 text-[#6f7b88]">Required column: <strong>email</strong> (or “email id”). Optional: <strong>first name</strong> and <strong>last name</strong>. Addresses are checked and duplicates removed. Uploaded rows are used only for this campaign and are not added to Contacts.</span>
      <span className="text-[10px] text-[#788392]">CSV or XLSX, up to 10 MB. For XLSX, only the first worksheet is read; put column headers in its first row.</span>
      <input data-testid="input-open-campaign-csv" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={uploadBlocked} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void handleFile(file); }}/>
    </label>

    {result?.fatal && <div role="alert" data-testid="status-open-campaign-csv-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[11px] leading-5 text-[#99501e]"><strong className="block">{result.fileName} wasn’t used.</strong>{result.fatal}{recipients.length > 0 && <span className="block">Your previous {recipients.length.toLocaleString()} recipients are unchanged.</span>}</div>}
    {result && !result.fatal && <div role="status" data-testid="status-open-campaign-csv-result" className="flex items-start gap-2 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] px-3 py-2.5 text-[11px] leading-5 text-[#31674b]">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/>
      <span><strong>{result.recipients.length.toLocaleString()} recipients ready</strong> from {result.fileName}: {result.totalRows.toLocaleString()} rows read{result.duplicateCount ? `, ${result.duplicateCount.toLocaleString()} duplicate${result.duplicateCount === 1 ? '' : 's'} removed` : ''}{result.invalid.length ? `, ${result.invalid.length.toLocaleString()} skipped` : ''}.</span>
    </div>}
    {result && result.invalid.length > 0 && <details data-testid="list-open-campaign-csv-issues" className="rounded-md border border-[#efd9bd] bg-[#fffaf3] px-3 py-2 text-[11px] text-[#895b2f]" open={Boolean(result.fatal)}>
      <summary className="cursor-pointer font-semibold">{result.invalid.length.toLocaleString()} row{result.invalid.length === 1 ? '' : 's'} skipped. Fix these in your file and upload again to include them.</summary>
      <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">{result.invalid.slice(0, 50).map(issue => <li key={`${issue.row}-${issue.value}`} className="flex gap-2"><span className="mono w-14 shrink-0 text-[10px] text-[#a07a55]">Row {issue.row}</span><span className="min-w-0 break-all">{issue.value || '(blank)'}</span><span className="shrink-0 text-[#a0603a]">{issue.reason}</span></li>)}</ul>
      {result.invalid.length > 50 && <p className="mt-1 text-[10px]">Showing the first 50 of {result.invalid.length.toLocaleString()}.</p>}
    </details>}

    {overLimit && allowance && <div role="alert" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]">This draft has {recipients.length.toLocaleString()} recipients, more than the {allowance.recipientLimit.toLocaleString()} your plan allows per open campaign. Upload a smaller file to continue.</div>}

    {recipients.length > 0 ? <div className="overflow-hidden rounded-md border border-[#e3e8ed]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8edf1] bg-[#fbfcfd] px-3 py-2">
        <span data-testid="text-open-campaign-recipient-count" className="text-[11px] font-semibold text-[#344154]">{recipients.length.toLocaleString()} unique recipient{recipients.length === 1 ? '' : 's'}{isExistingDraft && !result ? ' saved on this draft' : ''}</span>
        <button type="button" data-testid="button-clear-open-campaign-recipients" onClick={() => { onChange([]); setResult(null); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-[#687484] hover:bg-[#eef1f4]"><X className="h-3 w-3"/>Remove all</button>
      </div>
      <table className="w-full text-left text-[11px]">
        <thead className="bg-[#f6f8fa] text-[9px] uppercase tracking-wide text-[#718091]"><tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">First name</th><th className="px-3 py-2">Last name</th></tr></thead>
        <tbody className="divide-y divide-[#edf0f3]">{recipients.slice(0, 8).map(recipient => <tr key={recipient.email}><td className="break-all px-3 py-2 text-[#344154]">{recipient.email}</td><td className="px-3 py-2 text-[#536172]">{recipient.firstName || <span className="text-[#a0a8b3]">—</span>}</td><td className="px-3 py-2 text-[#536172]">{recipient.lastName || <span className="text-[#a0a8b3]">—</span>}</td></tr>)}</tbody>
      </table>
      {recipients.length > 8 && <p className="border-t border-[#e8edf1] bg-[#fbfcfd] px-3 py-1.5 text-[10px] text-[#788392]">Sample of the first 8 of {recipients.length.toLocaleString()}.</p>}
      <p data-testid="text-open-campaign-placeholder-availability" className="border-t border-[#e8edf1] px-3 py-2 text-[10px] leading-4 text-[#687587]">Personalization available: email{placeholders.firstName ? ', first name' : ''}{placeholders.lastName ? ', last name' : ''}{placeholders.fullName ? ', full name' : ''}. {!placeholders.fullName && 'Name fields are only available when every row has a value.'}</p>
    </div> : !savedLoading && <p className="rounded-md bg-[#f7f9fb] p-3 text-[11px] text-[#6f7b88]">No recipients yet. Upload a CSV or XLSX to build this campaign’s audience.</p>}
    <p className="flex items-start gap-1.5 text-[10px] leading-4 text-[#7b8794]"><Upload className="mt-0.5 h-3 w-3 shrink-0"/>Unsubscribes and confirmed bounces in this workspace are still suppressed when the campaign is queued. Uploaded recipients share your mailbox pacing with other campaigns.</p>
  </section>;
}
