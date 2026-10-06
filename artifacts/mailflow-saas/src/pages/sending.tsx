import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, CirclePlus, Clock3,
  Download, Edit3, Fingerprint, LoaderCircle, Upload, Mail, MoreHorizontal, Search, Send,
  ShieldCheck, Trash2, Users, X, BookmarkPlus,
} from 'lucide-react';
import { ContactImportDialog } from '@/components/contact-import-dialog';
import { DownloadListDialog, type DownloadListColumn, type DownloadScope } from '@/components/download-list-dialog';
import {
  ContactDirectoryFiltersPanel,
  emptyContactDirectoryFilters,
  type ContactDirectoryFilterValues,
} from '@/components/contact-directory-filters';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CONTACT_PLACEHOLDERS, plainTextToHtml } from '@/components/campaign-placeholders';
import { ContactReportEvidence, DeliveryCapabilityNotes, DeliveryEvidenceSection } from '@/components/delivery-evidence';
import { RichTextEditor } from '@/components/rich-text-editor';
import {
  exportContacts, getGetCampaignDashboardQueryKey, getGetCampaignRecipientSummaryQueryKey, getGetContactFilterOptionsQueryKey, getGetTenantSendingSettingsQueryKey, getGetUserDashboardQueryKey, getListCampaignsQueryKey, getListContactListsQueryKey, getListTenantSendingAccountsQueryKey,
  getGetGmailMailboxConnectionQueryKey, useDisconnectGmailMailbox,
  useGetGmailMailboxConnection, useStartGmailMailboxConnection,
  getListContactOptionsQueryKey, getListContactsQueryKey, getListContactSegmentsQueryKey, useCreateCampaign, useCreateContact, useCreateContactList, useCreateContactSegment,
  useDeleteCampaign, useDeleteContact, useDeleteContactList, useDeleteContactSegment, useGetCampaignDashboard, useGetCampaignRecipientSummary,
  useGetContactEmailHistory, useGetContactFilterOptions, useListCampaigns, useListContactLists, useListContactOptions, useListContacts, useListTenantSendingAccounts, usePreviewCampaign, useSendCampaign,
  useCreateTenantSendingAccount, useDeleteTenantSendingAccount, useSetPrimaryTenantSendingAccount, useUpdateTenantSendingAccount,
  useListContactSegments, useTestTenantSendingConnection, useTestTenantSendingSettings, useUpdateCampaign, useUpdateContact, useUpdateContactSegment,
  useUpdateContactList,
} from '@workspace/api-client-react';
import type {
  CampaignDashboard, CampaignSummary, CampaignTemplatePreview, Contact, ContactDirectoryItem, ContactEmailHistoryItem, ContactList, ContactOption,
  ContactAudienceSegment, ContactExportInput, TenantSendingAccount, TenantSendingSettingsInput,
} from '@workspace/api-client-react';
import {
  trackSmtpSenderAccountCreated,
  trackSmtpSenderAccountDefaultSelected,
  trackSmtpSenderAccountDeleted,
} from '@/lib/analytics';
import { downloadWorkbook } from '@/lib/download-workbook';

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');
const inputClass = 'h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]';
const labelClass = 'mb-1.5 block text-[12px] font-semibold text-[#344154]';
const panelClass = 'rounded-lg border border-[#e0e4e9] bg-white';
const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[13px] font-semibold text-white transition hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55';
const outlineButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#d7dce3] bg-white px-3.5 text-[13px] font-semibold text-[#283545] transition hover:bg-[#f7f9fb] disabled:cursor-not-allowed disabled:opacity-55';

