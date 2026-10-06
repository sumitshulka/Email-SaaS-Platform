import { Fragment, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileUp, Info, LoaderCircle, RefreshCw, Unlink } from 'lucide-react';
import {
  getGetMicrosoft365TraceConnectionQueryKey,
  getGetCampaignDashboardQueryKey, getGetCampaignDeliveryReportQueryKey, getGetUserDashboardQueryKey,
  getListCampaignsQueryKey, getListContactsQueryKey, useBackfillMicrosoft365Traces,
  useConnectMicrosoft365Trace, useDisconnectMicrosoft365Trace,
  useGetCampaignDeliveryReport, useGetMicrosoft365TraceConnection,
  useImportDeliveryReport, useTriggerMicrosoft365TraceSync,
} from '@workspace/api-client-react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
const MAX_BYTES = 1024 * 1024;
const PAGE = 50;
type Tone = 'blue' | 'green' | 'orange' | 'gray';
type ImportFormat = 'dsn' | 'microsoft_365_csv' | 'google_workspace_csv' | 'generic_csv';

const toneClass: Record<Tone, string> = { blue: 'bg-[#edf4fc] text-[#245b9b]', green: 'bg-[#edf7f0] text-[#397050]', orange: 'bg-[#fff3e8] text-[#a95218]', gray: 'bg-[#f0f2f4] text-[#66717e]' };
const dotClass: Record<Tone, string> = { blue: 'bg-[#4382c4]', green: 'bg-[#4c9668]', orange: 'bg-[#e78b3b]', gray: 'bg-[#929ba6]' };
const outlineBtn = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#d7dce3] bg-white px-3 text-[12px] font-semibold text-[#283545] transition hover:bg-[#f7f9fb] disabled:cursor-not-allowed disabled:opacity-55';
const primaryBtn = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[13px] font-semibold text-white transition hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55';
const inputCls = 'w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]';
const MICROSOFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICROSOFT_TRACE_GUIDE = 'https://learn.microsoft.com/en-us/exchange/monitoring/trace-an-email-message/graph-api-message-trace';
const MICROSOFT_TRACE_RESOURCE = 'https://learn.microsoft.com/en-us/graph/api/resources/exchangemessagetrace?view=graph-rest-1.0';

type MicrosoftTraceConnectGuidance = { title: string; detail: string; nextSteps: string[] };

function microsoftTraceConnectGuidance(error: unknown): MicrosoftTraceConnectGuidance {
  const value = error && typeof error === 'object' ? error as { status?: unknown; data?: unknown } : {};
  const status = typeof value.status === 'number' ? value.status : null;
  const data = value.data && typeof value.data === 'object' ? value.data as { code?: unknown } : {};

  if (data.code === 'MICROSOFT_365_TENANT_SWITCH_REQUIRES_DISCONNECT' || status === 409) {
    return {
      title: 'Disconnect the current tenant before switching',
      detail: 'This workspace already has a Microsoft 365 trace connection for another tenant.',
      nextSteps: ['Disconnect the current connection below, then enter the new tenant and app details. Previously saved delivery evidence will remain.'],
    };
  }
  if (data.code === 'MICROSOFT_365_TRACE_NOT_AUTHORIZED' || status === 403) {
    return {
      title: 'Microsoft signed in, but did not allow trace access',
      detail: 'The app is missing permission or the tenant has not completed one of the administrator steps.',
      nextSteps: ['Confirm ExchangeMessageTrace.Read.All is an Application permission and tenant admin consent is granted.', 'Confirm the Microsoft Exchange trace service principal exists in this tenant.'],
    };
  }
  if (data.code === 'MICROSOFT_365_CREDENTIALS_REJECTED' || data.code === 'INVALID_INPUT' || status === 400) {
    return {
      title: 'Check the tenant, app, and secret values',
      detail: 'Microsoft could not verify the sign-in details. The secret field was cleared; it is not saved in this page after an attempt.',
      nextSteps: ['Copy the Directory (tenant) ID and Application (client) ID from the same Entra app registration.', 'Enter the secret Value (not its Secret ID) and check that it has not expired.'],
    };
  }
  if (data.code === 'MICROSOFT_365_TRACE_UNAVAILABLE' || status === 502) {
    return {
      title: 'Microsoft could not be reached to verify trace access',
      detail: 'No connection was saved. Check Microsoft service availability and try again.',
      nextSteps: ['If this keeps happening after retrying, confirm the setup in Microsoft’s message-trace guide.'],
    };
  }
  return {
    title: 'Trace access could not be verified',
    detail: 'No connection was saved. Check the Microsoft setup steps and try again.',
    nextSteps: ['Confirm the tenant and app IDs, the active secret Value, admin consent, and the Exchange trace service principal.'],
  };
}

