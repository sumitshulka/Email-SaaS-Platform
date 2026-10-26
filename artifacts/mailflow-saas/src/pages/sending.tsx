import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight, CirclePlus, Clock3,
  Download, Edit3, Fingerprint, Linkedin, LoaderCircle, Upload, Mail, MoreHorizontal, Paperclip, Search, Send, Pause, Play,
  ShieldCheck, Trash2, Users, X, BookmarkPlus, Sparkles, RefreshCw,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CONTACT_PLACEHOLDERS, plainTextToHtml } from '@/components/campaign-placeholders';
import { ContactReportEvidence, DeliveryCapabilityNotes, DeliveryEvidenceSection, Microsoft365TraceSettingsPanel } from '@/components/delivery-evidence';
import { RichTextEditor } from '@/components/rich-text-editor';
import {
  exportContacts, getGetCampaignDashboardQueryKey, getGetCampaignHistoryQueryKey, getGetCampaignRecipientSummaryQueryKey, getGetContactFilterOptionsQueryKey, getGetCampaignAttachmentAvailabilityQueryKey, getGetSubscriptionAddOnsQueryKey, getGetTenantSendingSettingsQueryKey, getGetUserDashboardQueryKey, getListCampaignRepliesQueryKey, getListCampaignsQueryKey, getListContactListsQueryKey, getListTenantSendingAccountsQueryKey,
  getGetGmailMailboxConnectionQueryKey, useDisconnectGmailMailbox, useRescheduleCampaign, useCancelPausedCampaign,
  useGetGmailMailboxConnection, useRescanRecentGmailMessages, useStartGmailMailboxConnection,
  useSyncGmailMailboxNow, useCheckSenderMailbox,
  getListContactOptionsQueryKey, getListContactsQueryKey, getListContactSegmentsQueryKey, useCreateCampaign, useCreateCampaignFollowUp, useCreateContact, useCreateContactList, useCreateContactSegment, useListCompanies,
  useDeleteCampaign, useDeleteContact, useDeleteContactList, useDeleteContactSegment, useGenerateCampaignEmailDraft, useGetCampaignDashboard, useGetCampaignRecipientSummary, useGetCampaignVariantLimits, useGetSubscriptionAddOns, useListCampaignReplies, useSetCampaignPaused,
  useGetCampaignHistory, useGetContactEmailHistory, useGetContactFilterOptions, useGetCampaignAttachmentAvailability, useListCampaigns, useListContactLists, useListContactOptions, useListContacts, useListTenantSendingAccounts, usePreviewCampaign, useSendCampaign,
  useCreateTenantSendingAccount, useDeleteTenantSendingAccount, useSetPrimaryTenantSendingAccount, useUpdateTenantSendingAccount,
  useListContactSegments, useTestTenantSendingConnection, useTestTenantSendingSettings, useUpdateCampaign, useUpdateContact, useUpdateContactSegment, useVerifyContactEmail,
  useUpdateContactList,
} from '@workspace/api-client-react';
import type {
  CampaignDashboard, CampaignSummary, CampaignTemplatePreview, Contact, ContactDirectoryItem, ContactEmailHistoryItem, ContactEmailVerification, ContactList, ContactOption,
  ContactAudienceSegment, ContactExportInput, TenantSendingAccount, TenantSendingSettingsInput, CampaignVariantLimits,
  CampaignHistory, GetCampaignHistoryParams, GmailRecentRescanInput, GmailRecentRescanResult, GmailSyncDiagnosticsOutcome,
  GmailMailboxSyncNowResult,
  SenderInboxCheckResult, UserDashboard,
  ListContactsQueryResult,
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
function Button({ children, onClick, variant = 'primary', disabled, type = 'button', testId, className = '', ariaLabel, title }: { children: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; variant?: 'primary' | 'outline' | 'quiet' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; testId: string; className?: string; ariaLabel?: string; title?: string }) {
  const styles = variant === 'primary' ? primaryButton : variant === 'danger'
    ? 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#edc5a7] bg-white px-3.5 text-[13px] font-semibold text-[#b85b20] hover:bg-[#fff7f0] disabled:opacity-55'
    : variant === 'quiet' ? 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-[12px] font-semibold text-[#596474] hover:bg-[#f4f6f8]'
    : outlineButton;
  return <button type={type} data-testid={testId} onClick={onClick} disabled={disabled} aria-label={ariaLabel} title={title} className={cx(styles, className)}>{children}</button>;
}
function CampaignActionIcon({ label, icon, onClick, testId, disabled = false, danger = false }: { label: string; icon: ReactNode; onClick: () => void; testId: string; disabled?: boolean; danger?: boolean }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'inline-flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7ba3d0] disabled:cursor-not-allowed disabled:opacity-45',
          danger ? 'text-[#b85b20] hover:bg-[#fff3e8]' : 'text-[#596a7d] hover:bg-[#edf3f8] hover:text-[#245b9b]',
        )}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>;
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
function ContactEmailIcon({ status, hasRiskWarnings = false }: { status: ContactEmailVerification['status'] | null; hasRiskWarnings?: boolean }) {
  return <span className="relative inline-flex" aria-hidden="true">
    <Mail className="h-4 w-4"/>
    {status === 'accepted' && !hasRiskWarnings && <Check className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border border-white bg-white text-[#26834a]"/>}
    {(status === 'rejected' || status === 'no_mail_server') && <X className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border border-white bg-white text-[#c34343]"/>}
    {(status === 'catch_all' || status === 'inconclusive' || hasRiskWarnings) && <AlertCircle className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border border-white bg-white text-[#d47a19]"/>}
  </span>;
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

function gmailSyncOutcomeTitle(outcome: GmailSyncDiagnosticsOutcome) {
  switch (outcome) {
    case 'no_dsn_found': return 'No delivery-status notices found';
    case 'already_recorded': return 'Notices were already recorded';
    case 'parser_warning': return 'A notice was found but could not be fully read';
    case 'unmatched_reports': return 'A report could not be matched to a campaign';
    case 'gmail_api_error': return 'Gmail could not finish the sync';
    case 'history_expired': return 'Gmail history expired';
    case 'reauthorization_required': return 'Reconnect Gmail to resume syncing';
    case 'sync_error': return 'The sync could not be completed';
    default: return 'Gmail sync completed';
  }
}
const blankSettings = {
  provider: 'other' as TenantSendingSettingsInput['provider'],
  host: '', port: '587', encryption: 'tls' as TenantSendingSettingsInput['encryption'],
  username: '', password: '', fromName: '', fromEmail: '', replyTo: '',
};
const smtpProviderPresets: Partial<Record<
  TenantSendingSettingsInput['provider'],
  { host: string; port: string; encryption: TenantSendingSettingsInput['encryption'] }
>> = {
  google_workspace: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  gmail: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  microsoft_365: { host: 'smtp.office365.com', port: '587', encryption: 'tls' },
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
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const gmailSyncOverdue = Boolean(
    gmailConnection.data?.connected &&
    gmailConnection.data.syncStatus === 'connected' &&
    gmailConnection.data.nextSyncAt &&
    Date.parse(gmailConnection.data.nextSyncAt) < Date.now(),
  );
  const startGmailConnection = useStartGmailMailboxConnection();
  const disconnectGmailConnection = useDisconnectGmailMailbox();
  const recentGmailRescan = useRescanRecentGmailMessages();
  const immediateGmailSync = useSyncGmailMailboxNow();
  const checkSenderMailbox = useCheckSenderMailbox();
  const qc = useQueryClient();
  const { notice, setNotice, dismiss } = useNotice();
  const [recentRescanResult, setRecentRescanResult] = useState<GmailRecentRescanResult | null>(null);
  const [recentRescanError, setRecentRescanError] = useState<string | null>(null);
  const [recentRescanWindowDays, setRecentRescanWindowDays] = useState<GmailRecentRescanInput['windowDays']>(14);
  const [gmailSyncNowResult, setGmailSyncNowResult] = useState<GmailMailboxSyncNowResult | null>(null);
  const [imapHost, setImapHost] = useState('');
  const [inboxCheckResult, setInboxCheckResult] = useState<SenderInboxCheckResult | null>(null);
  const [inboxCheckError, setInboxCheckError] = useState<string | null>(null);
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
    const requestedAccountId = new URLSearchParams(window.location.search).get('accountId');
    const initial = accounts.find(account => account.id === requestedAccountId) ?? accounts.find(account => account.isPrimary) ?? accounts[0];
    setSelectedAccountId(initial?.id ?? '');
    setForm(formForAccount(initial));
    setImapHost(initial?.provider === 'microsoft_365' ? 'outlook.office365.com' : initial?.provider === 'gmail' || initial?.provider === 'google_workspace' ? 'imap.gmail.com' : '');
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
      setRecentRescanResult(null);
      setRecentRescanError(null);
      setNotice({ kind: 'success', text: 'Gmail mailbox disconnected and saved access removed.' });
    },
    onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
  });
  const rescanRecentGmail = () => {
    setRecentRescanResult(null);
    setRecentRescanError(null);
    recentGmailRescan.mutate({ data: { windowDays: recentRescanWindowDays } }, {
      onSuccess: result => setRecentRescanResult(result),
      onError: error => setRecentRescanError(mutationError(error)),
    });
  };
  const syncGmailNow = () => {
    setGmailSyncNowResult(null);
    immediateGmailSync.mutate(undefined, {
      onSuccess: result => {
        setGmailSyncNowResult(result);
        void qc.invalidateQueries({ queryKey: getGetGmailMailboxConnectionQueryKey() });
        setNotice({
          kind: result.failed > 0 ? 'error' : 'success',
          text: result.failed > 0
            ? 'Gmail could not finish checking for bounce reports. Review the sync status below and try again.'
            : `Gmail check complete: ${result.importedReports} bounce report(s) added from ${result.messagesChecked} message(s).`,
        });
      },
      onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
    });
  };
  const change = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const changeProvider = (provider: TenantSendingSettingsInput['provider']) => {
    const preset = smtpProviderPresets[provider];
    setForm(current => ({
      ...current,
      provider,
      host: preset?.host ?? '',
      port: preset?.port ?? '587',
      encryption: preset?.encryption ?? 'tls',
    }));
    setImapHost(provider === 'microsoft_365' ? 'outlook.office365.com' : provider === 'gmail' || provider === 'google_workspace' ? 'imap.gmail.com' : '');
  };
  const refreshSenderAccounts = () => {
    void qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetTenantSendingSettingsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
  };
  const markEmailSetupComplete = () => {
    qc.setQueryData<UserDashboard>(getGetUserDashboardQueryKey(), current => {
      if (!current || current.setupChecklist.emailSetup) return current;
      const setupChecklist = { ...current.setupChecklist, emailSetup: true };
      return {
        ...current,
        setupChecklist,
        setupStepsCompleted: Object.values(setupChecklist).filter(Boolean).length,
      };
    });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
  };
  const selectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    const account = accounts.find(account => account.id === accountId);
    setForm(formForAccount(account));
    setImapHost(account?.provider === 'microsoft_365' ? 'outlook.office365.com' : account?.provider === 'gmail' || account?.provider === 'google_workspace' ? 'imap.gmail.com' : '');
    setConnectionResult(null);
    setInboxCheckResult(null);
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
      fromName: form.fromName.trim(), fromEmail: form.fromEmail.trim(), replyTo: form.fromEmail.trim(),
  });
  const canTestSmtp = Boolean(
    form.host.trim() &&
    Number(form.port) > 0 &&
    form.fromName.trim() &&
    form.fromEmail.trim() &&
    (settings?.credentialsConfigured || (form.username.trim() && form.password)),
  );
  const runInboxCheck = () => {
    setInboxCheckResult(null);
    setInboxCheckError(null);
    if (!selectedAccountId) {
      setNotice({ kind: 'error', text: 'Save this sender account before checking its inbox.' });
      return;
    }
    if (!imapHost.trim()) {
      setNotice({ kind: 'error', text: 'Enter the incoming-mail server from your email provider.' });
      return;
    }
    checkSenderMailbox.mutate({
      accountId: selectedAccountId,
      data: { imapHost: imapHost.trim(), imapPort: 993 },
    }, {
      onSuccess: result => {
        setInboxCheckResult(result);
        setInboxCheckError(null);
        refreshSenderAccounts();
        setNotice({
          kind: 'success',
          text: `Inbox check complete: ${result.bounceReportsApplied} bounce report(s) applied and ${result.repliesFound} campaign reply/replies matched.`,
        });
      },
      onError: error => {
        const message = mutationError(error);
        setInboxCheckError(message);
        setNotice({ kind: 'error', text: message });
      },
    });
  };
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
        if (response.savedSettingsUpdated) markEmailSetupComplete();
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
          markEmailSetupComplete();
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
    <Heading eyebrow="SENDING / IDENTITY" title="Email Setup" detail="Manage campaign senders and delivery monitoring for this workspace."/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    <Tabs defaultValue="email-setup" className="w-full" data-testid="email-setup-tabs">
      <TabsList className="mb-5 grid h-auto w-full grid-cols-1 gap-1 rounded-lg border border-[#e0e4e9] bg-white p-1 sm:grid-cols-3">
        <TabsTrigger data-testid="tab-email-setup" value="email-setup" className="min-h-10 whitespace-normal rounded-md px-3 py-2 text-[12px] font-semibold text-[#66717e] data-[state=active]:bg-[#174f99] data-[state=active]:text-white data-[state=active]:shadow-sm">Email setup</TabsTrigger>
        <TabsTrigger data-testid="tab-gmail-monitoring" value="gmail-monitoring" className="min-h-10 whitespace-normal rounded-md px-3 py-2 text-[12px] font-semibold text-[#66717e] data-[state=active]:bg-[#174f99] data-[state=active]:text-white data-[state=active]:shadow-sm">Gmail &amp; Google Workspace</TabsTrigger>
        <TabsTrigger data-testid="tab-microsoft365-trace" value="microsoft365-trace" className="min-h-10 whitespace-normal rounded-md px-3 py-2 text-[12px] font-semibold text-[#66717e] data-[state=active]:bg-[#174f99] data-[state=active]:text-white data-[state=active]:shadow-sm">Microsoft 365</TabsTrigger>
      </TabsList>
      <TabsContent value="email-setup" className="mt-0">
        <section data-testid="section-sender-accounts" className={`${panelClass} mb-5 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">SENDER ACCOUNTS</div>
              <h2 className="display mt-2 text-[18px] font-bold text-[#1b293a]">SMTP accounts for campaigns</h2>
              <p className="mt-1 text-[12px] leading-5 text-[#687484]">Each connected SMTP account uses one slot in your subscription. Delivery monitoring is managed in its own tab.</p>
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
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className={`${panelClass} flex items-center gap-3 p-4`} style={{ backgroundColor: '#f4f8ff', borderColor: '#dce7f5' }}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#edf4fc] text-[#245b9b]"><Fingerprint className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">Campaign sender status</div><div className="mt-1"><Status tone={settings?.verified ? 'green' : 'orange'}>{settings?.verified ? 'Test email accepted' : 'Test email required'}</Status></div><p className="mt-1 text-[10px] leading-4 text-[#778291]">A connection check completes setup; campaigns require an accepted test email.</p></div></div>
          <div className={`${panelClass} flex items-center gap-3 p-4`} style={{ backgroundColor: '#f5f7fa', borderColor: '#e1e7ee' }}><div className="grid h-9 w-9 place-items-center rounded-md bg-[#f0f3f6] text-[#657488]"><ShieldCheck className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">SMTP credentials</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{settings?.credentialsConfigured ? 'Configured · protected' : 'Not configured'}</div></div></div>
          <div className={`${panelClass} flex items-center gap-3 p-4`} style={{ backgroundColor: '#fff8f1', borderColor: '#f0e1d2' }}><div className="grid h-9 w-9 place-items-center rounded-md bg-[#fff3e8] text-[#ae642c]"><Clock3 className="h-4 w-4"/></div><div><div className="text-[11px] text-[#778291]">Last updated</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{formatDate(settings?.updatedAt)}</div></div></div>
        </div>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(290px,.75fr)]">
          <form onSubmit={save} className={`${panelClass} p-5 sm:p-6`}>
            <div className="mb-5 flex items-start justify-between gap-3 border-b border-[#edf0f2] pb-4"><div><h2 className="display text-[18px] font-bold text-[#1b293a]">SMTP connection</h2><p className="mt-1 text-[12px] text-[#788392]">These settings are scoped to your tenant, never shared across workspaces.</p></div><span className="mono rounded bg-[#f4f6f8] px-2 py-1 text-[9px] tracking-wide text-[#788392]">TENANT ONLY</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label><span className={labelClass}>Provider</span><select data-testid="select-sender-provider" className={inputClass} value={form.provider} onChange={e => changeProvider(e.target.value as TenantSendingSettingsInput['provider'])}><option value="google_workspace">Google Workspace</option><option value="gmail">Gmail</option><option value="microsoft_365">Microsoft 365</option><option value="other">Other SMTP</option></select><span className="mt-1.5 block text-[10px] leading-4 text-[#778291]">{form.provider === 'other' ? 'Enter the SMTP details supplied by your email provider.' : 'Common SMTP host, port, and encryption are filled in; adjust them if your provider requires different settings.'}</span></label>
              <Field label="SMTP host" value={form.host} onChange={v => change('host', v)} placeholder="smtp.example.com" required testId="input-smtp-host"/>
              <Field label="Port" value={form.port} onChange={v => change('port', v)} type="number" required testId="input-smtp-port"/>
              <label><span className={labelClass}>Encryption</span><select data-testid="select-smtp-encryption" className={inputClass} value={form.encryption} onChange={e => change('encryption', e.target.value)}><option value="tls">STARTTLS / TLS</option><option value="ssl">SSL</option><option value="none">None</option></select></label>
              <Field label="SMTP username" value={form.username} onChange={v => change('username', v)} placeholder={settings?.credentialsConfigured ? 'Leave blank to keep the saved username' : 'sender@example.com'} testId="input-smtp-username" hint={settings?.credentialsConfigured ? `Saved username: ${settings.username} · leave blank to keep it` : 'Required with the SMTP password'}/>
              <Field label="SMTP password" value={form.password} onChange={v => change('password', v)} type="password" placeholder={settings?.credentialsConfigured ? 'Leave blank to keep current password' : 'Enter SMTP password'} testId="input-smtp-password" hint="Try an app password first if your email system allows it; otherwise, use your email password."/>
            </div>
            <div className="my-6 border-t border-[#edf0f2]"/>
            <div className="mb-4"><h3 className="display text-[16px] font-bold text-[#1b293a]">Sender identity</h3><p className="mt-1 text-[12px] text-[#788392]">The visible name and addresses recipients will see.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From name" value={form.fromName} onChange={v => change('fromName', v)} placeholder="Customer care" required testId="input-from-name"/>
              <Field label="From email" value={form.fromEmail} onChange={v => change('fromEmail', v)} type="email" placeholder="hello@example.com" required testId="input-from-email"/>
              <div className="sm:col-span-2"><div className="block"><span className={labelClass}>Reply-to address</span><div data-testid="text-smtp-reply-to" className="flex min-h-10 items-center rounded-md border border-[#d8dfe6] bg-[#f5f7f9] px-3 text-[13px] text-[#526276]">{form.fromEmail || 'Set the From email address above'}</div><span className="mt-1.5 block text-[11px] leading-relaxed text-[#808a97]">Campaign replies always return to the mailbox used to send them.</span></div></div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-5"><span className="flex items-center gap-2 text-[11px] text-[#7b8694]"><ShieldCheck className="h-4 w-4 text-[#598166]"/>Credentials are never displayed after saving.</span><Button type="submit" testId="button-save-sending-settings" disabled={updateAccount.isPending || createAccount.isPending}>{(updateAccount.isPending || createAccount.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{(updateAccount.isPending || createAccount.isPending) ? 'Saving settings' : selectedAccountId ? 'Save sender settings' : 'Add sender account'}</Button></div>
          </form>
          <div className={`${panelClass} overflow-hidden`}>
            <div className="bg-[#f5f8fb] p-5"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">CONNECTION CHECK</div><h2 className="display mt-2 text-[19px] font-bold text-[#1c2b3d]">Test SMTP settings</h2><p className="mt-2 text-[12px] leading-5 text-[#718091]">Use the values currently in the form. You can check login without sending, or send a real test email to confirm the server accepts a message.</p></div>
            <form onSubmit={runTest} className="space-y-4 p-5">
              <Field label="Deliver test to" value={testEmail} onChange={setTestEmail} type="email" placeholder="you@company.com" required testId="input-test-recipient"/>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Button type="button" variant="outline" testId="button-check-smtp-connection" onClick={runConnectionTest} disabled={!canTestSmtp || connectionTest.isPending || test.isPending} className="w-full whitespace-nowrap">{connectionTest.isPending ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin"/> : <ShieldCheck className="h-4 w-4 shrink-0"/>}{connectionTest.isPending ? 'Checking connection' : 'Check connection'}</Button>
                <Button type="submit" testId="button-test-sending-settings" disabled={!canTestSmtp || !testEmail.trim() || test.isPending || connectionTest.isPending} className="w-full whitespace-nowrap">{test.isPending ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin"/> : <Send className="h-4 w-4 shrink-0"/>}{test.isPending ? 'Sending test' : 'Send test email'}</Button>
              </div>
              {!canTestSmtp && <p className="text-[11px] leading-5 text-[#8a6a4e]">Enter SMTP details and credentials here, or configure credentials in saved settings, before testing.</p>}
              {connectionResult && <div data-testid="smtp-connection-result" role={connectionResult.kind === 'failure' ? 'alert' : 'status'} className={cx('rounded-md border p-3 text-[11px] leading-5', connectionResult.kind === 'success' ? 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]' : 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]')}>
                <div className="flex items-start gap-2">{connectionResult.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/>}<div><strong>{connectionResult.kind === 'success' ? 'SMTP connection successful' : 'SMTP connection failed'}</strong><p>{connectionResult.message}</p><p className="mt-1">Checked {formatDate(connectionResult.checkedAt)}{connectionResult.savedSettingsUpdated ? ' · Saved check details updated' : ' · Saved check details unchanged'}</p></div></div>
              </div>}
              {settings?.connectionCheckAt && settings.connectionCheckStatus && <div data-testid="text-last-smtp-connection-check" className="flex flex-wrap items-center gap-2 border-t border-[#edf0f2] pt-3 text-[11px] text-[#647365]"><span>Last saved-settings connection check:</span><Status tone={settings.connectionCheckStatus === 'success' ? 'green' : 'orange'}>{settings.connectionCheckStatus === 'success' ? 'Successful' : 'Failed'}</Status><span>{formatDate(settings.connectionCheckAt)}</span></div>}
              <p className="text-[11px] leading-5 text-[#788392]">A successful connection check sends no email and completes the Getting Started email step only when it matches saved settings. Campaigns require a test email accepted by the SMTP server; this does not confirm inbox delivery. Draft values are never saved.</p>
              {settings?.verified && settings.verifiedAt && <div className="flex items-start gap-2 border-t border-[#edf0f2] pt-4 text-[11px] leading-5 text-[#647365]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#52815d]"/>Verified {formatDate(settings.verifiedAt)}</div>}
            </form>
          </div>
        </div>
        <section className={`${panelClass} mt-5 p-5`} data-testid="section-imap-inbox-check">
          <div className="max-w-3xl">
            <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">INBOX MONITORING</div>
            <h2 className="display mt-2 text-[18px] font-bold text-[#1b293a]">Check this sender’s inbox</h2>
            <p className="mt-2 text-[12px] leading-5 text-[#687484]">
              Scans up to 100 messages from the last 14 days. Bounce reports update campaign delivery history; replies are matched against messages sent from this account. The mailbox password is the saved SMTP password.
            </p>
          </div>
          <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field
              label="Incoming server (IMAP)"
              value={imapHost}
              onChange={setImapHost}
              placeholder={form.provider === 'microsoft_365' ? 'outlook.office365.com' : form.provider === 'gmail' || form.provider === 'google_workspace' ? 'imap.gmail.com' : 'imap.your-email-provider.com'}
              testId="input-imap-host"
              hint="Secure IMAP port 993 is used. For Google, OAuth monitoring is recommended. Microsoft and some providers require IMAP to be enabled and an app password; OAuth-only sign-in is not supported by this password-based check."
            />
            <Button
              testId="button-check-sender-inbox"
              onClick={runInboxCheck}
              disabled={!selectedAccountId || !settings?.credentialsConfigured || !imapHost.trim() || checkSenderMailbox.isPending}
            >
              {checkSenderMailbox.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}
              {checkSenderMailbox.isPending ? 'Checking inbox…' : 'Check inbox now'}
            </Button>
          </div>
          {inboxCheckResult && <div role="status" data-testid="text-inbox-check-result" className="mt-4 max-w-3xl rounded-md border border-[#cfe4d8] bg-[#f1f8f4] p-3 text-[11px] leading-5 text-[#31674b]">
            Checked {inboxCheckResult.mailbox} at {formatDate(inboxCheckResult.checkedAt)}. Scanned {inboxCheckResult.messagesChecked} messages; found {inboxCheckResult.bounceReportsFound} bounce report(s), applied {inboxCheckResult.bounceReportsApplied}, and matched {inboxCheckResult.repliesFound} campaign reply/replies.
            {inboxCheckResult.replyMatches.length > 0 && <ul className="mt-2 space-y-1 border-t border-[#cfe4d8] pt-2">
              {inboxCheckResult.replyMatches.map((reply, index) => <li key={`${reply.campaignName}-${reply.recipientEmail}-${index}`}>{reply.recipientEmail} replied to “{reply.campaignName}” (sent {formatDate(reply.sentAt)}).</li>)}
            </ul>}
          </div>}
          {inboxCheckError && <div role="alert" data-testid="text-inbox-check-error" className="mt-4 max-w-3xl rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">
            Inbox connection failed: {inboxCheckError}
          </div>}
          {!settings?.credentialsConfigured && <p className="mt-3 max-w-3xl text-[11px] leading-5 text-[#99501e]">Save the sender’s SMTP username and password before checking its inbox. The inbox check uses those saved credentials.</p>}
        </section>
        <DeliveryCapabilityNotes/>
      </TabsContent>
      <TabsContent value="gmail-monitoring" className="mt-0">
        <section data-testid="section-gmail-bounce-monitor" className={`${panelClass} p-5 sm:p-6`}>
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
                  <span>Last sync attempt: <strong className="text-[#26364a]">{formatDate(gmailConnection.data.lastSyncAt)}</strong></span>
                </div>
                {gmailConnection.data.lastSuccessAt && <p className="mt-2 text-[11px] text-[#718091]">Last successful sync: {formatDate(gmailConnection.data.lastSuccessAt)} · Next check: {formatDate(gmailConnection.data.nextSyncAt)}</p>}
                {gmailConnection.data.syncStatus === 'error' && gmailConnection.data.nextSyncAt && <p data-testid="text-gmail-sync-retry" className="mt-2 text-[11px] leading-5 text-[#687484]">Next automatic retry scheduled for <time dateTime={gmailConnection.data.nextSyncAt}>{formatDate(gmailConnection.data.nextSyncAt)}</time>.</p>}
                {gmailSyncOverdue && <div data-testid="alert-gmail-sync-overdue" role="alert" className="mt-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">
                  <p className="font-semibold">Gmail bounce polling is overdue.</p>
                  <p className="mt-1">The scheduled check was {formatDate(gmailConnection.data.nextSyncAt)}. Run a sync now; if a notice may have been missed, rescan recent messages below. Reconnect Google if syncing continues to fail.</p>
                </div>}
                {gmailConnection.data.lastError && <p data-testid="text-gmail-sync-error" role="status" className="mt-3 rounded border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">{gmailConnection.data.lastError}</p>}
                {gmailConnection.data.syncStatus === 'history_expired' && <p className="mt-2 text-[11px] leading-5 text-[#99501e]">Reconnect to restart monitoring from a new checkpoint. Gmail cannot recover notices from the expired-history gap automatically.</p>}
                {gmailConnection.data.lastSyncDiagnostics && <div data-testid="panel-gmail-sync-diagnostics" role="status" className="mt-3 rounded-md border border-[#dce4ee] bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 data-testid="text-gmail-sync-diagnostic-outcome" className="text-[11px] font-semibold text-[#26364a]">{gmailSyncOutcomeTitle(gmailConnection.data.lastSyncDiagnostics.outcome)}</h3>
                    <span className="text-[10px] text-[#7a8795]">Attempted {formatDate(gmailConnection.data.lastSyncAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-[#687484]">{gmailSyncOutcomeDetail(gmailConnection.data.lastSyncDiagnostics.outcome)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {([
                      ['Messages checked', gmailConnection.data.lastSyncDiagnostics.messagesChecked],
                      ['DSN candidates', gmailConnection.data.lastSyncDiagnostics.dsnCandidates],
                      ['Imported reports', gmailConnection.data.lastSyncDiagnostics.importedReports],
                      ['Unmatched reports', gmailConnection.data.lastSyncDiagnostics.unmatchedReports],
                      ['Warnings', gmailConnection.data.lastSyncDiagnostics.warnings],
                    ] as const).map(([label, count]) => <div key={label} className="rounded border border-[#e4e8ed] bg-[#fafbfc] px-3 py-2">
                      <div className="mono text-[9px] uppercase tracking-[.1em] text-[#84909d]">{label}</div>
                      <div data-testid={`text-gmail-sync-count-${label.toLowerCase().replaceAll(' ', '-')}`} className="mt-1 text-[15px] font-semibold text-[#26364a]">{count === null ? '—' : count.toLocaleString()}</div>
                    </div>)}
                  </div>
                </div>}
                {gmailConnection.data.connected && <div className="mt-3 flex flex-col gap-3 rounded-md border border-[#dce4ee] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-[12px] font-semibold text-[#26364a]">Check for bounce reports</h3>
                    <p className="mt-1 text-[11px] leading-5 text-[#687484]">Run a Gmail sync now instead of waiting for the next automatic check.</p>
                  </div>
                  <Button
                    variant="outline"
                    testId="button-sync-gmail-now"
                    disabled={immediateGmailSync.isPending}
                    onClick={syncGmailNow}
                    className="shrink-0"
                  >
                    {immediateGmailSync.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin"/>Checking Gmail…</> : <><RefreshCw className="h-4 w-4"/>Check now</>}
                  </Button>
                  {gmailSyncNowResult && <div data-testid="panel-gmail-sync-now-result" role="status" className="basis-full rounded bg-[#f7f9fb] p-3 text-[11px] leading-5 text-[#596777]">
                    Checked {gmailSyncNowResult.messagesChecked.toLocaleString()} messages; found {gmailSyncNowResult.dsnCandidates.toLocaleString()} delivery-status reports and added {gmailSyncNowResult.importedReports.toLocaleString()} new bounce reports.
                    {gmailSyncNowResult.duplicates > 0 && ` ${gmailSyncNowResult.duplicates.toLocaleString()} were already recorded.`}
                    {gmailSyncNowResult.unmatchedReports > 0 && ` ${gmailSyncNowResult.unmatchedReports.toLocaleString()} could not be matched to a campaign.`}
                    {gmailSyncNowResult.warnings > 0 && ` ${gmailSyncNowResult.warnings.toLocaleString()} report warning(s).`}
                    {gmailSyncNowResult.failed > 0 && ` ${gmailSyncNowResult.failed.toLocaleString()} mailbox sync failed.`}
                  </div>}
                </div>}
              </div>}
          {gmailConnection.data?.connected && <div className="mt-4 rounded-md border border-[#dce4ee] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[12px] font-semibold text-[#26364a]">Recover recent bounce notices</h3>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#687484]">Scan message headers from the selected window (up to 500 messages). If Gmail has more, choose a shorter window and try again. Message content is fetched only for delivery-status reports; the regular sync checkpoint is unchanged.</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-32">
                  <span className={labelClass}>Recovery window</span>
                  <select
                    data-testid="select-gmail-rescan-window"
                    aria-label="Gmail recovery window"
                    className={inputClass}
                    value={recentRescanWindowDays}
                    disabled={recentGmailRescan.isPending}
                    onChange={event => setRecentRescanWindowDays(Number(event.target.value) as GmailRecentRescanInput['windowDays'])}
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                  </select>
                </label>
                <Button
                  variant="outline"
                  testId="button-rescan-recent-gmail"
                  disabled={recentGmailRescan.isPending}
                  onClick={rescanRecentGmail}
                >
                  {recentGmailRescan.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin"/>Scanning recent messages…</> : `Rescan last ${recentRescanWindowDays} days`}
                </Button>
              </div>
            </div>
            {recentRescanError && <p data-testid="text-gmail-rescan-error" role="alert" className="mt-3 rounded border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] leading-5 text-[#99501e]">{recentRescanError}</p>}
            {recentRescanResult && <div data-testid="panel-gmail-rescan-result" role="status" className="mt-3 rounded-md bg-[#f7f9fb] p-3">
              <p className="text-[11px] leading-5 text-[#596777]">Checked {recentRescanResult.messagesChecked.toLocaleString()} messages from the last {recentRescanResult.windowDays} days ({recentRescanResult.maxMessages.toLocaleString()} message limit); {recentRescanResult.candidateMessages.toLocaleString()} delivery-status reports found.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['Imported', recentRescanResult.imported],
                  ['Duplicates', recentRescanResult.duplicates],
                  ['Unmatched', recentRescanResult.unmatched],
                  ['Ignored', recentRescanResult.ignored],
                ] as const).map(([label, count]) => <div key={label} className="rounded border border-[#e4e8ed] bg-white px-3 py-2">
                  <div className="mono text-[9px] uppercase tracking-[.12em] text-[#84909d]">{label}</div>
                  <div className="mt-1 text-[16px] font-semibold text-[#26364a]">{count.toLocaleString()}</div>
                </div>)}
              </div>
              {recentRescanResult.warningCount > 0 && <p className="mt-2 text-[10px] leading-4 text-[#895b2f]">{recentRescanResult.warningCount.toLocaleString()} message or report warning(s) occurred during the scan.</p>}
            </div>}
          </div>}
          <p className="mt-3 text-[11px] leading-5 text-[#788392]">Only matched DSNs become bounce evidence. No bounce is not proof of delivery, inbox placement, or reading. Disconnecting removes Mailflow’s refresh token and asks Google to revoke it.</p>
        </section>
      </TabsContent>
      <TabsContent value="microsoft365-trace" className="mt-0">
        <Microsoft365TraceSettingsPanel/>
      </TabsContent>
    </Tabs>
  </></QueryState>;
}

type ContactForm = { email: string; firstName: string; lastName: string; companyName: string; linkedinUrl: string; phoneNumber: string; subscribed: boolean; listIds: string[] };
const emptyContact: ContactForm = { email: '', firstName: '', lastName: '', companyName: '', linkedinUrl: '', phoneNumber: '', subscribed: true, listIds: [] };

function getLinkedInProfileHref(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (hostname !== 'linkedin.com' && !hostname.endsWith('.linkedin.com')) ||
      !url.pathname ||
      url.pathname === '/'
    ) {
      return null;
    }
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

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
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#26364a]">{email.campaignName}{email.campaignType === 'follow_up' && <Status tone="blue">Follow-up</Status>}</div><div className="mt-1 break-words text-[12px] text-[#697687]">{email.subject}</div></div><Status tone={emailStatusTone(email.status)}>{emailStatusLabel(email.status)}</Status></div>
        <div data-testid={`text-contact-email-history-recipient-${email.id}`} className="mt-2 break-words text-[11px] text-[#586778]">Sent to {email.email}</div>
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
  const companiesQuery = useListCompanies();
  const filterOptionsQuery = useGetContactFilterOptions({
    query: { queryKey: getGetContactFilterOptionsQueryKey(), staleTime: 60_000 },
  });
  const segmentsQuery = useListContactSegments({
    query: { queryKey: getListContactSegmentsQueryKey(), staleTime: 0, refetchOnMount: 'always' },
  });
  const create = useCreateContact(); const update = useUpdateContact(); const remove = useDeleteContact();
  const verifyEmail = useVerifyContactEmail();
  const createSegment = useCreateContactSegment();
  const updateSegment = useUpdateContactSegment();
  const removeSegment = useDeleteContactSegment();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [selectedSegmentId, setSelectedSegmentId] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [segmentEditor, setSegmentEditor] = useState<{ mode: 'save' | 'rename'; segment?: ContactAudienceSegment } | null>(null);
  const [segmentName, setSegmentName] = useState('');
  const [segmentToDelete, setSegmentToDelete] = useState<ContactAudienceSegment | null>(null);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined); const [form, setForm] = useState<ContactForm>(emptyContact); const [importing, setImporting] = useState(false);
  const [historyContact, setHistoryContact] = useState<ContactDirectoryItem | null>(null);
  const [emailVerificationByContact, setEmailVerificationByContact] = useState<Record<string, { email: string; status: ContactEmailVerification['status']; riskFlags: ContactEmailVerification['riskFlags'] }>>({});
  const [emailVerification, setEmailVerification] = useState<{
    contact: ContactDirectoryItem;
    result?: ContactEmailVerification;
    error?: string;
  } | null>(null);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [movingContactId, setMovingContactId] = useState<string | null>(null);
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
  const moveContactMembership = async (contact: ContactDirectoryItem, targetListId: string) => {
    const targetList = lists.find(list => list.id === targetListId);
    if (!targetList || contact.listIds.length === 1 && contact.listIds[0] === targetListId) return;
    setMovingContactId(contact.id);
    try {
      await update.mutateAsync({
        contactId: contact.id,
        data: { listIds: [targetList.id] },
      });
      reload();
      setNotice({ kind: 'success', text: `${contact.email} moved to ${targetList.name}; other list memberships were removed.` });
    } catch (error) {
      setNotice({ kind: 'error', text: mutationError(error) });
    } finally {
      setMovingContactId(null);
    }
  };
  const openNew = () => { setEditing(null); setForm(emptyContact); setSelectedCompanyId(''); };
  const openEdit = (contact: Contact) => { setEditing(contact); setForm({ email: contact.email, firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName ?? '', linkedinUrl: contact.linkedinUrl ?? '', phoneNumber: contact.phoneNumber ?? '', subscribed: contact.subscribed, listIds: [...contact.listIds] }); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    if (!firstName || !lastName || !email) { setNotice({ kind: 'error', text: 'First name, last name, and email are required.' }); return; }
    if (editing?.emailStatus === 'bounced' && form.subscribed && email.toLowerCase() === editing.email.toLowerCase()) {
      setNotice({ kind: 'error', text: 'This address bounced. Enter a corrected email address before marking the contact subscribed.' });
      return;
    }
    const done = () => { reload(); setEditing(undefined); setSelectedCompanyId(''); setNotice({ kind: 'success', text: editing ? 'Contact changes saved.' : 'Contact added to your audience.' }); };
    const failed = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    const companyName = form.companyName.trim(); const linkedinUrl = form.linkedinUrl.trim(); const phoneNumber = form.phoneNumber.trim();
    if (editing) {
      update.mutate(
        { contactId: editing.id, data: { email, firstName, lastName, subscribed: form.subscribed, listIds: form.listIds, companyName: companyName || null, linkedinUrl: linkedinUrl || null, phoneNumber: phoneNumber || null } },
        {
          onSuccess: updatedContact => {
            qc.setQueriesData<ListContactsQueryResult>({ queryKey: getListContactsQueryKey() }, previous => previous
              ? {
                  ...previous,
                  contacts: previous.contacts.map(contact => contact.id === updatedContact.id
                    ? { ...contact, email: updatedContact.email, subscribed: updatedContact.subscribed, emailStatus: updatedContact.emailStatus }
                    : contact),
                }
              : previous);
            done();
          },
          onError: failed,
        },
      );
    } else {
      create.mutate({ data: { email, firstName, lastName, subscribed: form.subscribed, listIds: form.listIds, ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}), ...(linkedinUrl ? { linkedinUrl } : {}), ...(phoneNumber ? { phoneNumber } : {}) } }, { onSuccess: done, onError: failed });
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
    {emailVerification && <Modal
      title="Email verification"
      subtitle={emailVerification.contact.email}
      close={() => { if (!verifyEmail.isPending) setEmailVerification(null); }}
    >
      <div className="space-y-4">
        {verifyEmail.isPending ? (
          <div role="status" data-testid="status-contact-email-verification-loading" className="flex items-center gap-3 rounded-lg border border-[#dce5ee] bg-[#f6f9fc] p-4 text-[13px] text-[#46576c]">
            <LoaderCircle className="h-5 w-5 animate-spin text-[#245b9b]"/>Checking the mail server. No message will be sent.
          </div>
        ) : emailVerification.error ? (
          <div role="alert" data-testid="status-contact-email-verification-error" className="rounded-lg border border-[#f0d5bd] bg-[#fff8f1] p-4 text-[13px] text-[#99501e]">{emailVerification.error}</div>
        ) : emailVerification.result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Status tone={emailVerification.result.status === 'accepted' ? 'green' : emailVerification.result.status === 'catch_all' || emailVerification.result.status === 'inconclusive' ? 'orange' : 'gray'}>{emailVerification.result.status?.replaceAll('_', ' ') ?? 'inconclusive'}</Status>
              <span className="text-[10px] text-[#788596]">Checked {formatDate(emailVerification.result.checkedAt)}</span>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#e3e8ee] bg-[#f8fafc] p-4 text-[12px] text-[#435267]">
              <p><span className="font-semibold text-[#24364a]">Detected provider:</span> {emailVerification.result.providerName ?? 'Not identified from DNS'}</p>
              <p><span className="font-semibold text-[#24364a]">Check performed:</span> {emailVerification.result.verificationMethod}</p>
              {emailVerification.result.mailServer && <p><span className="font-semibold text-[#24364a]">Mail server checked:</span> {emailVerification.result.mailServer}</p>}
            </div>
            <p className="text-[11px] leading-5 text-[#718094]">This consent-free check uses public DNS and SMTP responses only. It does not sign in to the provider or query a private mailbox directory, and it never sends a message.</p>
            <p role="status" data-testid="status-contact-email-verification-result" className="rounded-lg border border-[#e3e8ee] bg-[#f8fafc] p-4 text-[13px] leading-6 text-[#435267]">{emailVerification.result.message}</p>
            {emailVerification.result.riskFlags.length > 0 && <section data-testid="contact-email-risk-warnings" className="rounded-lg border border-[#f0ddb6] bg-[#fffaf0] p-4 text-[12px] text-[#765421]">
              <h3 className="font-semibold">Address cautions</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {emailVerification.result.riskFlags.includes('disposable_domain') && <li>This domain is listed as disposable or temporary. Domain lists can be outdated, so confirm before acting on this warning.</li>}
                {emailVerification.result.riskFlags.includes('role_based_address') && <li>This appears to be a shared or role-based address rather than an individual mailbox.</li>}
                {emailVerification.result.riskFlags.includes('likely_domain_typo') && <li>The domain looks similar to a common email-provider domain.</li>}
              </ul>
              {emailVerification.result.suggestedEmail && <p className="mt-2">Possible correction: <span className="font-semibold">{emailVerification.result.suggestedEmail}</span>. Mailflow has not changed the saved address.</p>}
            </section>}
            {emailVerification.result.noReplyStyle && <p className="rounded-md bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">The address name resembles a no-reply alias. This is only a naming hint; reply behavior cannot be checked without sending a message.</p>}
            <p className="text-[10px] leading-5 text-[#788596]">SMTP checks are best-effort, not proof of inbox delivery or future sendability. Catch-all servers may accept addresses that do not exist.</p>
          </>
        )}
        <div className="flex justify-end border-t border-[#edf0f2] pt-3">
          <Button variant="outline" testId="button-close-contact-email-verification" disabled={verifyEmail.isPending} onClick={() => setEmailVerification(null)}>Close</Button>
        </div>
      </div>
    </Modal>}
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
        {visible.length ? <div className="overflow-x-auto"><p className="px-5 pb-2 text-[10px] text-[#788392]">Changing Membership moves the contact to one list and removes its other list memberships.</p><table className="w-full min-w-[1050px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Contact</th><th className="px-4 py-3 font-semibold">Membership</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last email</th><th className="px-4 py-3 font-semibold">Added</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{visible.map(contact => <tr key={contact.id} data-testid={`row-contact-${contact.id}`} className="hover:bg-[#fbfcfd]">
        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">{(contact.firstName?.[0] || contact.email[0] || '?').toUpperCase()}{contact.lastName?.[0]?.toUpperCase() || ''}</span><span className="min-w-0"><Link href={`/contacts/${contact.id}`} data-testid={`link-contact-${contact.id}`} className="block text-[12px] font-semibold text-[#26364a] no-underline hover:text-[#245b9b] hover:underline">{contact.firstName} {contact.lastName}</Link><span className="mt-0.5 block text-[11px] text-[#7c8794]">{contact.email}</span></span></div></td>
        <td className="px-4 py-3.5"><select
          data-testid={`select-contact-membership-${contact.id}`}
          aria-label={`Membership for ${[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email}`}
          title="Choose a list to move this contact into; this replaces all other list memberships."
          value={contact.listIds.length > 1 ? '__multiple__' : contact.listIds[0] ?? '__none__'}
          disabled={update.isPending || movingContactId === contact.id || lists.length === 0}
          onChange={event => { if (event.target.value !== '__none__' && event.target.value !== '__multiple__') void moveContactMembership(contact, event.target.value); }}
          className="h-8 max-w-[190px] rounded-md border border-[#d3dce7] bg-white px-2 text-[10px] text-[#415166] disabled:bg-[#f4f6f8]"
        >
          {contact.listIds.length > 1
            ? <option value="__multiple__" disabled>{contact.listIds.length} lists</option>
            : contact.listIds.length === 0
              ? <option value="__none__" disabled>No list assigned</option>
              : null}
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}{!list.active ? ' (inactive)' : ''}</option>)}
        </select></td>
        <td className="px-4 py-3.5">{(() => { const emailStatus = contact.emailStatus ?? (contact.subscribed ? 'subscribed' : 'unsubscribed'); return <button data-testid={`button-toggle-subscription-${contact.id}`} disabled={update.isPending || emailStatus === 'bounced'} onClick={() => toggleSub(contact)} title={emailStatus === 'bounced' ? 'Bounced addresses are suppressed; update the address and reconfirm consent before reactivating.' : undefined} className="rounded-full focus:outline-none focus:ring-2 focus:ring-[#dbe8f7] disabled:opacity-60"><Status tone={emailStatus === 'subscribed' ? 'green' : emailStatus === 'bounced' ? 'orange' : 'gray'}>{emailStatus === 'bounced' ? 'Bounced' : emailStatus === 'unsubscribed' ? 'Unsubscribed' : 'Subscribed'}</Status></button>; })()}</td>
         <td data-testid={`cell-contact-last-email-${contact.id}`} className="px-4 py-3.5">{contact.lastEmail ? <div className="max-w-[230px]"><div data-testid={`contact-last-email-campaign-${contact.id}`} className="truncate text-[11px] font-semibold text-[#354458]" title={contact.lastEmail.campaignName}>{contact.lastEmail.campaignName}</div><div data-testid={`contact-last-email-date-${contact.id}`} className="mt-1 truncate whitespace-nowrap text-[10px] text-[#7c8794]">{formatDate(contact.lastEmail.lastAttemptAt)}</div></div> : <span className="text-[11px] text-[#9aa3ad]">No email sent</span>}</td>
        <td className="px-4 py-3.5 text-[11px] text-[#7c8794]">{new Date(contact.createdAt).toLocaleDateString()}</td>
          <td className="px-5 py-3.5"><div className="flex justify-end gap-1">
            {(() => {
              const linkedinHref = getLinkedInProfileHref(contact.linkedinUrl);
              const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email;
              const savedVerification = emailVerificationByContact[contact.id];
              const verificationStatus = savedVerification?.email.toLowerCase() === contact.email.toLowerCase()
                ? savedVerification.status
                : contact.emailVerificationStatus;
              const riskFlags = savedVerification?.email.toLowerCase() === contact.email.toLowerCase()
                ? savedVerification.riskFlags
                : contact.emailVerificationRiskFlags ?? [];
              const hasRiskWarnings = riskFlags.length > 0;
              const verificationTitle = verificationStatus === 'accepted'
                ? 'Mail server accepted this address; this does not prove inbox delivery'
                : verificationStatus === 'rejected' || verificationStatus === 'no_mail_server'
                  ? 'Mail server rejected this address'
                  : verificationStatus === 'catch_all' || verificationStatus === 'inconclusive'
                    ? 'Email check inconclusive'
                    : 'Verify email without sending';
              const savedRiskLabels = riskFlags.map(flag => ({
                disposable_domain: 'disposable domain',
                role_based_address: 'role-based address',
                likely_domain_typo: 'possible domain typo',
              }[flag] ?? flag));
              const savedCheckDetails = [
                contact.emailVerificationProvider,
                contact.emailVerificationCheckedAt ? `checked ${formatDate(contact.emailVerificationCheckedAt)}` : null,
                savedRiskLabels.length ? `warnings: ${savedRiskLabels.join(', ')}` : null,
              ].filter(Boolean).join(' · ');
              return <>
                <span className="inline-flex h-9 w-10 shrink-0 items-center justify-center">
                  {linkedinHref && <a data-testid={`link-contact-linkedin-${contact.id}`} href={linkedinHref} target="_blank" rel="noopener noreferrer" aria-label={`Open LinkedIn profile for ${contactName}`} title="Open LinkedIn profile" className="inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-md text-[#245b9b] transition hover:bg-[#edf4fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dbe8f7]"><Linkedin aria-hidden="true" className="h-4 w-4"/></a>}
                </span>
                <Button variant="quiet" testId={`button-verify-contact-email-${contact.id}`} ariaLabel={`${verificationTitle}: ${contactName}`} disabled={verifyEmail.isPending} onClick={() => {
                  setEmailVerificationByContact(previous => {
                    const next = { ...previous };
                    delete next[contact.id];
                    return next;
                  });
                  setEmailVerification({ contact });
                  verifyEmail.mutate({ contactId: contact.id }, {
                    onSuccess: result => {
                      setEmailVerification({ contact, result });
                      setEmailVerificationByContact(previous => ({
                        ...previous,
                        [contact.id]: { email: contact.email, status: result.status, riskFlags: result.riskFlags },
                      }));
                      void contactsQuery.refetch();
                    },
                    onError: error => setEmailVerification({ contact, error: mutationError(error) }),
                  });
                }} title={savedCheckDetails ? `${verificationTitle} · ${savedCheckDetails}` : verificationTitle}><ContactEmailIcon status={verificationStatus} hasRiskWarnings={hasRiskWarnings}/></Button>
                <Button variant="quiet" testId={`button-contact-history-${contact.id}`} ariaLabel={`Email history for ${contactName}`} title="Email history" onClick={() => setHistoryContact(contact)}><Clock3 aria-hidden="true" className="h-4 w-4"/></Button>
                <Button variant="quiet" testId={`button-edit-contact-${contact.id}`} ariaLabel={`Edit ${contactName}`} title="Edit contact" onClick={() => openEdit(contact)}><Edit3 aria-hidden="true" className="h-4 w-4"/></Button>
                <Button variant="quiet" testId={`button-delete-contact-${contact.id}`} ariaLabel={`Delete ${contactName}`} title="Delete contact" disabled={remove.isPending} onClick={() => setContactToDelete(contact)}><Trash2 aria-hidden="true" className="h-4 w-4 text-[#b85b20]"/></Button>
              </>;
            })()}
          </div></td>
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
       {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
      <form onSubmit={submit} className="space-y-4">
         {editing?.emailStatus === 'bounced' && <div role="note" className="rounded-md border border-[#efd5c5] bg-[#fff6ef] px-3 py-2.5 text-[11px] leading-5 text-[#94501f]">This address bounced. To restore campaign eligibility, enter a corrected email address and check the subscription box. The bounced address must change; previously suppressed sends stay suppressed.</div>}
        <Field label="Email address" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" placeholder="person@company.com" required maxLength={254} testId="input-contact-email"/>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="First name" value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} required maxLength={100} testId="input-contact-first-name"/><Field label="Last name" value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} required maxLength={100} testId="input-contact-last-name"/></div>
         {editing ? (
           <Field label="Company name" value={form.companyName} onChange={v => setForm(f => ({ ...f, companyName: v }))} maxLength={200} placeholder="Optional" testId="input-contact-company"/>
         ) : (
           <label className="block">
             <span className="mb-1.5 block text-[11px] font-semibold text-[#465568]">Company</span>
             <select data-testid="select-contact-company" value={selectedCompanyId} onChange={event => setSelectedCompanyId(event.target.value)} disabled={companiesQuery.isLoading || companiesQuery.isError} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[12px] text-[#344154] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] disabled:cursor-not-allowed disabled:bg-[#f4f6f8]">
               <option value="">No company</option>
               {(companiesQuery.data?.companies ?? []).map(company => <option key={company.id} value={company.id}>{company.companyName}</option>)}
             </select>
             {companiesQuery.isLoading && <span className="mt-1 block text-[10px] text-[#788696]">Loading workspace companies…</span>}
             {companiesQuery.isError && <span role="alert" className="mt-1 block text-[10px] text-[#a45335]">Companies could not be loaded. <button type="button" data-testid="button-retry-contact-companies" disabled={companiesQuery.isFetching} onClick={() => void companiesQuery.refetch()} className="font-semibold underline disabled:opacity-50">Retry</button></span>}
             {!companiesQuery.isLoading && !companiesQuery.isError && !companiesQuery.data?.companies.length && <span className="mt-1 block text-[10px] text-[#788696]">No companies added yet. <Link href="/companies" className="font-semibold text-[#315879] underline">Add a company</Link> first.</span>}
           </label>
         )}
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

type ListCandidateFirstLetter = 'all' | 'other' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

type ListCandidateFilters = {
  firstLetter: ListCandidateFirstLetter;
  status: 'all' | 'subscribed' | 'unsubscribed';
  jobTitle: string;
  company: string;
  location: string;
  leadSource: string;
};

const EMPTY_LIST_CANDIDATE_FILTERS: ListCandidateFilters = {
  firstLetter: 'all',
  status: 'all',
  jobTitle: '',
  company: '',
  location: '',
  leadSource: 'all',
};

const LIST_CANDIDATE_FILTER_UNSET = '__unset__';

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
  const [candidateFilters, setCandidateFilters] = useState<ListCandidateFilters>(EMPTY_LIST_CANDIDATE_FILTERS);
  const [debouncedCandidateFilters, setDebouncedCandidateFilters] = useState<ListCandidateFilters>(EMPTY_LIST_CANDIDATE_FILTERS);
  const [onlyUnattachedContacts, setOnlyUnattachedContacts] = useState(false);
  const [pendingMembershipIds, setPendingMembershipIds] = useState<Set<string>>(() => new Set());
  const [membershipFeedback, setMembershipFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedContactSearch(contactSearch), 250);
    return () => window.clearTimeout(timer);
  }, [contactSearch]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCandidateFilters(candidateFilters), 250);
    return () => window.clearTimeout(timer);
  }, [candidateFilters]);
  const memberFilterOptionsQuery = useGetContactFilterOptions({
    query: { queryKey: getGetContactFilterOptionsQueryKey(), enabled: Boolean(viewingList), staleTime: 60_000 },
  });
  const updateCandidateFilter = <K extends keyof ListCandidateFilters>(key: K, value: ListCandidateFilters[K]) => {
    setCandidateFilters(current => ({ ...current, [key]: value }));
  };
  const clearCandidateFilters = () => {
    setCandidateFilters(EMPTY_LIST_CANDIDATE_FILTERS);
    setDebouncedCandidateFilters(EMPTY_LIST_CANDIDATE_FILTERS);
  };
  const activeCandidateFilterCount = Object.entries(candidateFilters).filter(([key, value]) =>
    key === 'firstLetter' ? value !== 'all' :
      key === 'status' ? value !== 'all' :
        key === 'leadSource' ? value !== 'all' : Boolean(value),
  ).length;
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
    ? {
        limit: 100,
        excludeListId: viewingList.id,
        search: debouncedContactSearch,
        ...(onlyUnattachedContacts ? { unattachedOnly: true } : {}),
        ...(debouncedCandidateFilters.firstLetter !== 'all' ? { firstLetter: debouncedCandidateFilters.firstLetter } : {}),
        ...(debouncedCandidateFilters.status !== 'all' ? { subscribed: debouncedCandidateFilters.status === 'subscribed' } : {}),
        ...(debouncedCandidateFilters.jobTitle ? { jobTitle: debouncedCandidateFilters.jobTitle } : {}),
        ...(debouncedCandidateFilters.company ? { company: debouncedCandidateFilters.company } : {}),
        ...(debouncedCandidateFilters.location ? { location: debouncedCandidateFilters.location } : {}),
        ...(debouncedCandidateFilters.leadSource !== 'all' ? { leadSource: debouncedCandidateFilters.leadSource } : {}),
      }
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
    setCandidateFilters(EMPTY_LIST_CANDIDATE_FILTERS);
    setDebouncedCandidateFilters(EMPTY_LIST_CANDIDATE_FILTERS);
    setMemberPage(1);
    setOnlyUnattachedContacts(false);
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
  const moveContactToList = async (contact: { id: string; email: string }, targetListId: string) => {
    const targetList = lists.find(list => list.id === targetListId);
    if (!targetList || !viewingList || targetList.id === viewingList.id) return;
    setPendingMembershipIds(current => new Set(current).add(contact.id));
    setMembershipFeedback(null);
    try {
      await updateContact.mutateAsync({
        contactId: contact.id,
        data: { listIds: [targetList.id] },
      });
      await refresh();
      setMembershipFeedback({ kind: 'success', text: `${contact.email} moved to ${targetList.name} and removed from other lists.` });
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
    {viewingList && <Modal wide title={`Manage contacts · ${viewingList.name}`} subtitle={`${viewingList.contactCount.toLocaleString()} contact${viewingList.contactCount === 1 ? '' : 's'} belong to this list.`} close={() => setViewingList(null)}>
      <section className="mb-4 rounded-md border border-[#e3e7eb] bg-[#fafbfc] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="text-[12px] font-semibold text-[#344154]">Add existing contacts</h3><p className="mt-1 text-[10px] text-[#7b8794]">Choose a contact to add it to this list. Existing list memberships are preserved.</p></div>
          <span className="text-[10px] text-[#7b8794]">{(contactOptionsQuery.data?.total ?? 0).toLocaleString()} available</span>
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a95a2]"/>
          <input data-testid={`input-search-list-contacts-${viewingList.id}`} aria-label="Search contacts to add" className={`${inputClass} h-9 pl-9 text-[12px]`} type="search" placeholder="Search by name, email, or company" value={contactSearch} onChange={event => setContactSearch(event.target.value)}/>
        </label>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 rounded-md border border-[#dce5ef] bg-white px-3 py-2 text-[11px] font-medium text-[#415166]">
          <input
            type="checkbox"
            data-testid="checkbox-only-unattached-contacts"
            checked={onlyUnattachedContacts}
            onChange={event => setOnlyUnattachedContacts(event.currentTarget.checked)}
            className="accent-[#174f99]"
          />
          Only unattached contacts
          <span className="font-normal text-[#7b8794]">(not in any list)</span>
        </label>
        <div data-testid="list-contact-candidate-filters" className="mt-3 rounded-md border border-[#e3e8ee] bg-white p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#536276]">Filter contacts to add</p>
            {activeCandidateFilterCount > 0 && <Button variant="quiet" className="min-h-7 px-2 text-[10px]" testId="button-clear-list-candidate-filters" onClick={clearCandidateFilters}>Clear filters ({activeCandidateFilterCount})</Button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block min-w-0">
              <span className="mb-1 block text-[10px] font-semibold text-[#536276]">Alphabet</span>
              <select data-testid="select-list-candidate-first-letter" value={candidateFilters.firstLetter} onChange={event => updateCandidateFilter('firstLetter', event.target.value as ListCandidateFirstLetter)} className="h-9 w-full rounded-md border border-[#d3dce7] bg-white px-2.5 text-[11px] text-[#29394c]">
                <option value="all">Any letter</option>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => <option key={letter} value={letter}>{letter}</option>)}
                <option value="other">Other (number or symbol)</option>
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[10px] font-semibold text-[#536276]">Subscription</span>
              <select data-testid="select-list-candidate-status" value={candidateFilters.status} onChange={event => updateCandidateFilter('status', event.target.value as ListCandidateFilters['status'])} className="h-9 w-full rounded-md border border-[#d3dce7] bg-white px-2.5 text-[11px] text-[#29394c]">
                <option value="all">All statuses</option>
                <option value="subscribed">Subscribed</option>
                <option value="unsubscribed">Unsubscribed</option>
              </select>
            </label>
            {([
              { key: 'jobTitle', label: 'Job title', placeholder: 'Filter by job title', testId: 'input-list-candidate-job-title' },
              { key: 'company', label: 'Company', placeholder: 'Filter by company', testId: 'input-list-candidate-company' },
              { key: 'location', label: 'Location', placeholder: 'Filter by location', testId: 'input-list-candidate-location' },
            ] as const).map(field => {
              const value = candidateFilters[field.key];
              const blankOnly = value === LIST_CANDIDATE_FILTER_UNSET;
              return <label key={field.key} className="block min-w-0">
                <span className="mb-1 block text-[10px] font-semibold text-[#536276]">{field.label}</span>
                <input
                  data-testid={field.testId}
                  value={blankOnly ? '' : value}
                  onChange={event => updateCandidateFilter(field.key, event.target.value)}
                  disabled={blankOnly}
                  placeholder={field.placeholder}
                  className="h-9 w-full rounded-md border border-[#d3dce7] bg-white px-2.5 text-[11px] text-[#29394c] placeholder:text-[#9aa6b4] disabled:bg-[#f0f2f5]"
                />
                <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#68788c]">
                  <input type="checkbox" data-testid={`checkbox-list-candidate-${field.key}-blank`} checked={blankOnly} onChange={event => updateCandidateFilter(field.key, event.currentTarget.checked ? LIST_CANDIDATE_FILTER_UNSET : '')} className="accent-[#174f99]"/>
                  Blank only
                </span>
              </label>;
            })}
            <label className="block min-w-0">
              <span className="mb-1 block text-[10px] font-semibold text-[#536276]">Lead source</span>
              <select data-testid="select-list-candidate-lead-source" value={candidateFilters.leadSource} onChange={event => updateCandidateFilter('leadSource', event.target.value)} className="h-9 w-full rounded-md border border-[#d3dce7] bg-white px-2.5 text-[11px] text-[#29394c]">
                <option value="all">Any source</option>
                <option value={LIST_CANDIDATE_FILTER_UNSET}>Blank only</option>
                {(memberFilterOptionsQuery.data?.leadSources ?? []).map(source => <option key={source} value={source}>{source}</option>)}
              </select>
            </label>
          </div>
        </div>
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
        </div> : (contactOptionsQuery.data?.total ?? 0) === 0 && !contactSearch.trim() && activeCandidateFilterCount === 0 && !onlyUnattachedContacts && contactsQuery.data?.workspaceTotal === 0 ? <div className="mt-3 rounded-md border border-dashed border-[#d9dfe6] bg-white px-4 py-5 text-center"><p className="text-[11px] text-[#7b8794]">No contacts are in this workspace yet.</p><Button variant="outline" className="mt-3" testId="button-go-to-contacts-to-create" onClick={() => { setViewingList(null); setLocation('/contacts'); }}>Go to Contacts</Button></div> : <p className="mt-3 rounded-md border border-dashed border-[#d9dfe6] bg-white px-4 py-5 text-center text-[11px] text-[#7b8794]">{contactSearch.trim() || activeCandidateFilterCount > 0 || onlyUnattachedContacts ? 'No contacts match your filters.' : 'All workspace contacts already belong to this list.'}</p>}
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[12px] font-semibold text-[#344154]">Contacts in this list</h3>
            <p className="mt-1 text-[10px] text-[#7b8794]">
              Showing {(contactsQuery.data?.total ?? 0).toLocaleString()} of {viewingList.contactCount.toLocaleString()} members.
            </p>
            <p className="mt-1 text-[10px] text-[#7b8794]">Choose a destination in “Move to list” to remove that contact from every other list.</p>
          </div>
        </div>
      {contactsQuery.isLoading ? <p className="text-[11px] text-[#7b8794]">Loading list members…</p>
        : contactsQuery.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]"><span>List members could not be loaded.</span><Button variant="outline" className="min-h-8 px-3 text-[11px]" testId="button-retry-list-members" onClick={() => void contactsQuery.refetch()}>Retry</Button></div>
      : viewingContacts.length ? <div className="max-h-[36vh] overflow-y-auto rounded-md border border-[#e7ebef]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_minmax(150px,0.8fr)] gap-3 border-b border-[#e7ebef] bg-[#f8fafb] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#7e8996]"><span>Contact</span><span>Email</span><span>Status</span><span>Move to list</span></div>
        {viewingContacts.map(contact => {
          const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email;
          const pendingMove = pendingMembershipIds.has(contact.id);
          const moveTargets = lists.filter(list => list.id !== viewingList.id);
          return <div key={contact.id} data-testid={`row-list-contact-${contact.id}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_minmax(150px,0.8fr)] items-center gap-3 border-b border-[#edf0f2] px-4 py-3 last:border-b-0">
            <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#29384a]">{displayName}</div>{contact.companyName && <div className="mt-0.5 truncate text-[10px] text-[#87919d]">{contact.companyName}</div>}</div>
            <a className="truncate text-[11px] text-[#365f8b] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>
            <Status tone={contact.subscribed ? 'green' : 'gray'}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</Status>
            <select
              aria-label={`Move ${displayName} to another list`}
              data-testid={`select-move-contact-${contact.id}`}
              value=""
              disabled={pendingMove || moveTargets.length === 0}
              onChange={event => { if (event.target.value) void moveContactToList(contact, event.target.value); }}
              className="h-8 min-w-0 rounded-md border border-[#d3dce7] bg-white px-2 text-[10px] text-[#415166] disabled:bg-[#f4f6f8]"
            >
              <option value="">{pendingMove ? 'Moving…' : moveTargets.length ? 'Move to…' : 'No other lists'}</option>
              {moveTargets.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
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

type CampaignForm = {
  name: string;
  objective: string;
  subjectVariants: string[];
  greetingVariants: string[];
  signatureVariants: string[];
  textBody: string;
  htmlBody: string;
  listIds: string[];
  senderAccountId: string;
  excludedContactIds: string[];
  attachments: Array<{ objectPath: string; name: string; size: number }>;
};
type CampaignVariantField = 'subjectVariants' | 'greetingVariants' | 'signatureVariants';
type CampaignAiBrief = {
  persona: string;
  promotion: string;
  goal: string;
  desiredAction: string;
  guidance: string;
};
const emptyCampaignAiBrief: CampaignAiBrief = {
  persona: '',
  promotion: '',
  goal: '',
  desiredAction: '',
  guidance: '',
};
const campaignAiBriefQuestions: Array<{ field: keyof CampaignAiBrief; label: string; placeholder: string }> = [
  { field: 'persona', label: 'Who is the target persona?', placeholder: 'Describe the audience you want to reach.' },
  { field: 'promotion', label: 'What product or service are you promoting?', placeholder: 'Name it and describe the main benefit.' },
  { field: 'goal', label: 'What is the goal of this campaign?', placeholder: 'For example: introduce an offer, drive registrations, or re-engage customers.' },
  { field: 'desiredAction', label: 'What should the recipient do next?', placeholder: 'Describe the single action you want them to take.' },
  { field: 'guidance', label: 'What details should the email include or avoid?', placeholder: 'Add key facts, offer terms, tone, or anything the email must not claim.' },
];
function campaignBriefWordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
function capCampaignBriefWords(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > 50 ? words.slice(0, 50).join(' ') : value;
}
const blankCampaign: CampaignForm = {
  name: '',
  objective: '',
  subjectVariants: [''],
  greetingVariants: [''],
  signatureVariants: [''],
  textBody: '',
  htmlBody: '',
  listIds: [],
  senderAccountId: '',
  excludedContactIds: [],
  attachments: [],
};

export function CampaignsPage({ maintenancePaused = false }: { maintenancePaused?: boolean } = {}) {
  const [, setLocation] = useLocation();
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [debouncedCampaignSearch, setDebouncedCampaignSearch] = useState('');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('all');
  const [campaignTypeFilter, setCampaignTypeFilter] = useState('all');
  const [campaignListFilter, setCampaignListFilter] = useState('all');
  const [campaignDateFilter, setCampaignDateFilter] = useState('all');
  const [campaignHistoryPage, setCampaignHistoryPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedCampaignSearch(campaignSearch),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [campaignSearch]);
  const campaignHistoryParams: GetCampaignHistoryParams = {
    page: campaignHistoryPage,
    pageSize: 25,
    search: debouncedCampaignSearch.trim() || undefined,
    status: campaignStatusFilter as GetCampaignHistoryParams['status'],
    campaignType: campaignTypeFilter as GetCampaignHistoryParams['campaignType'],
    listId: campaignListFilter === 'all' ? undefined : campaignListFilter,
    createdWithinDays:
      campaignDateFilter === 'all'
        ? undefined
        : (Number(campaignDateFilter) as GetCampaignHistoryParams['createdWithinDays']),
  };
  const campaignsQuery = useGetCampaignHistory(campaignHistoryParams);
  const listsQuery = useListContactLists(); const senderAccountsQuery = useListTenantSendingAccounts();
  const variantLimitsQuery = useGetCampaignVariantLimits();
  const attachmentAvailabilityQuery = useGetCampaignAttachmentAvailability({
    query: {
      queryKey: getGetCampaignAttachmentAvailabilityQueryKey(),
      staleTime: 60_000,
    },
  });
  const campaignPdfUploadAvailable = attachmentAvailabilityQuery.data?.available === true;
  const create = useCreateCampaign(); const createFollowUp = useCreateCampaignFollowUp(); const update = useUpdateCampaign(); const remove = useDeleteCampaign(); const send = useSendCampaign(); const pauseCampaign = useSetCampaignPaused();
  const rescheduleCampaign = useRescheduleCampaign();
  const cancelPausedCampaign = useCancelPausedCampaign();
  const previewCampaign = usePreviewCampaign();
  const aiAssist = useGenerateCampaignEmailDraft();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [editing, setEditing] = useState<CampaignSummary | null | undefined>(undefined); const [form, setForm] = useState<CampaignForm>(blankCampaign);
  const [campaignStep, setCampaignStep] = useState(0);
  const [campaignStepError, setCampaignStepError] = useState('');
  const [campaignReviewListId, setCampaignReviewListId] = useState('');
  const [campaignReviewPage, setCampaignReviewPage] = useState(1);
  const [campaignReviewSearch, setCampaignReviewSearch] = useState('');
  const [campaignContentError, setCampaignContentError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const addOnCreditsQuery = useGetSubscriptionAddOns({
    query: {
      queryKey: getGetSubscriptionAddOnsQueryKey(),
      enabled: editing !== undefined,
      staleTime: 0,
    },
  });
  const [audienceActionPending, setAudienceActionPending] = useState(false);
  const audienceActionInProgress = useRef(false);
  const [campaignListSearch, setCampaignListSearch] = useState('');
  const [showSelectedCampaignLists, setShowSelectedCampaignLists] = useState(false);
  const [collapsedCampaignIds, setCollapsedCampaignIds] = useState<Set<string>>(() => new Set());
  const [sampleContactId, setSampleContactId] = useState('');
  const [aiDraftPreview, setAiDraftPreview] = useState<{ subject: string; greeting: string; body: string; signature: string; remaining: number } | null>(null);
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [aiBriefFormOpen, setAiBriefFormOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState<CampaignAiBrief>(emptyCampaignAiBrief);
  const [aiDraftMaxWords, setAiDraftMaxWords] = useState<50 | 100 | 150 | 200>(100);
  const [placeholderTarget, setPlaceholderTarget] = useState<{ field: CampaignVariantField; index: number }>({ field: 'subjectVariants', index: 0 });
  const [previewState, setPreviewState] = useState<{ key: string; rendered: CampaignTemplatePreview } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ kind: 'queue' | 'delete'; campaign: CampaignSummary } | null>(null);
  const [queueStartAt, setQueueStartAt] = useState('');
  const [serverMinimumStartAt, setServerMinimumStartAt] = useState<Date | null>(null);
  const [queueStartError, setQueueStartError] = useState<string | null>(null);
  const [queuePolicyError, setQueuePolicyError] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<CampaignSummary | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<CampaignSummary | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CampaignSummary | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [pausedScheduleConflicts, setPausedScheduleConflicts] = useState<Array<{ campaignId: string; campaignName: string }>>([]);
  const campaignHistory = campaignsQuery.data as CampaignHistory | undefined;
  const campaigns = campaignHistory?.campaigns ?? [];
  const activeCampaignFinishAt = campaignHistory?.summary.activeCampaignFinishAt
    ? new Date(campaignHistory.summary.activeCampaignFinishAt)
    : null;
  const effectiveServerMinimumStartAt =
    serverMinimumStartAt && activeCampaignFinishAt
      ? new Date(Math.max(serverMinimumStartAt.getTime(), activeCampaignFinishAt.getTime()))
      : serverMinimumStartAt ?? activeCampaignFinishAt;
  const lists = (listsQuery.data || []) as ContactList[];
  const campaignReviewParams = {
    page: campaignReviewPage,
    pageSize: 25,
    includeHistory: false,
    search: campaignReviewSearch,
    status: 'all' as const,
    listId: campaignReviewListId || 'all',
    companyId: 'all',
    lifecycleStage: 'all',
    leadStatus: 'all',
    leadSource: 'all',
    addedWithin: 'any' as const,
  };
  const campaignReviewContactsQuery = useListContacts(campaignReviewParams, {
    query: {
      queryKey: getListContactsQueryKey(campaignReviewParams),
      enabled: editing !== undefined && campaignStep === 1 && Boolean(campaignReviewListId),
    },
  });
  const campaignReviewContacts = campaignReviewContactsQuery.data?.contacts ?? [];
  const campaignReviewError = campaignReviewContactsQuery.error;
  const campaignReviewErrorStatus = campaignReviewError && typeof campaignReviewError === 'object' && 'status' in campaignReviewError && typeof campaignReviewError.status === 'number'
    ? campaignReviewError.status
    : null;
  const campaignTree = useMemo(() => {
    const contextIds = new Set(campaignHistory?.contextCampaignIds ?? []);
    const byId = new Map(campaigns.map(campaign => [campaign.id, campaign]));
    const children = new Map<string, CampaignSummary[]>();
    const roots: CampaignSummary[] = [];
    for (const campaign of campaigns) {
      const parent = campaign.parentCampaignId ? byId.get(campaign.parentCampaignId) : undefined;
      if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), campaign]);
      else roots.push(campaign);
    }
    const newestFirst = (items: CampaignSummary[]) => items.sort((a, b) => {
      const createdAtOrder = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return createdAtOrder || b.id.localeCompare(a.id);
    });
    newestFirst(roots);
    for (const items of children.values()) newestFirst(items);
    const visible = new Set(campaigns.map(campaign => campaign.id));
    const rows: Array<{ campaign: CampaignSummary; depth: number; hasChildren: boolean; contextOnly: boolean }> = [];
    const parentIds = new Set<string>();
    const walk = (campaign: CampaignSummary, depth: number, path: Set<string>) => {
      if (!visible.has(campaign.id) || path.has(campaign.id)) return;
      const visibleChildren = (children.get(campaign.id) ?? []).filter(child => visible.has(child.id));
      const hasChildren = visibleChildren.length > 0;
      if (hasChildren) parentIds.add(campaign.id);
      rows.push({ campaign, depth, hasChildren, contextOnly: contextIds.has(campaign.id) });
      if (!hasChildren || collapsedCampaignIds.has(campaign.id)) return;
      const nextPath = new Set(path).add(campaign.id);
      for (const child of visibleChildren) walk(child, depth + 1, nextPath);
    };
    for (const root of roots) walk(root, 0, new Set());
    // Include campaigns with missing parent records as top-level entries.
    for (const campaign of campaigns) if (!campaign.parentCampaignId && !rows.some(row => row.campaign.id === campaign.id)) walk(campaign, 0, new Set());
    return { rows, parentIds };
  }, [campaigns, campaignHistory?.contextCampaignIds, collapsedCampaignIds]);
  const senderAccounts = senderAccountsQuery.data?.accounts ?? [];
  const aiAssistBalance = addOnCreditsQuery.data?.balances.emailAssist;
  const aiAssistAvailable = Boolean(
    addOnCreditsQuery.data?.eligible &&
    aiAssistBalance &&
    aiAssistBalance.remaining > 0,
  );
  const variantLimits = variantLimitsQuery.data ?? {
    subject: { minimum: 3, maximum: 7 },
    greeting: { minimum: 3, maximum: 7 },
    signature: { minimum: 3, maximum: 7 },
  };
  const variantLimitsByField = {
    subjectVariants: variantLimits.subject,
    greetingVariants: variantLimits.greeting,
    signatureVariants: variantLimits.signature,
  };
  const primarySenderAccountId = senderAccounts.find(account => account.isPrimary)?.id ?? senderAccounts[0]?.id ?? '';
  const updateVariant = (field: CampaignVariantField, index: number, value: string) => {
    setForm(current => {
      const values = [...current[field]];
      values[index] = value;
      return { ...current, [field]: values };
    });
  };
  const addVariant = (field: CampaignVariantField) => {
    setForm(current => {
      if (current[field].length >= variantLimitsByField[field].maximum) return current;
      return { ...current, [field]: [...current[field], ''] };
    });
  };
  const removeVariant = (field: CampaignVariantField, index: number) => {
    setForm(current => {
      const values = current[field].filter((_, valueIndex) => valueIndex !== index);
      return { ...current, [field]: values.length ? values : [''] };
    });
    setPlaceholderTarget(current => {
      if (current.field !== field || current.index < index) return current;
      return {
        field,
        index: current.index === index ? Math.max(0, index - 1) : current.index - 1,
      };
    });
  };
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
  const baseQueueMinimumStartAt = minimumCampaignStartAt(campaigns, effectiveServerMinimumStartAt);
  const followUpParent = pendingAction?.kind === 'queue' && pendingAction.campaign.parentCampaignId
    ? campaigns.find(campaign => campaign.id === pendingAction.campaign.parentCampaignId)
    : undefined;
  const followUpCompletionMinimum = followUpParent?.completedAt
    ? new Date(new Date(followUpParent.completedAt).getTime() + 24 * 60 * 60 * 1000)
    : null;
  const queueMinimumStartAt = followUpCompletionMinimum && followUpCompletionMinimum > baseQueueMinimumStartAt
    ? followUpCompletionMinimum
    : baseQueueMinimumStartAt;
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
  const hasActiveCampaigns = (campaignHistory?.summary.activeCampaignCount ?? 0) > 0 ||
    campaigns.some(campaign => campaign.status === 'queued' || campaign.status === 'sending');
  const eligibleSampleContacts = useMemo(() => {
    const listPriority = new Map(form.listIds.map((listId, index) => [listId, index]));
    const eligible = contacts
      .filter(contact => contact.subscribed && !form.excludedContactIds.includes(contact.id) && contact.listIds.some(listId => listPriority.has(listId)))
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
  }, [contacts, form.excludedContactIds, form.listIds]);
  useEffect(() => {
    if (sampleContactId && !eligibleSampleContacts.some(contact => contact.id === sampleContactId)) {
      setSampleContactId('');
    }
  }, [eligibleSampleContacts, sampleContactId]);
  useEffect(() => {
    if (campaignReviewListId && form.listIds.includes(campaignReviewListId)) return;
    setCampaignReviewListId(form.listIds[0] ?? '');
    setCampaignReviewPage(1);
  }, [campaignReviewListId, form.listIds]);
  const previewKey = JSON.stringify([form.listIds, sampleContactId, form.subjectVariants, form.greetingVariants, form.signatureVariants, form.textBody, form.htmlBody]);
  const visiblePreview = previewState?.key === previewKey ? previewState.rendered : null;
  const visiblePreviewError = previewError?.key === previewKey ? previewError.message : null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetCampaignHistoryQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); };
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil((campaignHistory?.total ?? 0) / 25));
    if (campaignHistoryPage > lastPage) setCampaignHistoryPage(lastPage);
  }, [campaignHistory?.total, campaignHistoryPage]);
  const closeCampaignEditor = () => { setEditing(undefined); setCampaignContentError(null); setCampaignStepError(''); setAiBriefFormOpen(false); setAiBrief(emptyCampaignAiBrief); };
  const continueCampaignStep = () => {
    setCampaignStepError('');
    if (campaignStep === 0 && !form.name.trim()) return setCampaignStepError('Enter an internal campaign name to continue.');
    if (campaignStep === 1) {
      if (!form.listIds.length) return setCampaignStepError('Select at least one active list.');
      if (!audienceCheckReady) return setCampaignStepError('Wait for the audience check to finish, or retry it before continuing.');
    }
    if (campaignStep === 2 && (!form.subjectVariants.some(value => value.trim()) || !form.textBody.trim())) {
      return setCampaignStepError('Add at least one subject line and a message body before continuing.');
    }
    setCampaignStep(step => Math.min(3, step + 1));
  };
  const toggleCampaignContact = (contactId: string, include: boolean) => {
    setForm(current => ({
      ...current,
      excludedContactIds: include
        ? current.excludedContactIds.filter(id => id !== contactId)
        : current.excludedContactIds.includes(contactId) ? current.excludedContactIds : [...current.excludedContactIds, contactId],
    }));
  };
  const openNew = () => { dismiss(); setCampaignContentError(null); setAttachmentError(''); setCampaignStepError(''); setCampaignStep(0); setEditing(null); const listIds = activeLists[0]?.id ? [activeLists[0].id] : []; setForm({ ...blankCampaign, listIds, senderAccountId: primarySenderAccountId }); setCampaignReviewListId(listIds[0] ?? ''); setCampaignReviewPage(1); setCampaignReviewSearch(''); setPlaceholderTarget({ field: 'subjectVariants', index: 0 }); setCampaignListSearch(''); setShowSelectedCampaignLists(false); setSampleContactId(''); setPreviewState(null); setPreviewError(null); setAiDraftPreview(null); setAiDraftError(null); setAiBriefFormOpen(false); setAiBrief(emptyCampaignAiBrief); setAiDraftMaxWords(100); };
  const openEdit = (campaign: CampaignSummary) => { dismiss(); setCampaignContentError(null); setAttachmentError(''); setCampaignStepError(''); setCampaignStep(0); setEditing(campaign); const listIds = campaign.listIds?.length ? [...campaign.listIds] : campaign.listId ? [campaign.listId] : []; setForm({ name: campaign.name, objective: campaign.objective ?? '', subjectVariants: campaign.subjectVariants?.length ? [...campaign.subjectVariants] : [campaign.subject], greetingVariants: campaign.greetingVariants?.length ? [...campaign.greetingVariants] : [''], signatureVariants: campaign.signatureVariants?.length ? [...campaign.signatureVariants] : [''], textBody: campaign.textBody, htmlBody: campaign.htmlBody ?? plainTextToHtml(campaign.textBody), listIds, senderAccountId: campaign.senderAccountId ?? primarySenderAccountId, excludedContactIds: campaign.excludedContactIds ?? [], attachments: campaign.attachments ?? [] }); setCampaignReviewListId(listIds[0] ?? ''); setCampaignReviewPage(1); setCampaignReviewSearch(''); setPlaceholderTarget({ field: 'subjectVariants', index: 0 }); setCampaignListSearch(''); setShowSelectedCampaignLists(false); setSampleContactId(''); setPreviewState(null); setPreviewError(null); setAiDraftPreview(null); setAiDraftError(null); setAiBriefFormOpen(false); setAiBrief(emptyCampaignAiBrief); setAiDraftMaxWords(100); };
  const uploadCampaignAttachment = async (file: File) => {
    setAttachmentError('');
    if (!campaignPdfUploadAvailable) {
      setAttachmentError('PDF uploads are unavailable because document storage is not configured. You can continue without an attachment.');
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (!/\.pdf$/i.test(file.name) || file.size < 1 || file.size > maxBytes) {
      setAttachmentError('Choose a PDF file no larger than 5 MB.');
      return;
    }
    if (form.attachments.length >= 2 || form.attachments.reduce((sum, file) => sum + file.size, 0) + file.size > maxBytes) {
      setAttachmentError('A campaign can include up to two PDFs with a combined size no greater than 5 MB.');
      return;
    }
    setUploadingAttachment(true);
    try {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (new TextDecoder().decode(header) !== '%PDF-') throw new Error('The selected file is not a valid PDF.');
      const response = await fetch(`/api/campaigns/attachments/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: file,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? 'Could not store the PDF.');
      }
      const attachment = await response.json();
      setForm(current => ({
        ...current,
        attachments: [...current.attachments, attachment],
      }));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not upload this PDF.');
    } finally {
      setUploadingAttachment(false);
    }
  };
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
        subject: form.subjectVariants.find(value => value.trim()) ?? '',
        subjectVariants: form.subjectVariants.map(value => value.trim()).filter(Boolean),
        greetingVariants: form.greetingVariants.map(value => value.trim()).filter(Boolean),
        signatureVariants: form.signatureVariants.map(value => value.trim()).filter(Boolean),
        textBody: form.textBody,
        htmlBody: form.htmlBody,
      },
    }, {
      onSuccess: rendered => setPreviewState({ key, rendered }),
      onError: error => setPreviewError({ key, message: mutationError(error) }),
    });
  };
  const insertPlaceholder = (field: CampaignVariantField, index: number, token: string) => {
    if (field === 'subjectVariants' && index === 0) {
      const input = subjectInputRef.current;
      const currentSubject = form.subjectVariants[0] ?? '';
      const start = input?.selectionStart ?? currentSubject.length;
      const end = input?.selectionEnd ?? start;
      const subject = `${currentSubject.slice(0, start)}${token}${currentSubject.slice(end)}`;
      updateVariant(field, index, subject);
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    setForm(current => {
      const values = [...current[field]];
      const currentValue = values[index] ?? '';
      const spacer = currentValue && !/\s$/.test(currentValue) ? ' ' : '';
      values[index] = `${currentValue}${spacer}${token}`;
      return { ...current, [field]: values };
    });
  };
  const insertSubjectPlaceholder = (token: string) =>
    insertPlaceholder('subjectVariants', 0, token);
  const requestAiDraft = () => {
    if (Object.values(aiBrief).some(answer => !answer.trim())) {
      setAiDraftError('Answer all five questions to give AI Email Assist a useful brief.');
      return;
    }
    setAiDraftError(null);
    setAiDraftPreview(null);
    aiAssist.mutate({
      data: {
        ...(form.objective.trim() ? { objective: form.objective.trim() } : {}),
        ...aiBrief,
        maxWords: aiDraftMaxWords,
        ...(form.textBody.trim() ? { currentBody: form.textBody.trim() } : {}),
      },
    }, {
      onSuccess: result => {
        setAiDraftPreview({ ...result.draft, remaining: result.usage.remaining });
        setAiBriefFormOpen(false);
        void qc.invalidateQueries({ queryKey: getGetSubscriptionAddOnsQueryKey() });
      },
      onError: error => {
        const apiError = error as { data?: { code?: string } };
        if (apiError.data?.code === 'AI_EMAIL_ASSIST_ALLOWANCE_EXHAUSTED') {
          void qc.invalidateQueries({ queryKey: getGetSubscriptionAddOnsQueryKey() });
        }
        setAiDraftError(mutationError(error));
      },
    });
  };
  const applyAiDraft = () => {
    if (!aiDraftPreview) return;
    setForm(current => ({
      ...current,
      subjectVariants: [aiDraftPreview.subject, ...current.subjectVariants.slice(1)],
      greetingVariants: [aiDraftPreview.greeting, ...current.greetingVariants.slice(1)],
      signatureVariants: [aiDraftPreview.signature, ...current.signatureVariants.slice(1)],
      textBody: aiDraftPreview.body,
      htmlBody: plainTextToHtml(aiDraftPreview.body),
    }));
    setAiDraftPreview(null);
    setAiDraftError(null);
    setPreviewState(null);
    setPreviewError(null);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.listIds.length || !audienceCheckReady || audienceActionInProgress.current) return;
    setCampaignContentError(null);
    audienceActionInProgress.current = true;
    setAudienceActionPending(true);
    const subjectVariants = form.subjectVariants.map(value => value.trim()).filter(Boolean);
    const greetingVariants = form.greetingVariants.map(value => value.trim()).filter(Boolean);
    const signatureVariants = form.signatureVariants.map(value => value.trim()).filter(Boolean);
    const data = {
      name: form.name.trim(),
      objective: form.objective.trim(),
      subject: subjectVariants[0] ?? '',
      subjectVariants,
      greetingVariants,
      signatureVariants,
      textBody: form.textBody.trim(),
      htmlBody: form.htmlBody.trim(),
      listIds: [...form.listIds],
      excludedContactIds: [...form.excludedContactIds],
      attachments: [...form.attachments],
      senderAccountId: form.senderAccountId || null,
    };
    try {
      const audience = await campaignAudienceQuery.refetch();
      if (audience.isError || !audience.data) {
        setNotice({ kind: 'error', text: 'We couldn’t verify the current audience. Retry before saving this campaign.' });
        return;
      }
      const success = () => { refresh(); closeCampaignEditor(); setNotice({ kind: 'success', text: editing ? 'Draft changes saved.' : 'Campaign draft created.' }); };
      const fail = (error: unknown) => {
        const errorData = error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object'
          ? error.data as { code?: unknown }
          : null;
        if (errorData?.code === 'PROFANITY_BLOCKED') {
          setCampaignContentError(mutationError(error));
          return;
        }
        setNotice({ kind: 'error', text: mutationError(error) });
      };
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
    setQueuePolicyError(null);
    setQueueStartAt(dateTimeLocalValue(minimumCampaignStartAt(campaigns, effectiveServerMinimumStartAt)));
    setPendingAction({ kind: 'queue', campaign });
  };
  const del = (campaign: CampaignSummary) => setPendingAction({ kind: 'delete', campaign });
  const openReschedule = (campaign: CampaignSummary) => {
    setRescheduleTarget(campaign);
    setRescheduleAt(campaign.scheduledAt ? dateTimeLocalValue(new Date(campaign.scheduledAt)) : '');
    setPausedScheduleConflicts([]);
  };
  const submitReschedule = () => {
    if (!rescheduleTarget || !rescheduleAt) return;
    const date = new Date(rescheduleAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      setNotice({ kind: 'error', text: 'Choose a new start time in the future.' });
      return;
    }
    rescheduleCampaign.mutate({
      campaignId: rescheduleTarget.id,
      data: { scheduledAt: date.toISOString(), confirmPausedConflicts: pausedScheduleConflicts.length > 0 },
    }, {
      onSuccess: result => {
        setRescheduleTarget(null);
        setPausedScheduleConflicts([]);
        refresh();
        const cancelled = result.cancelledPausedSchedules.length;
        setNotice({ kind: 'success', text: `Campaign rescheduled for ${formatDate(result.scheduledAt)}.${cancelled ? ` ${cancelled} paused campaign schedule${cancelled === 1 ? ' was' : 's were'} cancelled; those campaigns remain paused and must be scheduled again manually.` : ''}` });
      },
      onError: error => {
        const apiError = (error as { data?: { code?: string; campaigns?: Array<{ campaignId: string; campaignName: string }> } }).data;
        if (apiError?.code === 'PAUSED_CAMPAIGN_SCHEDULE_CONFLICT' && apiError.campaigns?.length) {
          setPausedScheduleConflicts(apiError.campaigns);
          return;
        }
        setNotice({ kind: 'error', text: mutationError(error) });
      },
    });
  };
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
          onSuccess: response => { setPendingAction(null); setQueuePolicyError(null); refresh(); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); setNotice({ kind: 'success', text: response.scheduledAt ? `Campaign scheduled for ${formatDate(response.scheduledAt)}.` : `Campaign status: ${response.status}.` }); },
          onError: error => {
            const apiError = (error as { data?: { code?: string; earliestStartAt?: string | null } }).data;
            if (apiError?.code === 'CAMPAIGN_START_TOO_EARLY' && apiError.earliestStartAt) {
              const earliest = new Date(apiError.earliestStartAt);
              setServerMinimumStartAt(earliest);
              setQueueStartAt(dateTimeLocalValue(roundUpToMinute(earliest)));
              setQueueStartError(`Delivery estimates changed. The earliest available start is ${formatDate(apiError.earliestStartAt)}.`);
              return;
            }
            if (apiError?.code === 'PROFANITY_BLOCKED') {
              setQueuePolicyError(mutationError(error));
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
  const campaignSummary = campaignHistory?.summary;
  const totalDelivered = campaignSummary?.delivered ?? 0;
  const totalBounced = campaignSummary?.bounced ?? 0;
  const campaignBestPractices = [
    { title: 'Keep the campaign small', detail: 'Start with a focused segment and increase gradually within your mailbox sending limits.' },
    { title: 'Research the message before setup', detail: 'Check facts, claims, links, and the offer so every part is relevant and accurate.' },
    { title: 'Match contacts to the persona', detail: 'Choose people whose role, needs, and context fit what the campaign is about.' },
    { title: 'Set a precise objective', detail: 'Choose one clear outcome and make the message and call to action support it.' },
    { title: 'Make follow-ups meaningfully different', detail: 'Use new research and prior engagement to add useful context instead of repeating the first email.' },
    { title: 'Respect consent and suppression', detail: 'Send only to eligible subscribed contacts; honor unsubscribes and suppress confirmed bounces.' },
    { title: 'Personalize with verified context', detail: 'Use accurate details that help the recipient; avoid guesses and generic name-only personalization.' },
    { title: 'Preview and test before queueing', detail: 'Check a sample contact, placeholders, sender, links, and the unsubscribe option.' },
    { title: 'Schedule thoughtfully and review replies', detail: 'Use reasonable timing, watch responses and bounce evidence, and pause to investigate unexpected issues.' },
  ];
  return <QueryState loading={campaignsQuery.isLoading || listsQuery.isLoading || variantLimitsQuery.isLoading} error={campaignsQuery.isError || listsQuery.isError || variantLimitsQuery.isError} retry={() => { void campaignsQuery.refetch(); void listsQuery.refetch(); void variantLimitsQuery.refetch(); }} label="campaigns"><>
    <Heading eyebrow="DELIVERY / CAMPAIGNS" title="Campaigns" detail="Manage drafts and delivery. Estimates include current queued work and shared sending limits; SMTP response times and retries can change actual finish times." action={<Button testId="button-create-campaign" onClick={openNew} disabled={!activeLists.length}><CirclePlus className="h-4 w-4"/>New campaign</Button>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    {!activeLists.length && <div className="mb-5 flex items-start gap-3 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-4 py-3 text-[12px] leading-5 text-[#895b2f]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>Activate a contact list before creating a campaign. Drafts can only target active lists.</span></div>}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eef5ff', borderColor: '#d7e4f3' }}><div className="text-[11px] text-[#536d89]">Campaigns</div><div className="display mt-2 text-[26px] font-bold text-[#245b9b]">{(campaignSummary?.campaignCount ?? 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#6f8092]">{(campaignSummary?.draftCount ?? 0).toLocaleString()} drafts · {(campaignSummary?.nonDraftCount ?? 0).toLocaleString()} queued or sent</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#eff8f1', borderColor: '#d5ead9' }}><div className="text-[11px] text-[#5f7c67]">SMTP accepted</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{totalDelivered.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#6f8092]">Inbox delivery is not confirmed</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#fff5eb', borderColor: '#f0dfcb' }}><div className="text-[11px] text-[#8b6747]">Rejected / failed</div><div className="display mt-2 text-[26px] font-bold text-[#ae642c]">{totalBounced.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#816f5f]">Includes matched provider bounce or failure reports</div></div><div className={`${panelClass} p-4`} style={{ backgroundColor: '#f3f5f8', borderColor: '#dfe4e9' }}><div className="text-[11px] text-[#677484]">Suppressed</div><div className="display mt-2 text-[26px] font-bold text-[#596675]">{(campaignSummary?.suppressed ?? 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#738092]">Unsubscribed or removed before send</div></div></div>
         <details data-testid="campaign-best-practices" className={`${panelClass} group mb-5 overflow-hidden bg-[#f7f9fc]`}>
           <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-[#fff3e8] px-4 py-3 transition-colors hover:bg-[#ffecdc] marker:hidden [&::-webkit-details-marker]:hidden group-open:border-b group-open:border-[#efd3b5] sm:px-5">
             <span>
               <span id="campaign-best-practices-heading" className="display block text-[16px] font-bold text-[#57391f]">Campaign best practices</span>
               <span className="mt-1 block text-[12px] leading-5 text-[#724d33]">A few practical checks for relevant, respectful campaigns and clearer results.</span>
             </span>
             <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8e562d] transition-transform group-open:rotate-180"/>
           </summary>
           <ul aria-labelledby="campaign-best-practices-heading" className="grid gap-2 border-t border-[#e1e6ed] p-3 sm:grid-cols-2 sm:p-4 2xl:grid-cols-3">
             {campaignBestPractices.map((item, index) => <li key={item.title} className="flex gap-2.5 rounded-md border border-[#e4e8ee] bg-white p-3">
               <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#eaf1fa] text-[10px] font-bold text-[#245b9b]">{index + 1}</span>
               <span><strong className="block text-[12px] font-semibold leading-5 text-[#27364a]">{item.title}</strong><span className="mt-0.5 block text-[12px] leading-[1.55] text-[#46556a]">{item.detail}</span></span>
             </li>)}
           </ul>
         </details>
        <section data-testid="campaign-filters" className={`${panelClass} mb-5 p-4 sm:p-5`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="display text-[16px] font-bold text-[#1b293a]">Find a campaign</h2><p className="mt-1 text-[11px] text-[#778393]">Search names, subjects, objectives, or senders; filter the tree without losing parent context.</p></div>
            <Button variant="outline" testId="button-reset-campaign-filters" onClick={() => { setCampaignSearch(''); setDebouncedCampaignSearch(''); setCampaignStatusFilter('all'); setCampaignTypeFilter('all'); setCampaignListFilter('all'); setCampaignDateFilter('all'); setCampaignHistoryPage(1); }} disabled={!campaignSearch && campaignStatusFilter === 'all' && campaignTypeFilter === 'all' && campaignListFilter === 'all' && campaignDateFilter === 'all'}><X className="h-3.5 w-3.5"/>Reset filters</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,2fr)_repeat(4,minmax(140px,1fr))]">
            <label><span className={labelClass}>Search campaigns</span><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8290a0]"/><input data-testid="input-campaign-search" className={`${inputClass} pl-9`} placeholder="Name, subject, objective, sender" value={campaignSearch} onChange={event => { setCampaignSearch(event.target.value); setCampaignHistoryPage(1); }}/></div></label>
            <label><span className={labelClass}>Status</span><select data-testid="select-campaign-status-filter" className={inputClass} value={campaignStatusFilter} onChange={event => { setCampaignStatusFilter(event.target.value); setCampaignHistoryPage(1); }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="queued">Queued</option><option value="scheduled">Scheduled</option><option value="sending">Sending</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label>
            <label><span className={labelClass}>Campaign type</span><select data-testid="select-campaign-type-filter" className={inputClass} value={campaignTypeFilter} onChange={event => { setCampaignTypeFilter(event.target.value); setCampaignHistoryPage(1); }}><option value="all">Primary + follow-ups</option><option value="primary">Primary only</option><option value="follow_up">Follow-ups</option></select></label>
            <label><span className={labelClass}>Audience list</span><select data-testid="select-campaign-list-filter" className={inputClass} value={campaignListFilter} onChange={event => { setCampaignListFilter(event.target.value); setCampaignHistoryPage(1); }}><option value="all">All lists</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            <label><span className={labelClass}>Created</span><select data-testid="select-campaign-date-filter" className={inputClass} value={campaignDateFilter} onChange={event => { setCampaignDateFilter(event.target.value); setCampaignHistoryPage(1); }}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          </div>
        </section>
     {(campaignHistory?.total ?? 0) > 0 ? <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9edf0] px-4 py-4"><div><h2 className="display text-[17px] font-bold text-[#1b293a]">Campaign tree</h2><p className="mt-1 text-[11px] text-[#788392]">{campaignHistory?.total.toLocaleString()} matching campaigns · page {campaignHistoryPage} of {Math.max(1, Math.ceil((campaignHistory?.total ?? 0) / 25))} · follow-ups include their parent context.</p></div>{campaignTree.parentIds.size > 0 && <Button variant="outline" testId="button-toggle-campaign-tree" onClick={() => setCollapsedCampaignIds(current => [...campaignTree.parentIds].every(id => current.has(id)) ? new Set() : new Set(campaignTree.parentIds))}>{[...campaignTree.parentIds].every(id => collapsedCampaignIds.has(id)) ? 'Expand all' : 'Collapse all'}</Button>}</div>
       <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Campaign</th><th className="px-4 py-3 font-semibold">Audience</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Delivery</th><th className="px-4 py-3 font-semibold">Start / end</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{campaignTree.rows.map(({ campaign, depth, hasChildren, contextOnly }) => <tr key={campaign.id} data-testid={`row-campaign-${campaign.id}`} className="hover:bg-[#fbfcfd]">
        <td className="max-w-[280px] px-5 py-4"><div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: `${depth * 20}px` }}>{hasChildren ? <button type="button" aria-label={`${collapsedCampaignIds.has(campaign.id) ? 'Expand' : 'Collapse'} follow-ups for ${campaign.name}`} data-testid={`button-toggle-campaign-${campaign.id}`} className="mt-0.5 rounded p-1 text-[#63758a] hover:bg-[#eef3f8]" onClick={() => setCollapsedCampaignIds(current => { const next = new Set(current); if (next.has(campaign.id)) next.delete(campaign.id); else next.add(campaign.id); return next; })}>{collapsedCampaignIds.has(campaign.id) ? <ChevronRight className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</button> : <span className="w-6 shrink-0"/>}<button data-testid={`button-campaign-details-${campaign.id}`} onClick={() => setLocation(`/campaigns/${campaign.id}`)} className="min-w-0 text-left"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[12px] font-semibold text-[#26364a] hover:text-[#245b9b]">{campaign.name}</span>{campaign.campaignType === 'follow_up' && <Status tone="blue">Follow-up</Status>}{contextOnly && <span className="text-[9px] text-[#7c8794]">parent context</span>}</span><span className="mt-1 block truncate text-[11px] text-[#7c8794]">{campaign.subject}</span></button></div></td>
        <td className="px-4 py-4"><span className="block text-[11px] font-medium text-[#536172]">{(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).map(listId => lists.find(list => list.id === listId)?.name || 'Removed list').join(' · ') || 'No target lists selected'}</span><span className="mt-1 block text-[10px] text-[#8a95a1]">{campaign.recipients.toLocaleString()} {campaign.status === 'draft' ? 'eligible' : 'total'} recipients</span><span className="mt-0.5 block text-[10px] text-[#8a95a1]">Estimated send: {formatDeliveryDuration(campaign.estimatedDurationSeconds)}</span></td>
        <td className="px-4 py-4"><Status tone={maintenancePaused && (campaign.status === 'queued' || campaign.status === 'sending') || campaign.pausedAt ? 'orange' : statusTone(campaign.status)}>{maintenancePaused && (campaign.status === 'queued' || campaign.status === 'sending') ? 'Maintenance paused' : campaign.pausedAt ? 'Paused' : campaign.status === 'queued' && campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() ? 'scheduled' : campaign.status}</Status></td>
          <td className="px-4 py-4"><div className="flex items-center gap-2 text-[11px]"><span className="font-semibold text-[#397050]">{campaign.delivered.toLocaleString()} accepted</span><span className="text-[#c1c7cd]">/</span><span className="text-[#a85f2a]">{campaign.bounced.toLocaleString()} rejected / failed</span></div><div className="mt-1 text-[10px] text-[#8a95a1]">SMTP acceptance does not confirm inbox delivery · provider bounce/failure reports count as rejected / failed · {campaign.suppressed.toLocaleString()} suppressed · {campaign.unknown.toLocaleString()} unknown · {campaign.queued.toLocaleString()} queued</div></td>
          <td className="px-4 py-4 text-[10px] leading-5 text-[#7b8794]"><span className="block">Start {campaign.scheduledAt || campaign.queuedAt ? formatDate(campaign.scheduledAt || campaign.queuedAt) : '—'}</span><span className="block">End {campaign.completedAt ? formatDate(campaign.completedAt) : '—'}</span>{campaign.pausedAt && <span data-testid={`text-campaign-resume-at-${campaign.id}`} className="block font-semibold text-[#a95218]">{campaign.resumeAt ? `Resume ${formatDate(campaign.resumeAt)}` : 'No automatic resume'}</span>}</td>
            <td className="px-5 py-4"><div className="flex justify-end gap-1">
              {(campaign.status === 'queued' || campaign.status === 'completed') && <CampaignActionIcon label="Create follow-up draft" icon={<CirclePlus className="h-4 w-4"/>} testId={`button-follow-up-campaign-${campaign.id}`} disabled={createFollowUp.isPending} onClick={() => createFollowUp.mutate({ campaignId: campaign.id }, { onSuccess: followUp => { refresh(); openEdit(followUp); setNotice({ kind: 'success', text: 'Follow-up draft created. Its schedule must be at least 24 hours after the primary campaign completes.' }); }, onError: error => setNotice({ kind: 'error', text: mutationError(error) }) })}/>}
              {campaign.status === 'queued' && campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() && !campaign.pausedAt && !maintenancePaused && <CampaignActionIcon label="Reschedule campaign" icon={<Clock3 className="h-4 w-4"/>} testId={`button-reschedule-campaign-${campaign.id}`} disabled={rescheduleCampaign.isPending} onClick={() => openReschedule(campaign)}/>}
              {(campaign.status === 'queued' || campaign.status === 'sending') && !maintenancePaused && (campaign.pausedAt ? <>
                <CampaignActionIcon label="Change resume time" icon={<Clock3 className="h-4 w-4"/>} testId={`button-list-edit-resume-time-${campaign.id}`} disabled={pauseCampaign.isPending} onClick={() => setPauseTarget(campaign)}/>
                <CampaignActionIcon label="Resume campaign" icon={<Play className="h-4 w-4"/>} testId={`button-list-pause-campaign-${campaign.id}`} disabled={pauseCampaign.isPending} onClick={() => pauseCampaign.mutate({ campaignId: campaign.id, data: { paused: false } }, { onSuccess: () => { refresh(); setNotice({ kind: 'success', text: 'Campaign delivery resumed.' }); }, onError: error => setNotice({ kind: 'error', text: mutationError(error) }) })}/>
                <CampaignActionIcon label="Cancel paused campaign" icon={<X className="h-4 w-4"/>} testId={`button-cancel-paused-campaign-${campaign.id}`} danger onClick={() => setCancelTarget(campaign)}/>
              </> : <CampaignActionIcon label="Pause campaign" icon={<Pause className="h-4 w-4"/>} testId={`button-list-pause-campaign-${campaign.id}`} disabled={pauseCampaign.isPending} onClick={() => setPauseTarget(campaign)}/>)}
              {campaign.status === 'draft' && <>
                <CampaignActionIcon label="Edit campaign draft" icon={<Edit3 className="h-4 w-4"/>} testId={`button-edit-campaign-${campaign.id}`} onClick={() => openEdit(campaign)}/>
                <CampaignActionIcon label="Queue campaign" icon={<Send className="h-4 w-4"/>} testId={`button-queue-campaign-${campaign.id}`} disabled={send.isPending || !(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).length || !(campaign.listIds?.length ? campaign.listIds : campaign.listId ? [campaign.listId] : []).every(id => lists.some(list => list.id === id && list.active))} onClick={() => queue(campaign)}/>
                <CampaignActionIcon label="Delete campaign draft" icon={<Trash2 className="h-4 w-4"/>} testId={`button-delete-campaign-${campaign.id}`} disabled={remove.isPending} danger onClick={() => del(campaign)}/>
              </>}
            </div></td>
       </tr>)}</tbody></table></div>
     </section> : (campaignSummary?.campaignCount ?? 0) > 0 ? <EmptyState title="No campaigns match these filters" detail="Try a broader search or clear one or more filters to see matching campaigns." action={<Button variant="outline" testId="button-clear-campaign-filters" onClick={() => { setCampaignSearch(''); setDebouncedCampaignSearch(''); setCampaignStatusFilter('all'); setCampaignTypeFilter('all'); setCampaignListFilter('all'); setCampaignDateFilter('all'); setCampaignHistoryPage(1); }}>Clear filters</Button>} /> : <EmptyState title="No campaigns yet" detail={activeLists.length ? 'Create a draft to prepare a message for an active list. Delivery counts will appear here after queueing.' : 'Create and activate a list first. Campaigns are always tied to an audience in this workspace.'} action={activeLists.length ? <Button testId="button-empty-create-campaign" onClick={openNew}><CirclePlus className="h-4 w-4"/>Create campaign</Button> : undefined}/>}
    {(campaignHistory?.total ?? 0) > 0 && <nav aria-label="Campaign history pages" data-testid="campaign-history-pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e0e4e9] bg-white px-4 py-3">
      <span className="text-[11px] text-[#687484]">Showing {((campaignHistoryPage - 1) * 25 + 1).toLocaleString()}–{Math.min(campaignHistoryPage * 25, campaignHistory?.total ?? 0).toLocaleString()} of {(campaignHistory?.total ?? 0).toLocaleString()} matching campaigns</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" testId="button-campaign-history-previous" disabled={campaignHistoryPage <= 1 || campaignsQuery.isFetching} onClick={() => setCampaignHistoryPage(page => Math.max(1, page - 1))}><ArrowLeft className="h-3.5 w-3.5"/>Previous</Button>
        <span aria-live="polite" className="min-w-20 text-center text-[11px] font-medium text-[#536172]">Page {campaignHistoryPage} of {Math.max(1, Math.ceil((campaignHistory?.total ?? 0) / 25))}</span>
        <Button variant="outline" testId="button-campaign-history-next" disabled={campaignHistoryPage >= Math.ceil((campaignHistory?.total ?? 0) / 25) || campaignsQuery.isFetching} onClick={() => setCampaignHistoryPage(page => page + 1)}>Next<ArrowRight className="h-3.5 w-3.5"/></Button>
      </div>
    </nav>}
    {editing !== undefined && <Modal wide title={editing ? 'Edit campaign draft' : 'New campaign draft'} subtitle="Build and review your campaign in four guided steps. Lists remain live until queueing; contact exclusions are preserved." close={closeCampaignEditor}>
      <form onSubmit={save} className="space-y-4">
        {campaignContentError && <div role="alert" data-testid="status-campaign-content-policy-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] leading-5 text-[#99501e]">{campaignContentError}</div>}
        <ol aria-label="Campaign setup progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['Campaign basics', 'Audience', 'Email content', 'Review'].map((label, index) => <li key={label} aria-current={campaignStep === index ? 'step' : undefined}>
            <button type="button" onClick={() => { if (index <= campaignStep) { setCampaignStep(index); setCampaignStepError(''); } }} className={cx('flex min-h-10 w-full items-center gap-2 rounded-md border px-2.5 text-left text-[11px] font-semibold transition', campaignStep === index ? 'border-[#245b9b] bg-[#edf4fc] text-[#1c4f86]' : campaignStep > index ? 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]' : 'border-[#e3e8ed] bg-white text-[#798492]')}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px]">{index + 1}</span>{label}
            </button>
          </li>)}
        </ol>
        {campaignStepError && <div role="alert" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">{campaignStepError}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={cx('min-w-0 space-y-3', campaignStep === 2 && 'sm:col-span-2')}>
            {campaignStep === 0 && <Field label="Internal campaign name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="April product notes" required testId="input-campaign-name"/>}
            {campaignStep === 0 && <label className="block min-w-0">
              <span className={labelClass}>SMTP sender account</span>
              <select data-testid="select-campaign-sender-account" className={inputClass} value={form.senderAccountId} onChange={event => setForm(current => ({ ...current, senderAccountId: event.target.value }))} disabled={senderAccountsQuery.isLoading}>
                <option value="">Use the default account</option>
                {senderAccounts.map(account => <option key={account.id} value={account.id}>{account.fromEmail}{account.isPrimary ? ' · default' : ''}{account.verified ? '' : ' · not verified'}</option>)}
              </select>
              <span className="mt-1 block text-[10px] leading-4 text-[#808a97]">{senderAccounts.length ? 'The chosen account sends this campaign. The default account is used when no account is selected.' : 'No SMTP account is configured. Add and verify one in Email Setup before queueing this campaign.'}</span>
            </label>}
            {campaignStep === 0 && <label className="block min-w-0">
              <span className={labelClass}>Campaign objective</span>
              <textarea data-testid="input-campaign-objective" rows={3} maxLength={500} value={form.objective} onChange={event => setForm(current => ({ ...current, objective: event.target.value }))} placeholder="What should this campaign achieve?" className="w-full resize-y rounded-md border border-[#d8dde4] bg-white px-3 py-2 text-[12px] leading-5 text-[#182333] outline-none placeholder:text-[#a0a8b3] focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"/>
              <span className="mt-1 block text-[10px] leading-4 text-[#808a97]">Internal note only; it won’t be included in the email. {form.objective.length}/500</span>
            </label>}
            {campaignStep === 2 && <section data-testid="panel-campaign-ai-assist" className="rounded-md border border-[#dce5ed] bg-[#f5f9fc] p-3 sm:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#344b62]"><Sparkles className="h-3.5 w-3.5 text-[#4276a2]"/>AI Email Assist</h3><p className="mt-1 text-[10px] leading-4 text-[#65788a]">Create a suggested subject, greeting, body, and signature from your campaign objective. This will not send the campaign.</p></div>
                {aiAssistBalance && <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-[#536a80]">{aiAssistBalance.remaining} credits left</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" testId="button-generate-campaign-ai-draft" onClick={() => { setAiBriefFormOpen(open => !open); setAiDraftError(null); }} disabled={aiAssist.isPending || addOnCreditsQuery.isLoading || !aiAssistAvailable}>
                  <Sparkles className="h-3.5 w-3.5"/>
                  {aiBriefFormOpen ? 'Close AI brief' : 'Draft with AI'}
                </Button>
                {!aiAssistAvailable && !addOnCreditsQuery.isLoading && <Button variant="outline" testId="button-campaign-ai-addons" onClick={() => setLocation('/plans')}>View add-on packages</Button>}
                {addOnCreditsQuery.isError && <Button variant="outline" testId="button-retry-campaign-ai-credits" onClick={() => void addOnCreditsQuery.refetch()}>Retry credit check</Button>}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[#6f8090]">
                {addOnCreditsQuery.isLoading ? 'Checking your AI Email Assist balance…' : !addOnCreditsQuery.data?.eligible ? 'An active paid primary plan and an AI Email Assist add-on are required.' : !aiAssistAvailable ? 'No AI Email Assist credits remain. Choose an add-on package to add more.' : 'One credit is used only when a complete draft is successfully generated.'}
              </p>
              {aiBriefFormOpen && <div data-testid="campaign-ai-brief-form" className="mt-4 space-y-3 border-t border-[#dce5ed] pt-4">
                <div>
                  <h4 className="text-[11px] font-semibold text-[#344b62]">Campaign brief</h4>
                  <p className="mt-1 text-[10px] leading-4 text-[#65788a]">Answer each question in 50 words or fewer. These answers guide the draft and are not saved to the campaign.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {campaignAiBriefQuestions.map(question => {
                    const value = aiBrief[question.field];
                    const count = campaignBriefWordCount(value);
                    return <label key={question.field} className="block min-w-0">
                      <span className={labelClass}>{question.label}</span>
                      <textarea
                        data-testid={`input-campaign-ai-${question.field}`}
                        rows={2}
                        maxLength={1000}
                        aria-required="true"
                        value={value}
                        onChange={event => setAiBrief(current => ({ ...current, [question.field]: capCampaignBriefWords(event.target.value) }))}
                        placeholder={question.placeholder}
                        className="w-full resize-y rounded-md border border-[#d8dde4] bg-white px-3 py-2 text-[11px] leading-5 text-[#182333] outline-none placeholder:text-[#a0a8b3] focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
                      />
                      <span className={cx('mt-1 block text-right text-[10px]', count >= 50 ? 'text-[#a35b2b]' : 'text-[#808a97]')}>{count}/50 words</span>
                    </label>;
                  })}
                  <label className="block">
                    <span className={labelClass}>Email body length</span>
                    <select data-testid="select-campaign-ai-max-words" className={inputClass} value={aiDraftMaxWords} onChange={event => setAiDraftMaxWords(Number(event.target.value) as 50 | 100 | 150 | 200)}>
                      {[50, 100, 150, 200].map(words => <option key={words} value={words}>{words} words</option>)}
                    </select>
                    <span className="mt-1 block text-[10px] leading-4 text-[#808a97]">Subject, greeting, and signature are outside this body limit.</span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5ebf0] pt-3">
                  <span className="text-[10px] text-[#68798a]">The AI will use these answers and your campaign objective, if provided.</span>
                  <Button type="button" testId="button-submit-campaign-ai-brief" onClick={requestAiDraft} disabled={aiAssist.isPending || Object.values(aiBrief).some(answer => !answer.trim())}>
                    {aiAssist.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <Sparkles className="h-3.5 w-3.5"/>}
                    {aiAssist.isPending ? 'Drafting…' : 'Generate draft'}
                  </Button>
                </div>
              </div>}
              {aiDraftError && <p role="alert" data-testid="status-campaign-ai-assist-error" className="mt-2 rounded border border-[#efd7c3] bg-[#fff8f1] px-2.5 py-2 text-[10px] leading-4 text-[#925023]">{aiDraftError}</p>}
              {aiDraftPreview && <div data-testid="panel-campaign-ai-draft-preview" className="mt-3 space-y-2 rounded-md border border-[#dce5ed] bg-white p-3">
                <p className="text-[10px] font-semibold text-[#3c5c78]">Draft ready · {aiDraftPreview.remaining} credit{aiDraftPreview.remaining === 1 ? '' : 's'} remaining</p>
                <div><span className="text-[9px] font-semibold uppercase tracking-wide text-[#7b8793]">Subject</span><p className="mt-0.5 break-words text-[11px] font-semibold text-[#26384a]">{aiDraftPreview.subject}</p></div>
                <div><span className="text-[9px] font-semibold uppercase tracking-wide text-[#7b8793]">Greeting</span><p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-[#405366]">{aiDraftPreview.greeting}</p></div>
                <div><span className="text-[9px] font-semibold uppercase tracking-wide text-[#7b8793]">Message</span><p className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[#405366]">{aiDraftPreview.body}</p></div>
                <div><span className="text-[9px] font-semibold uppercase tracking-wide text-[#7b8793]">Signature</span><p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-[#405366]">{aiDraftPreview.signature}</p></div>
                <Button testId="button-use-campaign-ai-draft" onClick={applyAiDraft}>Use this draft</Button>
              </div>}
            </section>}
          </div>
          {campaignStep === 1 && <fieldset className="min-w-0 sm:col-span-2">
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
                {listsQuery.isLoading && <p role="status" className="px-2 py-3 text-center text-[11px] text-[#687587]">Loading your contact lists…</p>}
                {listsQuery.isError && <div role="alert" className="mx-1 my-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-2.5 py-2 text-[10px] leading-4 text-[#99501e]">
                  <span>{lists.length ? 'Could not refresh your contact lists. Showing the last loaded list data.' : 'Could not load your contact lists. Retry before choosing an audience.'}</span>
                  <Button type="button" variant="outline" testId="button-retry-campaign-lists" disabled={listsQuery.isFetching} onClick={() => void listsQuery.refetch()}>
                    {listsQuery.isFetching && <LoaderCircle className="h-3 w-3 animate-spin"/>}Retry
                  </Button>
                </div>}
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
                {!listsQuery.isLoading && !listsQuery.isError && !lists.length && <p className="px-2 py-2 text-[11px] text-[#788392]">Create a contact list before preparing a campaign.</p>}
                {lists.length > 0 && !filteredCampaignLists.length && <p className="px-2 py-3 text-center text-[11px] text-[#788392]">{showSelectedCampaignLists ? 'No selected lists match this search.' : 'No lists match this search.'}</p>}
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-[#808a97]">Choose one or more lists. Inactive lists can’t be newly selected or queued.</p>
          </fieldset>}
        </div>
        {campaignStep === 1 && <section className="rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-3" aria-label="Campaign list processing order">
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
        </section>}
        {campaignStep === 1 && form.listIds.length > 0 && <div data-testid="campaign-audience-summary" className={cx('flex items-start gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-5', campaignAudienceQuery.isError ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : campaignAudienceQuery.data?.overlappingRecipients ? 'border-[#efd9bd] bg-[#fff8ef] text-[#895b2f]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]')}>
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
        {campaignStep === 1 && <section aria-label="Contact selection" className="space-y-3 rounded-lg border border-[#dce4e9] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[12px] font-semibold text-[#344154]">Review contacts</h3><p className="mt-1 text-[11px] leading-5 text-[#687587]">Selected lists stay live until queueing. Uncheck contacts to exclude them. Bounced and unsubscribed contacts stay visible but cannot be selected.</p></div><span className="rounded-full bg-[#edf4fc] px-2.5 py-1 text-[10px] font-semibold text-[#245b9b]">{form.excludedContactIds.length} excluded</span></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,2fr)]">
            <label><span className={labelClass}>Review contacts in list</span><select className={inputClass} value={campaignReviewListId} onChange={event => { setCampaignReviewListId(event.target.value); setCampaignReviewPage(1); }}><option value="">Choose selected list</option>{form.listIds.map(id => <option key={id} value={id}>{lists.find(list => list.id === id)?.name ?? 'Selected list'}</option>)}</select></label>
            <label><span className={labelClass}>Search contacts</span><input type="search" className={inputClass} value={campaignReviewSearch} onChange={event => { setCampaignReviewSearch(event.target.value); setCampaignReviewPage(1); }} placeholder="Name or email"/></label>
          </div>
          {!campaignReviewListId ? <p className="rounded-md bg-[#f7f9fb] p-3 text-[11px] text-[#6f7b88]">Choose a list to review its contacts.</p> : campaignReviewContactsQuery.isLoading ? <p role="status" className="p-3 text-[11px] text-[#6f7b88]">Loading contacts from {lists.find(list => list.id === campaignReviewListId)?.name ?? 'the selected list'}…</p> : campaignReviewContactsQuery.isError ? <div role="alert" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-3 text-[11px] text-[#99501e]">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>Could not load contacts{campaignReviewErrorStatus ? ` (HTTP ${campaignReviewErrorStatus})` : ''}. Retry before continuing.</span><Button type="button" variant="outline" testId="button-retry-campaign-contacts" onClick={() => void campaignReviewContactsQuery.refetch()}>Retry</Button></div>
            {campaignReviewError instanceof Error && <p className="mt-1 break-words text-[10px] leading-4">{campaignReviewError.message}</p>}
          </div> : <div className="overflow-hidden rounded-md border border-[#e3e8ed]">
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[650px] text-left text-[11px]">
                <thead className="sticky top-0 bg-[#f6f8fa] text-[9px] uppercase tracking-wide text-[#718091]"><tr><th className="px-3 py-2">Include</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Verification</th><th className="px-3 py-2">Subscription</th></tr></thead>
                <tbody className="divide-y divide-[#edf0f3]">{campaignReviewContacts.map(contact => {
                  const bounced = contact.emailStatus === 'bounced';
                  const eligible = contact.subscribed && !bounced && contact.emailStatus !== 'unsubscribed';
                  const included = eligible && !form.excludedContactIds.includes(contact.id);
                  return <tr key={contact.id} className={cx(!eligible && 'bg-[#fafbfc] text-[#8993a0]')}>
                    <td className="px-3 py-2"><input aria-label={`Include ${contact.email}`} type="checkbox" checked={included} disabled={!eligible} onChange={event => toggleCampaignContact(contact.id, event.target.checked)} className="h-4 w-4 accent-[#245b9b]"/></td>
                    <td className="px-3 py-2 font-medium">{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || '—'}</td>
                    <td className="px-3 py-2">{contact.email}</td>
                    <td className="px-3 py-2">{contact.emailVerificationStatus ? `${contact.emailVerificationStatus}${contact.emailVerificationProvider ? ` · ${contact.emailVerificationProvider}` : ''}` : 'Not checked'}</td>
                    <td className="px-3 py-2">{bounced ? 'Bounced · excluded' : contact.subscribed ? 'Subscribed' : contact.emailStatus === 'unsubscribed' ? 'Unsubscribed · excluded' : 'Not subscribed · excluded'}</td>
                  </tr>;
                })}{!campaignReviewContacts.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#788392]">No contacts match this list and search.</td></tr>}</tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-[#e8edf1] bg-[#fbfcfd] px-3 py-2 text-[10px] text-[#687587]"><span>Page {campaignReviewContactsQuery.data?.page ?? campaignReviewPage} of {campaignReviewContactsQuery.data?.pageCount ?? 1} · {campaignReviewContactsQuery.data?.total ?? campaignReviewContacts.length} contacts</span><span className="flex gap-1"><Button variant="quiet" testId="button-campaign-contacts-previous" disabled={campaignReviewPage <= 1} onClick={() => setCampaignReviewPage(page => Math.max(1, page - 1))}>Previous</Button><Button variant="quiet" testId="button-campaign-contacts-next" disabled={campaignReviewPage >= (campaignReviewContactsQuery.data?.pageCount ?? 1)} onClick={() => setCampaignReviewPage(page => page + 1)}>Next</Button></span></div>
          </div>}
        </section>}
         <section hidden={campaignStep !== 2} data-testid="campaign-subject-variants" className="space-y-3 rounded-lg border border-[#dce4e9] bg-[#f8fafc] p-4">
           <div><h3 className="text-[12px] font-semibold text-[#344154]">Subject line variants</h3><p className="mt-1 text-[11px] leading-5 text-[#687587]">Create alternative subject lines for a recipient-level test. Placeholders such as a contact’s first name are supported.</p></div>
           <div className="space-y-2">
             {form.subjectVariants.map((value, index) => <div key={`subject-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block"><span className={labelClass}>Subject option {index + 1}{index === 0 ? ' · required' : ''}</span><input ref={index === 0 ? subjectInputRef : undefined} data-testid={index === 0 ? 'input-campaign-subject' : `input-campaign-subject-variant-${index + 1}`} className={inputClass} value={value} onFocus={() => setPlaceholderTarget({ field: 'subjectVariants', index })} onChange={event => updateVariant('subjectVariants', index, event.target.value)} placeholder="A concise subject your audience will recognize" required={campaignStep === 2 && index === 0} maxLength={200}/></label>
               <button type="button" data-testid={`button-remove-subject-variant-${index + 1}`} aria-label={`Remove subject option ${index + 1}`} onClick={() => removeVariant('subjectVariants', index)} disabled={form.subjectVariants.length === 1} className="min-h-10 rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] font-medium text-[#536172] hover:bg-[#f5f8fb] disabled:opacity-40">Remove</button>
             </div>)}
           </div>
           <div className="flex flex-wrap items-center justify-between gap-2">
             <p role="status" className="text-[11px] leading-5 text-[#687587]">{form.subjectVariants.filter(value => value.trim()).length < variantLimits.subject.minimum ? `A test starts at ${variantLimits.subject.minimum} non-empty options. Until then, the first option is used for everyone.` : 'Recipients are assigned one stable subject option for this campaign.'}</p>
             <button type="button" data-testid="button-add-subject-variant" onClick={() => addVariant('subjectVariants')} disabled={form.subjectVariants.length >= variantLimits.subject.maximum} className="min-h-9 rounded-md border border-[#c9d7e5] bg-white px-3 text-[11px] font-semibold text-[#245b9b] hover:bg-[#f2f7fc] disabled:cursor-not-allowed disabled:opacity-45">Add subject option</button>
           </div>
         </section>
          <section hidden={campaignStep !== 2} data-testid="campaign-greeting-variants" className="space-y-3 rounded-lg border border-[#dce4e9] bg-[#f8fafc] p-4">
           <div><h3 className="text-[12px] font-semibold text-[#344154]">Greeting line variants <span className="font-normal text-[#7e8996]">(optional)</span></h3><p className="mt-1 text-[11px] leading-5 text-[#687587]">A greeting is added above the message body. Leave all options blank to omit it.</p></div>
           <div className="space-y-2">
             {form.greetingVariants.map((value, index) => <div key={`greeting-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
               <label className="block"><span className={labelClass}>Greeting option {index + 1}</span><input data-testid={`input-campaign-greeting-variant-${index + 1}`} className={inputClass} value={value} onFocus={() => setPlaceholderTarget({ field: 'greetingVariants', index })} onChange={event => updateVariant('greetingVariants', index, event.target.value)} placeholder="For example, Hello {{firstName}}," maxLength={500}/></label>
               <button type="button" data-testid={`button-remove-greeting-variant-${index + 1}`} aria-label={`Remove greeting option ${index + 1}`} onClick={() => removeVariant('greetingVariants', index)} disabled={form.greetingVariants.length === 1} className="min-h-10 rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] font-medium text-[#536172] hover:bg-[#f5f8fb] disabled:opacity-40">Remove</button>
             </div>)}
           </div>
           <div className="flex flex-wrap items-center justify-between gap-2">
             <p role="status" className="text-[11px] leading-5 text-[#687587]">{form.greetingVariants.filter(value => value.trim()).length === 0 ? 'Optional. Leave blank to omit a greeting.' : form.greetingVariants.filter(value => value.trim()).length < variantLimits.greeting.minimum ? `A test starts at ${variantLimits.greeting.minimum} non-empty options. Until then, the first option is used for everyone.` : 'Recipients are assigned one stable greeting option for this campaign.'}</p>
             <button type="button" data-testid="button-add-greeting-variant" onClick={() => addVariant('greetingVariants')} disabled={form.greetingVariants.length >= variantLimits.greeting.maximum} className="min-h-9 rounded-md border border-[#c9d7e5] bg-white px-3 text-[11px] font-semibold text-[#245b9b] hover:bg-[#f2f7fc] disabled:cursor-not-allowed disabled:opacity-45">Add greeting option</button>
           </div>
         </section>
          <section hidden={campaignStep !== 2} data-testid="campaign-signature-variants" className="space-y-3 rounded-lg border border-[#dce4e9] bg-[#f8fafc] p-4">
           <div><h3 className="text-[12px] font-semibold text-[#344154]">Signature variants <span className="font-normal text-[#7e8996]">(optional)</span></h3><p className="mt-1 text-[11px] leading-5 text-[#687587]">A signature is added after the message body. Placeholders are supported; leave all options blank to omit it.</p></div>
           <div className="space-y-2">
             {form.signatureVariants.map((value, index) => <div key={`signature-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
               <label className="block"><span className={labelClass}>Signature option {index + 1}</span><textarea data-testid={`input-campaign-signature-variant-${index + 1}`} className={`${inputClass} min-h-20 resize-y py-2`} value={value} onFocus={() => setPlaceholderTarget({ field: 'signatureVariants', index })} onChange={event => updateVariant('signatureVariants', index, event.target.value)} placeholder={'Best regards,\\n{{firstName}}'} maxLength={4000}/></label>
               <button type="button" data-testid={`button-remove-signature-variant-${index + 1}`} aria-label={`Remove signature option ${index + 1}`} onClick={() => removeVariant('signatureVariants', index)} disabled={form.signatureVariants.length === 1} className="min-h-10 rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] font-medium text-[#536172] hover:bg-[#f5f8fb] disabled:opacity-40">Remove</button>
             </div>)}
           </div>
           <div className="flex flex-wrap items-center justify-between gap-2">
             <p role="status" className="text-[11px] leading-5 text-[#687587]">{form.signatureVariants.filter(value => value.trim()).length === 0 ? 'Optional. Leave blank to omit a signature.' : form.signatureVariants.filter(value => value.trim()).length < variantLimits.signature.minimum ? `A test starts at ${variantLimits.signature.minimum} non-empty options. Until then, the first option is used for everyone.` : 'Recipients are assigned one stable signature option for this campaign.'}</p>
             <button type="button" data-testid="button-add-signature-variant" onClick={() => addVariant('signatureVariants')} disabled={form.signatureVariants.length >= variantLimits.signature.maximum} className="min-h-9 rounded-md border border-[#c9d7e5] bg-white px-3 text-[11px] font-semibold text-[#245b9b] hover:bg-[#f2f7fc] disabled:cursor-not-allowed disabled:opacity-45">Add signature option</button>
           </div>
         </section>
          <section hidden={campaignStep !== 2} className="rounded-md border border-[#e4e9ef] bg-white p-3" aria-label="Insert a contact placeholder">
           <p className="mb-2 text-[10px] leading-4 text-[#687587]">Insert a contact field into the last focused subject, greeting, or signature option.</p>
           <div className="flex flex-wrap gap-1.5">{CONTACT_PLACEHOLDERS.map(({ token, label }) => <button key={token} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertPlaceholder(placeholderTarget.field, placeholderTarget.index, token)} className="rounded border border-[#dce4ec] bg-white px-2 py-1 text-[10px] font-medium text-[#365a7e] hover:border-[#9abbe1] hover:bg-[#f1f7fd]" data-testid={`button-insert-campaign-placeholder-${token.slice(2, -2)}`} title={`Insert ${token}`}>{label}</button>)}</div>
         </section>
          <label hidden={campaignStep !== 2} className="block"><span className={labelClass}>Formatted message</span><RichTextEditor value={form.htmlBody} onChange={(htmlBody, textBody) => setForm(current => ({ ...current, htmlBody, textBody }))}/><span className="mt-1.5 block text-[11px] leading-relaxed text-[#808a97]">Formatting is preserved in the HTML message submitted to your SMTP provider. A plain-text fallback is included.</span></label>
          <section hidden={campaignStep !== 2} className="rounded-lg border border-[#dce4e9] bg-white p-4" aria-label="Email attachments">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-[12px] font-semibold text-[#344154]">PDF attachments</h3><p className="mt-1 text-[11px] leading-5 text-[#687587]">Up to 2 PDFs; each and the combined total must be 5 MB or less.</p></div>
              <label className={cx('inline-flex items-center gap-2 rounded-md border border-[#c9d7e5] px-3 py-2 text-[11px] font-semibold text-[#245b9b]', campaignPdfUploadAvailable ? 'cursor-pointer hover:bg-[#f2f7fc]' : 'cursor-not-allowed opacity-50', (uploadingAttachment || form.attachments.length >= 2) && 'cursor-not-allowed opacity-50')}>
                {uploadingAttachment ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <Upload className="h-3.5 w-3.5"/>}
                {uploadingAttachment ? 'Uploading PDF…' : attachmentAvailabilityQuery.isLoading ? 'Checking PDF storage…' : campaignPdfUploadAvailable ? 'Add PDF' : 'PDF uploads unavailable'}
                <input data-testid="input-campaign-attachment" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!campaignPdfUploadAvailable || attachmentAvailabilityQuery.isLoading || attachmentAvailabilityQuery.isError || uploadingAttachment || form.attachments.length >= 2} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void uploadCampaignAttachment(file); }}/>
              </label>
            </div>
            {!campaignPdfUploadAvailable && <p role="status" className="mt-2 text-[11px] leading-5 text-[#778392]">{attachmentAvailabilityQuery.isLoading ? 'Checking PDF storage availability…' : attachmentAvailabilityQuery.isError ? 'PDF storage availability could not be checked, so uploads are disabled. You can still create the campaign without a PDF.' : 'PDF storage is not configured, so uploads are disabled. You can still create the campaign without a PDF.'}</p>}
            {form.attachments.length > 0 && <ul className="mt-3 space-y-2">{form.attachments.map((file, index) => <li key={file.objectPath} className="flex items-center justify-between gap-3 rounded-md bg-[#f7f9fb] px-3 py-2 text-[11px]"><span className="min-w-0 truncate font-medium text-[#344154]">{file.name}<span className="ml-2 text-[10px] font-normal text-[#778392]">{(file.size / 1024 / 1024).toFixed(2)} MB</span></span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setForm(current => ({ ...current, attachments: current.attachments.filter((_, i) => i !== index) }))} className="shrink-0 text-[#8a4b40] hover:underline">Remove</button></li>)}</ul>}
            <p className="mt-2 text-[10px] text-[#808a97]">Total: {(form.attachments.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} / 5 MB</p>
            {attachmentError && <p role="alert" className="mt-2 text-[11px] text-[#a23f35]">{attachmentError}</p>}
          </section>
          <section hidden={campaignStep !== 3} className="space-y-3 rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-4" aria-label="Personalized email preview">
            <div><h3 className="text-[12px] font-semibold text-[#344154]">Preview for a contact</h3><p className="mt-1 text-[11px] text-[#788392]">Preview the first subject, greeting, and signature options with a subscribed contact. Queued recipients receive their fixed test assignments.</p></div>
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
         <div className="flex items-start gap-2 rounded-md bg-[#f5f8fb] px-3 py-2.5 text-[11px] leading-5 text-[#607186]"><Users className="mt-0.5 h-4 w-4 shrink-0 text-[#245b9b]"/><span>Only subscribed contacts are eligible. Duplicate email addresses are removed when queued. Each test assignment stays fixed for that recipient throughout the campaign; an unsubscribe link is included automatically.</span></div>
         {campaignStep === 3 && <section className="rounded-lg border border-[#cfe0ef] bg-[#f4f8fc] p-3" aria-label="Campaign confirmation">
           <h3 className="text-[12px] font-semibold text-[#294e72]">Confirm campaign setup</h3>
           <div className="mt-2 grid gap-2 text-[11px] text-[#4d6073] sm:grid-cols-2">
             <p><strong>Name:</strong> {form.name || 'Not entered'}</p><p><strong>Sender:</strong> {senderAccounts.find(account => account.id === form.senderAccountId)?.fromEmail ?? 'Default sender'}</p>
             <p><strong>Lists:</strong> {form.listIds.map(id => lists.find(list => list.id === id)?.name ?? 'Removed list').join(', ') || 'None selected'}</p><p><strong>Contact exclusions:</strong> {form.excludedContactIds.length}</p>
             <p><strong>Subject options:</strong> {form.subjectVariants.filter(value => value.trim()).length}</p><p><strong>Greeting / signature options:</strong> {form.greetingVariants.filter(value => value.trim()).length} / {form.signatureVariants.filter(value => value.trim()).length}</p>
           </div>
           <p className="mt-2 border-t border-[#dce7f1] pt-2 text-[10px] leading-4 text-[#586d80]">Bounced, unsubscribed, and otherwise ineligible contacts are suppressed again when the campaign is queued. An unsubscribe link is included automatically.</p>
         </section>}
         <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] pt-4">
           <Button variant="outline" testId="button-cancel-campaign" onClick={closeCampaignEditor}>Cancel</Button>
           <div className="flex gap-2">{campaignStep > 0 && <Button variant="outline" testId="button-campaign-step-back" onClick={() => { setCampaignStepError(''); setCampaignStep(step => Math.max(0, step - 1)); }}>Back</Button>}
              {campaignStep < 3 ? <Button key="campaign-step-continue" type="button" testId="button-campaign-step-next" onClick={event => { event.preventDefault(); continueCampaignStep(); }}>Continue</Button> : <Button key="campaign-step-save" type="submit" testId="button-submit-campaign" disabled={create.isPending || update.isPending || uploadingAttachment || audienceActionPending || !form.listIds.length || !audienceCheckReady || (!editing && !activeLists.length)}>{(create.isPending || update.isPending || uploadingAttachment || audienceActionPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{uploadingAttachment ? 'Uploading PDF…' : audienceActionPending ? 'Checking audience…' : editing ? 'Save draft' : 'Create draft'}</Button>}
           </div>
         </div>
      </form>
    </Modal>}
     {pauseTarget && <CampaignPauseDialog
       campaignName={pauseTarget.name}
        currentResumeAt={pauseTarget.resumeAt}
        alreadyPaused={Boolean(pauseTarget.pausedAt)}
       pending={pauseCampaign.isPending}
       close={() => setPauseTarget(null)}
       onSubmit={resumeAt => pauseCampaign.mutate({
         campaignId: pauseTarget.id,
         data: { paused: true, resumeAt: resumeAt?.toISOString() ?? null },
       }, {
         onSuccess: response => {
           setPauseTarget(null);
           refresh();
            setNotice({
              kind: 'success',
              text: pauseTarget.pausedAt
                ? response.resumeAt
                  ? `Automatic resume updated to ${formatDate(response.resumeAt)}.`
                  : 'Automatic resume cleared. Campaign remains paused.'
                : response.resumeAt
                  ? `Campaign paused until ${formatDate(response.resumeAt)}.`
                  : 'Campaign delivery paused.',
            });
         },
         onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
       })}
     />}
      {rescheduleTarget && <Modal
        title="Reschedule campaign"
        subtitle={`Choose a new start time for “${rescheduleTarget.name}”.`}
        close={() => { if (!rescheduleCampaign.isPending) { setRescheduleTarget(null); setPausedScheduleConflicts([]); } }}
      >
        <div className="space-y-4">
          <label className="block">
            <span className={labelClass}>New start date and time (your local time)</span>
            <input data-testid="input-reschedule-campaign-at" type="datetime-local" min={dateTimeLocalValue(roundUpToMinute(new Date(Date.now() + 60_000)))} value={rescheduleAt} onChange={event => { setRescheduleAt(event.target.value); setPausedScheduleConflicts([]); }} className={inputClass}/>
          </label>
          <p className="text-[11px] leading-5 text-[#788392]">You can move this scheduled campaign earlier or later. Times already assigned to another active, unpaused campaign are not allowed.</p>
          {pausedScheduleConflicts.length > 0 && <div role="alert" data-testid="warning-paused-campaign-schedule-conflict" className="rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-3 text-[11px] leading-5 text-[#895b2f]">
            <p><strong>A paused campaign is scheduled for this exact time:</strong></p>
            <ul className="my-1 list-disc pl-5">{pausedScheduleConflicts.map(item => <li key={item.campaignId}>{item.campaignName}</li>)}</ul>
            <p>Confirming will cancel that campaign’s schedule and automatic resume time. It will remain paused and must be scheduled again manually.</p>
          </div>}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button variant="outline" testId="button-cancel-reschedule-campaign" disabled={rescheduleCampaign.isPending} onClick={() => { setRescheduleTarget(null); setPausedScheduleConflicts([]); }}>Cancel</Button>
            <Button testId="button-confirm-reschedule-campaign" disabled={rescheduleCampaign.isPending || !rescheduleAt} onClick={submitReschedule}>
              {rescheduleCampaign.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}
              {pausedScheduleConflicts.length ? 'Confirm and cancel paused schedule' : 'Save new schedule'}
            </Button>
          </div>
        </div>
      </Modal>}
      <ConfirmActionDialog
        open={Boolean(cancelTarget)}
        title="Cancel this paused campaign?"
        description={cancelTarget
          ? `Stop “${cancelTarget.name}” and suppress its messages that have not started. Messages already sent stay in campaign history. A message already being submitted to the SMTP server may still finish. The campaign will be marked completed; use Follow-up to create a new draft and schedule another run.`
          : ''}
        confirmLabel="Stop campaign"
        pending={cancelPausedCampaign.isPending}
        onOpenChange={open => { if (!open && !cancelPausedCampaign.isPending) setCancelTarget(null); }}
        onConfirm={() => {
          if (!cancelTarget) return;
          cancelPausedCampaign.mutate({ campaignId: cancelTarget.id }, {
            onSuccess: result => {
              setCancelTarget(null);
              refresh();
              setNotice({
                kind: 'success',
                text: `Campaign stopped. ${result.stoppedRecipients.toLocaleString()} queued message${result.stoppedRecipients === 1 ? '' : 's'} will not be sent; sent mail remains in the dashboard.${result.inFlightRecipients ? ` ${result.inFlightRecipients} message${result.inFlightRecipients === 1 ? ' was' : 's were'} already being submitted and may finish.` : ''} Use Follow-up to create and schedule another draft.`,
              });
            },
            onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
          });
        }}
        testId="dialog-cancel-paused-campaign"
      />
     <ConfirmActionDialog
       open={Boolean(pendingAction)}
       title={pendingAction?.kind === 'queue' ? 'Queue this campaign?' : 'Delete this draft?'}
        description={pendingAction?.kind === 'queue'
            ? `Choose when “${pendingAction.campaign.name}” should start sending to ${campaignAudienceQuery.data?.uniqueRecipients.toLocaleString() ?? pendingAction.campaign.recipients.toLocaleString()} unique email addresses.${pendingAction.campaign.parentCampaignId ? followUpParent?.completedAt ? ` This follow-up must start at least 24 hours after the primary campaign finishes (no earlier than ${formatDate(new Date(new Date(followUpParent.completedAt).getTime() + 24 * 60 * 60 * 1000).toISOString())}).` : ' The primary campaign must finish before this follow-up can be queued; its start must be at least 24 hours after completion.' : ''}`
         : pendingAction ? `Permanently delete the draft “${pendingAction.campaign.name}”? This cannot be undone.` : ''}
       confirmLabel={pendingAction?.kind === 'queue' ? 'Queue campaign' : 'Delete draft'}
       destructive={pendingAction?.kind !== 'queue'}
       pending={audienceActionPending || send.isPending || remove.isPending}
         confirmDisabled={pendingAction?.kind === 'queue' && (!queueStartIsValid || !audienceCheckReady)}
        onOpenChange={open => { if (!open && !send.isPending && !remove.isPending) { setPendingAction(null); setQueuePolicyError(null); } }}
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
           {queuePolicyError && <div role="alert" data-testid="status-queue-campaign-content-policy-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">{queuePolicyError}</div>}
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
function formatLiveDeliveryCountdown(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return days
    ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(days * 24 + hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
}

function CampaignPauseDialog({
  campaignName,
  currentResumeAt = null,
  alreadyPaused = false,
  pending,
  close,
  onSubmit,
}: {
  campaignName: string;
  currentResumeAt?: string | Date | null;
  alreadyPaused?: boolean;
  pending: boolean;
  close: () => void;
  onSubmit: (resumeAt: Date | null) => void;
}) {
  const [resumeAtLocal, setResumeAtLocal] = useState(() => currentResumeAt
    ? dateTimeLocalValue(new Date(currentResumeAt))
    : '');
  const [error, setError] = useState<string | null>(null);
  const earliestResumeAt = dateTimeLocalValue(
    roundUpToMinute(new Date(Date.now() + 60_000)),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const resumeAt = resumeAtLocal ? new Date(resumeAtLocal) : null;
    if (resumeAt && (!Number.isFinite(resumeAt.getTime()) || resumeAt.getTime() <= Date.now())) {
      setError('Choose a resume time in the future.');
      return;
    }
    onSubmit(resumeAt);
  };
  return <Modal
    title={alreadyPaused ? 'Change resume time' : 'Pause campaign'}
    subtitle={alreadyPaused
      ? `Update the automatic resume time for “${campaignName}” without restarting delivery.`
      : `Pause “${campaignName}” now, with an optional automatic resume time.`}
    close={close}
  >
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className={labelClass}>Resume automatically at (optional)</span>
        <input
          data-testid="input-campaign-resume-at"
          className={inputClass}
          type="datetime-local"
          min={earliestResumeAt}
          value={resumeAtLocal}
          onChange={event => { setResumeAtLocal(event.target.value); setError(null); }}
        />
        <span className="mt-1.5 block text-[11px] leading-5 text-[#808a97]">
          Leave blank to keep the campaign paused until you resume it manually. Uses your local time.
        </span>
      </label>
      {error && <p role="alert" className="text-[11px] text-[#99501e]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-[#edf0f2] pt-4">
        {alreadyPaused && currentResumeAt && <Button
          variant="quiet"
          testId="button-clear-campaign-resume-time"
          disabled={pending}
          onClick={() => onSubmit(null)}
        >Clear automatic resume</Button>}
        <Button variant="outline" testId="button-cancel-campaign-pause" onClick={close}>Cancel</Button>
        <Button type="submit" testId="button-confirm-campaign-pause" disabled={pending}>
          {pending && <LoaderCircle className="h-4 w-4 animate-spin"/>}
          {alreadyPaused
            ? resumeAtLocal ? 'Save resume time' : 'Keep paused'
            : resumeAtLocal ? 'Pause and schedule resume' : 'Pause campaign'}
        </Button>
      </div>
    </form>
  </Modal>;
}

export function CampaignDashboardPage({ campaignId, maintenancePaused = false }: { campaignId: string; maintenancePaused?: boolean }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const pauseCampaign = useSetCampaignPaused();
  const cancelPausedCampaign = useCancelPausedCampaign();
  const deleteDraft = useDeleteCampaign();
  const { notice, setNotice, dismiss } = useNotice();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const senderAccountsQuery = useListTenantSendingAccounts();
  const repliesQuery = useListCampaignReplies(campaignId, { query: { queryKey: getListCampaignRepliesQueryKey(campaignId), staleTime: 0, refetchOnMount: 'always' } });
  const scanInbox = useCheckSenderMailbox();
  const [storeReplyContent, setStoreReplyContent] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const query = useGetCampaignDashboard(campaignId, {
    query: {
      queryKey: getGetCampaignDashboardQueryKey(campaignId),
      refetchInterval: 10_000,
    },
  });
  const dashboard = query.data as CampaignDashboard | undefined;
  useEffect(() => {
    if (!dashboard || (dashboard.campaign.status !== 'queued' && dashboard.campaign.status !== 'sending') || dashboard.campaign.pausedAt || maintenancePaused) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dashboard?.campaign.status, dashboard?.campaign.pausedAt, maintenancePaused]);

  return <QueryState loading={query.isLoading} error={query.isError} retry={() => { void query.refetch(); }} label="campaign dashboard">
    {dashboard && (() => {
      const { campaign, targetLists, pacing } = dashboard;
      const attachments = campaign.attachments ?? [];
      const inboxConnected = Boolean(senderAccountsQuery.data?.accounts.some(account => account.id === campaign.senderAccountId && account.inboxConnectedAt));
      const removedTargetListCount = Math.max(0, campaign.listIds.length - targetLists.length);
      const resolved = campaign.status === 'draft' ? 0 : Math.max(0, campaign.recipients - campaign.queued);
      const progress = campaign.recipients > 0 ? Math.min(100, Math.round((resolved / campaign.recipients) * 100)) : 0;
      const isPausedForMaintenance = maintenancePaused && (campaign.status === 'queued' || campaign.status === 'sending');
      const isUserPaused = Boolean(campaign.pausedAt);
      const isActive = campaign.status === 'queued' || campaign.status === 'sending';
      const pauseTimer = isPausedForMaintenance || isUserPaused;
      const liveRemainingSeconds = pauseTimer || !pacing.estimatedCompletionAt
        ? pacing.estimatedDurationSeconds
        : Math.max(0, Math.ceil((new Date(pacing.estimatedCompletionAt).getTime() - clockNow) / 1000));
      const statusTone = isPausedForMaintenance ? 'orange' : campaign.status === 'completed' ? 'green' : campaign.status === 'queued' || campaign.status === 'sending' ? 'blue' : 'gray';
      const isScheduled = campaign.status === 'queued' && campaign.scheduledAt !== null && new Date(campaign.scheduledAt).getTime() > Date.now();
      const metrics = [
        { label: 'Total emails', value: campaign.recipients, detail: campaign.status === 'draft' ? 'Unique eligible addresses across selected lists' : 'Captured when queued', surface: { backgroundColor: '#eef5ff', borderColor: '#d7e4f3' } },
        { label: 'SMTP accepted', value: campaign.delivered, detail: 'Inbox delivery is not confirmed', surface: { backgroundColor: '#eff8f1', borderColor: '#d5ead9' } },
        { label: 'Rejected / failed', value: campaign.bounced, detail: 'SMTP rejection, terminal failure, or matched provider report', surface: { backgroundColor: '#fff5eb', borderColor: '#f0dfcb' } },
        { label: 'Suppressed', value: campaign.suppressed, detail: 'Unsubscribed or removed', surface: { backgroundColor: '#f3f5f8', borderColor: '#dfe4e9' } },
        { label: 'Still queued', value: pacing.remainingEmails, detail: isPausedForMaintenance ? 'Paused for platform maintenance' : campaign.status === 'draft' ? 'Will be queued when sent' : 'Waiting for paced delivery', surface: { backgroundColor: '#f3f0fc', borderColor: '#e1dcf4' } },
      ];

      return <>
        <div className="mb-5">
          <Button variant="outline" testId="button-back-to-campaigns" onClick={() => setLocation('/campaigns')}><ArrowLeft className="h-4 w-4"/>Back to campaigns</Button>
        </div>
        <Heading eyebrow="DELIVERY / CAMPAIGNS / DASHBOARD" title={campaign.name} detail={campaign.subject} action={<div className="flex flex-wrap items-center gap-2">{campaign.status === 'draft' && <Button variant="quiet" testId="button-delete-draft-campaign" disabled={deleteDraft.isPending} onClick={() => { setDeleteError(null); setDeleteDialogOpen(true); }}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete draft</Button>}<Status tone={isPausedForMaintenance || isUserPaused ? 'orange' : statusTone}>{isPausedForMaintenance ? 'Maintenance paused' : isUserPaused ? 'Paused' : isScheduled ? 'scheduled' : campaign.status}</Status>{isActive && !isPausedForMaintenance && isUserPaused && <Button variant="outline" testId="button-edit-campaign-resume-time" disabled={pauseCampaign.isPending} onClick={() => setPauseDialogOpen(true)}>Change resume time</Button>}{isActive && !isPausedForMaintenance && isUserPaused && <Button variant="danger" testId="button-cancel-paused-campaign-detail" disabled={cancelPausedCampaign.isPending} onClick={() => setCancelDialogOpen(true)}>Cancel campaign</Button>}{isActive && !isPausedForMaintenance && <Button variant="outline" testId="button-toggle-campaign-pause" disabled={pauseCampaign.isPending} onClick={() => isUserPaused ? pauseCampaign.mutate({ campaignId, data: { paused: false } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetCampaignDashboardQueryKey(campaignId) }); void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetCampaignHistoryQueryKey() }); }, onError: () => { void query.refetch(); } }) : setPauseDialogOpen(true)}>{isUserPaused ? <><Play className="h-3.5 w-3.5"/>Resume delivery</> : <><Pause className="h-3.5 w-3.5"/>Pause campaign</>}</Button>}</div>}/>
        {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
        {(isUserPaused || isPausedForMaintenance) && <div role="status" className="mb-4 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2 text-[11px] leading-5 text-[#895b2f]">{isUserPaused && campaign.resumeAt ? `Delivery is paused and will resume automatically at ${formatDate(campaign.resumeAt)}. ` : ''}Queued messages are on hold. A message already being submitted to the SMTP server may finish; remaining messages will wait until delivery resumes.</div>}
        {pauseCampaign.isError && <div role="alert" className="mb-4 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2 text-[11px] text-[#895b2f]">Could not change the campaign pause state. Please try again.</div>}
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
              <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Delivery pacing</h2><p className="mt-1 text-[11px] text-[#788392]">Caps apply independently to each configured SMTP mailbox.</p></div>
              <Clock3 className="h-5 w-5 text-[#245b9b]"/>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-[#f5f8fb] p-3"><div className="text-[10px] uppercase tracking-wide text-[#7a8795]">Estimated time remaining</div><div aria-live="off" className="mt-1 text-[20px] font-bold tabular-nums text-[#26364a]">{isActive && !pauseTimer ? formatLiveDeliveryCountdown(liveRemainingSeconds) : formatDeliveryDuration(liveRemainingSeconds)}</div></div>
              <div className="rounded-md bg-[#f5f8fb] p-3"><div className="text-[10px] uppercase tracking-wide text-[#7a8795]">{pauseTimer ? 'Delivery paused' : 'Estimated finish'}</div><div className="mt-1 text-[13px] font-semibold text-[#26364a]">{isPausedForMaintenance ? 'Will resume automatically' : isUserPaused ? campaign.resumeAt ? formatDate(campaign.resumeAt) : 'Resume when you are ready' : campaign.status === 'completed' ? formatDate(campaign.completedAt) : pacing.estimatedCompletionAt ? formatDate(pacing.estimatedCompletionAt) : 'No emails waiting'}</div></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div><div className="text-[10px] text-[#85909d]">Hourly cap per SMTP</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">{pacing.emailsPerHour.toLocaleString()} emails / rolling hour</div></div>
              <div><div className="text-[10px] text-[#85909d]">Daily cap per SMTP</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">{pacing.emailsPerDay.toLocaleString()} emails / rolling 24 hours</div></div>
              <div><div className="text-[10px] text-[#85909d]">Minimum spacing</div><div className="mt-1 text-[13px] font-semibold text-[#344154]">At least one email every {formatDeliveryDuration(pacing.minimumSpacingSeconds)}</div></div>
            </div>
            {campaign.status === 'draft' && pacing.remainingEmails > pacing.maxCampaignSize && <div className="mt-4 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-3 py-2 text-[11px] leading-5 text-[#895b2f]"><AlertCircle className="mr-2 inline h-4 w-4"/>This audience exceeds the current maximum campaign size of {pacing.maxCampaignSize.toLocaleString()} emails, so it cannot be queued yet.</div>}
            <p className="mt-4 border-t border-[#edf0f2] pt-3 text-[10px] leading-5 text-[#8993a0]">This campaign uses the hourly and daily caps for its selected SMTP mailbox. Other campaigns using that same mailbox share its allowance; different mailboxes have separate allowances. SMTP response time and retries are uncertain, so actual finish times may differ.</p>
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
              <p className="text-[10px] leading-5 text-[#8993a0]">Draft counts exclude contacts removed from this campaign; only subscribed contacts are eligible. Overlapping addresses are deduplicated in the campaign total, and the queued audience is then fixed.</p>
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

        {attachments.length > 0 && <section data-testid="section-campaign-attachments" className={`${panelClass} mb-5 p-5`}>
          <div className="flex items-start gap-3">
            <Paperclip aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#245b9b]"/>
            <div className="min-w-0 flex-1">
              <h2 className="display text-[17px] font-bold text-[#1b293a]">Attachments sent with this campaign</h2>
              <p className="mt-1 text-[11px] leading-5 text-[#788392]">These files are included with each campaign email.</p>
              <ul className="mt-3 space-y-2">
                {attachments.map((attachment, index) => <li key={attachment.objectPath} data-testid={`campaign-attachment-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#e7ebef] bg-[#f7f9fb] px-3 py-2.5">
                  <span className="min-w-0 truncate text-[12px] font-medium text-[#344154]" title={attachment.name}>{attachment.name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[#778392]">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
                </li>)}
              </ul>
            </div>
          </div>
        </section>}

        <section data-testid="section-campaign-replies" className={`${panelClass} mb-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Bounce and reply scan</h2><p className="mt-1 text-[11px] leading-5 text-[#788392]">Scan the connected sender inbox for bounce reports and replies to this campaign.</p></div>
            <Button testId="button-scan-campaign-inbox" disabled={!inboxConnected || scanInbox.isPending || !campaign.senderAccountId} onClick={() => { if (!campaign.senderAccountId) return; scanInbox.reset(); scanInbox.mutate({ accountId: campaign.senderAccountId, data: { campaignId, storeReplyContent } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListCampaignRepliesQueryKey(campaignId) }); void qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() }); }, onError: () => { void repliesQuery.refetch(); } }); }}>
              {scanInbox.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}{scanInbox.isPending ? 'Scanning inbox…' : 'Scan inbox now'}
            </Button>
          </div>
          {!senderAccountsQuery.isLoading && !inboxConnected && <div className="mt-3 rounded-md bg-[#f5f8fb] p-3 text-[11px] leading-5 text-[#687587]">
            {campaign.senderAccountId ? <>To connect it, open <Link href={`/sending-settings?accountId=${encodeURIComponent(campaign.senderAccountId)}`} data-testid="link-campaign-sender-inbox-settings" className="font-semibold text-[#245b9b] underline">Email Setup</Link>. The campaign’s sender will be selected. Under <b>Check this sender’s inbox</b>, enter the incoming IMAP server (for example, <span className="font-mono">imap.gmail.com</span> or <span className="font-mono">outlook.office365.com</span>), then click <b>Check inbox now</b>. This uses the saved sender username and password over secure IMAP port 993. Once the check succeeds, return here and scan the campaign.</> : <>This campaign has no sender account linked, so it cannot be scanned. Edit the campaign to select a sender account first.</>}
          </div>}
          <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[#586778]"><input type="checkbox" checked={storeReplyContent} onChange={event => setStoreReplyContent(event.target.checked)} className="mt-1 accent-[#174f99]"/><span>Retrieve and store reply text for future analysis. Off by default; no message text is stored unless selected.</span></label>
          {scanInbox.isSuccess && scanInbox.data && <p role="status" data-testid="text-campaign-inbox-scan-result" className="mt-3 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] p-3 text-[11px] leading-5 text-[#31674b]">Scanned {scanInbox.data.messagesChecked} messages. Found {scanInbox.data.bounceReportsFound} bounce report(s), applied {scanInbox.data.bounceReportsApplied}, and matched {scanInbox.data.repliesFound} reply/replies.</p>}
          {scanInbox.isError && <p role="alert" className="mt-3 rounded-md bg-[#fff8f1] p-3 text-[11px] text-[#99501e]">Inbox scan failed. Confirm the sender inbox connection and retry.</p>}
          {repliesQuery.isLoading ? <p className="mt-4 text-[11px] text-[#8993a0]">Loading reply history…</p> : repliesQuery.isError ? <button type="button" onClick={() => void repliesQuery.refetch()} className="mt-4 text-[11px] font-semibold text-[#245b9b] underline">Couldn’t load saved replies. Retry</button> : repliesQuery.data?.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[11px]"><thead><tr className="border-b text-[#788392]"><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Reply received</th><th className="py-2">Content</th></tr></thead><tbody>{repliesQuery.data.map(reply => <tr key={reply.id} className="border-b border-[#edf0f2]"><td className="py-3 pr-3 font-semibold text-[#344154]">{reply.contactName}</td><td className="py-3 pr-3">{reply.recipientEmail}</td><td className="py-3 pr-3">{formatDate(reply.receivedAt)}</td><td className="max-w-sm py-3">{reply.bodyText ? <details><summary className="cursor-pointer font-semibold text-[#245b9b]">View stored reply</summary><p className="mt-2 whitespace-pre-wrap break-words text-[#586778]">{reply.bodyText}</p></details> : <span className="text-[#8993a0]">Not stored</span>}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-[11px] text-[#8993a0]">No campaign replies have been matched yet.</p>}
        </section>

        <section className={`${panelClass} mb-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Content variant results</h2><p className="mt-1 text-[11px] leading-5 text-[#687587]">Each recipient keeps one assigned version. These figures describe SMTP acceptance and recorded provider outcomes; they do not measure opens, clicks, inbox placement, or engagement.</p></div>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {([
              { title: 'Subject lines', group: dashboard.variantResults.subject },
              { title: 'Greeting lines', group: dashboard.variantResults.greeting },
              { title: 'Signatures', group: dashboard.variantResults.signature },
            ] as const).filter(section => section.group.variants.length > 0).map(section => (
              <div key={section.title} className="min-w-0 rounded-md border border-[#e5e9ee] bg-[#fbfcfd] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold text-[#344154]">{section.title}</h3>
                  <Status tone={campaign.status === 'draft' ? 'gray' : section.group.testEnabled ? 'blue' : 'orange'}>
                    {campaign.status === 'draft' ? 'not queued' : section.group.testEnabled ? 'test active' : 'first option used'}
                  </Status>
                </div>
                <div className="mt-3 space-y-2">
                  {section.group.variants.map(variant => <div key={variant.index} className="rounded-md border border-[#e5e9ee] bg-white p-2.5">
                    <div className="break-words text-[11px] font-medium leading-5 text-[#344154]">{variant.index + 1}. {variant.value || '—'}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[#718092]">
                      <span>Assigned <strong className="text-[#344154]">{variant.assigned.toLocaleString()}</strong></span>
                      <span>SMTP accepted <strong className="text-[#397050]">{variant.smtpAccepted.toLocaleString()}</strong></span>
                      <span>Failed <strong className="text-[#ae642c]">{variant.failed.toLocaleString()}</strong></span>
                      <span>Suppressed <strong className="text-[#596675]">{variant.suppressed.toLocaleString()}</strong></span>
                      <span>Unknown <strong className="text-[#8a65a2]">{variant.unknown.toLocaleString()}</strong></span>
                    </div>
                  </div>)}
                </div>
                {!section.group.testEnabled && campaign.status === 'draft' && <p className="mt-2 text-[10px] leading-4 text-[#788392]">Recipient assignments are recorded when this draft is queued.</p>}
                {!section.group.testEnabled && campaign.status !== 'draft' && <p className="mt-2 text-[10px] leading-4 text-[#788392]">The campaign did not meet the configured minimum for a test, so the first option was used.</p>}
              </div>
            ))}
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
    <ConfirmActionDialog
      open={deleteDialogOpen}
      title="Delete this draft?"
      description={dashboard ? `Permanently delete the draft “${dashboard.campaign.name}”? This cannot be undone.` : 'Permanently delete this draft campaign? This cannot be undone.'}
      confirmLabel="Delete draft"
      onOpenChange={open => {
        if (deleteDraft.isPending) return;
        setDeleteDialogOpen(open);
        if (!open) setDeleteError(null);
      }}
      onConfirm={() => {
        setDeleteError(null);
        deleteDraft.mutate({ campaignId }, {
          onSuccess: () => {
            setDeleteDialogOpen(false);
            void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
            void qc.invalidateQueries({ queryKey: getGetCampaignHistoryQueryKey() });
            setLocation('/campaigns');
          },
          onError: error => setDeleteError(mutationError(error)),
        });
      }}
      pending={deleteDraft.isPending}
      testId="dialog-delete-draft-campaign"
    >
      {deleteError && <p role="alert" className="text-[12px] leading-5 text-[#99501e]">{deleteError}</p>}
    </ConfirmActionDialog>
    <ConfirmActionDialog
      open={cancelDialogOpen}
      title="Cancel this paused campaign?"
      description="This stops queued messages and keeps sent mail in the campaign dashboard. A message already being submitted to the SMTP server may still finish. After cancellation, use the campaign’s Follow-up action to create a new draft and schedule another run."
      confirmLabel="Stop campaign"
      pending={cancelPausedCampaign.isPending}
      onOpenChange={open => { if (!cancelPausedCampaign.isPending) setCancelDialogOpen(open); }}
      onConfirm={() => cancelPausedCampaign.mutate({ campaignId }, {
        onSuccess: result => {
          setCancelDialogOpen(false);
          void qc.invalidateQueries({ queryKey: getGetCampaignDashboardQueryKey(campaignId) });
          void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetCampaignHistoryQueryKey() });
          const remaining = result.stoppedRecipients;
          setNotice({
            kind: 'success',
            text: `Campaign stopped. ${remaining.toLocaleString()} queued message${remaining === 1 ? '' : 's'} will not be sent. Sent mail remains in the dashboard.${result.inFlightRecipients ? ` ${result.inFlightRecipients} message${result.inFlightRecipients === 1 ? ' was' : 's were'} already being submitted and may finish.` : ''} Use Follow-up to schedule another draft.`,
          });
        },
        onError: () => { void query.refetch(); },
      })}
      testId="dialog-cancel-paused-campaign-detail"
    />
    {pauseDialogOpen && dashboard && <CampaignPauseDialog
      campaignName={dashboard.campaign.name}
      currentResumeAt={dashboard.campaign.resumeAt}
      alreadyPaused={Boolean(dashboard.campaign.pausedAt)}
      pending={pauseCampaign.isPending}
      close={() => setPauseDialogOpen(false)}
      onSubmit={resumeAt => pauseCampaign.mutate({
        campaignId,
        data: { paused: true, resumeAt: resumeAt?.toISOString() ?? null },
      }, {
        onSuccess: () => {
          setPauseDialogOpen(false);
          void qc.invalidateQueries({ queryKey: getGetCampaignDashboardQueryKey(campaignId) });
          void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetCampaignHistoryQueryKey() });
        },
        onError: () => { void query.refetch(); },
      })}
    />}
  </QueryState>;
}

function gmailSyncOutcomeDetail(outcome: GmailSyncDiagnosticsOutcome) {
  switch (outcome) {
    case 'no_dsn_found':
      return 'No new delivery-status notices were found in the messages checked. If you expected an older notice, use the recent-message rescan below and choose a wider window.';
    case 'already_recorded':
      return 'Gmail found notices, but they were already recorded. Check Delivery Evidence on the campaign to review existing reports.';
    case 'parser_warning':
      return 'Gmail found delivery-status notices that Mailflow could not fully read. Try the recent-message rescan below, or import the notice from Delivery Evidence.';
    case 'unmatched_reports':
      return 'Mailflow read one or more notices but could not match every report to a campaign. Confirm the connected mailbox receives the campaign’s delivery notices, then review Delivery Evidence.';
    case 'gmail_api_error':
      return 'Gmail access or history could not be read for this attempt. Mailflow will retry; reconnect the mailbox if the error continues.';
    case 'history_expired':
      return 'Gmail no longer has the saved history checkpoint. Reconnect to start a new checkpoint; notices from the gap cannot be recovered automatically.';
    case 'reauthorization_required':
      return 'Google authorization expired or was revoked. Reconnect the mailbox to resume monitoring.';
    case 'sync_error':
      return 'Mailflow could not complete this attempt. It will retry; use the recent-message rescan if the issue continues.';
    default:
      return 'No action is needed. Gmail bounce monitoring will continue on its regular schedule.';
  }
}