function Heading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div><div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">{eyebrow}</div><h1 className="display text-[30px] font-bold leading-tight text-[#172334]">{title}</h1><p className="mt-2 max-w-2xl text-[13px] text-[#687484]">{detail}</p></div>
    {action}
  </div>;
}
function Button({ children, onClick, variant = 'primary', disabled, type = 'button', testId, className = '' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'quiet' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; testId: string; className?: string }) {
  const styles = variant === 'primary' ? primaryButton : variant === 'danger'
    ? 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#edc5a7] bg-white px-3.5 text-[13px] font-semibold text-[#b85b20] hover:bg-[#fff7f0] disabled:opacity-55'
    : variant === 'quiet' ? 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-[12px] font-semibold text-[#596474] hover:bg-[#f4f6f8]'
    : outlineButton;
  return <button type={type} data-testid={testId} onClick={onClick} disabled={disabled} className={cx(styles, className)}>{children}</button>;
}
function Field({ label, value, onChange, type = 'text', placeholder, required, hint, testId, maxLength }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; hint?: string; testId: string; maxLength?: number }) {
  return <label className="block"><span className={labelClass}>{label}</span><input data-testid={testId} className={inputClass} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} maxLength={maxLength} />{hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-[#808a97]">{hint}</span>}</label>;
}
function Notice({ kind = 'success', children, onDismiss }: { kind?: 'success' | 'error'; children: ReactNode; onDismiss: () => void }) {
  const error = kind === 'error';
  return <div role={error ? 'alert' : 'status'} className={cx('mb-5 flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-[12px]', error ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]')}>
    <span className="flex items-center gap-2">{error ? <AlertCircle className="h-4 w-4 shrink-0"/> : <CheckCircle2 className="h-4 w-4 shrink-0"/>}{children}</span>
    <button type="button" data-testid="button-dismiss-notice" onClick={onDismiss} aria-label="Dismiss message"><X className="h-4 w-4"/></button>
  </div>;
}
function QueryState({ loading, error, retry, children, label }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode; label: string }) {
  if (loading) return <div aria-label={`Loading ${label}`} className="space-y-4"><div className="h-24 animate-pulse rounded-lg bg-[#edf0f3]"/><div className="h-56 animate-pulse rounded-lg bg-[#f1f3f5]"/></div>;
  if (error) return <div className={`${panelClass} flex items-center justify-between gap-4 p-5`}><div className="flex items-center gap-3"><AlertCircle className="h-5 w-5 text-[#cd732f]"/><div><p className="text-sm font-semibold">We couldn't load {label}</p><p className="mt-1 text-xs text-[#778291]">Your workspace data is unchanged. Try again.</p></div></div><Button variant="outline" testId="button-retry" onClick={retry}>Retry</Button></div>;
  return <>{children}</>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="grid min-h-[245px] place-items-center rounded-lg border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-10 text-center"><div className="max-w-sm"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#edf4fc] text-[#245b9b]"><Mail className="h-5 w-5"/></div><h3 className="display mt-4 text-[18px] font-bold text-[#1c2b3d]">{title}</h3><p className="mt-2 text-[12px] leading-5 text-[#738091]">{detail}</p>{action && <div className="mt-4">{action}</div>}</div></div>;
}
function Modal({ title, subtitle, close, children, wide = false }: { title: string; subtitle: string; close: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#172334]/35 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className={cx('my-auto w-full rounded-xl border border-[#dfe4ea] bg-white p-5 shadow-xl sm:p-7', wide ? 'max-w-[700px]' : 'max-w-[500px]')}>
      <div className="mb-6 flex items-start justify-between gap-4"><div><div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#788596]">WORKSPACE EDITOR</div><h2 className="display text-[23px] font-bold text-[#172334]">{title}</h2><p className="mt-1.5 text-[12px] text-[#748090]">{subtitle}</p></div><button type="button" data-testid="button-close-dialog" onClick={close} className="rounded-md p-2 text-[#778291] hover:bg-[#f3f5f7]" aria-label="Close"><X className="h-4 w-4"/></button></div>
      {children}
    </section>
  </div>;
}
function Status({ children, tone = 'gray' }: { children: ReactNode; tone?: 'blue' | 'green' | 'orange' | 'gray' }) {
  const color = { blue: 'bg-[#edf4fc] text-[#245b9b]', green: 'bg-[#edf7f0] text-[#397050]', orange: 'bg-[#fff3e8] text-[#a95218]', gray: 'bg-[#f0f2f4] text-[#66717e]' }[tone];
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize', color)}><span className={cx('h-1.5 w-1.5 rounded-full', tone === 'green' ? 'bg-[#4c9668]' : tone === 'orange' ? 'bg-[#e78b3b]' : tone === 'blue' ? 'bg-[#4382c4]' : 'bg-[#929ba6]')}/>{children}</span>;
}
function formatDate(date: string | null | undefined) {
  return date ? new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}
function roundUpToMinute(date: Date) {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}
function dateTimeLocalValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function minimumCampaignStartAt(campaigns: CampaignSummary[], serverMinimum?: Date | null) {
  const now = Date.now();
  const activeCampaigns = campaigns.filter(campaign => campaign.status === 'queued' || campaign.status === 'sending');
  const estimatedFinish = activeCampaigns.reduce(
    (latest, campaign) => Math.max(latest, now + Math.max(0, campaign.estimatedDurationSeconds) * 1000),
    now,
  );
  return roundUpToMinute(new Date(Math.max(now + 60_000, estimatedFinish, serverMinimum?.getTime() ?? 0)));
}
function useNotice() {
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  return { notice, setNotice, dismiss: () => setNotice(null) };
}
function mutationError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

const blankSettings = {
  provider: 'other' as TenantSendingSettingsInput['provider'],
  host: '', port: '587', encryption: 'tls' as TenantSendingSettingsInput['encryption'],
  username: '', password: '', fromName: '', fromEmail: '', replyTo: '',
};

export function SendingSettingsPage() {
  const query = useListTenantSendingAccounts();
  const createAccount = useCreateTenantSendingAccount();
  const updateAccount = useUpdateTenantSendingAccount();
  const deleteAccount = useDeleteTenantSendingAccount();
  const setPrimaryAccount = useSetPrimaryTenantSendingAccount();
  const test = useTestTenantSendingSettings();
  const connectionTest = useTestTenantSendingConnection();
  const gmailConnection = useGetGmailMailboxConnection({
    query: {
      queryKey: getGetGmailMailboxConnectionQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const startGmailConnection = useStartGmailMailboxConnection();
  const disconnectGmailConnection = useDisconnectGmailMailbox();
  const qc = useQueryClient();
  const { notice, setNotice, dismiss } = useNotice();
  const [form, setForm] = useState(blankSettings);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [connectionResult, setConnectionResult] = useState<{
    kind: 'success' | 'failure';
    message: string;
    checkedAt: string;
    savedSettingsUpdated: boolean;
  } | null>(null);
  const accounts = query.data?.accounts ?? [];
  const settings = accounts.find(account => account.id === selectedAccountId);
  const formForAccount = (account?: TenantSendingAccount) => account ? ({
    provider: account.provider,
    host: account.host || '',
    port: String(account.port || 587),
    encryption: account.encryption || 'tls',
    username: '',
    password: '',
    fromName: account.fromName || '',
    fromEmail: account.fromEmail || '',
    replyTo: account.replyTo || '',
  }) : blankSettings;
  useEffect(() => {
    if (!query.data || initialized) return;
    const initial = accounts.find(account => account.isPrimary) ?? accounts[0];
    setSelectedAccountId(initial?.id ?? '');
    setForm(formForAccount(initial));
    setInitialized(true);
  }, [query.data, accounts, initialized]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('gmail');
    if (result === 'connected') {
      setNotice({ kind: 'success', text: 'Gmail bounce monitoring is connected. Initial sync will begin shortly.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (result === 'failed') {
      setNotice({ kind: 'error', text: 'Gmail connection did not complete. Check Google consent and try again.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [setNotice]);
  const connectGmail = () => startGmailConnection.mutate(undefined, {
    onSuccess: result => { window.location.assign(result.authorizationUrl); },
    onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
  });
  const disconnectGmail = () => disconnectGmailConnection.mutate(undefined, {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getGetGmailMailboxConnectionQueryKey() });
      setNotice({ kind: 'success', text: 'Gmail mailbox disconnected and saved access removed.' });
    },
    onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
  });
  const change = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const refreshSenderAccounts = () => {
    void qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetTenantSendingSettingsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
  };
  const selectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setForm(formForAccount(accounts.find(account => account.id === accountId)));
    setConnectionResult(null);
  };
  const addAccount = () => {
    setSelectedAccountId('');
    setForm(blankSettings);
    setConnectionResult(null);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const data: TenantSendingSettingsInput = currentSendingSettings();
    const onSuccess = (account?: TenantSendingAccount) => {
      refreshSenderAccounts();
      if (account) {
        setSelectedAccountId(account.id);
        setInitialized(true);
      }
      setForm(value => ({ ...value, password: '' }));
      setNotice({ kind: 'success', text: 'Sender identity saved. SMTP credentials remain encrypted in this workspace.' });
    };
    const onError = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    if (selectedAccountId) {
      updateAccount.mutate({ accountId: selectedAccountId, data }, {
        onSuccess: response => onSuccess(response.account),
        onError,
      });
    } else {
      createAccount.mutate({ data }, {
        onSuccess: response => {
          if (query.data) {
            trackSmtpSenderAccountCreated(query.data.configuredCount + 1, query.data.emailAccountLimit);
          }
          onSuccess(response.account);
        },
        onError,
      });
    }
  };
  const currentSendingSettings = (): TenantSendingSettingsInput => ({
      provider: form.provider, host: form.host.trim(), port: Number(form.port), encryption: form.encryption,
      ...(form.username.trim() ? { username: form.username.trim() } : {}), ...(form.password ? { password: form.password } : {}),
      fromName: form.fromName.trim(), fromEmail: form.fromEmail.trim(), ...(form.replyTo.trim() ? { replyTo: form.replyTo.trim() } : {}),
  });
  const canTestSmtp = Boolean(
    form.host.trim() &&
    Number(form.port) > 0 &&
    form.fromName.trim() &&
    form.fromEmail.trim() &&
    (settings?.credentialsConfigured || (form.username.trim() && form.password)),
  );
  const runConnectionTest = () => {
    setConnectionResult(null);
    connectionTest.mutate({ data: { ...(selectedAccountId ? { accountId: selectedAccountId } : {}), settings: currentSendingSettings() } }, {
      onSuccess: response => {
        setConnectionResult({
          kind: 'success',
          message: response.message,
          checkedAt: response.checkedAt,
          savedSettingsUpdated: response.savedSettingsUpdated,
        });
        refreshSenderAccounts();
        setNotice({ kind: 'success', text: response.message });
      },
      onError: error => {
        const message = mutationError(error);
        const errorData =
          error &&
          typeof error === 'object' &&
          'data' in error &&
          error.data &&
          typeof error.data === 'object'
            ? error.data
            : null;
        setConnectionResult({
          kind: 'failure',
          message,
          checkedAt:
            errorData &&
            'checkedAt' in errorData &&
            typeof errorData.checkedAt === 'string'
              ? errorData.checkedAt
              : new Date().toISOString(),
          savedSettingsUpdated:
            Boolean(
              errorData &&
              'savedSettingsUpdated' in errorData &&
              errorData.savedSettingsUpdated === true,
            ),
        });
        refreshSenderAccounts();
        setNotice({ kind: 'error', text: message });
      },
    });
  };
  const runTest = (e: FormEvent) => {
    e.preventDefault();
    test.mutate({ data: { ...(selectedAccountId ? { accountId: selectedAccountId } : {}), settings: currentSendingSettings(), toEmail: testEmail.trim() } }, {
      onSuccess: response => {
        if (response.verifiedAt) {
          refreshSenderAccounts();
        }
        setNotice({ kind: 'success', text: response.message || 'SMTP accepted the test message; check the recipient mailbox to confirm it arrived.' });
      },
      onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
    });
  };
  const makePrimary = (account: TenantSendingAccount) => setPrimaryAccount.mutate(
    { accountId: account.id },
    {
      onSuccess: () => {
        refreshSenderAccounts();
        if (query.data) {
          trackSmtpSenderAccountDefaultSelected(query.data.configuredCount, query.data.emailAccountLimit);
        }
        setNotice({ kind: 'success', text: `${account.fromEmail} is now the default campaign sender.` });
      },
      onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
    },
  );
  const removeAccount = (account: TenantSendingAccount) => {
    const confirmed = window.confirm(
      `Remove ${account.fromEmail} from this workspace? Its saved SMTP credentials will be deleted. Draft campaigns will no longer be assigned to this sender.`,
    );
    if (!confirmed) return;
    deleteAccount.mutate(
      { accountId: account.id },
      {
        onSuccess: async () => {
          if (query.data) {
            trackSmtpSenderAccountDeleted(
              Math.max(0, query.data.configuredCount - 1),
              query.data.emailAccountLimit,
            );
          }
          await qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetTenantSendingSettingsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
          if (selectedAccountId === account.id) {
            setSelectedAccountId('');
            setInitialized(false);
            setForm(blankSettings);
          }
          setNotice({ kind: 'success', text: 'SMTP sender account and its saved credentials were removed.' });
        },
        onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
      },
    );
  };
  return <QueryState loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} label="sender settings"><>
    <Heading eyebrow="SENDING / IDENTITY" title="Email Setup" detail="Configure the email account this workspace uses to send campaigns and monitor delivery."/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    <section data-testid="section-sender-accounts" className={`${panelClass} mb-5 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">SENDER ACCOUNTS</div>
          <h2 className="display mt-2 text-[18px] font-bold text-[#1b293a]">SMTP accounts for campaigns</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#687484]">Each connected SMTP account uses one slot in your subscription. Gmail bounce monitoring is managed separately below.</p>
        </div>
        <span data-testid="text-sender-account-usage" className="rounded-md border border-[#dce4eb] bg-[#f7f9fb] px-3 py-2 text-[11px] font-semibold text-[#405469]">
          {query.data?.configuredCount ?? accounts.length} of {query.data?.emailAccountLimit ?? 1} account slots used
        </span>
      </div>
      {query.data?.overLimit && <p role="alert" className="mt-4 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2.5 text-[11px] leading-5 text-[#895b2f]">This workspace has more SMTP accounts than its current package allows. Remove accounts until you are within the limit. Campaign sending is paused until then.</p>}
      {query.data?.scheduledDowngrade && <p data-testid="text-scheduled-sender-retention" className="mt-4 rounded-md border border-[#d6e3ef] bg-[#f3f7fb] px-3 py-2.5 text-[11px] leading-5 text-[#385c7e]">
        {query.data.scheduledDowngrade.packageName} starts {formatDate(query.data.scheduledDowngrade.startsAt)}. {query.data.scheduledDowngrade.accountIdsToKeep.length} selected SMTP account{query.data.scheduledDowngrade.accountIdsToKeep.length === 1 ? '' : 's'} will stay; other saved accounts will be removed then.
      </p>}
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {accounts.map(account => <article key={account.id} data-testid={`card-sender-account-${account.id}`} className={`rounded-md border p-3 ${selectedAccountId === account.id ? 'border-[#8eafd0] bg-[#f5f9fd]' : 'border-[#e3e8ed] bg-white'}`}>
          <button type="button" data-testid={`button-select-sender-account-${account.id}`} onClick={() => selectAccount(account.id)} className="block w-full text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12px] font-semibold text-[#28394d]">{account.fromEmail}</span>
              {account.isPrimary && <Status tone="blue">default</Status>}
              {account.verified && <Status tone="green">verified</Status>}
            </div>
            <p className="mt-1 truncate text-[11px] text-[#778392]">{account.fromName} · {account.host}:{account.port}</p>
            {account.activeCampaignCount > 0 && <p className="mt-1 text-[10px] text-[#895b2f]">{account.activeCampaignCount} queued or sending campaign{account.activeCampaignCount === 1 ? '' : 's'}</p>}
          </button>
          <div className="mt-2 flex flex-wrap gap-2 border-t border-[#edf0f2] pt-2">
            {!account.isPrimary && <button type="button" data-testid={`button-primary-sender-account-${account.id}`} onClick={() => makePrimary(account)} disabled={setPrimaryAccount.isPending} className="text-[10px] font-semibold text-[#245b9b] hover:underline disabled:opacity-50">Make default</button>}
            <button type="button" data-testid={`button-delete-sender-account-${account.id}`} onClick={() => removeAccount(account)} disabled={account.activeCampaignCount > 0 || deleteAccount.isPending} className="text-[10px] font-semibold text-[#a44f42] hover:underline disabled:cursor-not-allowed disabled:opacity-45">Remove</button>
          </div>
        </article>)}
        <button type="button" data-testid="button-add-sender-account" onClick={addAccount} disabled={accounts.length >= (query.data?.emailAccountLimit ?? 1)} className="flex min-h-20 items-center justify-center gap-2 rounded-md border border-dashed border-[#ccd7e1] bg-[#fbfcfd] px-3 text-[11px] font-semibold text-[#38638a] hover:bg-[#f4f8fb] disabled:cursor-not-allowed disabled:opacity-50">
          <CirclePlus className="h-4 w-4"/>Add SMTP account
        </button>
      </div>
    </section>
    <section data-testid="section-gmail-bounce-monitor" className={`${panelClass} mb-5 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">BOUNCE MONITORING</div>
          <h2 className="display mt-2 text-[18px] font-bold text-[#1b293a]">Gmail and Google Workspace</h2>
          <p className="mt-2 text-[12px] leading-5 text-[#687484]">Connect a mailbox with its owner’s Google consent. Mailflow checks new-message headers and fetches message content only when Gmail identifies a delivery-status notice. It does not scan unrelated mailbox content.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {gmailConnection.data?.connected && <Button variant="outline" testId="button-disconnect-gmail" disabled={disconnectGmailConnection.isPending} onClick={disconnectGmail}>{disconnectGmailConnection.isPending ? 'Disconnecting…' : 'Disconnect mailbox'}</Button>}
          <Button testId="button-connect-gmail" disabled={!gmailConnection.data?.configured || startGmailConnection.isPending} onClick={connectGmail}>{startGmailConnection.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : null}{gmailConnection.data?.connected ? 'Reconnect Google account' : 'Connect Google account'}</Button>
        </div>
      </div>
      {gmailConnection.isLoading ? <p className="mt-4 text-[12px] text-[#778291]">Checking Gmail connection status…</p>
        : gmailConnection.isError || !gmailConnection.data ? <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[12px] text-[#99501e]"><span>Gmail connection status could not be loaded.</span><button type="button" className={outlineButton} onClick={() => void gmailConnection.refetch()}>Retry</button></div>
        : !gmailConnection.data.configured
          ? <div className="mt-4 rounded-md border border-[#e4e8ed] bg-[#f7f9fb] p-4">
            <p data-testid="text-gmail-oauth-setup" className="text-[12px] leading-5 text-[#596777]">Gmail bounce monitoring is not available yet. Your platform administrator will enable mailbox connections when setup is complete.</p>
          </div>
          : <div className="mt-4 rounded-md bg-[#f7f9fb] p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#596777]">
            <span>Status: <strong className="text-[#26364a]">{gmailConnection.data.syncStatus.replace(/_/g, ' ')}</strong></span>
            {gmailConnection.data.emailAddress && <span>Mailbox: <strong className="text-[#26364a]">{gmailConnection.data.emailAddress}</strong></span>}
            <span>Polling: every {Math.round(gmailConnection.data.pollIntervalSeconds / 60)} min</span>
            <span>Last checked: <strong className="text-[#26364a]">{formatDate(gmailConnection.data.lastSyncAt)}</strong></span>
          </div>
          {gmailConnection.data.lastSuccessAt && <p className="mt-2 text-[11px] text-[#718091]">Last successful sync: {formatDate(gmailConnection.data.lastSuccessAt)} · Next check: {formatDate(gmailConnection.data.nextSyncAt)}</p>}
          {gmailConnection.data.lastError && <p data-testid="text-gmail-sync-error" role="status" className="mt-3 rounded border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">{gmailConnection.data.lastError}</p>}
          {gmailConnection.data.syncStatus === 'history_expired' && <p className="mt-2 text-[11px] leading-5 text-[#99501e]">Reconnect to restart monitoring from a new checkpoint. Gmail cannot recover notices from the expired-history gap automatically.</p>}
        </div>}
      <p className="mt-3 text-[11px] leading-5 text-[#788392]">Only matched DSNs become bounce evidence. No bounce is not proof of delivery, inbox placement, or reading. Disconnecting removes Mailflow’s refresh token and asks Google to revoke it.</p>
    </section>
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className={`${panelClass} flex items-center gap-3 p-4`}><div className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fc] text-[#245b9b]"><Fingerprint className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">Identity status</div><div className="mt-1"><Status tone={settings?.verified ? 'green' : 'orange'}>{settings?.verified ? 'Verified' : 'Verification needed'}</Status></div></div></div>
      <div className={`${panelClass} flex items-center gap-3 p-4`}><div className="grid h-9 w-9 place-items-center rounded-md bg-[#f0f3f6] text-[#657488]"><ShieldCheck className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">SMTP credentials</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{settings?.credentialsConfigured ? 'Configured · protected' : 'Not configured'}</div></div></div>
      <div className={`${panelClass} flex items-center gap-3 p-4`}><div className="grid h-9 w-9 place-items-center rounded-md bg-[#fff3e8] text-[#ae642c]"><Clock3 className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">Last updated</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{formatDate(settings?.updatedAt)}</div></div></div>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(290px,.75fr)]">
      <form onSubmit={save} className={`${panelClass} p-5 sm:p-6`}>
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-[#edf0f2] pb-4"><div><h2 className="display text-[18px] font-bold text-[#1b293a]">SMTP connection</h2><p className="mt-1 text-[12px] text-[#788392]">These settings are scoped to your tenant, never shared across workspaces.</p></div><span className="mono rounded bg-[#f4f6f8] px-2 py-1 text-[9px] tracking-wide text-[#788392]">TENANT ONLY</span></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={labelClass}>Provider</span><select data-testid="select-sender-provider" className={inputClass} value={form.provider} onChange={e => change('provider', e.target.value)}><option value="google_workspace">Google Workspace</option><option value="gmail">Gmail</option><option value="microsoft_365">Microsoft 365</option><option value="other">Other SMTP</option></select></label>
          <Field label="SMTP host" value={form.host} onChange={v => change('host', v)} placeholder="smtp.example.com" required testId="input-smtp-host"/>
          <Field label="Port" value={form.port} onChange={v => change('port', v)} type="number" required testId="input-smtp-port"/>
          <label><span className={labelClass}>Encryption</span><select data-testid="select-smtp-encryption" className={inputClass} value={form.encryption} onChange={e => change('encryption', e.target.value)}><option value="tls">STARTTLS / TLS</option><option value="ssl">SSL</option><option value="none">None</option></select></label>
          <Field label="SMTP username" value={form.username} onChange={v => change('username', v)} placeholder={settings?.credentialsConfigured ? 'Leave blank to keep the saved username' : 'sender@example.com'} testId="input-smtp-username" hint={settings?.credentialsConfigured ? `Saved username: ${settings.username} · leave blank to keep it` : 'Required with the SMTP password'}/>
          <Field label="SMTP password" value={form.password} onChange={v => change('password', v)} type="password" placeholder={settings?.credentialsConfigured ? 'Leave blank to keep current password' : 'Enter SMTP password'} testId="input-smtp-password"/>
        </div>
        <div className="my-6 border-t border-[#edf0f2]"/>
        <div className="mb-4"><h3 className="display text-[16px] font-bold text-[#1b293a]">Sender identity</h3><p className="mt-1 text-[12px] text-[#788392]">The visible name and addresses recipients will see.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From name" value={form.fromName} onChange={v => change('fromName', v)} placeholder="Customer care" required testId="input-from-name"/>
          <Field label="From email" value={form.fromEmail} onChange={v => change('fromEmail', v)} type="email" placeholder="hello@example.com" required testId="input-from-email"/>
          <div className="sm:col-span-2"><Field label="Reply-to address" value={form.replyTo} onChange={v => change('replyTo', v)} type="email" placeholder="Optional — defaults to from address" testId="input-reply-to"/></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-5"><span className="flex items-center gap-2 text-[11px] text-[#7b8694]"><ShieldCheck className="h-4 w-4 text-[#598166]"/>Credentials are never displayed after saving.</span><Button type="submit" testId="button-save-sending-settings" disabled={updateAccount.isPending || createAccount.isPending}>{(updateAccount.isPending || createAccount.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{(updateAccount.isPending || createAccount.isPending) ? 'Saving settings' : selectedAccountId ? 'Save sender settings' : 'Add sender account'}</Button></div>
      </form>
       <div className={`${panelClass} overflow-hidden`}>
         <div className="bg-[#f5f8fb] p-5"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">CONNECTION CHECK</div><h2 className="display mt-2 text-[19px] font-bold text-[#1c2b3d]">Test SMTP settings</h2><p className="mt-2 text-[12px] leading-5 text-[#718091]">Use the values currently in the form. You can check login without sending, or send a real test email to confirm the server accepts a message.</p></div>
        <form onSubmit={runTest} className="space-y-4 p-5">
          <Field label="Deliver test to" value={testEmail} onChange={setTestEmail} type="email" placeholder="you@company.com" required testId="input-test-recipient"/>
           <div className="grid gap-2 sm:grid-cols-2">
             <Button type="button" variant="outline" testId="button-check-smtp-connection" onClick={runConnectionTest} disabled={!canTestSmtp || connectionTest.isPending || test.isPending} className="w-full">{connectionTest.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <ShieldCheck className="h-4 w-4"/>}{connectionTest.isPending ? 'Checking connection' : 'Check connection'}</Button>
             <Button type="submit" testId="button-test-sending-settings" disabled={!canTestSmtp || !testEmail.trim() || test.isPending || connectionTest.isPending} className="w-full">{test.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}{test.isPending ? 'Sending test' : 'Send test email'}</Button>
           </div>
           {!canTestSmtp && <p className="text-[11px] leading-5 text-[#8a6a4e]">Enter SMTP details and credentials here, or configure credentials in saved settings, before testing.</p>}
           {connectionResult && <div data-testid="smtp-connection-result" role={connectionResult.kind === 'failure' ? 'alert' : 'status'} className={cx('rounded-md border p-3 text-[11px] leading-5', connectionResult.kind === 'success' ? 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]' : 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]')}>
             <div className="flex items-start gap-2">{connectionResult.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>}<div><strong>{connectionResult.kind === 'success' ? 'SMTP connection successful' : 'SMTP connection failed'}</strong><p>{connectionResult.message}</p><p className="mt-1">Checked {formatDate(connectionResult.checkedAt)}{connectionResult.savedSettingsUpdated ? ' · Saved check details updated' : ' · Saved check details unchanged'}</p></div></div>
           </div>}
           {settings?.connectionCheckAt && settings.connectionCheckStatus && <div data-testid="text-last-smtp-connection-check" className="flex flex-wrap items-center gap-2 border-t border-[#edf0f2] pt-3 text-[11px] text-[#647365]"><span>Last saved-settings connection check:</span><Status tone={settings.connectionCheckStatus === 'success' ? 'green' : 'orange'}>{settings.connectionCheckStatus === 'success' ? 'Successful' : 'Failed'}</Status><span>{formatDate(settings.connectionCheckAt)}</span></div>}
           <p className="text-[11px] leading-5 text-[#788392]">A connection check sends no email and does not mark the sender verified for campaigns. Matching saved settings keep a separate result and date; draft values are never saved. Sending a test email marks matching saved settings verified.</p>
          {settings?.verified && settings.verifiedAt && <div className="flex items-start gap-2 border-t border-[#edf0f2] pt-4 text-[11px] leading-5 text-[#647365]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#52815d]"/>Verified {formatDate(settings.verifiedAt)}</div>}
        </form>
      </div>
    </div>
    <DeliveryCapabilityNotes/>
  </></QueryState>;
}

type ContactForm = { email: string; firstName: string; lastName: string; companyName: string; linkedinUrl: string; phoneNumber: string; subscribed: boolean; listIds: string[] };
const emptyContact: ContactForm = { email: '', firstName: '', lastName: '', companyName: '', linkedinUrl: '', phoneNumber: '', subscribed: true, listIds: [] };

function emailStatusTone(status: ContactEmailHistoryItem['status']): 'blue' | 'green' | 'orange' | 'gray' {
  if (status === 'delivered') return 'green';
  if (status === 'bounced') return 'orange';
  if (status === 'queued' || status === 'sending') return 'blue';
  return 'gray';
}

function emailStatusLabel(status: ContactEmailHistoryItem['status']): string {
  if (status === 'delivered') return 'SMTP accepted';
  if (status === 'bounced') return 'Rejected / failed';
  if (status === 'unknown') return 'Outcome unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ContactEmailHistoryDialog({ contact, close }: { contact: Contact; close: () => void }) {
  const query = useGetContactEmailHistory(contact.id);
  return <Modal wide title="Email history" subtitle={`Campaign emails sent to ${contact.email}.`} close={close}>
    {query.isLoading ? <div aria-label="Loading email history" className="space-y-3"><div className="h-20 animate-pulse rounded-md bg-[#edf0f3]"/><div className="h-20 animate-pulse rounded-md bg-[#f1f3f5]"/></div>
      : query.isError ? <div role="alert" className="flex items-center justify-between gap-4 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-4"><p className="text-[12px] text-[#99501e]">We couldn’t load this contact’s email history.</p><Button variant="outline" testId="button-retry-contact-email-history" onClick={() => void query.refetch()}>Retry</Button></div>
      : query.data?.length ? <ol data-testid="list-contact-email-history" className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">{query.data.map((email: ContactEmailHistoryItem) => <li key={email.id} data-testid={`item-contact-email-history-${email.id}`} className="rounded-lg border border-[#e5e9ed] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="text-[13px] font-semibold text-[#26364a]">{email.campaignName}</div><div className="mt-1 break-words text-[12px] text-[#697687]">{email.subject}</div></div><Status tone={emailStatusTone(email.status)}>{emailStatusLabel(email.status)}</Status></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#edf0f2] pt-3 text-[11px] text-[#788392]"><span>Last attempt: {formatDate(email.lastAttemptAt)}</span><span>{email.attempts} {email.attempts === 1 ? 'attempt' : 'attempts'}</span>{email.deliveredAt && <span>SMTP accepted: {formatDate(email.deliveredAt)}</span>}</div><ContactReportEvidence detailed id={email.id} item={email}/>
      </li>)}</ol>
      : <div data-testid="empty-contact-email-history" className="rounded-lg border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-10 text-center"><Mail className="mx-auto h-5 w-5 text-[#557399]"/><div className="mt-3 text-[14px] font-semibold text-[#26364a]">No email history yet</div><p className="mt-1 text-[12px] text-[#738091]">No campaign emails have been attempted for this contact.</p></div>}
  </Modal>;
}

const contactDownloadColumns: DownloadListColumn<ContactExportInput['columns'][number]>[] = [
  { key: 'name', label: 'Name', group: 'standard' },
  { key: 'email', label: 'Email', group: 'standard' },
  { key: 'subscribed', label: 'Subscription status', group: 'standard' },
  { key: 'listNames', label: 'Lists', group: 'standard' },
  { key: 'companyName', label: 'Company', group: 'standard' },
  { key: 'location', label: 'Location', group: 'standard' },
  { key: 'createdAt', label: 'Date added', group: 'standard' },
  { key: 'id', label: 'Contact ID', group: 'additional' },
  { key: 'phoneNumber', label: 'Phone', group: 'additional' },
  { key: 'mobilePhone', label: 'Mobile phone', group: 'additional' },
  { key: 'jobTitle', label: 'Job title', group: 'additional' },
  { key: 'department', label: 'Department', group: 'additional' },
  { key: 'seniority', label: 'Seniority', group: 'additional' },
  { key: 'lifecycleStage', label: 'Lifecycle stage', group: 'additional' },
  { key: 'leadStatus', label: 'Lead status', group: 'additional' },
  { key: 'leadSource', label: 'Lead source', group: 'additional' },
  { key: 'preferredLanguage', label: 'Preferred language', group: 'additional' },
  { key: 'timeZone', label: 'Time zone', group: 'additional' },
  { key: 'linkedinUrl', label: 'LinkedIn', group: 'additional' },
  { key: 'websiteUrl', label: 'Website', group: 'additional' },
  { key: 'twitterUrl', label: 'X / Twitter', group: 'additional' },
  { key: 'facebookUrl', label: 'Facebook', group: 'additional' },
  { key: 'instagramUrl', label: 'Instagram', group: 'additional' },
  { key: 'interests', label: 'Interests', group: 'additional' },
  { key: 'goals', label: 'Goals', group: 'additional' },
  { key: 'painPoints', label: 'Pain points', group: 'additional' },
  { key: 'personalizationContext', label: 'Personalization context', group: 'additional' },
  { key: 'notes', label: 'Notes', group: 'additional' },
  { key: 'companyDomain', label: 'Company domain', group: 'additional' },
  { key: 'companyWebsiteUrl', label: 'Company website', group: 'additional' },
  { key: 'companyIndustry', label: 'Company industry', group: 'additional' },
  { key: 'companySize', label: 'Company size', group: 'additional' },
  { key: 'companyRevenueRange', label: 'Company revenue', group: 'additional' },
  { key: 'companyDescription', label: 'Company description', group: 'additional' },
  { key: 'companyPhoneNumber', label: 'Company phone', group: 'additional' },
  { key: 'companyLinkedinUrl', label: 'Company LinkedIn', group: 'additional' },
  { key: 'companyLocation', label: 'Company location', group: 'additional' },
  { key: 'updatedAt', label: 'Last updated', group: 'additional' },
];

export function ContactsPage() {
  const [filters, setFilters] = useState<ContactDirectoryFilterValues>(emptyContactDirectoryFilters);
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);
  const contactsParams = {
    page,
    pageSize: 50,
    includeHistory: true,
    search: debouncedSearch,
    status: filters.status,
    listId: filters.listId,
    companyId: filters.companyId,
    lifecycleStage: filters.lifecycleStage,
    leadStatus: filters.leadStatus,
    leadSource: filters.leadSource,
    addedWithin: filters.addedWithin,
  };
  const contactsQuery = useListContacts(contactsParams, {
    query: {
      queryKey: getListContactsQueryKey(contactsParams),
      refetchInterval: 30_000,
      placeholderData: previous => previous,
    },
  });
  const listsQuery = useListContactLists();
  const filterOptionsQuery = useGetContactFilterOptions({
    query: { queryKey: getGetContactFilterOptionsQueryKey(), staleTime: 60_000 },
  });
  const segmentsQuery = useListContactSegments({
    query: { queryKey: getListContactSegmentsQueryKey(), staleTime: 0, refetchOnMount: 'always' },
  });
  const create = useCreateContact(); const update = useUpdateContact(); const remove = useDeleteContact();
  const createSegment = useCreateContactSegment();
  const updateSegment = useUpdateContactSegment();
  const removeSegment = useDeleteContactSegment();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [selectedSegmentId, setSelectedSegmentId] = useState('');
  const [segmentEditor, setSegmentEditor] = useState<{ mode: 'save' | 'rename'; segment?: ContactAudienceSegment } | null>(null);
  const [segmentName, setSegmentName] = useState('');
  const [segmentToDelete, setSegmentToDelete] = useState<ContactAudienceSegment | null>(null);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined); const [form, setForm] = useState<ContactForm>(emptyContact); const [importing, setImporting] = useState(false);
  const [historyContact, setHistoryContact] = useState<ContactDirectoryItem | null>(null);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const contacts = contactsQuery.data?.contacts ?? [];
  const visible = contacts;
  const resultStart = contacts.length && contactsQuery.data
    ? (contactsQuery.data.page - 1) * contactsQuery.data.pageSize + 1
    : 0;
  const resultEnd = contactsQuery.data
    ? Math.min(contactsQuery.data.page * contactsQuery.data.pageSize, contactsQuery.data.total)
    : 0;
  const lists = (listsQuery.data || []) as ContactList[];
  const lifecycleStages = filterOptionsQuery.data?.lifecycleStages ?? [];
  const leadStatuses = filterOptionsQuery.data?.leadStatuses ?? [];
  const leadSources = filterOptionsQuery.data?.leadSources ?? [];
  const segments = segmentsQuery.data ?? [];
  const selectedSegment = segments.find(segment => segment.id === selectedSegmentId);
  const updateFilters = (next: ContactDirectoryFilterValues) => {
    setFilters(next);
    if (next.companyId === 'all') setSelectedCompanyName(null);
    setPage(1);
  };
  useEffect(() => {
    if (!contactsQuery.isFetching && contactsQuery.data && contactsQuery.data.page !== page) {
      setPage(contactsQuery.data.page);
    }
  }, [contactsQuery.data?.page, contactsQuery.isFetching, page]);
  const hasActiveFilters = filters.search.trim() !== '' || filters.status !== 'all'
    || filters.listId !== 'all' || filters.companyId !== 'all'
    || filters.lifecycleStage !== 'all' || filters.leadStatus !== 'all'
    || filters.leadSource !== 'all' || filters.addedWithin !== 'any';
  const contactFilterSummary = [
    filters.search.trim() ? `Search: ${filters.search.trim()}` : null,
    filters.status !== 'all' ? `Status: ${filters.status}` : null,
    filters.listId !== 'all' ? `List: ${lists.find(list => list.id === filters.listId)?.name ?? (filters.listId === '__none__' ? 'No list' : 'Selected list')}` : null,
    filters.companyId !== 'all' ? `Company: ${filters.companyId === '__none__' ? 'No company' : selectedCompanyName ?? 'Selected company'}` : null,
    filters.lifecycleStage !== 'all' ? `Lifecycle: ${filters.lifecycleStage === '__unset__' ? 'Not set' : filters.lifecycleStage}` : null,
    filters.leadStatus !== 'all' ? `Lead status: ${filters.leadStatus === '__unset__' ? 'Not set' : filters.leadStatus}` : null,
    filters.leadSource !== 'all' ? `Lead source: ${filters.leadSource === '__unset__' ? 'Not set' : filters.leadSource}` : null,
    filters.addedWithin !== 'any' ? `Added in the last ${filters.addedWithin} days` : null,
  ].filter((value): value is string => Boolean(value)).join(' · ');
  const downloadContacts = async (scope: DownloadScope, columns: ContactExportInput['columns']) => {
    const workbook = await exportContacts({
      scope,
      columns,
      ...(scope === 'filtered' ? {
        filters: {
          search: filters.search,
          status: filters.status,
          listId: filters.listId,
          companyId: filters.companyId,
          lifecycleStage: filters.lifecycleStage,
          leadStatus: filters.leadStatus,
          leadSource: filters.leadSource,
          addedWithin: filters.addedWithin,
        },
      } : {}),
    });
    downloadWorkbook(workbook, 'contacts');
  };
  const reload = () => { void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); };
  const openNew = () => { setEditing(null); setForm(emptyContact); };
  const openEdit = (contact: Contact) => { setEditing(contact); setForm({ email: contact.email, firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName ?? '', linkedinUrl: contact.linkedinUrl ?? '', phoneNumber: contact.phoneNumber ?? '', subscribed: contact.subscribed, listIds: [...contact.listIds] }); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    if (!firstName || !lastName || !email) { setNotice({ kind: 'error', text: 'First name, last name, and email are required.' }); return; }
    const done = () => { reload(); setEditing(undefined); setNotice({ kind: 'success', text: editing ? 'Contact changes saved.' : 'Contact added to your audience.' }); };
    const failed = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    const companyName = form.companyName.trim(); const linkedinUrl = form.linkedinUrl.trim(); const phoneNumber = form.phoneNumber.trim();
    if (editing) {
      update.mutate({ contactId: editing.id, data: { email, firstName, lastName, subscribed: form.subscribed, listIds: form.listIds, companyName: companyName || null, linkedinUrl: linkedinUrl || null, phoneNumber: phoneNumber || null } }, { onSuccess: done, onError: failed });
    } else {
      create.mutate({ data: { email, firstName, lastName, subscribed: form.subscribed, listIds: form.listIds, ...(companyName ? { companyName } : {}), ...(linkedinUrl ? { linkedinUrl } : {}), ...(phoneNumber ? { phoneNumber } : {}) } }, { onSuccess: done, onError: failed });
    }
  };
  const confirmDeleteContact = () => {
    if (!contactToDelete) return;
    const contact = contactToDelete;
    remove.mutate({ contactId: contact.id }, {
      onSuccess: () => { setContactToDelete(null); reload(); setNotice({ kind: 'success', text: 'Contact deleted.' }); },
      onError: error => { setContactToDelete(null); setNotice({ kind: 'error', text: mutationError(error) }); },
    });
  };
  const openSegmentEditor = (mode: 'save' | 'rename', segment?: ContactAudienceSegment) => {
    setSegmentName(segment?.name ?? '');
    setSegmentEditor({ mode, ...(segment ? { segment } : {}) });
  };
  const submitSegment = (event: FormEvent) => {
    event.preventDefault();
    const name = segmentName.trim();
    if (!name || !segmentEditor) return;
    const failed = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    const saved = (segment: ContactAudienceSegment, successText: string) => {
      void qc.invalidateQueries({ queryKey: getListContactSegmentsQueryKey() });
      setSelectedSegmentId(segment.id);
      setSegmentEditor(null);
      setNotice({ kind: 'success', text: successText });
    };
    if (segmentEditor.mode === 'save') {
      createSegment.mutate(
        { data: { name, filters } },
        {
          onSuccess: segment => saved(segment, `“${segment.name}” was saved.`),
          onError: failed,
        },
      );
    } else if (segmentEditor.segment) {
      updateSegment.mutate(
        { segmentId: segmentEditor.segment.id, data: { name } },
        {
          onSuccess: segment => saved(segment, `“${segment.name}” was renamed.`),
          onError: failed,
        },
      );
    }
  };
  const applySelectedSegment = () => {
    if (!selectedSegment) return;
    updateFilters(selectedSegment.filters);
    setNotice({ kind: 'success', text: `“${selectedSegment.name}” was applied.` });
  };
  const confirmDeleteSegment = () => {
    if (!segmentToDelete) return;
    const segment = segmentToDelete;
    removeSegment.mutate(
      { segmentId: segment.id },
      {
        onSuccess: () => {
          setSegmentToDelete(null);
          if (selectedSegmentId === segment.id) setSelectedSegmentId('');
          void qc.invalidateQueries({ queryKey: getListContactSegmentsQueryKey() });
          setNotice({ kind: 'success', text: `“${segment.name}” was deleted.` });
        },
        onError: error => {
          setSegmentToDelete(null);
          setNotice({ kind: 'error', text: mutationError(error) });
        },
      },
    );
  };
  const toggleSub = (contact: Contact) => update.mutate({ contactId: contact.id, data: { subscribed: !contact.subscribed } }, { onSuccess: () => { reload(); setNotice({ kind: 'success', text: contact.subscribed ? 'Contact unsubscribed.' : 'Contact subscribed.' }); }, onError: error => setNotice({ kind: 'error', text: mutationError(error) }) });
  const busy = create.isPending || update.isPending;
  return <QueryState loading={contactsQuery.isLoading || listsQuery.isLoading} error={contactsQuery.isError || listsQuery.isError} retry={() => { void contactsQuery.refetch(); void listsQuery.refetch(); }} label="contacts"><>
    <Heading eyebrow="AUDIENCE / CONTACTS" title="Contacts" detail="Keep your audience accurate, opted-in, and organized by the lists you send to." action={<div className="flex flex-wrap gap-2"><Button variant="outline" testId="button-download-contacts" disabled={contactsQuery.isFetching || debouncedSearch !== filters.search} onClick={() => setDownloadOpen(true)}><Download className="h-4 w-4"/>Download list</Button><Button variant="outline" testId="button-import-contacts" onClick={() => setImporting(true)}><Upload className="h-4 w-4"/>Import contacts</Button><Button testId="button-add-contact" onClick={openNew}><CirclePlus className="h-4 w-4"/>Add contact</Button></div>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    {downloadOpen && <DownloadListDialog
      title="Download contacts"
      description="Choose the rows and contact fields to include in your Excel workbook."
      entityLabel="contacts"
      currentCount={contactsQuery.data?.total ?? 0}
      allCount={contactsQuery.data?.workspaceTotal ?? 0}
      hasActiveFilters={hasActiveFilters}
      filterSummary={contactFilterSummary}
      defaultScope={hasActiveFilters ? 'filtered' : 'all'}
      columns={contactDownloadColumns}
      defaultColumns={['name', 'email', 'subscribed', 'listNames', 'companyName', 'location', 'createdAt']}
      onDownload={downloadContacts}
      onClose={() => setDownloadOpen(false)}
    />}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div data-testid="summary-contact-total" className={`${panelClass} p-4`} style={{ backgroundColor: '#eaf3ff', borderColor: '#c9dcf3' }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-medium text-[#536984]">All contacts</div><div className="display mt-2 text-[26px] font-bold text-[#1d3e65]">{(contactsQuery.data?.workspaceTotal ?? 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#647b97]">Across this workspace</div></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#d8e9ff] text-[#2862a1]"><Users className="h-4 w-4"/></span></div>
      </div>
      <div data-testid="summary-contact-subscribed" className={`${panelClass} p-4`} style={{ backgroundColor: '#eaf5ee', borderColor: '#cde4d5' }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-medium text-[#4d7059]">Subscribed</div><div className="display mt-2 text-[26px] font-bold text-[#285e3c]">{(contactsQuery.data?.workspaceSubscribed ?? 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#64816d]">Eligible for campaigns</div></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#d8ecdf] text-[#397050]"><CheckCircle2 className="h-4 w-4"/></span></div>
      </div>
      <div data-testid="summary-contact-lists" className={`${panelClass} p-4`} style={{ backgroundColor: '#f1edff', borderColor: '#ded6f7' }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-medium text-[#655b83]">Lists in workspace</div><div className="display mt-2 text-[26px] font-bold text-[#4f4384]">{lists.length.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#766c93]">Available for audience filters</div></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e3dcfb] text-[#6856a4]"><Activity className="h-4 w-4"/></span></div>
      </div>
    </div>
    <section className={panelClass}>
      <div className="space-y-4 border-b border-[#e9edf0] p-4 sm:p-5">
        <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Audience directory</h2><p className="mt-1 text-[11px] text-[#788392]">Showing {resultStart}–{resultEnd} of {(contactsQuery.data?.total ?? 0).toLocaleString()} matching contacts{contactsQuery.isFetching ? ' · Updating…' : ''}</p></div>
        <div data-testid="contact-segments-panel" className="rounded-lg border border-[#dce5ef] bg-white p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold text-[#344154]">Saved audience segments</h3>
              <p className="mt-1 text-[10px] text-[#788392]">Save and reuse a search and filter combination in this workspace.</p>
            </div>
            <Button
              variant="outline"
              testId="button-save-contact-segment"
              disabled={createSegment.isPending}
              onClick={() => openSegmentEditor('save')}
            >
              <BookmarkPlus className="h-4 w-4"/>Save current filters
            </Button>
          </div>
          {segmentsQuery.isError ? (
            <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2">
              <span className="text-[11px] text-[#99501e]">Saved segments could not be loaded.</span>
              <Button variant="outline" testId="button-retry-contact-segments" onClick={() => void segmentsQuery.refetch()}>Retry</Button>
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="min-w-[220px] flex-1">
                  <span className="sr-only">Saved segment</span>
                  <select
                    data-testid="select-contact-segment"
                    aria-label="Saved audience segment"
                    value={selectedSegmentId}
                    onChange={event => setSelectedSegmentId(event.target.value)}
                    disabled={segmentsQuery.isLoading || segments.length === 0}
                    className="h-10 w-full rounded-md border border-[#d3dce7] bg-white px-3 text-[12px] text-[#29394c] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] disabled:bg-[#f6f8fa]"
                  >
                    <option value="">{segmentsQuery.isLoading ? 'Loading saved segments…' : segments.length ? 'Choose a saved segment' : 'No saved segments yet'}</option>
                    {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
                  </select>
                </label>
                <Button variant="outline" testId="button-apply-contact-segment" disabled={!selectedSegment} onClick={applySelectedSegment}>Apply</Button>
                <Button
                  variant="quiet"
                  testId="button-rename-contact-segment"
                  disabled={!selectedSegment || updateSegment.isPending}
                  onClick={() => selectedSegment && openSegmentEditor('rename', selectedSegment)}
                >
                  <Edit3 className="h-3.5 w-3.5"/>Rename
                </Button>
                <Button
                  variant="danger"
                  testId="button-delete-contact-segment"
                  disabled={!selectedSegment || removeSegment.isPending}
                  onClick={() => selectedSegment && setSegmentToDelete(selectedSegment)}
                >
                  <Trash2 className="h-3.5 w-3.5"/>Delete
                </Button>
              </div>
              {!segmentsQuery.isLoading && segments.length > 0 && (
                <p className="mt-2 text-[10px] text-[#8591a0]">{segments.length} saved {segments.length === 1 ? 'segment' : 'segments'} in this workspace.</p>
              )}
            </>
          )}
        </div>
        <ContactDirectoryFiltersPanel
          filters={filters}
          onChange={updateFilters}
          lists={lists}
          selectedCompanyName={selectedCompanyName}
          onSelectedCompanyNameChange={setSelectedCompanyName}
          lifecycleStages={lifecycleStages}
          leadStatuses={leadStatuses}
          leadSources={leadSources}
        />
      </div>
       {visible.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Contact</th><th className="px-4 py-3 font-semibold">Membership</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last email</th><th className="px-4 py-3 font-semibold">Added</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{visible.map(contact => <tr key={contact.id} data-testid={`row-contact-${contact.id}`} className="hover:bg-[#fbfcfd]">
        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">{(contact.firstName?.[0] || contact.email[0] || '?').toUpperCase()}{contact.lastName?.[0]?.toUpperCase() || ''}</span><span className="min-w-0"><Link href={`/contacts/${contact.id}`} data-testid={`link-contact-${contact.id}`} className="block text-[12px] font-semibold text-[#26364a] no-underline hover:text-[#245b9b] hover:underline">{contact.firstName} {contact.lastName}</Link><span className="mt-0.5 block text-[11px] text-[#7c8794]">{contact.email}</span></span></div></td>
        <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1.5">{contact.listIds.length ? contact.listIds.map(id => <span key={id} className="rounded bg-[#f1f4f7] px-2 py-1 text-[10px] text-[#5f6e7f]">{lists.find(l => l.id === id)?.name || 'List'}</span>) : <span className="text-[11px] text-[#9aa3ad]">No list</span>}</div></td>
        <td className="px-4 py-3.5"><button data-testid={`button-toggle-subscription-${contact.id}`} disabled={update.isPending} onClick={() => toggleSub(contact)} className="rounded-full focus:outline-none focus:ring-2 focus:ring-[#dbe8f7] disabled:opacity-60"><Status tone={contact.subscribed ? 'green' : 'gray'}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</Status></button></td>
         <td data-testid={`cell-contact-last-email-${contact.id}`} className="px-4 py-3.5">{contact.lastEmail ? <div className="max-w-[230px]"><div data-testid={`contact-last-email-campaign-${contact.id}`} className="truncate text-[11px] font-semibold text-[#354458]" title={contact.lastEmail.campaignName}>{contact.lastEmail.campaignName}</div><div data-testid={`contact-last-email-date-${contact.id}`} className="mt-1 truncate whitespace-nowrap text-[10px] text-[#7c8794]">{formatDate(contact.lastEmail.lastAttemptAt)}</div></div> : <span className="text-[11px] text-[#9aa3ad]">No email sent</span>}</td>
        <td className="px-4 py-3.5 text-[11px] text-[#7c8794]">{new Date(contact.createdAt).toLocaleDateString()}</td>
         <td className="px-5 py-3.5"><div className="flex justify-end gap-1"><Button variant="quiet" testId={`button-contact-history-${contact.id}`} onClick={() => setHistoryContact(contact)}><Clock3 className="h-3.5 w-3.5"/>History</Button><Button variant="quiet" testId={`button-edit-contact-${contact.id}`} onClick={() => openEdit(contact)}><Edit3 className="h-3.5 w-3.5"/>Edit</Button><Button variant="quiet" testId={`button-delete-contact-${contact.id}`} disabled={remove.isPending} onClick={() => setContactToDelete(contact)}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete</Button></div></td>
      </tr>)}</tbody></table></div> : <div className="p-5"><EmptyState title={hasActiveFilters ? 'No matching contacts' : 'Your audience starts here'} detail={hasActiveFilters ? 'Try removing a filter or broadening your search.' : 'Add a contact and assign them to a list to get your first audience ready.'} action={(contactsQuery.data?.workspaceTotal ?? 0) === 0 ? <Button testId="button-empty-add-contact" onClick={openNew}><CirclePlus className="h-4 w-4"/>Add a contact</Button> : undefined}/></div>}
       {(contactsQuery.data?.pageCount ?? 0) > 1 && <div className="flex items-center justify-between border-t border-[#e9edf0] px-4 py-3">
         <span className="text-[10px] text-[#788392]">Page {contactsQuery.data!.page.toLocaleString()} of {contactsQuery.data!.pageCount.toLocaleString()}</span>
         <div className="flex gap-2">
           <Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-audience-previous-page" disabled={contactsQuery.data!.page <= 1 || contactsQuery.isFetching} onClick={() => setPage(current => Math.max(1, current - 1))}><ArrowLeft className="h-3.5 w-3.5"/>Previous</Button>
           <Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-audience-next-page" disabled={contactsQuery.data!.page >= contactsQuery.data!.pageCount || contactsQuery.isFetching} onClick={() => setPage(current => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5"/></Button>
         </div>
       </div>}
    </section>
     {segmentEditor && <Modal
       title={segmentEditor.mode === 'save' ? 'Save audience segment' : 'Rename audience segment'}
       subtitle={segmentEditor.mode === 'save' ? 'Save the current search and filters for reuse.' : 'Change the name of this saved filter combination.'}
       close={() => { if (!createSegment.isPending && !updateSegment.isPending) setSegmentEditor(null); }}
     >
       <form onSubmit={submitSegment} className="space-y-4">
         <Field label="Segment name" value={segmentName} onChange={setSegmentName} placeholder="e.g. Recent subscribed leads" required maxLength={100} testId="input-contact-segment-name"/>
         <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
           <Button variant="outline" testId="button-cancel-contact-segment" disabled={createSegment.isPending || updateSegment.isPending} onClick={() => setSegmentEditor(null)}>Cancel</Button>
           <Button type="submit" testId="button-submit-contact-segment" disabled={createSegment.isPending || updateSegment.isPending}>
             {(createSegment.isPending || updateSegment.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}
             {segmentEditor.mode === 'save' ? 'Save segment' : 'Save name'}
           </Button>
         </div>
       </form>
     </Modal>}
     <ConfirmActionDialog
       open={Boolean(segmentToDelete)}
       title="Delete this saved segment?"
       description={segmentToDelete ? `Delete “${segmentToDelete.name}”? This removes the saved filter combination but does not change any contacts.` : ''}
       confirmLabel="Delete segment"
       onOpenChange={open => { if (!open && !removeSegment.isPending) setSegmentToDelete(null); }}
       onConfirm={confirmDeleteSegment}
       pending={removeSegment.isPending}
       testId="dialog-delete-contact-segment"
     />
    {editing !== undefined && <Modal title={editing ? 'Edit contact' : 'Add contact'} subtitle="Contact details and list memberships for this workspace." close={() => setEditing(undefined)}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email address" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" placeholder="person@company.com" required maxLength={254} testId="input-contact-email"/>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="First name" value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} required maxLength={100} testId="input-contact-first-name"/><Field label="Last name" value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} required maxLength={100} testId="input-contact-last-name"/></div>
        <Field label="Company name" value={form.companyName} onChange={v => setForm(f => ({ ...f, companyName: v }))} maxLength={200} placeholder="Optional" testId="input-contact-company"/>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="LinkedIn URL" value={form.linkedinUrl} onChange={v => setForm(f => ({ ...f, linkedinUrl: v }))} maxLength={2048} placeholder="Optional" testId="input-contact-linkedin"/><Field label="Phone number" value={form.phoneNumber} onChange={v => setForm(f => ({ ...f, phoneNumber: v }))} maxLength={40} placeholder="Optional" testId="input-contact-phone"/></div>
        <div className="rounded-md border border-[#e3e7eb] p-3"><div className="mb-2 text-[12px] font-semibold text-[#344154]">List memberships</div>{lists.length ? <div className="max-h-36 space-y-2 overflow-y-auto">{lists.map(list => <label key={list.id} className="flex items-center gap-2 text-[12px] text-[#536172]"><input data-testid={`checkbox-contact-list-${list.id}`} type="checkbox" checked={form.listIds.includes(list.id)} onChange={e => setForm(f => ({ ...f, listIds: e.target.checked ? [...f.listIds, list.id] : f.listIds.filter(id => id !== list.id) }))} className="accent-[#174f99]"/>{list.name}{!list.active && <span className="text-[10px] text-[#a0a8b3]">inactive</span>}</label>)}</div> : <p className="text-[11px] text-[#818d9a]">Create a list first to organize contacts.</p>}</div>
        <label className="flex items-center gap-2 text-[12px] font-medium text-[#445267]"><input data-testid="checkbox-contact-subscribed" type="checkbox" checked={form.subscribed} onChange={e => setForm(f => ({ ...f, subscribed: e.target.checked }))} className="accent-[#174f99]"/>Contact is subscribed and eligible for campaigns</label>
        <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="outline" testId="button-cancel-contact" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" testId="button-submit-contact" disabled={busy}>{busy && <LoaderCircle className="h-4 w-4 animate-spin"/>}{busy ? 'Saving contact' : editing ? 'Save changes' : 'Add contact'}</Button></div>
      </form>
    </Modal>}
     {historyContact && <ContactEmailHistoryDialog contact={historyContact} close={() => setHistoryContact(null)}/>}
     <ConfirmActionDialog
       open={Boolean(contactToDelete)}
       title="Delete this contact?"
       description={contactToDelete ? `Delete ${contactToDelete.email} from this workspace? It will be removed from its lists, and past delivery records will no longer be linked to this contact.` : ''}
       confirmLabel="Delete contact"
       pending={remove.isPending}
       onOpenChange={open => { if (!open && !remove.isPending) setContactToDelete(null); }}
       onConfirm={confirmDeleteContact}
       testId="dialog-delete-contact"
     />
    {importing && <ContactImportDialog onClose={() => setImporting(false)} onChanged={reload}/>}
  </></QueryState>;
}

export function ListsPage() {
  const [, setLocation] = useLocation();
  const query = useListContactLists(); const campaignsQuery = useListCampaigns();
  const create = useCreateContactList(); const update = useUpdateContactList(); const remove = useDeleteContactList();
  const updateContact = useUpdateContact();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [editing, setEditing] = useState<ContactList | null | undefined>(undefined); const [name, setName] = useState('');
  const [listToDelete, setListToDelete] = useState<ContactList | null>(null);
  const [viewingList, setViewingList] = useState<ContactList | null>(null);
  const [openCampaignLists, setOpenCampaignLists] = useState<Set<string>>(() => new Set());
  const [contactSearch, setContactSearch] = useState('');
  const [debouncedContactSearch, setDebouncedContactSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [pendingMembershipIds, setPendingMembershipIds] = useState<Set<string>>(() => new Set());
  const [membershipFeedback, setMembershipFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedContactSearch(contactSearch), 250);
    return () => window.clearTimeout(timer);
  }, [contactSearch]);
  const memberParams = viewingList
    ? { page: memberPage, pageSize: 25, includeHistory: false, listId: viewingList.id }
    : undefined;
  const contactsQuery = useListContacts(memberParams, {
    query: {
      queryKey: getListContactsQueryKey(memberParams),
      enabled: Boolean(viewingList),
    },
  });
  const contactOptionsParams = viewingList
    ? { limit: 30, excludeListId: viewingList.id, search: debouncedContactSearch }
    : undefined;
  const contactOptionsQuery = useListContactOptions(contactOptionsParams, {
    query: {
      queryKey: getListContactOptionsQueryKey(contactOptionsParams),
      enabled: Boolean(viewingList),
    },
  });
  const lists = (query.data || []) as ContactList[];
  const contacts = contactsQuery.data?.contacts ?? [];
  const campaigns = (campaignsQuery.data || []) as CampaignSummary[];
  const campaignsByList = useMemo(() => {
    const grouped = new Map<string, CampaignSummary[]>();
    for (const campaign of campaigns) {
       const campaignListIds = campaign.listIds?.length
         ? campaign.listIds
         : campaign.listId
           ? [campaign.listId]
           : [];
       for (const listId of campaignListIds) {
         const listCampaigns = grouped.get(listId) || [];
         if (!listCampaigns.some(item => item.id === campaign.id)) {
           listCampaigns.push(campaign);
         }
         grouped.set(listId, listCampaigns);
       }
    }
    return grouped;
  }, [campaigns]);
  const viewingContacts = contacts;
  const availableContacts = contactOptionsQuery.data?.contacts ?? [];
  useEffect(() => {
    if (contactsQuery.data && contactsQuery.data.page !== memberPage) {
      setMemberPage(contactsQuery.data.page);
    }
  }, [contactsQuery.data?.page, memberPage]);
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListContactsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListContactOptionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }),
  ]);
  const openListContacts = (list: ContactList) => {
    setViewingList(list);
    setContactSearch('');
    setDebouncedContactSearch('');
    setMemberPage(1);
    setMembershipFeedback(null);
  };
  const toggleCampaignList = (listId: string) => setOpenCampaignLists(current => {
    const next = new Set(current);
    if (next.has(listId)) next.delete(listId);
    else next.add(listId);
    return next;
  });
  const addContactToList = async (contact: ContactOption) => {
    const list = viewingList;
    if (!list || contactOptionsQuery.isFetching || contact.listIds.includes(list.id)) return;
    setPendingMembershipIds(current => new Set(current).add(contact.id));
    setMembershipFeedback(null);
    try {
      await updateContact.mutateAsync({
        contactId: contact.id,
        data: { listIds: [...new Set([...contact.listIds, list.id])] },
      });
      await refresh();
      setMembershipFeedback({ kind: 'success', text: `${contact.email} was added to ${list.name}.` });
    } catch (error) {
      setMembershipFeedback({ kind: 'error', text: mutationError(error) });
      await refresh();
    } finally {
      setPendingMembershipIds(current => {
        const next = new Set(current);
        next.delete(contact.id);
        return next;
      });
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const success = () => { refresh(); setEditing(undefined); setName(''); setNotice({ kind: 'success', text: editing ? 'List changes saved.' : 'Contact list created.' }); };
    const fail = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    if (editing) update.mutate({ listId: editing.id, data: { name: name.trim() } }, { onSuccess: success, onError: fail });
    else create.mutate({ data: { name: name.trim() } }, { onSuccess: success, onError: fail });
  };
  const toggle = (list: ContactList) => update.mutate({ listId: list.id, data: { active: !list.active } }, { onSuccess: () => { refresh(); setNotice({ kind: 'success', text: list.active ? 'List deactivated.' : 'List activated and available for campaigns.' }); }, onError: error => setNotice({ kind: 'error', text: mutationError(error) }) });
  const confirmDeleteList = () => {
    if (!listToDelete) return;
    const list = listToDelete;
    remove.mutate({ listId: list.id }, {
      onSuccess: () => { setListToDelete(null); refresh(); setNotice({ kind: 'success', text: 'List deleted. Contacts remain in the workspace.' }); },
      onError: error => { setListToDelete(null); setNotice({ kind: 'error', text: mutationError(error) }); },
    });
  };
  const openCreate = () => { setEditing(null); setName(''); };
  return <QueryState loading={query.isLoading} error={query.isError} retry={() => { void query.refetch(); }} label="contact lists"><>
    <Heading eyebrow="AUDIENCE / LISTS" title="Contact lists" detail="Build focused audiences, control campaign eligibility, and keep every list easy to audit." action={<Button testId="button-create-list" onClick={openCreate}><CirclePlus className="h-4 w-4"/>Create list</Button>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
     <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eef5ff', borderColor: '#d7e4f3' }}><div className="text-[11px] text-[#536d89]">Total lists</div><div className="display mt-2 text-[26px] font-bold text-[#245b9b]">{lists.length}</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eff8f1', borderColor: '#d5ead9' }}><div className="text-[11px] text-[#5f7c67]">Active lists</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{lists.filter(l => l.active).length}</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#f3f0fc', borderColor: '#e1dcf4' }}><div className="text-[11px] text-[#6f6692]">List memberships</div><div className="display mt-2 text-[26px] font-bold text-[#6352a0]">{lists.reduce((total, list) => total + list.contactCount, 0).toLocaleString()}</div></div></div>
    {lists.length ? <div className="space-y-3">{lists.map((list, index) => {
      const memberCount = list.contactCount;
      const listCampaigns = campaignsByList.get(list.id) || [];
      const campaignsOpen = openCampaignLists.has(list.id);
      const campaignsUnavailable = campaignsQuery.isError && campaignsQuery.data === undefined;
      const campaignsLoading = campaignsQuery.isLoading && campaignsQuery.data === undefined;
      return <section key={list.id} data-testid={`card-list-${list.id}`} className={`${panelClass} overflow-hidden transition-shadow hover:shadow-sm`}>
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#edf4fc] text-[#245b9b]"><Users className="h-5 w-5"/></div>
          <div className="min-w-[180px] flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="display text-[18px] font-bold text-[#1c2b3d]">{list.name}</h2><Status tone={list.active ? 'green' : 'gray'}>{list.active ? 'Active' : 'Inactive'}</Status></div><p className="mt-1 text-[11px] text-[#7c8794]">Created {new Date(list.createdAt).toLocaleDateString()} · updated {new Date(list.updatedAt).toLocaleDateString()}</p></div>
          <div className="min-w-[125px] rounded-md bg-[#f7f9fb] px-3 py-2"><div className="text-[10px] text-[#7e8996]">Contacts</div><div className="mt-0.5 text-[16px] font-bold text-[#26364a]">{memberCount.toLocaleString()} <span className="text-[10px] font-normal text-[#84909d]">members</span></div></div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button variant="outline" testId={`button-view-list-contacts-${list.id}`} onClick={() => openListContacts(list)}><Users className="h-3.5 w-3.5"/>Manage contacts</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-testid={`button-list-actions-${list.id}`} aria-label={`Actions for ${list.name}`} title="List actions" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#d7dce3] bg-white text-[#526174] transition hover:bg-[#f7f9fb] focus:outline-none focus:ring-2 focus:ring-[#dbe8f7]">
                  <MoreHorizontal className="h-4 w-4"/>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem data-testid={`button-toggle-list-${list.id}`} disabled={update.isPending} onSelect={() => toggle(list)}>{list.active ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                <DropdownMenuItem data-testid={`button-edit-list-${list.id}`} onSelect={() => { setEditing(list); setName(list.name); }}><Edit3 className="h-3.5 w-3.5"/>Edit</DropdownMenuItem>
                <DropdownMenuItem data-testid={`button-delete-list-${list.id}`} disabled={remove.isPending} onSelect={() => setListToDelete(list)} className="text-[#b85b20] focus:text-[#b85b20]"><Trash2 className="h-3.5 w-3.5"/>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div data-testid={`list-campaigns-section-${list.id}`} className="border-t border-[#edf0f2] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-semibold text-[#435164]">Campaigns using this list</span>
              <span data-testid={`status-list-campaign-count-${list.id}`} className="rounded-full bg-[#f1f4f7] px-2 py-0.5 text-[10px] text-[#657386]">
                {campaignsLoading ? 'Loading' : campaignsUnavailable ? 'Unavailable' : `${listCampaigns.length} ${listCampaigns.length === 1 ? 'campaign' : 'campaigns'}`}
              </span>
            </div>
            <button type="button" data-testid={`button-toggle-list-campaigns-${list.id}`} aria-expanded={campaignsOpen} aria-controls={`list-campaigns-${list.id}`} onClick={() => toggleCampaignList(list.id)} className="rounded px-2 py-1 text-[11px] font-semibold text-[#245b9b] transition hover:bg-[#edf4fc]">
              {campaignsOpen ? 'Hide campaigns' : 'View campaigns'}
            </button>
          </div>
          {campaignsOpen && <div id={`list-campaigns-${list.id}`} className="mt-3">
            {campaignsLoading ? <p className="text-[11px] text-[#7c8794]">Loading campaigns…</p>
              : campaignsUnavailable ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>Campaigns using this list could not be loaded.</span><Button variant="outline" className="min-h-8 px-3 text-[11px]" testId={`button-retry-list-campaigns-${list.id}`} onClick={() => { void campaignsQuery.refetch(); }}>Retry</Button></div>
                : listCampaigns.length ? <div className="grid gap-2 md:grid-cols-2">
                  {listCampaigns.map(campaign => <Link key={campaign.id} href={`/campaigns/${campaign.id}`} data-testid={`link-list-campaign-${campaign.id}`} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#e8edf2] bg-[#fbfcfd] px-3 py-2.5 no-underline transition hover:border-[#c8d8e8] hover:bg-[#f6f9fc]">
                    <span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#29384a]">{campaign.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#7c8794]">{campaign.subject}</span></span>
                    <Status tone={campaign.status === 'completed' ? 'green' : campaign.status === 'queued' || campaign.status === 'sending' ? 'blue' : 'gray'}>{campaign.status}</Status>
                  </Link>)}
                </div> : <p className="text-[11px] text-[#7c8794]">No campaigns have used this list yet.</p>}
          </div>}
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0f2] bg-[#fcfcfd] px-5 py-2.5"><span className="mono text-[9px] tracking-[.1em] text-[#9aa3ad]">LIST {String(index + 1).padStart(2, '0')}</span><span className="text-[10px] text-[#87919d]">{list.active ? 'Available for campaign targeting' : 'Hidden from campaign queueing'}</span></div>
      </section>;
    })}</div> : <EmptyState title="No lists created yet" detail="Lists make it simple to target the right audience and review its size before sending." action={<Button testId="button-empty-create-list" onClick={openCreate}><CirclePlus className="h-4 w-4"/>Create your first list</Button>}/>}
    {editing !== undefined && <Modal title={editing ? 'Edit contact list' : 'Create contact list'} subtitle="List status controls whether it can be selected for new campaigns." close={() => setEditing(undefined)}>
      <form onSubmit={save} className="space-y-4"><Field label="List name" value={name} onChange={setName} placeholder="Product updates" required testId="input-list-name"/>{editing && <div className="rounded-md bg-[#f6f8fa] p-3 text-[11px] leading-5 text-[#6e7b8a]">This list currently has {editing.contactCount} contact{editing.contactCount === 1 ? '' : 's'} associated. Renaming does not change memberships.</div>}
        <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="outline" testId="button-cancel-list" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" testId="button-submit-list" disabled={create.isPending || update.isPending}>{(create.isPending || update.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{editing ? 'Save list' : 'Create list'}</Button></div>
      </form>
    </Modal>}
    {viewingList && <Modal wide title={`Manage contacts · ${viewingList.name}`} subtitle={`${(contactsQuery.data?.total ?? viewingList.contactCount).toLocaleString()} contact${(contactsQuery.data?.total ?? viewingList.contactCount) === 1 ? '' : 's'} belong to this list.`} close={() => setViewingList(null)}>
      <section className="mb-4 rounded-md border border-[#e3e7eb] bg-[#fafbfc] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="text-[12px] font-semibold text-[#344154]">Add existing contacts</h3><p className="mt-1 text-[10px] text-[#7b8794]">Choose a contact to add it to this list. Existing list memberships are preserved.</p></div>
          <span className="text-[10px] text-[#7b8794]">{(contactOptionsQuery.data?.total ?? 0).toLocaleString()} available</span>
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a95a2]"/>
          <input data-testid={`input-search-list-contacts-${viewingList.id}`} aria-label="Search contacts to add" className={`${inputClass} h-9 pl-9 text-[12px]`} type="search" placeholder="Search by name, email, or company" value={contactSearch} onChange={event => setContactSearch(event.target.value)}/>
        </label>
        {membershipFeedback && <p role={membershipFeedback.kind === 'error' ? 'alert' : 'status'} data-testid="status-list-membership" className={`mt-3 rounded-md border px-3 py-2 text-[11px] ${membershipFeedback.kind === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{membershipFeedback.text}</p>}
        {contactOptionsQuery.isLoading ? <p className="mt-3 text-[10px] text-[#7b8794]">Loading matching contacts…</p>
          : contactOptionsQuery.isError ? <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>Contacts could not be searched.</span><Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-retry-list-contact-options" onClick={() => void contactOptionsQuery.refetch()}>Retry</Button></div>
        : availableContacts.length ? <div className="mt-3 max-h-48 divide-y divide-[#edf0f2] overflow-y-auto rounded-md border border-[#e7ebef] bg-white">
          {availableContacts.map(contact => {
            const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email;
            const pending = pendingMembershipIds.has(contact.id);
            return <div key={contact.id} data-testid={`row-add-contact-to-list-${contact.id}`} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[#29384a]">{displayName}</div><div className="truncate text-[10px] text-[#7c8794]">{contact.email}{contact.companyName ? ` · ${contact.companyName}` : ''}</div></div>
              <Button variant="outline" className="min-h-8 px-3 text-[11px]" testId={`button-add-contact-to-list-${contact.id}`} disabled={pending || contactOptionsQuery.isFetching} onClick={() => void addContactToList(contact)}>{pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <CirclePlus className="h-3.5 w-3.5"/>}{pending ? 'Adding' : 'Add'}</Button>
            </div>;
          })}
        </div> : (contactOptionsQuery.data?.total ?? 0) === 0 && !contactSearch.trim() && contactsQuery.data?.workspaceTotal === 0 ? <div className="mt-3 rounded-md border border-dashed border-[#d9dfe6] bg-white px-4 py-5 text-center"><p className="text-[11px] text-[#7b8794]">No contacts are in this workspace yet.</p><Button variant="outline" className="mt-3" testId="button-go-to-contacts-to-create" onClick={() => { setViewingList(null); setLocation('/contacts'); }}>Go to Contacts</Button></div> : <p className="mt-3 rounded-md border border-dashed border-[#d9dfe6] bg-white px-4 py-5 text-center text-[11px] text-[#7b8794]">{contactSearch.trim() ? 'No contacts match your search.' : 'All workspace contacts already belong to this list.'}</p>}
      </section>
      <section>
        <h3 className="mb-2 text-[12px] font-semibold text-[#344154]">Contacts in this list</h3>
      {contactsQuery.isLoading ? <p className="text-[11px] text-[#7b8794]">Loading list members…</p>
        : contactsQuery.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>List members could not be loaded.</span><Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-retry-list-members" onClick={() => void contactsQuery.refetch()}>Retry</Button></div>
      : viewingContacts.length ? <div className="max-h-[36vh] overflow-y-auto rounded-md border border-[#e7ebef]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 border-b border-[#e7ebef] bg-[#f8fafb] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#7e8996]"><span>Contact</span><span>Email</span><span>Status</span></div>
        {viewingContacts.map(contact => {
          const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email;
          return <div key={contact.id} data-testid={`row-list-contact-${contact.id}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-b border-[#edf0f2] px-4 py-3 last:border-b-0">
            <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#29384a]">{displayName}</div>{contact.companyName && <div className="mt-0.5 truncate text-[10px] text-[#87919d]">{contact.companyName}</div>}</div>
            <a className="truncate text-[11px] text-[#365f8b] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>
            <Status tone={contact.subscribed ? 'green' : 'gray'}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</Status>
          </div>;
        })}
      </div> : <div className="rounded-md border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-6 text-center">
        <Users className="mx-auto h-5 w-5 text-[#7f8ea0]"/><p className="mt-2 text-[12px] font-semibold text-[#344154]">No contacts in this list yet</p><p className="mt-1 text-[10px] text-[#7b8794]">Use the search above to add contacts from your workspace.</p>
      </div>}
      {(contactsQuery.data?.pageCount ?? 0) > 1 && <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-[#788392]">Page {contactsQuery.data!.page} of {contactsQuery.data!.pageCount.toLocaleString()}</span>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-list-members-previous-page" disabled={memberPage <= 1 || contactsQuery.isFetching} onClick={() => setMemberPage(current => Math.max(1, current - 1))}><ArrowLeft className="h-3.5 w-3.5"/>Previous</Button>
          <Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-list-members-next-page" disabled={memberPage >= contactsQuery.data!.pageCount || contactsQuery.isFetching} onClick={() => setMemberPage(current => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5"/></Button>
        </div>
      </div>}
      </section>
    </Modal>}
     <ConfirmActionDialog
       open={Boolean(listToDelete)}
       title="Delete this contact list?"
       description={listToDelete ? `Delete “${listToDelete.name}”? Contacts will remain in your workspace but will no longer belong to this list.` : ''}
       confirmLabel="Delete list"
       pending={remove.isPending}
       onOpenChange={open => { if (!open && !remove.isPending) setListToDelete(null); }}
       onConfirm={confirmDeleteList}
       testId="dialog-delete-contact-list"
     />
  </></QueryState>;
}

type CampaignForm = { name: string; objective: string; subject: string; textBody: string; htmlBody: string; listIds: string[]; senderAccountId: string };
const blankCampaign: CampaignForm = { name: '', objective: '', subject: '', textBody: '', htmlBody: '', listIds: [], senderAccountId: '' };

export function CampaignsPage() {
  const [, setLocation] = useLocation();
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const campaignsQuery = useListCampaigns(); const listsQuery = useListContactLists(); const senderAccountsQuery = useListTenantSendingAccounts();
  const create = useCreateCampaign(); const update = useUpdateCampaign(); const remove = useDeleteCampaign(); const send = useSendCampaign();
  const previewCampaign = usePreviewCampaign();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [editing, setEditing] = useState<CampaignSummary | null | undefined>(undefined); const [form, setForm] = useState<CampaignForm>(blankCampaign);
  const [audienceActionPending, setAudienceActionPending] = useState(false);
  const audienceActionInProgress = useRef(false);
  const [campaignListSearch, setCampaignListSearch] = useState('');
  const [showSelectedCampaignLists, setShowSelectedCampaignLists] = useState(false);
  const [sampleContactId, setSampleContactId] = useState('');
  const [previewState, setPreviewState] = useState<{ key: string; rendered: CampaignTemplatePreview } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ kind: 'queue' | 'delete'; campaign: CampaignSummary } | null>(null);
  const [queueStartAt, setQueueStartAt] = useState('');
  const [serverMinimumStartAt, setServerMinimumStartAt] = useState<Date | null>(null);
  const [queueStartError, setQueueStartError] = useState<string | null>(null);
  const campaigns = (campaignsQuery.data || []) as CampaignSummary[];
  const lists = (listsQuery.data || []) as ContactList[];
  const senderAccounts = senderAccountsQuery.data?.accounts ?? [];
  const primarySenderAccountId = senderAccounts.find(account => account.isPrimary)?.id ?? senderAccounts[0]?.id ?? '';
  const sampleContactsParams = { limit: 100, listIds: form.listIds, subscribed: true };
  const contactsQuery = useListContactOptions(sampleContactsParams, {
    query: {
      queryKey: getListContactOptionsQueryKey(sampleContactsParams),
      enabled: form.listIds.length > 0,
      staleTime: 30_000,
    },
  });
  const contacts = contactsQuery.data?.contacts ?? [];
  const activeLists = lists.filter(list => list.active);
  const filteredCampaignLists = useMemo(() => {
    const query = campaignListSearch.trim().toLowerCase();
    return lists.filter(list =>
      (!query || list.name.toLowerCase().includes(query)) &&
      (!showSelectedCampaignLists || form.listIds.includes(list.id)),
    );
  }, [campaignListSearch, form.listIds, lists, showSelectedCampaignLists]);
  const matchingCampaignListsToAdd = filteredCampaignLists.filter(list => list.active && !form.listIds.includes(list.id));
  const queueMinimumStartAt = minimumCampaignStartAt(campaigns, serverMinimumStartAt);
  const queueMinimumStartAtInput = dateTimeLocalValue(queueMinimumStartAt);
  const queueStartDate = queueStartAt ? new Date(queueStartAt) : null;
  const campaignAudienceListIds =
    editing !== undefined
      ? form.listIds
      : pendingAction?.kind === 'queue'
        ? pendingAction.campaign.listIds?.length
          ? pendingAction.campaign.listIds
          : pendingAction.campaign.listId
            ? [pendingAction.campaign.listId]
            : []
        : [];
  const campaignAudienceQuery = useGetCampaignRecipientSummary(
    { listIds: campaignAudienceListIds },
    {
      query: {
        queryKey: getGetCampaignRecipientSummaryQueryKey({ listIds: campaignAudienceListIds }),
        enabled: campaignAudienceListIds.length > 0,
        staleTime: 0,
        refetchInterval: campaignAudienceListIds.length > 0 && (editing !== undefined || pendingAction?.kind === 'queue')
          ? 30_000
          : false,
        refetchIntervalInBackground: false,
      },
    },
  );
  const audienceCheckReady = Boolean(
    campaignAudienceListIds.length > 0 &&
    campaignAudienceQuery.data &&
    !campaignAudienceQuery.isFetching &&
    !campaignAudienceQuery.isError,
  );
  const queueStartIsValid = Boolean(
    queueStartDate &&
    Number.isFinite(queueStartDate.getTime()) &&
    queueStartDate.getTime() >= queueMinimumStartAt.getTime(),
  );
  const hasActiveCampaigns = campaigns.some(campaign => campaign.status === 'queued' || campaign.status === 'sending');
  const eligibleSampleContacts = useMemo(() => {
    const listPriority = new Map(form.listIds.map((listId, index) => [listId, index]));
    const eligible = contacts
      .filter(contact => contact.subscribed && contact.listIds.some(listId => listPriority.has(listId)))
      .sort((left, right) => {
        const priority = (contact: ContactOption) => Math.min(
          ...contact.listIds.map(listId => listPriority.get(listId) ?? Number.MAX_SAFE_INTEGER),
        );
        const listOrder = priority(left) - priority(right);
        if (listOrder !== 0) return listOrder;
        const createdAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
        if (createdAt !== 0) return createdAt;
        return left.id.localeCompare(right.id);
      });
    const seenEmails = new Set<string>();
    return eligible.filter(contact => {
      const email = contact.email.trim().toLowerCase();
      if (!email || seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });
  }, [contacts, form.listIds]);
  useEffect(() => {
    if (sampleContactId && !eligibleSampleContacts.some(contact => contact.id === sampleContactId)) {
      setSampleContactId('');
    }
  }, [eligibleSampleContacts, sampleContactId]);
  const previewKey = JSON.stringify([form.listIds, sampleContactId, form.subject, form.textBody, form.htmlBody]);
  const visiblePreview = previewState?.key === previewKey ? previewState.rendered : null;
  const visiblePreviewError = previewError?.key === previewKey ? previewError.message : null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); };
  const openNew = () => { setEditing(null); setForm({ ...blankCampaign, listIds: activeLists[0]?.id ? [activeLists[0].id] : [], senderAccountId: primarySenderAccountId }); setCampaignListSearch(''); setShowSelectedCampaignLists(false); setSampleContactId(''); setPreviewState(null); setPreviewError(null); };
  const openEdit = (campaign: CampaignSummary) => { setEditing(campaign); setForm({ name: campaign.name, objective: campaign.objective ?? '', subject: campaign.subject, textBody: campaign.textBody, htmlBody: campaign.htmlBody ?? plainTextToHtml(campaign.textBody), listIds: campaign.listIds?.length ? [...campaign.listIds] : campaign.listId ? [campaign.listId] : [], senderAccountId: campaign.senderAccountId ?? primarySenderAccountId }); setCampaignListSearch(''); setShowSelectedCampaignLists(false); setSampleContactId(''); setPreviewState(null); setPreviewError(null); };
  const updateCampaignListSelection = (update: (listIds: string[]) => string[]) => {
    setForm(current => ({ ...current, listIds: update(current.listIds) }));
    setSampleContactId('');
    setPreviewState(null);
    setPreviewError(null);
  };
  const toggleCampaignList = (listId: string, checked: boolean) => {
    updateCampaignListSelection(listIds =>
      checked
        ? listIds.includes(listId) ? listIds : [...listIds, listId]
        : listIds.filter(id => id !== listId),
    );
  };
  const addMatchingCampaignLists = () => {
    if (!campaignListSearch.trim() || !matchingCampaignListsToAdd.length) return;
    const matchingIds = matchingCampaignListsToAdd.map(list => list.id);
    updateCampaignListSelection(listIds => [...listIds, ...matchingIds.filter(id => !listIds.includes(id))]);
  };
  const clearCampaignLists = () => {
    if (form.listIds.length) updateCampaignListSelection(() => []);
  };
  const moveCampaignList = (index: number, direction: -1 | 1) => {
    setForm(current => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.listIds.length) return current;
      const listIds = [...current.listIds];
      [listIds[index], listIds[nextIndex]] = [listIds[nextIndex], listIds[index]];
      return { ...current, listIds };
    });
    setPreviewState(null);
    setPreviewError(null);
  };
  const requestPreview = () => {
    if (!sampleContactId) return;
    const key = previewKey;
    setPreviewState(null);
    setPreviewError(null);
    previewCampaign.mutate({
      data: {
         listIds: form.listIds,
        contactId: sampleContactId,
        subject: form.subject,
        textBody: form.textBody,
        htmlBody: form.htmlBody,
      },
    }, {
      onSuccess: rendered => setPreviewState({ key, rendered }),
      onError: error => setPreviewError({ key, message: mutationError(error) }),
    });
  };
  const insertSubjectPlaceholder = (token: string) => {
    const input = subjectInputRef.current;
    const start = input?.selectionStart ?? form.subject.length;
    const end = input?.selectionEnd ?? start;
    const subject = `${form.subject.slice(0, start)}${token}${form.subject.slice(end)}`;
    setForm(current => ({ ...current, subject }));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.listIds.length || !audienceCheckReady || audienceActionInProgress.current) return;
    audienceActionInProgress.current = true;
    setAudienceActionPending(true);
    const data = { name: form.name.trim(), objective: form.objective.trim(), subject: form.subject.trim(), textBody: form.textBody.trim(), htmlBody: form.htmlBody.trim(), listIds: [...form.listIds], senderAccountId: form.senderAccountId || null };
    try {
      const audience = await campaignAudienceQuery.refetch();
      if (audience.isError || !audience.data) {
        setNotice({ kind: 'error', text: 'We couldn’t verify the current audience. Retry before saving this campaign.' });
        return;
      }
      const success = () => { refresh(); setEditing(undefined); setNotice({ kind: 'success', text: editing ? 'Draft changes saved.' : 'Campaign draft created.' }); };
      const fail = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
      if (editing) update.mutate({ campaignId: editing.id, data }, { onSuccess: success, onError: fail });
      else create.mutate({ data: data as Parameters<typeof create.mutate>[0]['data'] }, { onSuccess: success, onError: fail });
    } finally {
      audienceActionInProgress.current = false;
      setAudienceActionPending(false);
    }
  };
  const queue = (campaign: CampaignSummary) => {
    setServerMinimumStartAt(null);
    setQueueStartError(null);
    setQueueStartAt(dateTimeLocalValue(minimumCampaignStartAt(campaigns)));
    setPendingAction({ kind: 'queue', campaign });
  };
  const del = (campaign: CampaignSummary) => setPendingAction({ kind: 'delete', campaign });
  const confirmCampaignAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.kind === 'queue') {
      if (!queueStartIsValid || !queueStartDate || !audienceCheckReady || audienceActionInProgress.current) return;
      audienceActionInProgress.current = true;
      setAudienceActionPending(true);
      try {
        const audience = await campaignAudienceQuery.refetch();
        if (audience.isError || !audience.data) {
          setNotice({ kind: 'error', text: 'We couldn’t verify the current audience. Retry before queueing this campaign.' });
          return;
        }
        send.mutate({ campaignId: action.campaign.id, data: { scheduledAt: queueStartDate.toISOString() } }, {
          onSuccess: response => { setPendingAction(null); refresh(); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); setNotice({ kind: 'success', text: response.scheduledAt ? `Campaign scheduled for ${formatDate(response.scheduledAt)}.` : `Campaign status: ${response.status}.` }); },
          onError: error => {
            const apiError = (error as { data?: { code?: string; earliestStartAt?: string | null } }).data;
            if (apiError?.code === 'CAMPAIGN_START_TOO_EARLY' && apiError.earliestStartAt) {
              const earliest = new Date(apiError.earliestStartAt);
              setServerMinimumStartAt(earliest);
              setQueueStartAt(dateTimeLocalValue(roundUpToMinute(earliest)));
              setQueueStartError(`Delivery estimates changed. The earliest available start is ${formatDate(apiError.earliestStartAt)}.`);
              return;
            }
            setPendingAction(null);
            setNotice({ kind: 'error', text: mutationError(error) });
          },
        });
      } finally {
        audienceActionInProgress.current = false;
        setAudienceActionPending(false);
      }
    } else {
      remove.mutate({ campaignId: action.campaign.id }, {
        onSuccess: () => { setPendingAction(null); refresh(); setNotice({ kind: 'success', text: 'Campaign draft deleted.' }); },
        onError: error => { setPendingAction(null); setNotice({ kind: 'error', text: mutationError(error) }); },
      });
    }
  };
  const statusTone = (status: CampaignSummary['status']) => status === 'completed' ? 'green' : status === 'queued' || status === 'sending' ? 'blue' : 'gray';
  const totalDelivered = campaigns.reduce((sum, campaign) => sum + campaign.delivered, 0);
  const totalBounced = campaigns.reduce((sum, campaign) => sum + campaign.bounced, 0);
  return <QueryState loading={campaignsQuery.isLoading || listsQuery.isLoading} error={campaignsQuery.isError || listsQuery.isError} retry={() => { void campaignsQuery.refetch(); void listsQuery.refetch(); }} label="campaigns"><>
    <Heading eyebrow="DELIVERY / CAMPAIGNS" title="Campaigns" detail="Manage drafts and delivery. Estimates include current queued work and shared sending limits; SMTP response times and retries can change actual finish times." action={<Button testId="button-create-campaign" onClick={openNew} disabled={!activeLists.length}><CirclePlus className="h-4 w-4"/>New campaign</Button>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    {!activeLists.length && <div className="mb-5 flex items-start gap-3 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-4 py-3 text-[12px] leading-5 text-[#895b2f]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>Activate a contact list before creating a campaign. Drafts can only target active lists.</span></div>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eef5ff', borderColor: '#d7e4f3' }}><div className="text-[11px] text-[#536d89]">Campaigns</div><div className="display mt-2 text-[26px] font-bold text-[#245b9b]">{campaigns.length}</div><div className="mt-1 text-[10px] text-[#6f8092]">{campaigns.filter(c => c.status === 'draft').length} drafts · {campaigns.filter(c => c.status !== 'draft').length} queued or sent</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eff8f1', borderColor: '#d5ead9' }}><div className="text-[11px] text-[#5f7c67]">SMTP accepted</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{totalDelivered.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#6f8092]">Inbox delivery is not confirmed</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#fff5eb', borderColor: '#f0dfcb' }}><div className="text-[11px] text-[#8b6747]">Rejected / failed</div><div className="display mt-2 text-[26px] font-bold text-[#ae642c]">{totalBounced.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#816f5f]">SMTP rejection or terminal send failure</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#f3f5f8', borderColor: '#dfe4e9' }}><div className="text-[11px] text-[#677484]">Suppressed</div><div className="display mt-2 text-[26px] font-bold text-[#596675]">{campaigns.reduce((sum, campaign) => sum + campaign.suppressed, 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#738092]">Unsubscribed or removed before send</div></div></div>
    {campaigns.length ? <section className={panelClass}>
      <div className="flex items-center justify-between border-b border-[#e9edf0] px-4 py-4"><div><h2 className="display text-[17px] font-bold text-[#1b293a]">Campaign activity</h2><p className="mt-1 text-[11px] text-[#788392]">Queue timestamps and final delivery counts from your workspace.</p></div><span className="mono hidden text-[9px] tracking-[.12em] text-[#9aa3ad] sm:block"><Activity className="mr-1 inline h-3.5 w-3.5"/>DELIVERY LOG</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Campaign</th><th className="px-4 py-3 font-semibold">Audience</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Delivery</th><th className="px-4 py-3 font-semibold">Queued / completed</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{campaigns.map(campaign => <tr key={campaign.id} data-testid={`row-campaign-${campaign.id}`} className="hover:bg-[#fbfcfd]">
        <td className="max-w-[240px] px-5 py-4"><button data-testid={`button-campaign-details-${campaign.id}`} onClick={() => setLocation(`/campaigns/${campaign.id}`)} className="text-left"><span className="block truncate text-[12px] font-semibold text-[#26364a] hover:text-[#245b9b]">{campaign.name}</span><span className="mt-1 block truncate text-[11px] text-[#7c8794]">{campaign.subject}</span></button></td>
        <td className="px-4 py-4"><span className="block text-[11px] font-medium text-[#536172]">{(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).map(listId => lists.find(list => list.id === listId)?.name || 'Removed list').join(' · ') || 'No target lists selected'}</span><span className="mt-1 block text-[10px] text-[#8a95a1]">{campaign.recipients.toLocaleString()} {campaign.status === 'draft' ? 'eligible' : 'total'} recipients</span><span className="mt-0.5 block text-[10px] text-[#8a95a1]">Estimated send: {formatDeliveryDuration(campaign.estimatedDurationSeconds)}</span></td>
         <td className="px-4 py-4"><Status tone={statusTone(campaign.status)}>{campaign.status === 'queued' && campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() ? 'scheduled' : campaign.status}</Status></td>
          <td className="px-4 py-4"><div className="flex items-center gap-2 text-[11px]"><span className="font-semibold text-[#397050]">{campaign.delivered.toLocaleString()} accepted</span><span className="text-[#c1c7cd]">/</span><span className="text-[#a85f2a]">{campaign.bounced.toLocaleString()} rejected / failed</span></div><div className="mt-1 text-[10px] text-[#8a95a1]">SMTP acceptance does not confirm inbox delivery · {campaign.suppressed.toLocaleString()} suppressed · {campaign.unknown.toLocaleString()} unknown · {campaign.queued.toLocaleString()} queued</div></td>
         <td className="px-4 py-4 text-[10px] leading-5 text-[#7b8794]">{campaign.queuedAt ? <><span className="block">{campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() ? 'Starts' : 'Queued'} {formatDate(campaign.scheduledAt || campaign.queuedAt)}</span>{campaign.scheduledAt && <span className="block">Queued {formatDate(campaign.queuedAt)}</span>}{campaign.completedAt && <span className="block">Finished {formatDate(campaign.completedAt)}</span>}</> : 'Not queued'}</td>
          <td className="px-5 py-4"><div className="flex justify-end gap-1">{campaign.status === 'draft' && <><Button variant="quiet" testId={`button-edit-campaign-${campaign.id}`} onClick={() => openEdit(campaign)}><Edit3 className="h-3.5 w-3.5"/>Edit</Button><Button testId={`button-queue-campaign-${campaign.id}`} onClick={() => queue(campaign)} disabled={send.isPending || !(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).length || !(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).every(id => lists.some(list => list.id === id && list.active))}><Send className="h-3.5 w-3.5"/>Queue</Button><Button variant="quiet" testId={`button-delete-campaign-${campaign.id}`} disabled={remove.isPending} onClick={() => del(campaign)}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete</Button></>}</div></td>
      </tr>)}</tbody></table></div>
    </section> : <EmptyState title="No campaigns yet" detail={activeLists.length ? 'Create a draft to prepare a message for an active list. Delivery counts will appear here after queueing.' : 'Create and activate a list first. Campaigns are always tied to an audience in this workspace.'} action={activeLists.length ? <Button testId="button-empty-create-campaign" onClick={openNew}><CirclePlus className="h-4 w-4"/>Create campaign</Button> : undefined}/>}
    {editing !== undefined && <Modal wide title={editing ? 'Edit campaign draft' : 'New campaign draft'} subtitle="Only draft campaigns can be edited. Each selected list is processed in the order shown; overlapping addresses receive one email." close={() => setEditing(undefined)}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <Field label="Internal campaign name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="April product notes" required testId="input-campaign-name"/>
            <label className="block min-w-0">
              <span className={labelClass}>SMTP sender account</span>
              <select data-testid="select-campaign-sender-account" className={inputClass} value={form.senderAccountId} onChange={event => setForm(current => ({ ...current, senderAccountId: event.target.value }))} disabled={senderAccountsQuery.isLoading}>
                <option value="">Use the default account</option>
                {senderAccounts.map(account => <option key={account.id} value={account.id}>{account.fromEmail}{account.isPrimary ? ' · default' : ''}{account.verified ? '' : ' · not verified'}</option>)}
              </select>
              <span className="mt-1 block text-[10px] leading-4 text-[#808a97]">{senderAccounts.length ? 'The chosen account sends this campaign. The default account is used when no account is selected.' : 'No SMTP account is configured. Add and verify one in Email Setup before queueing this campaign.'}</span>
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>Campaign objective</span>
              <textarea data-testid="input-campaign-objective" rows={3} maxLength={500} value={form.objective} onChange={event => setForm(current => ({ ...current, objective: event.target.value }))} placeholder="What should this campaign achieve?" className="w-full resize-y rounded-md border border-[#d8dde4] bg-white px-3 py-2 text-[12px] leading-5 text-[#182333] outline-none placeholder:text-[#a0a8b3] focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"/>
              <span className="mt-1 block text-[10px] leading-4 text-[#808a97]">Internal note only; it won’t be included in the email. {form.objective.length}/500</span>
            </label>
          </div>
          <fieldset className="min-w-0">
            <legend className={labelClass}>Target lists</legend>
            <div className="overflow-hidden rounded-md border border-[#d8dde4] bg-white">
              <div className="border-b border-[#e9edf0] bg-[#fbfcfd] p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-[#e0e4e9] bg-white p-0.5">
                    <button type="button" data-testid="button-campaign-lists-all" aria-pressed={!showSelectedCampaignLists} onClick={() => setShowSelectedCampaignLists(false)} className={cx('rounded px-2 py-1 text-[10px] font-semibold transition', !showSelectedCampaignLists ? 'bg-[#edf4fc] text-[#245b9b]' : 'text-[#66717e] hover:bg-[#f6f8fa]')}>All <span className="font-normal opacity-75">{lists.length}</span></button>
                    <button type="button" data-testid="button-campaign-lists-selected" aria-pressed={showSelectedCampaignLists} onClick={() => setShowSelectedCampaignLists(true)} className={cx('rounded px-2 py-1 text-[10px] font-semibold transition', showSelectedCampaignLists ? 'bg-[#edf4fc] text-[#245b9b]' : 'text-[#66717e] hover:bg-[#f6f8fa]')}>Selected <span className="font-normal opacity-75">{form.listIds.length}</span></button>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium text-[#687484]">{form.listIds.length} selected</span>
                </div>
                <label className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8993a0]"/>
                  <input data-testid="input-campaign-list-search" type="search" value={campaignListSearch} onChange={event => setCampaignListSearch(event.target.value)} placeholder="Search lists by name" aria-label="Search campaign lists" className="h-9 w-full rounded-md border border-[#d8dde4] bg-white pl-8 pr-3 text-[11px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]"/>
                </label>
                <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
                  <span className="text-[10px] text-[#808a97]">{filteredCampaignLists.length} of {lists.length} lists</span>
                  <div className="flex items-center gap-1">
                    {campaignListSearch.trim() && !showSelectedCampaignLists && <button type="button" data-testid="button-add-matching-campaign-lists" onClick={addMatchingCampaignLists} disabled={!matchingCampaignListsToAdd.length} className="rounded px-1.5 py-1 text-[10px] font-semibold text-[#245b9b] hover:bg-[#edf4fc] disabled:cursor-not-allowed disabled:text-[#a0a8b3]">Add {matchingCampaignListsToAdd.length} matches</button>}
                    {form.listIds.length > 0 && <button type="button" data-testid="button-clear-campaign-lists" onClick={clearCampaignLists} className="rounded px-1.5 py-1 text-[10px] font-semibold text-[#687484] hover:bg-[#eef1f4]">Clear all</button>}
                  </div>
                </div>
              </div>
              <div data-testid="campaign-list-picker" className="max-h-40 space-y-0.5 overflow-y-auto p-1.5">
                {filteredCampaignLists.map(list => {
                  const checked = form.listIds.includes(list.id);
                  return <label key={list.id} className={cx('flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[11px] hover:bg-[#f5f8fb]', !list.active && !checked && 'cursor-not-allowed opacity-60')}>
                    <input data-testid={`checkbox-campaign-list-${list.id}`} type="checkbox" checked={checked} disabled={!list.active && !checked} onChange={event => toggleCampaignList(list.id, event.target.checked)} className="h-4 w-4 accent-[#245b9b]"/>
                    <span className="min-w-0 flex-1 truncate font-medium text-[#344154]">{list.name}</span>
                    <span className="shrink-0 text-[10px] text-[#8993a0]">{list.contactCount} contacts</span>
                    {!list.active && <Status tone="gray">inactive</Status>}
                  </label>;
                })}
                {form.listIds.filter(listId => !lists.some(list => list.id === listId)).map(listId => <div key={listId} className="flex items-center justify-between gap-2 rounded bg-[#fff8ef] px-2 py-2 text-[11px] text-[#895b2f]">
                  <span>Removed list is still selected.</span>
                  <Button variant="quiet" testId={`button-remove-removed-campaign-list-${listId}`} onClick={() => toggleCampaignList(listId, false)}>Remove</Button>
                </div>)}
                {!lists.length && <p className="px-2 py-2 text-[11px] text-[#788392]">Create a contact list before preparing a campaign.</p>}
                {lists.length > 0 && !filteredCampaignLists.length && <p className="px-2 py-3 text-center text-[11px] text-[#788392]">{showSelectedCampaignLists ? 'No selected lists match this search.' : 'No lists match this search.'}</p>}
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-[#808a97]">Choose one or more lists. Inactive lists can’t be newly selected or queued.</p>
          </fieldset>
        </div>
        <section className="rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-3" aria-label="Campaign list processing order">
          <div><h3 className="text-[11px] font-semibold text-[#344154]">Processing order</h3><p className="mt-1 text-[10px] leading-4 text-[#788392]">If an email address appears in more than one list, the first list containing it determines the entry used. That address still receives only one email.</p></div>
          {form.listIds.length ? <ol data-testid="campaign-list-order" className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
            {form.listIds.map((listId, index) => {
              const list = lists.find(item => item.id === listId);
              const label = list?.name || 'Removed list';
              return <li key={`${listId}-${index}`} className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-[#e5e9ee] bg-white px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-[#344154]"><span className="mono shrink-0 text-[10px] text-[#8a95a1]">{index + 1}</span><span className="truncate">{label}</span>{index === 0 && <span className="shrink-0"><Status tone="blue">first priority</Status></span>}{list && !list.active && <span className="shrink-0"><Status tone="gray">inactive</Status></span>}</span>
                <span className="flex shrink-0 gap-0.5">
                  <Button variant="quiet" testId={`button-campaign-list-up-${listId}`} onClick={() => moveCampaignList(index, -1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5"/>Earlier</Button>
                  <Button variant="quiet" testId={`button-campaign-list-down-${listId}`} onClick={() => moveCampaignList(index, 1)} disabled={index === form.listIds.length - 1}><ArrowDown className="h-3.5 w-3.5"/>Later</Button>
                </span>
              </li>;
            })}
          </ol> : <p className="mt-2 text-[11px] text-[#8a5a31]">Select at least one list. You can change the order here.</p>}
        </section>
        {form.listIds.length > 0 && <div data-testid="campaign-audience-summary" className={cx('flex items-start gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-5', campaignAudienceQuery.isError ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : campaignAudienceQuery.data?.overlappingRecipients ? 'border-[#efd9bd] bg-[#fff8ef] text-[#895b2f]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]')}>
          {campaignAudienceQuery.isError ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/> : <Users className="mt-0.5 h-4 w-4 shrink-0"/>}
          <div className="min-w-0 flex-1">
            {campaignAudienceQuery.isFetching && <p>Checking subscribed contacts and list overlap…</p>}
            {!campaignAudienceQuery.isFetching && campaignAudienceQuery.isError && <p role="alert">We couldn’t verify the audience. Retry before saving or queueing this campaign.</p>}
            {!campaignAudienceQuery.isFetching && !campaignAudienceQuery.isError && campaignAudienceQuery.data && <>
              <p><strong>{campaignAudienceQuery.data.uniqueRecipients.toLocaleString()} unique subscribed email addresses</strong> across the selected lists.</p>
              {campaignAudienceQuery.data.overlappingRecipients > 0
                ? <p><strong>{campaignAudienceQuery.data.overlappingRecipients.toLocaleString()} addresses appear in multiple selected lists.</strong> Each address will receive one email only; the first matching list in the order above takes priority.</p>
                : <p>No subscribed email addresses currently overlap. If a contact is added to multiple lists before sending, they will still receive one email only.</p>}
            </>}
          </div>
          <Button
            variant="quiet"
            testId="button-refresh-campaign-audience"
            disabled={campaignAudienceQuery.isFetching || audienceActionPending}
            onClick={() => void campaignAudienceQuery.refetch()}
          >
            {campaignAudienceQuery.isFetching && <LoaderCircle className="h-3.5 w-3.5 animate-spin"/>}
            {campaignAudienceQuery.isError ? 'Retry audience' : 'Refresh audience'}
          </Button>
        </div>}
         <label className="block"><span className={labelClass}>Email subject</span><input ref={subjectInputRef} data-testid="input-campaign-subject" className={inputClass} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="A concise subject your audience will recognize" required maxLength={200}/></label>
         <div className="-mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[10px] text-[#7e8996]">Insert a subject field:</span>{CONTACT_PLACEHOLDERS.map(({ token, label }) => <button key={token} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertSubjectPlaceholder(token)} className="rounded border border-[#dce4ec] bg-white px-2 py-1 text-[10px] font-medium text-[#365a7e] hover:border-[#9abbe1] hover:bg-[#f1f7fd]" data-testid={`button-insert-subject-placeholder-${token.slice(2, -2)}`} title={`Insert ${token}`}>{label}</button>)}</div>
         <label className="block"><span className={labelClass}>Formatted message</span><RichTextEditor value={form.htmlBody} onChange={(htmlBody, textBody) => setForm(current => ({ ...current, htmlBody, textBody }))}/><span className="mt-1.5 block text-[11px] leading-relaxed text-[#808a97]">Formatting is preserved in the HTML message submitted to your SMTP provider. A plain-text fallback is included.</span></label>
         <section className="space-y-3 rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-4" aria-label="Personalized email preview">
            <div><h3 className="text-[12px] font-semibold text-[#344154]">Preview for a contact</h3><p className="mt-1 text-[11px] text-[#788392]">Preview the current unsaved subject and message using a subscribed contact in any selected list.</p></div>
           <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
               <label className="min-w-0 flex-1"><span className={labelClass}>Sample contact</span><select data-testid="select-campaign-preview-contact" className={inputClass} value={sampleContactId} onChange={e => setSampleContactId(e.target.value)} disabled={!form.listIds.length || contactsQuery.isLoading}>
               <option value="">{contactsQuery.isLoading ? 'Loading contacts…' : 'Choose a subscribed contact'}</option>
               {eligibleSampleContacts.map(contact => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email} · {contact.email}</option>)}
             </select></label>
             <Button variant="outline" testId="button-preview-campaign" onClick={requestPreview} disabled={!sampleContactId || previewCampaign.isPending}>
               {previewCampaign.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}Preview email
             </Button>
           </div>
           {contactsQuery.isError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>We couldn’t load contacts for the preview.</span><Button variant="outline" testId="button-retry-preview-contacts" onClick={() => void contactsQuery.refetch()}>Retry</Button></div>}
            {!contactsQuery.isLoading && !contactsQuery.isError && form.listIds.length > 0 && eligibleSampleContacts.length === 0 && <p className="text-[11px] text-[#8a5a31]">These lists have no subscribed contacts available to preview.</p>}
            {(contactsQuery.data?.total ?? 0) > eligibleSampleContacts.length && <p className="text-[10px] text-[#788392]">Showing the first {eligibleSampleContacts.length} of {contactsQuery.data?.total.toLocaleString()} matching contacts. Select fewer lists to narrow the sample choices.</p>}
           {visiblePreviewError && <p role="alert" className="text-[11px] text-[#99501e]">{visiblePreviewError}</p>}
           {visiblePreview && <div data-testid="panel-campaign-preview" className="space-y-4 rounded-md border border-[#e2e7ed] bg-white p-4">
             <div><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Resolved subject</div><p data-testid="text-campaign-preview-subject" className="mt-1 break-words text-[13px] font-semibold text-[#29384a]">{visiblePreview.subject}</p></div>
             <div><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Formatted HTML</div>{visiblePreview.htmlBody !== null ? <div data-testid="html-campaign-preview" className="campaign-message-preview mt-2 rounded-md bg-[#f8fafb] p-4 text-[12px] leading-6 text-[#566476] [&_a]:text-[#245b9b] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[#9abbe1] [&_blockquote]:pl-3 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-2 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-bold [&_u]:underline [&_ul]:my-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: visiblePreview.htmlBody }}/> : <p className="mt-2 text-[11px] text-[#84909d]">No formatted HTML message.</p>}</div>
             <div><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Plain-text fallback</div><pre data-testid="text-campaign-preview-fallback" className="mt-2 whitespace-pre-wrap break-words rounded-md bg-[#f8fafb] p-4 font-sans text-[12px] leading-6 text-[#566476]">{visiblePreview.textBody}</pre></div>
           </div>}
         </section>
         <div className="flex items-center gap-2 rounded-md bg-[#f5f8fb] px-3 py-2.5 text-[11px] text-[#607186]"><Users className="h-4 w-4 shrink-0 text-[#245b9b]"/>Only subscribed contacts are eligible. Duplicate email addresses are removed when the campaign is queued.</div>
         <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="outline" testId="button-cancel-campaign" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" testId="button-submit-campaign" disabled={create.isPending || update.isPending || audienceActionPending || !form.listIds.length || !audienceCheckReady || (!editing && !activeLists.length)}>{(create.isPending || update.isPending || audienceActionPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{audienceActionPending ? 'Checking audience…' : editing ? 'Save draft' : 'Create draft'}</Button></div>
      </form>
    </Modal>}
     <ConfirmActionDialog
       open={Boolean(pendingAction)}
       title={pendingAction?.kind === 'queue' ? 'Queue this campaign?' : 'Delete this draft?'}
       description={pendingAction?.kind === 'queue'
           ? `Choose when “${pendingAction.campaign.name}” should start sending to ${campaignAudienceQuery.data?.uniqueRecipients.toLocaleString() ?? pendingAction.campaign.recipients.toLocaleString()} unique email addresses.`
         : pendingAction ? `Permanently delete the draft “${pendingAction.campaign.name}”? This cannot be undone.` : ''}
       confirmLabel={pendingAction?.kind === 'queue' ? 'Queue campaign' : 'Delete draft'}
       destructive={pendingAction?.kind !== 'queue'}
       pending={audienceActionPending || send.isPending || remove.isPending}
         confirmDisabled={pendingAction?.kind === 'queue' && (!queueStartIsValid || !audienceCheckReady)}
       onOpenChange={open => { if (!open && !send.isPending && !remove.isPending) setPendingAction(null); }}
       onConfirm={confirmCampaignAction}
       testId="dialog-campaign-action"
      >
        {pendingAction?.kind === 'queue' && <div className="mt-4 space-y-3">
           {campaignAudienceQuery.isFetching && <p className="text-[11px] text-[#788392]">Refreshing the recipient and overlap counts…</p>}
           {campaignAudienceQuery.isError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]"><span>We couldn’t verify the current audience. Retry before queueing.</span><Button variant="outline" testId="button-retry-queue-audience" onClick={() => void campaignAudienceQuery.refetch()}>Retry</Button></div>}
           {audienceCheckReady && campaignAudienceQuery.data && <div data-testid="queue-audience-summary" className={cx('rounded-md border px-3 py-2.5 text-[11px] leading-5', campaignAudienceQuery.data.overlappingRecipients ? 'border-[#efd9bd] bg-[#fff8ef] text-[#895b2f]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]')}>
             <p><strong>{campaignAudienceQuery.data.uniqueRecipients.toLocaleString()} unique subscribed email addresses</strong> will be queued.</p>
             {campaignAudienceQuery.data.overlappingRecipients > 0
               ? <p><strong>{campaignAudienceQuery.data.overlappingRecipients.toLocaleString()} addresses are on more than one selected list.</strong> Each gets one email only; the first matching list in the saved order takes priority.</p>
               : <p>No subscribed addresses currently overlap. Duplicate addresses are still deduplicated when the recipient queue is created.</p>}
           </div>}
          <label className="block">
            <span className={labelClass}>Start date and time (your local time)</span>
            <input data-testid="input-campaign-start-at" type="datetime-local" min={queueMinimumStartAtInput} value={queueStartAt} onChange={event => { setQueueStartAt(event.target.value); setQueueStartError(null); }} className={inputClass} required />
          </label>
          {hasActiveCampaigns && <div className="rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2.5 text-[11px] leading-5 text-[#895b2f]">
            Existing campaign delivery is queued or in progress. This campaign cannot start before <strong>{formatDate(queueMinimumStartAt.toISOString())}</strong>. The finish time is an estimate and can change.
          </div>}
          {!hasActiveCampaigns && <p className="text-[11px] leading-5 text-[#788392]">Choose a future time. The time is interpreted in your device’s time zone.</p>}
          {queueStartError && <div role="alert" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">{queueStartError}</div>}
        </div>}
      </ConfirmActionDialog>
  </></QueryState>;
}

function formatDeliveryDuration(seconds: number) {
  if (seconds <= 0) return 'Under a minute';
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} day ${remainingHours} hr` : `${days} day`;
}

export function CampaignDashboardPage({ campaignId }: { campaignId: string }) {
  const [, setLocation] = useLocation();
  const query = useGetCampaignDashboard(campaignId, {
    query: {
      queryKey: getGetCampaignDashboardQueryKey(campaignId),
      refetchInterval: 10_000,
    },
  });
  const dashboard = query.data as CampaignDashboard | undefined;

  return <QueryState loading={query.isLoading} error={query.isError} retry={() => { void query.refetch(); }} label="campaign dashboard">
    {dashboard && (() => {
      const { campaign, targetLists, pacing } = dashboard;
      const removedTargetListCount = Math.max(0, campaign.listIds.length - targetLists.length);
      const resolved = campaign.delivered + campaign.bounced + campaign.suppressed + campaign.unknown;
      const progress = campaign.recipients > 0 ? Math.min(100, Math.round((resolved / campaign.recipients) * 100)) : 0;
      const statusTone = campaign.status === 'completed' ? 'green' : campaign.status === 'queued' || campaign.status === 'sending' ? 'blue' : 'gray';
      const isScheduled = campaign.status === 'queued' && campaign.scheduledAt !== null && new Date(campaign.scheduledAt).getTime() > Date.now();
      const metrics = [
        { label: 'Total emails', value: campaign.recipients, detail: campaign.status === 'draft' ? 'Unique eligible addresses across selected lists' : 'Captured when queued', surface: { backgroundColor: '#eef5ff', borderColor: '#d7e4f3' } },
        { label: 'SMTP accepted', value: campaign.delivered, detail: 'Inbox delivery is not confirmed', surface: { backgroundColor: '#eff8f1', borderColor: '#d5ead9' } },
        { label: 'Rejected / failed', value: campaign.bounced, detail: 'SMTP rejection or terminal send failure', surface: { backgroundColor: '#fff5eb', borderColor: '#f0dfcb' } },
        { label: 'Suppressed', value: campaign.suppressed, detail: 'Unsubscribed or removed', surface: { backgroundColor: '#f3f5f8', borderColor: '#dfe4e9' } },
        { label: 'Still queued', value: pacing.remainingEmails, detail: campaign.status === 'draft' ? 'Will be queued when sent' : 'Waiting for paced delivery', surface: { backgroundColor: '#f3f0fc', borderColor: '#e1dcf4' } },
      ];

      return <>
        <div className="mb-5">
          <Button variant="outline" testId="button-back-to-campaigns" onClick={() => setLocation('/campaigns')}><ArrowLeft className="h-4 w-4"/>Back to campaigns</Button>
        </div>
        <Heading eyebrow="DELIVERY / CAMPAIGNS / DASHBOARD" title={campaign.name} detail={campaign.subject} action={<Status tone={statusTone}>{isScheduled ? 'scheduled' : campaign.status}</Status>}/>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(metric => <div key={metric.label} className={`${panelClass} p-4`} style={metric.surface}>
            <div className="text-[11px] text-[#778291]">{metric.label}</div>
            <div className="display mt-2 text-[25px] font-bold text-[#192638]">{metric.value.toLocaleString()}</div>
            <div className="mt-1 text-[10px] text-[#8a95a1]">{metric.detail}</div>
          </div>)}
        </div>

        <div className="mb-5 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <section className={`${panelClass} p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Delivery pacing</h2><p className="mt-1 text-[11px] text-[#788392]">Based on the workspace limits set by the superadmin.</p></div>
              <Clock3 className="h-5 w-5 text-[#245b9b]"/>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-[#f5f8fb] p-3"><div className="text-[10px] uppercase tracking-wide text-[#7a8795]">Estimated time remaining</div><div className="mt-1 text-[20px] font-bold text-[#26364a]">{formatDeliveryDuration(pacing.estimatedDurationSeconds)}</div></div>
              <div className="rounded-md bg-[#f5f8fb] p-3"><div className="text-[10px] uppercase tracking-wide text-[#7a8795]">Estimated finish</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{campaign.status === 'completed' ? formatDate(campaign.completedAt) : pacing.estimatedCompletionAt ? formatDate(pacing.estimatedCompletionAt) : 'No emails waiting'}</div></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div><div className="text-[10px] text-[#85909d]">Hourly cap</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">{pacing.emailsPerHour.toLocaleString()} emails/hour</div></div>
              <div><div className="text-[10px] text-[#85909d]">Daily cap</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">{pacing.emailsPerDay.toLocaleString()} emails/day</div></div>
              <div><div className="text-[10px] text-[#85909d]">Minimum spacing</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">One email every {formatDeliveryDuration(pacing.minimumSpacingSeconds)}</div></div>
            </div>
            {campaign.status === 'draft' && pacing.remainingEmails > pacing.maxCampaignSize && <div className="mt-4 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2 text-[11px] leading-5 text-[#895b2f]"><AlertCircle className="mr-2 inline h-4 w-4"/>This audience exceeds the current maximum campaign size of {pacing.maxCampaignSize.toLocaleString()} emails, so it cannot be queued yet.</div>}
            <p className="mt-4 border-t border-[#edf0f2] pt-3 text-[10px] leading-5 text-[#8993a0]">This estimate includes recipients already queued ahead of this campaign and the shared hourly and daily limits. SMTP response time and retries are uncertain, so actual finish times may differ.</p>
          </section>

          <section className={`${panelClass} p-5`}>
            <h2 className="display text-[17px] font-bold text-[#1b293a]">Target lists</h2>
            {targetLists.length ? <div className="mt-3 space-y-3">
              {targetLists.map((targetList, index) => <div key={targetList.id} data-testid={`campaign-target-list-${targetList.id}`} className="rounded-md border border-[#e7ebef] p-3">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#647183]"><span className="mono text-[10px] text-[#8993a0]">{index + 1}.</span><Users className="h-4 w-4 text-[#245b9b]"/><span className="font-medium text-[#344154]">{targetList.name}</span><Status tone={targetList.active ? 'green' : 'gray'}>{targetList.active ? 'active' : 'inactive'}</Status></div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[['All contacts', targetList.totalContacts], ['Eligible', targetList.eligibleContacts], ['Unsubscribed', targetList.unsubscribedContacts]].map(([label, value]) => <div key={label} className="rounded-md bg-[#f7f9fb] p-2.5"><div className="text-[10px] text-[#7a8795]">{label}</div><div className="mt-1 text-[15px] font-bold text-[#26364a]">{Number(value).toLocaleString()}</div></div>)}
                </div>
              </div>)}
              {removedTargetListCount > 0 && <p role="status" className="text-[11px] text-[#895b2f]">{removedTargetListCount} selected {removedTargetListCount === 1 ? 'list is' : 'lists are'} no longer available.</p>}
              <p className="text-[10px] leading-5 text-[#8993a0]">Only subscribed contacts are eligible. The total is deduplicated across lists and fixed when the draft is queued.</p>
            </div> : <p className="mt-3 text-[12px] text-[#7b8794]">{campaign.listIds.length ? 'The campaign’s selected lists have been removed.' : 'No target lists are selected.'}</p>}
          </section>
        </div>

        <section className={`${panelClass} mb-5 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-[#e9edf0] px-5 py-4"><div><h2 className="display text-[17px] font-bold text-[#1b293a]">Delivery progress</h2><p className="mt-1 text-[11px] text-[#788392]">{resolved.toLocaleString()} of {campaign.recipients.toLocaleString()} recipients resolved</p></div><span className="mono text-[11px] text-[#647183]">{progress}%</span></div>
          <div className="px-5 py-4"><div className="h-2 overflow-hidden rounded-full bg-[#edf0f2]"><div className="h-full rounded-full bg-[#397050] transition-all" style={{ width: `${progress}%` }}/></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[['SMTP accepted', campaign.delivered, '#397050'], ['Rejected / failed', campaign.bounced, '#ae642c'], ['Suppressed', campaign.suppressed, '#66717e'], ['Outcome unknown', campaign.unknown, '#8a65a2']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between text-[11px]"><span className="text-[#778291]">{label}</span><span className="font-semibold" style={{ color: String(color) }}>{Number(value).toLocaleString()}</span></div>)}
            </div>
          </div>
        </section>

        <DeliveryEvidenceSection campaignId={campaignId} active={campaign.status === 'queued' || campaign.status === 'sending'}/>

        <section className={`${panelClass} p-5`}>
          <h2 className="display text-[17px] font-bold text-[#1b293a]">Campaign message</h2>
          {campaign.objective?.trim() && <div className="mt-4 rounded-md border border-[#dbe5ef] bg-[#f6f9fc] p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#718197]">Campaign objective · internal</div><p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#425368]">{campaign.objective}</p></div>}
          <div className="mt-4 border-b border-[#edf0f2] pb-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Sender email</div><p data-testid={`text-campaign-sender-email-${campaign.id}`} className="mt-1 break-all text-[13px] font-semibold text-[#29384a]">{campaign.senderEmail ?? (campaign.status === 'draft' ? 'No sender account selected' : 'Unavailable for this campaign')}</p></div>
          <div className="mt-4 border-b border-[#edf0f2] pb-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Subject</div><p className="mt-1 text-[13px] font-semibold text-[#29384a]">{campaign.subject}</p></div>
           <div className="pt-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">{campaign.htmlBody ? 'Formatted message' : 'Plain-text message'}</div>{campaign.htmlBody ? <div className="campaign-message-preview mt-2 rounded-md bg-[#f8fafb] p-4 text-[12px] leading-6 text-[#566476] [&_a]:text-[#245b9b] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[#9abbe1] [&_blockquote]:pl-3 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-2 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-bold [&_u]:underline [&_ul]:my-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: campaign.htmlBody }}/> : <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-6 text-[#566476]">{campaign.textBody}</pre>}</div>
           <div className="mt-5 flex flex-wrap gap-5 border-t border-[#edf0f2] pt-4 text-[10px] text-[#7c8794]"><span>Created: {formatDate(campaign.createdAt)}</span><span>Queued: {formatDate(campaign.queuedAt)}</span><span>Scheduled start: {formatDate(campaign.scheduledAt)}</span><span>Completed: {formatDate(campaign.completedAt)}</span></div>
        </section>
      </>;
    })()}
  </QueryState>;
}