/** Maps imported report outcome strings to display labels. Defensive: unknown strings are shown verbatim as Unconfirmed-like gray. */
export function reportOutcomeMeta(outcome: string | null | undefined): { label: string; tone: Tone } | null {
  switch (outcome) {
    case 'delivered': case 'reported_delivered': return { label: 'Reported delivered', tone: 'green' };
    case 'bounced': case 'reported_bounced': case 'bounce': return { label: 'Reported bounce', tone: 'orange' };
    case 'delayed': case 'reported_delayed': case 'delay': return { label: 'Reported delay', tone: 'blue' };
    case 'failed': case 'reported_failed': case 'failure': return { label: 'Reported failure', tone: 'orange' };
    case 'unconfirmed': case 'none': case '': case null: case undefined: return null;
    default: return { label: 'Unconfirmed', tone: 'gray' };
  }
}

export function EvidencePill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold', toneClass[tone])}><span className={cx('h-1.5 w-1.5 rounded-full', dotClass[tone])}/>{label}</span>;
}

type ReportFields = { reportOutcome?: string | null; reportSource?: string | null; reportEvidenceVerification?: string | null; reportDiagnostic?: string | null; reportAt?: string | null; lastError?: string | null; messageId?: string | null; smtpResponse?: string | null };

function evidenceSourceLabel(verification: string | null | undefined): string {
  if (verification === 'gmail_authorized') return 'Google-authorized mailbox';
  if (verification === 'microsoft365_authorized') return 'Microsoft 365 tenant-authorized trace';
  return 'User-imported';
}

/** Compact report line for contact latest-email / history, kept distinct from transport status. */
export function ContactReportEvidence({ item, detailed = false, id }: { item: ReportFields; detailed?: boolean; id: string }) {
  const meta = reportOutcomeMeta(item.reportOutcome);
  const hasDetail = !!(item.reportDiagnostic || item.lastError || item.messageId || item.smtpResponse);
  if (!meta && !hasDetail) return null;
  return <div data-testid={`evidence-contact-${id}`} className="mt-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {meta ? <EvidencePill label={meta.label} tone={meta.tone}/> : <EvidencePill label="Unconfirmed" tone="gray"/>}
      {meta && <span className="text-[10px] text-[#87919d]">{item.reportAt ? new Date(item.reportAt).toLocaleDateString() : 'Report time unavailable'}</span>}
    </div>
    {detailed && <dl className="mt-2 space-y-1 rounded-md bg-[#f7f9fb] p-2.5 text-[11px] text-[#5c6877]">
      {item.reportDiagnostic && <div><dt className="inline font-semibold">Report diagnostic: </dt><dd className="inline break-words">{item.reportDiagnostic}</dd></div>}
      {item.reportSource && <div><dt className="inline font-semibold">Source: </dt><dd className="inline">{evidenceSourceLabel(item.reportEvidenceVerification)} · {item.reportSource.replace(/_/g, ' ')}</dd></div>}
      {item.lastError && <div><dt className="inline font-semibold">SMTP error: </dt><dd className="inline break-words">{item.lastError}</dd></div>}
      {item.smtpResponse && <div><dt className="inline font-semibold">SMTP response: </dt><dd className="mono inline break-all">{item.smtpResponse}</dd></div>}
      {item.messageId && <div><dt className="inline font-semibold">Message-ID: </dt><dd className="mono inline break-all">{item.messageId}</dd></div>}
    </dl>}
  </div>;
}

function Disclosure({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return <details data-testid={testId} className="group rounded-md border border-[#e5e9ed] bg-[#fbfcfd] px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-semibold text-[#344154]">{title}<ChevronDown className="h-4 w-4 transition group-open:rotate-180"/></summary><div className="mt-3 space-y-2 text-[12px] leading-5 text-[#5f6c7c]">{children}</div></details>;
}

function downloadTemplate() {
  const csv = 'message_id,recipient_address,status,timestamp,diagnostic\r\n<tracked-message-id@example.test>,recipient@example.test,Delivered,2025-01-31T14:05:00+00:00,Replace with your real values\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'mailflow-report-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

function ImportPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const importer = useImportDeliveryReport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ImportFormat>('dsn');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; unmatched: number; ignored: number; warnings: string[]; message: string } | null>(null);
  const bytes = new Blob([content]).size;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setError(null); setResult(null);
    if (file.size > MAX_BYTES) { setError(`${file.name} is ${(file.size / 1048576).toFixed(2)} MB. Reports must be 1 MB or smaller.`); return; }
    try {
      const text = await file.text();
      if (!text.trim()) { setError(`${file.name} is empty.`); return; }
      setContent(text); setFileName(file.name);
      if (/\.csv$/i.test(file.name) && format === 'dsn') setFormat('generic_csv');
      if (/\.(eml|txt)$/i.test(file.name) && format !== 'dsn') setFormat('dsn');
    } catch { setError(`We couldn't read ${file.name}. Check the file and try again, or paste its text instead.`); }
  };
  const submit = () => {
    setError(null); setResult(null);
    if (!content.trim()) { setError('Choose a file or paste report text first.'); return; }
    if (bytes > MAX_BYTES) { setError('Report text exceeds 1 MB. Trim it or split it into smaller files.'); return; }
    importer.mutate({ data: { format, content, campaignId } }, {
      onSuccess: res => {
        setResult(res); setContent(''); setFileName('');
        void qc.invalidateQueries({ queryKey: getGetCampaignDeliveryReportQueryKey(campaignId) });
        void qc.invalidateQueries({ queryKey: getGetCampaignDashboardQueryKey(campaignId) });
        void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('/email-history') });
      },
      onError: err => setError(err instanceof Error ? err.message : 'The report could not be imported.'),
    });
  };
  return <div className="border-t border-[#e9edf0] px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Import a delivery report</h3><p className="mt-0.5 text-[11px] text-[#788392]">Add bounce or delivery evidence from your mailbox provider. It is stored as user-supplied evidence.</p></div>
      <button type="button" data-testid="button-toggle-report-import" className={outlineBtn} onClick={() => setOpen(v => !v)}><FileUp className="h-4 w-4"/>{open ? 'Hide import' : 'Import report'}</button>
    </div>
    {open && <div className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <label className="block"><span className="mb-1.5 block text-[12px] font-semibold text-[#344154]">Report format</span>
          <select data-testid="select-report-format" className={cx(inputCls, 'h-10')} value={format} onChange={e => setFormat(e.target.value as ImportFormat)}>
            <option value="dsn">Delivery-failure notice (DSN / .eml)</option><option value="google_workspace_csv">Google Workspace Email Log CSV</option><option value="microsoft_365_csv">Microsoft 365 message trace CSV</option><option value="generic_csv">Generic CSV</option>
          </select></label>
        <div><span className="mb-1.5 block text-[12px] font-semibold text-[#344154]">File</span>
          <div className="flex flex-wrap items-center gap-3"><input ref={fileRef} data-testid="input-report-file" type="file" accept=".eml,.txt,.csv,text/plain,text/csv,message/rfc822" className="hidden" onChange={e => void onFile(e)}/>
            <button type="button" data-testid="button-choose-report-file" className={outlineBtn} onClick={() => fileRef.current?.click()}>Choose .eml, .txt or .csv</button>
            <span data-testid="text-report-file-name" className="text-[11px] text-[#788392]">{fileName || 'No file chosen. Max 1 MB.'}</span></div></div>
      </div>
      <label className="block"><span className="mb-1.5 block text-[12px] font-semibold text-[#344154]">Or paste report text</span>
        <textarea data-testid="input-report-text" rows={5} className={cx(inputCls, 'mono py-2 text-[11px]')} value={content} onChange={e => { setContent(e.target.value); setFileName(''); }} placeholder="Paste a delivery-failure notification or CSV rows"/>
        <span className={cx('mt-1 block text-[11px]', bytes > MAX_BYTES ? 'text-[#a95218]' : 'text-[#808a97]')}>{(bytes / 1024).toFixed(1)} KB of 1024 KB</span></label>
      <div className="space-y-2">
        <Disclosure testId="help-report-sources" title="Where do I get each report?">
          <p><b>Gmail:</b> open the original delivery-failure notification and download the message as .eml.</p>
          <p><b>Google Workspace:</b> Email Log Search shows delivery steps only, with no inbox placement or read details. Dates follow the admin's device timezone. Export headers vary, so a native export may need its columns renamed to the template below, with an explicit timezone on timestamps.</p>
          <p><b>Microsoft 365:</b> a message trace CSV with Status and recipient columns, an enhanced summary with recipient_status (for example recipient@example.test##Receive, Deliver or Fail), or an extended trace with event_id, recipient_address and message_id. SEND events only mean SMTP transmission, not mailbox delivery, and are ignored.</p>
          <p><b>Other:</b> a generic DSN message or a CSV. Native exports are not guaranteed to be compatible; the template is the safest format.</p>
        </Disclosure>
        <Disclosure testId="help-report-columns" title="CSV columns and matching rules">
          <p>Required columns: <span className="mono">Message-ID</span>, <span className="mono">Message ID</span> or <span className="mono">message_id</span>; <span className="mono">recipient</span>, <span className="mono">RecipientAddress</span> or <span className="mono">recipient_address</span>; <span className="mono">status</span> or <span className="mono">Event status</span>. A timestamp column is optional; use ISO format with an explicit timezone.</p>
          <p>A row is applied only when it matches this workspace, a tracked message ID and the recipient. Subject or email address alone never matches, so sends made before tracking IDs were stored will show as unmatched.</p>
          <p>Received and origin timestamps in a source are when the service first received the message, not delivery time, so they are not used as the report time. Rows without an event time show "Report time unavailable".</p>
          <p>The file itself is not kept; only the extracted evidence is saved.</p>
          <button type="button" data-testid="button-download-csv-template" className={outlineBtn} onClick={downloadTemplate}>Download CSV template</button>
        </Disclosure>
      </div>
      <div className="flex items-start gap-2 rounded-md bg-[#f5f8fb] p-3 text-[11px] leading-5 text-[#5f6c7c]"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#245b9b]"/>Imported reports are evidence you supply. Mailflow cannot authenticate them with the provider.</div>
      {error && <div role="alert" data-testid="error-report-import" className="flex items-start gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] text-[#99501e]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>{error}</div>}
      <button type="button" data-testid="button-submit-report-import" className={primaryBtn} disabled={importer.isPending || !content.trim()} onClick={submit}>{importer.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}{importer.isPending ? 'Importing' : 'Import evidence'}</button>
    </div>}
    {result && <div role="status" data-testid="result-report-import" className="mt-4 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] p-4 text-[12px] text-[#31674b]">
      <p className="font-semibold">{result.message}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{([['Imported', result.imported], ['Duplicates', result.duplicates], ['Unmatched', result.unmatched], ['Ignored', result.ignored]] as const).map(([l, v]) => <div key={l} data-testid={`count-import-${l.toLowerCase()}`}><div className="display text-[20px] font-bold">{v}</div><div className="text-[11px]">{l}</div></div>)}</div>
      {result.warnings.length > 0 && <ul data-testid="list-import-warnings" className="mt-3 list-disc space-y-1 border-t border-[#cfe4d8] pl-5 pt-3 text-[#8a5a2b]">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>}
  </div>;
}

export function Microsoft365TraceSettingsPanel() {
  const qc = useQueryClient();
  const connectionQuery = useGetMicrosoft365TraceConnection({
    query: { queryKey: getGetMicrosoft365TraceConnectionQueryKey(), refetchInterval: 30_000, staleTime: 10_000 },
  });
  const connect = useConnectMicrosoft365Trace();
  const disconnect = useDisconnectMicrosoft365Trace();
  const sync = useTriggerMicrosoft365TraceSync();
  const backfill = useBackfillMicrosoft365Traces();
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [adminConsentConfirmed, setAdminConsentConfirmed] = useState(false);
  const [days, setDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<MicrosoftTraceConnectGuidance | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connection = connectionQuery.data;
  const busy = connect.isPending || disconnect.isPending || sync.isPending || backfill.isPending;
  const tenantIdValid = MICROSOFT_UUID.test(tenantId.trim());
  const clientIdValid = MICROSOFT_UUID.test(clientId.trim());

  const refreshEvidence = () => {
    void qc.invalidateQueries({ queryKey: getGetMicrosoft365TraceConnectionQueryKey() });
    void qc.invalidateQueries({
      predicate: query => {
        const key = String(query.queryKey[0] ?? '');
        return key.endsWith('/delivery-report') || /^\/api\/campaigns\/[^/]+$/.test(key);
      },
    });
    void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
  };
  const submitConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); setNotice(null); setConnectError(null);
    if (!tenantIdValid || !clientIdValid) {
      setConnectError({
        title: 'Enter valid Microsoft Entra IDs',
        detail: 'Both values must be complete IDs in the 8-4-4-4-12 format shown below.',
        nextSteps: ['Copy the Directory (tenant) ID from the tenant Overview.', 'Copy the Application (client) ID from the app registration Overview.'],
      });
      return;
    }
    connect.mutate({ data: { tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret, adminConsentConfirmed: true } }, {
      onSuccess: () => {
        setNotice('Microsoft Graph accepted a trace request. The rolling 90-day backfill is queued.');
        refreshEvidence();
      },
      onError: err => setConnectError(microsoftTraceConnectGuidance(err)),
    });
    setClientSecret('');
  };
  const runSync = () => {
    setError(null); setConnectError(null); setNotice(null);
    sync.mutate(undefined, {
      onSuccess: () => { setNotice('A trace sync is queued.'); refreshEvidence(); },
      onError: err => setError(err instanceof Error ? err.message : 'The sync could not be queued.'),
    });
  };
  const runBackfill = () => {
    setError(null); setConnectError(null); setNotice(null);
    backfill.mutate({ data: { days } }, {
      onSuccess: () => { setNotice(`A ${days}-day trace backfill is queued.`); refreshEvidence(); },
      onError: err => setError(err instanceof Error ? err.message : 'The backfill could not be queued.'),
    });
  };
  const removeConnection = () => {
    if (!window.confirm('Disconnect Microsoft 365 trace collection? Saved delivery evidence will stay, but credentials and queued trace work will be removed.')) return;
    setError(null); setConnectError(null); setNotice(null);
    disconnect.mutate(undefined, {
      onSuccess: () => { setNotice('Microsoft 365 trace collection is disconnected. Previously recorded evidence remains.'); refreshEvidence(); },
      onError: err => setError(err instanceof Error ? err.message : 'The connection could not be removed.'),
    });
  };

  return <section data-testid="section-microsoft365-trace" className="mb-5 rounded-lg border border-[#e0e4e9] bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Microsoft 365 message trace</h3>
        <p className="mt-0.5 max-w-3xl text-[11px] leading-5 text-[#788392]">Connect a tenant-authorized Microsoft Graph app to collect trace events automatically for this workspace’s campaigns. One connection applies to all campaigns; matched events appear on each campaign’s details page. This is separate from SMTP credentials and does not confirm inbox placement or reading.</p></div>
      {connection?.connected && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${connection.syncStatus === 'error' ? 'bg-[#fff3e8] text-[#a95218]' : 'bg-[#edf7f0] text-[#397050]'}`}>{connection.syncStatus === 'error' ? <AlertCircle className="h-3.5 w-3.5"/> : <CheckCircle2 className="h-3.5 w-3.5"/>}{connection.syncStatus === 'error' ? 'Sync needs attention' : 'Trace access verified'}</span>}
    </div>
    {connectionQuery.isError && <div role="alert" className="mt-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] text-[#99501e]">Connection health could not be loaded. Retry by refreshing this page.</div>}
    {connection?.connected ? <div className="mt-3 space-y-3">
      <div className="grid gap-3 rounded-md bg-[#f7f9fb] p-3 text-[11px] text-[#5c6877] sm:grid-cols-2">
        <div><span className="font-semibold text-[#344154]">Tenant:</span> <span className="mono break-all">{connection.tenantId}</span></div>
        <div><span className="font-semibold text-[#344154]">Authenticated source:</span> Microsoft Graph · {connection.permission}</div>
        <div><span className="font-semibold text-[#344154]">Last successful sync:</span> {connection.lastSuccessAt ? new Date(connection.lastSuccessAt).toLocaleString() : 'Not yet synced'}</div>
        <div><span className="font-semibold text-[#344154]">Backfill:</span> {connection.backfillStartAt ? `Working from ${new Date(connection.backfillStartAt).toLocaleDateString()} through ${connection.backfillEndAt ? new Date(connection.backfillEndAt).toLocaleDateString() : 'now'}` : connection.backfillCompletedAt ? `Complete · ${new Date(connection.backfillCompletedAt).toLocaleString()}` : 'Incremental sync is active'}</div>
      </div>
      {connection.lastError && <div role="status" data-testid="text-microsoft365-sync-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">{connection.lastError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="button-sync-microsoft365-now" className={outlineBtn} disabled={busy} onClick={runSync}><RefreshCw className="h-3.5 w-3.5"/>Sync now</button>
        <label className="flex items-center gap-2 text-[11px] text-[#5c6877]">Backfill
          <select data-testid="select-microsoft365-backfill-days" className="h-9 rounded-md border border-[#d8dde4] bg-white px-2 text-[12px]" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
        </label>
        <button type="button" data-testid="button-backfill-microsoft365" className={outlineBtn} disabled={busy} onClick={runBackfill}>Start backfill</button>
        <button type="button" data-testid="button-disconnect-microsoft365" className={outlineBtn} disabled={busy} onClick={removeConnection}><Unlink className="h-3.5 w-3.5"/>Disconnect</button>
      </div>
    </div> : <form className="mt-3 space-y-3" onSubmit={submitConnect}>
      <div data-testid="help-microsoft365-trace-setup" className="rounded-md border border-[#e5e9ed] bg-[#fbfcfd] p-4">
        <h4 className="text-[12px] font-semibold text-[#344154]">Set up Microsoft 365 trace access</h4>
        <p className="mt-1 text-[11px] leading-5 text-[#5f6c7c]">A Microsoft 365 administrator completes these steps in your organization. Mailflow cannot do them for you.</p>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-[11px] leading-5 text-[#5f6c7c]">
          <li>
            <b className="text-[#344154]">Create or open an app registration.</b> In Microsoft Entra, register the app that will read traces. On its Overview page, copy the Directory (tenant) ID and Application (client) ID.
            {' '}<a data-testid="link-microsoft365-entra-apps" className="text-[#245b9b] underline" href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">Open app registrations in Microsoft Entra</a>.
          </li>
          <li>
            <b className="text-[#344154]">Allow the app to read message traces.</b> Open API permissions, choose Add a permission → Microsoft Graph → Application permissions, and add <span className="mono">ExchangeMessageTrace.Read.All</span>. A tenant administrator must then select Grant admin consent.
            {' '}<a data-testid="link-microsoft365-graph-setup" className="text-[#245b9b] underline" href={MICROSOFT_TRACE_GUIDE} target="_blank" rel="noreferrer">Follow Microsoft’s Graph trace setup guide</a>
            {' '}or <a data-testid="link-microsoft365-admin-consent-help" className="text-[#245b9b] underline" href="https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent" target="_blank" rel="noreferrer">read about tenant admin consent</a>.
          </li>
          <li>
            <b className="text-[#344154]">Create a client secret.</b> In the app registration, open Certificates &amp; secrets and create a client secret. Copy its <b>Value</b> right away; Microsoft will not show it again. Do not use the Secret ID.
            {' '}<a data-testid="link-microsoft365-secret-help" className="text-[#245b9b] underline" href="https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials?tabs=client-secret" target="_blank" rel="noreferrer">Microsoft’s secret setup instructions</a>.
          </li>
          <li>
            <b className="text-[#344154]">Provision Microsoft’s trace service principal.</b> This is separate from your app registration. In Microsoft Graph PowerShell, an administrator with permission to create service principals runs:
            <pre className="my-2 overflow-x-auto rounded bg-[#f0f3f6] p-2 text-[10px] leading-4 text-[#344154]"><code>{'Connect-MgGraph -Scopes "Application.ReadWrite.All"\nNew-MgServicePrincipal -AppId 8bd644d1-64a1-4d4b-ae52-2e0cbf64e373'}</code></pre>
            <a data-testid="link-microsoft365-trace-service-principal" className="text-[#245b9b] underline" href={MICROSOFT_TRACE_RESOURCE} target="_blank" rel="noreferrer">See Microsoft’s service-principal instructions</a>
            {' '}and <a data-testid="link-microsoft365-graph-powershell" className="text-[#245b9b] underline" href="https://learn.microsoft.com/en-us/powershell/microsoftgraph/installation?view=graph-powershell-1.0" target="_blank" rel="noreferrer">install Microsoft Graph PowerShell if needed</a>. It can take several hours for this setup to become available.
          </li>
        </ol>
        <p className="mt-3 border-t border-[#e5e9ed] pt-3 text-[11px] leading-5 text-[#5f6c7c]">Microsoft limits trace history to 90 days and requests to 10-day windows. Mailflow splits requests into supported windows and stores progress as it syncs.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#344154]">Microsoft Entra tenant ID</span>
          <input data-testid="input-microsoft365-tenant-id" aria-invalid={tenantId.length > 0 && !tenantIdValid} aria-describedby={tenantId.length > 0 && !tenantIdValid ? 'help-microsoft365-tenant-id error-microsoft365-tenant-id' : 'help-microsoft365-tenant-id'} className={cx(inputCls, 'h-9 mono')} autoComplete="off" spellCheck={false} required maxLength={36} value={tenantId} onChange={e => { setTenantId(e.target.value); setConnectError(null); }} placeholder="Directory (tenant) ID"/>
          <span id="help-microsoft365-tenant-id" className="mt-1 block text-[10px] leading-4 text-[#788392]">36 characters in 8-4-4-4-12 format; copy it from the tenant Overview.</span>
          {tenantId.length > 0 && !tenantIdValid && <span role="alert" data-testid="error-microsoft365-tenant-id" className="mt-1 block text-[10px] text-[#99501e]">Enter the full tenant ID, including its hyphens.</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#344154]">App registration client ID</span>
          <input data-testid="input-microsoft365-client-id" aria-invalid={clientId.length > 0 && !clientIdValid} aria-describedby={clientId.length > 0 && !clientIdValid ? 'help-microsoft365-client-id error-microsoft365-client-id' : 'help-microsoft365-client-id'} className={cx(inputCls, 'h-9 mono')} autoComplete="off" spellCheck={false} required maxLength={36} value={clientId} onChange={e => { setClientId(e.target.value); setConnectError(null); }} placeholder="Application (client) ID"/>
          <span id="help-microsoft365-client-id" className="mt-1 block text-[10px] leading-4 text-[#788392]">Copy the Application (client) ID from this app registration’s Overview.</span>
          {clientId.length > 0 && !clientIdValid && <span role="alert" data-testid="error-microsoft365-client-id" className="mt-1 block text-[10px] text-[#99501e]">Enter the full client ID, including its hyphens.</span>}
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-[#344154]">App registration client secret</span>
        <input data-testid="input-microsoft365-client-secret" className={cx(inputCls, 'h-9 mono')} type="password" autoComplete="new-password" spellCheck={false} required minLength={8} maxLength={4096} value={clientSecret} onChange={e => { setClientSecret(e.target.value); setConnectError(null); }} placeholder="Secret Value (not the Secret ID)"/>
        <span className="mt-1 block text-[10px] leading-4 text-[#788392]">This field is masked and cleared when verification starts. Mailflow stores the secret encrypted and does not return it in connection details.</span>
      </label>
      <label className="flex items-start gap-2 text-[11px] leading-5 text-[#5f6c7c]"><input data-testid="checkbox-microsoft365-admin-consent" type="checkbox" required checked={adminConsentConfirmed} onChange={e => { setAdminConsentConfirmed(e.target.checked); setConnectError(null); }} className="mt-1 accent-[#174f99]"/>A tenant administrator has granted the <span className="mono">ExchangeMessageTrace.Read.All</span> application permission and completed the trace service-principal setup.</label>
      {connectError && <div role="alert" data-testid="error-microsoft365-connect" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">
        <p className="font-semibold">{connectError.title}</p><p className="mt-1">{connectError.detail}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">{connectError.nextSteps.map((step, i) => <li key={i}>{step}</li>)}</ul>
        <p className="mt-2">Review <a data-testid="link-microsoft365-connect-error-guide" className="font-semibold text-[#245b9b] underline" href={MICROSOFT_TRACE_GUIDE} target="_blank" rel="noreferrer">Microsoft’s message-trace setup guide</a> and retry.</p>
      </div>}
      {error && <div role="alert" data-testid="error-microsoft365-control" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">{error}</div>}
      <div data-testid="notice-microsoft365-trace-limits" className="flex items-start gap-2 rounded-md bg-[#f5f8fb] p-3 text-[11px] leading-5 text-[#5f6c7c]"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#245b9b]"/><span><b className="text-[#344154]">What trace evidence means:</b> A <span className="mono">DELIVER</span> event is evidence Microsoft reports delivery to a mailbox, not inbox placement or that someone read the message. A <span className="mono">SEND</span> event means it was sent to another server. No trace event does not prove delivery or failure.</span></div>
      <button type="submit" data-testid="button-connect-microsoft365" className={primaryBtn} disabled={busy || !adminConsentConfirmed || !tenantIdValid || !clientIdValid || clientSecret.length < 8}>{connect.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}{connect.isPending ? 'Verifying access' : 'Verify and connect'}</button>
    </form>}
    {notice && <p role="status" data-testid="notice-microsoft365-connection" className="mt-3 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] p-3 text-[11px] text-[#31674b]">{notice}</p>}
    {error && connection?.connected && <div role="alert" data-testid="error-microsoft365-control" className="mt-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] text-[#99501e]">{error}</div>}
  </section>;
}

export function DeliveryEvidenceSection({ campaignId, active }: { campaignId: string; active: boolean }) {
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const params = { limit: PAGE, offset };
  const query = useGetCampaignDeliveryReport(campaignId, params, {
    query: { queryKey: getGetCampaignDeliveryReportQueryKey(campaignId, params), refetchInterval: active ? 10_000 : 60_000, staleTime: active ? 0 : 30_000 },
  });
  const data = query.data;
  const s = data?.summary;
  const total = data?.total ?? 0;
  const cells: Array<[string, number | undefined, string]> = [
    ['SMTP accepted', s?.smtpAccepted, 'Server took the message. Not inbox proof.'],
    ['Send failed', s?.sendFailed, 'Rejected by SMTP or failed to send.'],
    ['Reported delivered', s?.reportedDelivered, 'A report said delivered; not proof of inbox placement or reading.'],
    ['Reported bounce', s?.reportedBounced, 'A delivery-status report recorded a bounce.'],
    ['Reported delay', s?.reportedDelayed, 'A delivery-status report recorded a delay.'],
    ['Reported failure', s?.reportedFailed, 'A delivery-status report recorded a failure.'],
    ['Unconfirmed', s?.unconfirmed, 'No report. Not the same as delivered.'],
  ];
  return <section data-testid="section-delivery-evidence" className="mb-5 overflow-hidden rounded-lg border border-[#e0e4e9] bg-white">
    <div className="border-b border-[#e9edf0] px-5 py-4"><h2 className="display text-[17px] font-bold text-[#1b293a]">Delivery evidence</h2>
      <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#788392]">SMTP acceptance means your provider took the message, not that it reached an inbox. DSN requests are best effort and providers may ignore them. Authorized Gmail and Microsoft 365 trace connections can collect provider events; the absence of an event never means delivered, placed in an inbox, or read.</p></div>
    {query.isLoading ? <div aria-label="Loading delivery evidence" className="space-y-3 p-5"><div className="h-16 animate-pulse rounded-md bg-[#edf0f3]"/><div className="h-40 animate-pulse rounded-md bg-[#f1f3f5]"/></div>
      : query.isError || !data ? <div role="alert" className="m-5 flex items-center justify-between gap-4 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-4"><p className="text-[12px] text-[#99501e]">We couldn't load delivery evidence for this campaign.</p><button type="button" data-testid="button-retry-delivery-report" className={outlineBtn} onClick={() => void query.refetch()}>Retry</button></div>
      : <>
        <div className="grid gap-px bg-[#edf0f2] sm:grid-cols-2 lg:grid-cols-4">{cells.map(([l, v, d]) => <div key={l} className="bg-white px-5 py-4" data-testid={`summary-evidence-${l.toLowerCase().replace(/[^a-z]+/g, '-')}`}><div className="text-[11px] font-semibold text-[#5c6877]">{l}</div><div className="display mt-1 text-[22px] font-bold text-[#192638]">{(v ?? 0).toLocaleString()}</div><div className="mt-0.5 text-[10px] text-[#8a95a2]">{d}</div></div>)}</div>
        {data.recipients.length === 0 ? <div data-testid="empty-delivery-report" className="m-5 rounded-lg border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-10 text-center"><div className="text-[14px] font-semibold text-[#26364a]">No recipient evidence yet</div><p className="mt-1 text-[12px] text-[#738091]">Recipients appear here once the campaign has queued messages.</p></div>
          : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Recipient</th><th className="px-4 py-3 font-semibold">Transport</th><th className="px-4 py-3 font-semibold">Report evidence</th><th className="px-4 py-3 font-semibold">DSN</th><th className="px-5 py-3 text-right font-semibold">Details</th></tr></thead>
            <tbody className="divide-y divide-[#edf0f2]">{data.recipients.map(r => {
              const meta = reportOutcomeMeta(r.reportOutcome); const isOpen = openId === r.id;
              const accepted = !!r.smtpAcceptedAt;
              return <Fragment key={r.id}><tr data-testid={`row-evidence-${r.id}`} className="align-top">
                <td className="px-5 py-3 text-[12px] font-semibold text-[#26364a]">{r.email}<div className="mt-0.5 text-[10px] font-normal text-[#8a95a2]">{r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'}</div></td>
                <td className="px-4 py-3"><EvidencePill label={accepted ? 'SMTP accepted' : r.status === 'bounced' ? 'Send failed' : r.status.charAt(0).toUpperCase() + r.status.slice(1)} tone={accepted ? 'green' : r.status === 'bounced' ? 'orange' : r.status === 'queued' || r.status === 'sending' ? 'blue' : 'gray'}/>{r.smtpAcceptedAt && <div className="mt-1 text-[10px] text-[#8a95a2]">{new Date(r.smtpAcceptedAt).toLocaleString()}</div>}</td>
                <td className="px-4 py-3">{meta ? <><EvidencePill label={meta.label} tone={meta.tone}/><div className="mt-1 text-[10px] text-[#8a95a2]">{evidenceSourceLabel(r.evidenceVerification)} · {r.reportAt ? new Date(r.reportAt).toLocaleString() : 'Report time unavailable'}</div></> : <EvidencePill label="Unconfirmed" tone="gray"/>}</td>
                <td className="px-4 py-3 text-[11px] text-[#66717e]">{r.dsnRequested ? 'Requested (best effort)' : 'Not requested'}</td>
                <td className="px-5 py-3 text-right"><button type="button" data-testid={`button-inspect-evidence-${r.id}`} aria-expanded={isOpen} className={outlineBtn} onClick={() => setOpenId(isOpen ? null : r.id)}>{isOpen ? 'Hide' : 'Inspect'}</button></td></tr>
                {isOpen && <tr key={`${r.id}-d`} data-testid={`detail-evidence-${r.id}`} className="bg-[#f9fafb]"><td colSpan={5} className="px-5 py-4"><dl className="grid gap-x-8 gap-y-2 text-[11px] text-[#5c6877] md:grid-cols-2">
                  {([['Message-ID', r.latestMessageId], ['SMTP response', [r.latestSmtpCode, r.latestSmtpResponse].filter(Boolean).join(' ') || null], ['Last send error', r.lastError], ['Report diagnostic', r.reportDiagnostic], ['Report status code', r.reportStatusCode], ['Report source', r.reportSource ? r.reportSource.replace(/_/g, ' ') : null], ['Delivery scope', r.reportDeliveryScope === 'mailbox' ? 'Mailbox, as reported by the provider (not a guaranteed inbox folder or read)' : r.reportDeliveryScope === 'receiving_server' ? 'Receiving server only' : r.reportDeliveryScope], ['Verification', r.evidenceVerification ? evidenceSourceLabel(r.evidenceVerification) : null]] as Array<[string, string | null | undefined]>).map(([k, v]) => <div key={k}><dt className="font-semibold text-[#344154]">{k}</dt><dd className="mono mt-0.5 break-all">{v || 'None recorded'}</dd></div>)}
                </dl></td></tr>}</Fragment>;
            })}</tbody></table></div>}
        <div className="flex items-center justify-between border-t border-[#e9edf0] px-5 py-3 text-[11px] text-[#788392]"><span data-testid="text-evidence-range">{total ? `${offset + 1}-${Math.min(offset + PAGE, total)} of ${total.toLocaleString()}` : '0 recipients'}</span>
          <div className="flex gap-2"><button type="button" data-testid="button-evidence-prev" className={outlineBtn} disabled={offset === 0 || query.isFetching} onClick={() => { setOpenId(null); setOffset(Math.max(0, offset - PAGE)); }}><ChevronLeft className="h-4 w-4"/>Previous</button><button type="button" data-testid="button-evidence-next" className={outlineBtn} disabled={offset + PAGE >= total || query.isFetching} onClick={() => { setOpenId(null); setOffset(offset + PAGE); }}>Next<ChevronRight className="h-4 w-4"/></button></div></div>
      </>}
      <ImportPanel campaignId={campaignId}/>
  </section>;
}

export function DeliveryCapabilityNotes() {
  return <section data-testid="section-delivery-capability" className="mt-5 rounded-lg border border-[#e0e4e9] bg-white p-5 sm:p-6">
    <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">DELIVERY EVIDENCE</div>
    <h2 className="display mt-2 text-[18px] font-bold text-[#1b293a]">What your provider can tell Mailflow</h2>
    <div className="mt-4 grid gap-4 md:grid-cols-2 text-[12px] leading-5 text-[#5f6c7c]">
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">SMTP and DSN</h3><p className="mt-1">Mailflow records the SMTP response for every send and requests a delivery status notification (DSN) when the server supports it. This is best effort: a provider may ignore the request. Acceptance by SMTP is not inbox delivery, and no bounce never means delivered.</p></div>
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Gmail and Google Workspace</h3><p className="mt-1">A tenant owner can authorize Gmail bounce monitoring from Email Setup. Mailflow polls new-message history, reads only metadata for ordinary messages, and fetches content only when Gmail identifies a delivery-status notice. Connection health and any history gap are shown there. No bounce is not evidence of delivery, inbox placement, or reading.</p></div>
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Microsoft 365</h3><p className="mt-1">A tenant administrator can authorize Exchange message-trace collection with the required Graph application permission and service principal. Microsoft’s SEND event means transmission to another server; DELIVER is mailbox-level evidence, not proof of inbox placement or reading. Trace windows cover up to 90 days and outcomes use event times, not the initial received time.</p></div>
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Imported reports</h3><p className="mt-1">Reports are matched by this workspace, a tracked message ID and the recipient. They are user-supplied evidence and are not authenticated by the provider.</p></div>
      <div><h3 className="text-[13px] font-semibold text-[#26364a]">Older sends</h3><p className="mt-1">Messages sent before tracking IDs were stored cannot be matched and will be reported as unmatched.</p></div>
    </div>
  </section>;
}
