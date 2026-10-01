import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowLeft, Check, CheckCircle2, CirclePlus, Clock3,
  Edit3, Fingerprint, LoaderCircle, Upload, Mail, Search, Send,
  ShieldCheck, Trash2, Users, X,
} from 'lucide-react';
import { ContactImportDialog } from '@/components/contact-import-dialog';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { CONTACT_PLACEHOLDERS, plainTextToHtml } from '@/components/campaign-placeholders';
import { RichTextEditor } from '@/components/rich-text-editor';
import {
  getGetCampaignDashboardQueryKey, getGetTenantSendingSettingsQueryKey, getGetUserDashboardQueryKey, getListCampaignsQueryKey, getListContactListsQueryKey,
  getListContactsQueryKey, useCreateCampaign, useCreateContact, useCreateContactList,
  useDeleteCampaign, useDeleteContact, useDeleteContactList, useGetCampaignDashboard, useGetTenantSendingSettings,
  useGetContactEmailHistory, useListCampaigns, useListContactLists, useListContacts, useSendCampaign,
  useTestTenantSendingSettings, useUpdateCampaign, useUpdateContact,
  useUpdateContactList, useUpdateTenantSendingSettings,
} from '@workspace/api-client-react';
import type {
  CampaignDashboard, CampaignSummary, Contact, ContactDirectoryItem, ContactEmailHistoryItem, ContactList,
  TenantSendingSettings, TenantSendingSettingsInput,
} from '@workspace/api-client-react';

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
  const query = useGetTenantSendingSettings();
  const update = useUpdateTenantSendingSettings();
  const test = useTestTenantSendingSettings();
  const qc = useQueryClient();
  const { notice, setNotice, dismiss } = useNotice();
  const [form, setForm] = useState(blankSettings);
  const [initialized, setInitialized] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const settings = query.data as TenantSendingSettings | undefined;
  useEffect(() => {
    if (!settings || initialized) return;
    setForm({ provider: settings.provider, host: settings.host || '', port: String(settings.port || 587), encryption: settings.encryption || 'tls', username: '', password: '', fromName: settings.fromName || '', fromEmail: settings.fromEmail || '', replyTo: settings.replyTo || '' });
    setInitialized(true);
  }, [settings, initialized]);
  const change = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const save = (e: FormEvent) => {
    e.preventDefault();
    const data: TenantSendingSettingsInput = {
      provider: form.provider, host: form.host.trim(), port: Number(form.port), encryption: form.encryption,
      ...(form.username.trim() ? { username: form.username.trim() } : {}), ...(form.password ? { password: form.password } : {}),
      fromName: form.fromName.trim(), fromEmail: form.fromEmail.trim(), ...(form.replyTo.trim() ? { replyTo: form.replyTo.trim() } : {}),
    };
    update.mutate({ data }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetTenantSendingSettingsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); setForm(v => ({ ...v, password: '' })); setNotice({ kind: 'success', text: 'Sender identity saved. Your credentials remain encrypted in this workspace.' }); },
      onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
    });
  };
  const runTest = (e: FormEvent) => {
    e.preventDefault();
    test.mutate({ data: { toEmail: testEmail.trim() } }, {
      onSuccess: response => { void qc.invalidateQueries({ queryKey: getGetTenantSendingSettingsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); setNotice({ kind: 'success', text: response.message || 'Test message sent and sender identity verified.' }); },
      onError: error => setNotice({ kind: 'error', text: mutationError(error) }),
    });
  };
  return <QueryState loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} label="sender settings"><>
    <Heading eyebrow="SENDING / IDENTITY" title="Sending settings" detail="Configure the SMTP identity this workspace uses to deliver customer campaigns."/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
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
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-5"><span className="flex items-center gap-2 text-[11px] text-[#7b8694]"><ShieldCheck className="h-4 w-4 text-[#598166]"/>Credentials are never displayed after saving.</span><Button type="submit" testId="button-save-sending-settings" disabled={update.isPending}>{update.isPending && <LoaderCircle className="h-4 w-4 animate-spin"/>}{update.isPending ? 'Saving settings' : 'Save sender settings'}</Button></div>
      </form>
      <div className={`${panelClass} overflow-hidden`}>
        <div className="bg-[#f5f8fb] p-5"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">CONNECTION CHECK</div><h2 className="display mt-2 text-[19px] font-bold text-[#1c2b3d]">Send a test message</h2><p className="mt-2 text-[12px] leading-5 text-[#718091]">A test verifies this workspace's SMTP credentials and sender identity.</p></div>
        <form onSubmit={runTest} className="space-y-4 p-5">
          <Field label="Deliver test to" value={testEmail} onChange={setTestEmail} type="email" placeholder="you@company.com" required testId="input-test-recipient"/>
          <Button type="submit" testId="button-test-sending-settings" disabled={test.isPending || !settings?.credentialsConfigured} className="w-full">{test.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}{test.isPending ? 'Sending test' : 'Send test email'}</Button>
          {!settings?.credentialsConfigured && <p className="text-[11px] leading-5 text-[#8a6a4e]">Save SMTP credentials before running a connection test.</p>}
          {settings?.verified && settings.verifiedAt && <div className="flex items-start gap-2 border-t border-[#edf0f2] pt-4 text-[11px] leading-5 text-[#647365]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#52815d]"/>Verified {formatDate(settings.verifiedAt)}</div>}
        </form>
      </div>
    </div>
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

function ContactEmailHistoryDialog({ contact, close }: { contact: Contact; close: () => void }) {
  const query = useGetContactEmailHistory(contact.id);
  return <Modal wide title="Email history" subtitle={`Campaign emails sent to ${contact.email}.`} close={close}>
    {query.isLoading ? <div aria-label="Loading email history" className="space-y-3"><div className="h-20 animate-pulse rounded-md bg-[#edf0f3]"/><div className="h-20 animate-pulse rounded-md bg-[#f1f3f5]"/></div>
      : query.isError ? <div role="alert" className="flex items-center justify-between gap-4 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-4"><p className="text-[12px] text-[#99501e]">We couldn’t load this contact’s email history.</p><Button variant="outline" testId="button-retry-contact-email-history" onClick={() => void query.refetch()}>Retry</Button></div>
      : query.data?.length ? <ol data-testid="list-contact-email-history" className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">{query.data.map((email: ContactEmailHistoryItem) => <li key={email.id} data-testid={`item-contact-email-history-${email.id}`} className="rounded-lg border border-[#e5e9ed] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="text-[13px] font-semibold text-[#26364a]">{email.campaignName}</div><div className="mt-1 break-words text-[12px] text-[#697687]">{email.subject}</div></div><Status tone={emailStatusTone(email.status)}>{email.status}</Status></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#edf0f2] pt-3 text-[11px] text-[#788392]"><span>Last attempt: {formatDate(email.lastAttemptAt)}</span><span>{email.attempts} {email.attempts === 1 ? 'attempt' : 'attempts'}</span>{email.deliveredAt && <span>Delivered: {formatDate(email.deliveredAt)}</span>}</div>
      </li>)}</ol>
      : <div data-testid="empty-contact-email-history" className="rounded-lg border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-10 text-center"><Mail className="mx-auto h-5 w-5 text-[#557399]"/><div className="mt-3 text-[14px] font-semibold text-[#26364a]">No email history yet</div><p className="mt-1 text-[12px] text-[#738091]">No campaign emails have been attempted for this contact.</p></div>}
  </Modal>;
}

export function ContactsPage() {
  const contactsQuery = useListContacts({ query: { queryKey: getListContactsQueryKey(), refetchInterval: 30_000 } });
  const listsQuery = useListContactLists();
  const create = useCreateContact(); const update = useUpdateContact(); const remove = useDeleteContact();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined); const [form, setForm] = useState<ContactForm>(emptyContact); const [importing, setImporting] = useState(false);
  const [historyContact, setHistoryContact] = useState<ContactDirectoryItem | null>(null);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const contacts = contactsQuery.data?.contacts ?? [];
  const lists = (listsQuery.data || []) as ContactList[];
  const visible = useMemo(() => contacts.filter(c => {
    const term = search.trim().toLowerCase();
    const matches = !term || `${c.email} ${c.firstName} ${c.lastName} ${c.companyName ?? ''} ${c.phoneNumber ?? ''} ${c.linkedinUrl ?? ''}`.toLowerCase().includes(term);
    return matches && (filter === 'all' || (filter === 'subscribed' ? c.subscribed : !c.subscribed));
  }), [contacts, search, filter]);
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
  const toggleSub = (contact: Contact) => update.mutate({ contactId: contact.id, data: { subscribed: !contact.subscribed } }, { onSuccess: () => { reload(); setNotice({ kind: 'success', text: contact.subscribed ? 'Contact unsubscribed.' : 'Contact subscribed.' }); }, onError: error => setNotice({ kind: 'error', text: mutationError(error) }) });
  const busy = create.isPending || update.isPending;
  return <QueryState loading={contactsQuery.isLoading || listsQuery.isLoading} error={contactsQuery.isError || listsQuery.isError} retry={() => { void contactsQuery.refetch(); void listsQuery.refetch(); }} label="contacts"><>
    <Heading eyebrow="AUDIENCE / CONTACTS" title="Contacts" detail="Keep your audience accurate, opted-in, and organized by the lists you send to." action={<div className="flex flex-wrap gap-2"><Button variant="outline" testId="button-import-contacts" onClick={() => setImporting(true)}><Upload className="h-4 w-4"/>Import contacts</Button><Button testId="button-add-contact" onClick={openNew}><CirclePlus className="h-4 w-4"/>Add contact</Button></div>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">All contacts</div><div className="display mt-2 text-[26px] font-bold text-[#192638]">{contacts.length.toLocaleString()}</div></div>
      <div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Subscribed</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{contacts.filter(c => c.subscribed).length.toLocaleString()}</div></div>
      <div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Lists in workspace</div><div className="display mt-2 text-[26px] font-bold text-[#245b9b]">{lists.length.toLocaleString()}</div></div>
    </div>
    <section className={panelClass}>
      <div className="flex flex-col gap-3 border-b border-[#e9edf0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="display text-[17px] font-bold text-[#1b293a]">Audience directory</h2><p className="mt-1 text-[11px] text-[#788392]">{visible.length} of {contacts.length} contacts</p></div>
        <div className="flex flex-wrap gap-2">
          <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c97a3]"/><input data-testid="input-search-contacts" className={`${inputClass} w-full pl-9 sm:w-[230px]`} placeholder="Search name, email, company, phone" value={search} onChange={e => setSearch(e.target.value)}/></label>
          <select data-testid="select-contact-status-filter" className={`${inputClass} w-auto min-w-[135px]`} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option></select>
        </div>
      </div>
       {visible.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Contact</th><th className="px-4 py-3 font-semibold">Membership</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last email</th><th className="px-4 py-3 font-semibold">Added</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{visible.map(contact => <tr key={contact.id} data-testid={`row-contact-${contact.id}`} className="hover:bg-[#fbfcfd]">
        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">{(contact.firstName?.[0] || contact.email[0] || '?').toUpperCase()}{contact.lastName?.[0]?.toUpperCase() || ''}</span><span><span className="block text-[12px] font-semibold text-[#26364a]">{contact.firstName} {contact.lastName}</span><span className="mt-0.5 block text-[11px] text-[#7c8794]">{contact.email}</span>{(contact.companyName || contact.phoneNumber || contact.linkedinUrl) && <span data-testid={`text-contact-details-${contact.id}`} className="mt-0.5 block text-[11px] text-[#7c8794]">{[contact.companyName, contact.phoneNumber].filter(Boolean).join(' · ')}{contact.linkedinUrl && <>{(contact.companyName || contact.phoneNumber) ? ' · ' : ''}{/^https?:\/\//i.test(contact.linkedinUrl) ? <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[#245b9b] hover:underline">LinkedIn</a> : contact.linkedinUrl}</>}</span>}</span></div></td>
        <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1.5">{contact.listIds.length ? contact.listIds.map(id => <span key={id} className="rounded bg-[#f1f4f7] px-2 py-1 text-[10px] text-[#5f6e7f]">{lists.find(l => l.id === id)?.name || 'List'}</span>) : <span className="text-[11px] text-[#9aa3ad]">No list</span>}</div></td>
        <td className="px-4 py-3.5"><button data-testid={`button-toggle-subscription-${contact.id}`} disabled={update.isPending} onClick={() => toggleSub(contact)} className="rounded-full focus:outline-none focus:ring-2 focus:ring-[#dbe8f7] disabled:opacity-60"><Status tone={contact.subscribed ? 'green' : 'gray'}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</Status></button></td>
         <td className="px-4 py-3.5">{contact.lastEmail ? <div className="max-w-[230px]"><div className="truncate text-[11px] font-semibold text-[#354458]" title={contact.lastEmail.subject}>{contact.lastEmail.subject}</div><div className="mt-1 truncate text-[10px] text-[#7c8794]" title={contact.lastEmail.campaignName}>{contact.lastEmail.campaignName}</div><div className="mt-1.5 flex flex-wrap items-center gap-2"><Status tone={emailStatusTone(contact.lastEmail.status)}>{contact.lastEmail.status}</Status><span className="text-[10px] text-[#87919d]">{formatDate(contact.lastEmail.lastAttemptAt)}</span></div></div> : <span className="text-[11px] text-[#9aa3ad]">No email sent</span>}</td>
        <td className="px-4 py-3.5 text-[11px] text-[#7c8794]">{new Date(contact.createdAt).toLocaleDateString()}</td>
         <td className="px-5 py-3.5"><div className="flex justify-end gap-1"><Button variant="quiet" testId={`button-contact-history-${contact.id}`} onClick={() => setHistoryContact(contact)}><Clock3 className="h-3.5 w-3.5"/>History</Button><Button variant="quiet" testId={`button-edit-contact-${contact.id}`} onClick={() => openEdit(contact)}><Edit3 className="h-3.5 w-3.5"/>Edit</Button><Button variant="quiet" testId={`button-delete-contact-${contact.id}`} disabled={remove.isPending} onClick={() => setContactToDelete(contact)}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete</Button></div></td>
      </tr>)}</tbody></table></div> : <div className="p-5"><EmptyState title={search || filter !== 'all' ? 'No matching contacts' : 'Your audience starts here'} detail={search || filter !== 'all' ? 'Try a different search or status filter.' : 'Add a contact and assign them to a list to get your first audience ready.'} action={!contacts.length ? <Button testId="button-empty-add-contact" onClick={openNew}><CirclePlus className="h-4 w-4"/>Add a contact</Button> : undefined}/></div>}
    </section>
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
  const query = useListContactLists(); const contactsQuery = useListContacts();
  const create = useCreateContactList(); const update = useUpdateContactList(); const remove = useDeleteContactList();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [editing, setEditing] = useState<ContactList | null | undefined>(undefined); const [name, setName] = useState('');
  const [listToDelete, setListToDelete] = useState<ContactList | null>(null);
  const [viewingList, setViewingList] = useState<ContactList | null>(null);
  const lists = (query.data || []) as ContactList[];
  const contacts = contactsQuery.data?.contacts ?? [];
  const viewingContacts = viewingList
    ? contacts
        .filter(contact => contact.listIds.includes(viewingList.id))
        .sort((left, right) => left.email.localeCompare(right.email))
    : [];
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); };
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
  return <QueryState loading={query.isLoading || contactsQuery.isLoading} error={query.isError || contactsQuery.isError} retry={() => { void query.refetch(); void contactsQuery.refetch(); }} label="contact lists"><>
    <Heading eyebrow="AUDIENCE / LISTS" title="Contact lists" detail="Build focused audiences, control campaign eligibility, and keep every list easy to audit." action={<Button testId="button-create-list" onClick={openCreate}><CirclePlus className="h-4 w-4"/>Create list</Button>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Total lists</div><div className="display mt-2 text-[26px] font-bold text-[#192638]">{lists.length}</div></div><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Active lists</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{lists.filter(l => l.active).length}</div></div><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Contacts in lists</div><div className="display mt-2 text-[26px] font-bold text-[#245b9b]">{contacts.filter(c => c.listIds.length > 0).length}</div></div></div>
    {lists.length ? <div className="space-y-3">{lists.map((list, index) => {
      const memberCount = contacts.filter(c => c.listIds.includes(list.id)).length;
      return <section key={list.id} data-testid={`card-list-${list.id}`} className={`${panelClass} overflow-hidden transition-shadow hover:shadow-sm`}>
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#edf4fc] text-[#245b9b]"><Users className="h-5 w-5"/></div>
          <div className="min-w-[180px] flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="display text-[18px] font-bold text-[#1c2b3d]">{list.name}</h2><Status tone={list.active ? 'green' : 'gray'}>{list.active ? 'Active' : 'Inactive'}</Status></div><p className="mt-1 text-[11px] text-[#7c8794]">Created {new Date(list.createdAt).toLocaleDateString()} · updated {new Date(list.updatedAt).toLocaleDateString()}</p></div>
          <div className="min-w-[125px] rounded-md bg-[#f7f9fb] px-3 py-2"><div className="text-[10px] text-[#7e8996]">Contacts</div><div className="mt-0.5 text-[16px] font-bold text-[#26364a]">{memberCount.toLocaleString()} <span className="text-[10px] font-normal text-[#84909d]">members</span></div></div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto"><Button variant="outline" testId={`button-view-list-contacts-${list.id}`} onClick={() => setViewingList(list)}><Users className="h-3.5 w-3.5"/>View contacts</Button><Button variant="outline" testId={`button-toggle-list-${list.id}`} onClick={() => toggle(list)} disabled={update.isPending}>{list.active ? 'Deactivate' : 'Activate'}</Button><Button variant="quiet" testId={`button-edit-list-${list.id}`} onClick={() => { setEditing(list); setName(list.name); }}><Edit3 className="h-3.5 w-3.5"/>Edit</Button><Button variant="quiet" testId={`button-delete-list-${list.id}`} disabled={remove.isPending} onClick={() => setListToDelete(list)}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete</Button></div>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0f2] bg-[#fcfcfd] px-5 py-2.5"><span className="mono text-[9px] tracking-[.1em] text-[#9aa3ad]">LIST {String(index + 1).padStart(2, '0')}</span><span className="text-[10px] text-[#87919d]">{list.active ? 'Available for campaign targeting' : 'Hidden from campaign queueing'}</span></div>
      </section>;
    })}</div> : <EmptyState title="No lists created yet" detail="Lists make it simple to target the right audience and review its size before sending." action={<Button testId="button-empty-create-list" onClick={openCreate}><CirclePlus className="h-4 w-4"/>Create your first list</Button>}/>}
    {editing !== undefined && <Modal title={editing ? 'Edit contact list' : 'Create contact list'} subtitle="List status controls whether it can be selected for new campaigns." close={() => setEditing(undefined)}>
      <form onSubmit={save} className="space-y-4"><Field label="List name" value={name} onChange={setName} placeholder="Product updates" required testId="input-list-name"/>{editing && <div className="rounded-md bg-[#f6f8fa] p-3 text-[11px] leading-5 text-[#6e7b8a]">This list currently has {editing.contactCount} contact{editing.contactCount === 1 ? '' : 's'} associated. Renaming does not change memberships.</div>}
        <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="outline" testId="button-cancel-list" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" testId="button-submit-list" disabled={create.isPending || update.isPending}>{(create.isPending || update.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{editing ? 'Save list' : 'Create list'}</Button></div>
      </form>
    </Modal>}
    {viewingList && <Modal wide title={`Contacts in ${viewingList.name}`} subtitle={`${viewingContacts.length.toLocaleString()} contact${viewingContacts.length === 1 ? '' : 's'} belong to this list.`} close={() => setViewingList(null)}>
      {viewingContacts.length ? <div className="max-h-[60vh] overflow-y-auto rounded-md border border-[#e7ebef]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 border-b border-[#e7ebef] bg-[#f8fafb] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#7e8996]"><span>Contact</span><span>Email</span><span>Status</span></div>
        {viewingContacts.map(contact => {
          const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email;
          return <div key={contact.id} data-testid={`row-list-contact-${contact.id}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-b border-[#edf0f2] px-4 py-3 last:border-b-0">
            <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#29384a]">{displayName}</div>{contact.companyName && <div className="mt-0.5 truncate text-[10px] text-[#87919d]">{contact.companyName}</div>}</div>
            <a className="truncate text-[11px] text-[#365f8b] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>
            <Status tone={contact.subscribed ? 'green' : 'gray'}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</Status>
          </div>;
        })}
      </div> : <div className="rounded-md border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-8 text-center">
        <Users className="mx-auto h-5 w-5 text-[#7f8ea0]"/><p className="mt-3 text-[13px] font-semibold text-[#344154]">No contacts in this list yet</p><p className="mt-1 text-[11px] text-[#7b8794]">Add or import contacts and assign them to this list.</p>
        <div className="mt-4"><Button variant="outline" testId="button-add-contacts-to-list" onClick={() => { setViewingList(null); setLocation('/contacts'); }}>Go to contacts</Button></div>
      </div>}
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

type CampaignForm = { name: string; subject: string; textBody: string; htmlBody: string; listId: string };
const blankCampaign: CampaignForm = { name: '', subject: '', textBody: '', htmlBody: '', listId: '' };

export function CampaignsPage() {
  const [, setLocation] = useLocation();
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const campaignsQuery = useListCampaigns(); const listsQuery = useListContactLists();
  const create = useCreateCampaign(); const update = useUpdateCampaign(); const remove = useDeleteCampaign(); const send = useSendCampaign();
  const qc = useQueryClient(); const { notice, setNotice, dismiss } = useNotice();
  const [editing, setEditing] = useState<CampaignSummary | null | undefined>(undefined); const [form, setForm] = useState<CampaignForm>(blankCampaign);
  const [pendingAction, setPendingAction] = useState<{ kind: 'queue' | 'delete'; campaign: CampaignSummary } | null>(null);
  const campaigns = (campaignsQuery.data || []) as CampaignSummary[];
  const lists = (listsQuery.data || []) as ContactList[];
  const activeLists = lists.filter(list => list.active);
  const refresh = () => { void qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactListsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() }); };
  const openNew = () => { setEditing(null); setForm({ ...blankCampaign, listId: activeLists[0]?.id || '' }); };
  const openEdit = (campaign: CampaignSummary) => { setEditing(campaign); setForm({ name: campaign.name, subject: campaign.subject, textBody: campaign.textBody, htmlBody: campaign.htmlBody ?? plainTextToHtml(campaign.textBody), listId: campaign.listId || '' }); };
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
  const save = (e: FormEvent) => {
    e.preventDefault();
    const data = { name: form.name.trim(), subject: form.subject.trim(), textBody: form.textBody.trim(), htmlBody: form.htmlBody.trim(), listId: form.listId };
    const success = () => { refresh(); setEditing(undefined); setNotice({ kind: 'success', text: editing ? 'Draft changes saved.' : 'Campaign draft created.' }); };
    const fail = (error: unknown) => setNotice({ kind: 'error', text: mutationError(error) });
    if (editing) update.mutate({ campaignId: editing.id, data }, { onSuccess: success, onError: fail });
    else create.mutate({ data: data as Parameters<typeof create.mutate>[0]['data'] }, { onSuccess: success, onError: fail });
  };
  const queue = (campaign: CampaignSummary) => setPendingAction({ kind: 'queue', campaign });
  const del = (campaign: CampaignSummary) => setPendingAction({ kind: 'delete', campaign });
  const confirmCampaignAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.kind === 'queue') {
      send.mutate({ campaignId: action.campaign.id }, {
        onSuccess: response => { setPendingAction(null); refresh(); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); setNotice({ kind: 'success', text: response.status === 'queued' ? 'Campaign queued for delivery.' : `Campaign status: ${response.status}.` }); },
        onError: error => { setPendingAction(null); setNotice({ kind: 'error', text: mutationError(error) }); },
      });
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
    <Heading eyebrow="DELIVERY / CAMPAIGNS" title="Campaigns" detail="Shape a draft, choose an active audience, then queue and review persisted delivery outcomes." action={<Button testId="button-create-campaign" onClick={openNew} disabled={!activeLists.length}><CirclePlus className="h-4 w-4"/>New campaign</Button>}/>
    {notice && <Notice kind={notice.kind} onDismiss={dismiss}>{notice.text}</Notice>}
    {!activeLists.length && <div className="mb-5 flex items-start gap-3 rounded-md border border-[#efd9bd] bg-[#fff8ef] px-4 py-3 text-[12px] leading-5 text-[#895b2f]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>Activate a contact list before creating a campaign. Drafts can only target active lists.</span></div>}
     <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Campaigns</div><div className="display mt-2 text-[26px] font-bold text-[#192638]">{campaigns.length}</div><div className="mt-1 text-[10px] text-[#8a95a1]">{campaigns.filter(c => c.status === 'draft').length} drafts · {campaigns.filter(c => c.status !== 'draft').length} queued or sent</div></div><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Delivered</div><div className="display mt-2 text-[26px] font-bold text-[#397050]">{totalDelivered.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#8a95a1]">Accepted by SMTP provider</div></div><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Bounced</div><div className="display mt-2 text-[26px] font-bold text-[#ae642c]">{totalBounced.toLocaleString()}</div><div className="mt-1 text-[10px] text-[#8a95a1]">Across all campaigns</div></div><div className={`${panelClass} p-4`}><div className="text-[11px] text-[#778291]">Suppressed</div><div className="display mt-2 text-[26px] font-bold text-[#66717e]">{campaigns.reduce((sum, campaign) => sum + campaign.suppressed, 0).toLocaleString()}</div><div className="mt-1 text-[10px] text-[#8a95a1]">Unsubscribed or removed before send</div></div></div>
    {campaigns.length ? <section className={panelClass}>
      <div className="flex items-center justify-between border-b border-[#e9edf0] px-4 py-4"><div><h2 className="display text-[17px] font-bold text-[#1b293a]">Campaign activity</h2><p className="mt-1 text-[11px] text-[#788392]">Queue timestamps and final delivery counts from your workspace.</p></div><span className="mono hidden text-[9px] tracking-[.12em] text-[#9aa3ad] sm:block"><Activity className="mr-1 inline h-3.5 w-3.5"/>DELIVERY LOG</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.12em] text-[#8a95a2]"><tr><th className="px-5 py-3 font-semibold">Campaign</th><th className="px-4 py-3 font-semibold">Audience</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Delivery</th><th className="px-4 py-3 font-semibold">Queued / completed</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{campaigns.map(campaign => <tr key={campaign.id} data-testid={`row-campaign-${campaign.id}`} className="hover:bg-[#fbfcfd]">
        <td className="max-w-[240px] px-5 py-4"><button data-testid={`button-campaign-details-${campaign.id}`} onClick={() => setLocation(`/campaigns/${campaign.id}`)} className="text-left"><span className="block truncate text-[12px] font-semibold text-[#26364a] hover:text-[#245b9b]">{campaign.name}</span><span className="mt-1 block truncate text-[11px] text-[#7c8794]">{campaign.subject}</span></button></td>
        <td className="px-4 py-4"><span className="block text-[11px] font-medium text-[#536172]">{lists.find(l => l.id === campaign.listId)?.name || 'Removed list'}</span><span className="mt-1 block text-[10px] text-[#8a95a1]">{campaign.recipients.toLocaleString()} {campaign.status === 'draft' ? 'eligible' : 'total'} recipients</span><span className="mt-0.5 block text-[10px] text-[#8a95a1]">Estimated send: {formatDeliveryDuration(campaign.estimatedDurationSeconds)}</span></td>
        <td className="px-4 py-4"><Status tone={statusTone(campaign.status)}>{campaign.status}</Status></td>
         <td className="px-4 py-4"><div className="flex items-center gap-2 text-[11px]"><span className="font-semibold text-[#397050]">{campaign.delivered.toLocaleString()} delivered</span><span className="text-[#c1c7cd]">/</span><span className="text-[#a85f2a]">{campaign.bounced.toLocaleString()} bounced</span></div><div className="mt-1 text-[10px] text-[#8a95a1]">{campaign.suppressed.toLocaleString()} suppressed · {campaign.unknown.toLocaleString()} unknown · {campaign.queued.toLocaleString()} queued</div></td>
        <td className="px-4 py-4 text-[10px] leading-5 text-[#7b8794]">{campaign.queuedAt ? <><span className="block">Queued {formatDate(campaign.queuedAt)}</span>{campaign.completedAt && <span className="block">Finished {formatDate(campaign.completedAt)}</span>}</> : 'Not queued'}</td>
         <td className="px-5 py-4"><div className="flex justify-end gap-1">{campaign.status === 'draft' && <><Button variant="quiet" testId={`button-edit-campaign-${campaign.id}`} onClick={() => openEdit(campaign)}><Edit3 className="h-3.5 w-3.5"/>Edit</Button><Button testId={`button-queue-campaign-${campaign.id}`} onClick={() => queue(campaign)} disabled={send.isPending || !campaign.listId || !lists.some(l => l.id === campaign.listId && l.active)}><Send className="h-3.5 w-3.5"/>Queue</Button><Button variant="quiet" testId={`button-delete-campaign-${campaign.id}`} disabled={remove.isPending} onClick={() => del(campaign)}><Trash2 className="h-3.5 w-3.5 text-[#b85b20]"/>Delete</Button></>}</div></td>
      </tr>)}</tbody></table></div>
    </section> : <EmptyState title="No campaigns yet" detail={activeLists.length ? 'Create a draft to prepare a message for an active list. Delivery counts will appear here after queueing.' : 'Create and activate a list first. Campaigns are always tied to an audience in this workspace.'} action={activeLists.length ? <Button testId="button-empty-create-campaign" onClick={openNew}><CirclePlus className="h-4 w-4"/>Create campaign</Button> : undefined}/>}
    {editing !== undefined && <Modal wide title={editing ? 'Edit campaign draft' : 'New campaign draft'} subtitle="Only draft campaigns can be edited. Queueing starts delivery to subscribed contacts in the selected list." close={() => setEditing(undefined)}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Internal campaign name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="April product notes" required testId="input-campaign-name"/><label><span className={labelClass}>Target list</span><select data-testid="select-campaign-list" required className={inputClass} value={form.listId} onChange={e => setForm(f => ({ ...f, listId: e.target.value }))}><option value="" disabled>Select an active list</option>{activeLists.map(list => <option key={list.id} value={list.id}>{list.name} · {list.contactCount} contacts</option>)}</select></label></div>
         <label className="block"><span className={labelClass}>Email subject</span><input ref={subjectInputRef} data-testid="input-campaign-subject" className={inputClass} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="A concise subject your audience will recognize" required maxLength={200}/></label>
         <div className="-mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[10px] text-[#7e8996]">Insert a subject field:</span>{CONTACT_PLACEHOLDERS.map(({ token, label }) => <button key={token} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertSubjectPlaceholder(token)} className="rounded border border-[#dce4ec] bg-white px-2 py-1 text-[10px] font-medium text-[#365a7e] hover:border-[#9abbe1] hover:bg-[#f1f7fd]" data-testid={`button-insert-subject-placeholder-${token.slice(2, -2)}`} title={`Insert ${token}`}>{label}</button>)}</div>
         <label className="block"><span className={labelClass}>Formatted message</span><RichTextEditor value={form.htmlBody} onChange={(htmlBody, textBody) => setForm(current => ({ ...current, htmlBody, textBody }))}/><span className="mt-1.5 block text-[11px] leading-relaxed text-[#808a97]">Formatting is preserved in the delivered email. A plain-text fallback is generated from this message automatically.</span></label>
        <div className="flex items-center gap-2 rounded-md bg-[#f5f8fb] px-3 py-2.5 text-[11px] text-[#607186]"><Users className="h-4 w-4 shrink-0 text-[#245b9b]"/>Eligible recipients are subscribed contacts associated with the selected active list.</div>
        <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="outline" testId="button-cancel-campaign" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" testId="button-submit-campaign" disabled={create.isPending || update.isPending || !activeLists.length}>{(create.isPending || update.isPending) && <LoaderCircle className="h-4 w-4 animate-spin"/>}{editing ? 'Save draft' : 'Create draft'}</Button></div>
      </form>
    </Modal>}
     <ConfirmActionDialog
       open={Boolean(pendingAction)}
       title={pendingAction?.kind === 'queue' ? 'Queue this campaign?' : 'Delete this draft?'}
       description={pendingAction?.kind === 'queue'
         ? `Start sending “${pendingAction.campaign.name}” to ${pendingAction.campaign.recipients} eligible recipients in its selected list.`
         : pendingAction ? `Permanently delete the draft “${pendingAction.campaign.name}”? This cannot be undone.` : ''}
       confirmLabel={pendingAction?.kind === 'queue' ? 'Queue campaign' : 'Delete draft'}
       destructive={pendingAction?.kind !== 'queue'}
       pending={send.isPending || remove.isPending}
       onOpenChange={open => { if (!open && !send.isPending && !remove.isPending) setPendingAction(null); }}
       onConfirm={confirmCampaignAction}
       testId="dialog-campaign-action"
     />
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
      const { campaign, targetList, pacing } = dashboard;
      const resolved = campaign.delivered + campaign.bounced + campaign.suppressed + campaign.unknown;
      const progress = campaign.recipients > 0 ? Math.min(100, Math.round((resolved / campaign.recipients) * 100)) : 0;
      const statusTone = campaign.status === 'completed' ? 'green' : campaign.status === 'queued' || campaign.status === 'sending' ? 'blue' : 'gray';
      const metrics = [
        { label: 'Total emails', value: campaign.recipients, detail: campaign.status === 'draft' ? 'Currently eligible in this list' : 'Captured when queued' },
        { label: 'Delivered', value: campaign.delivered, detail: 'Accepted by SMTP provider' },
        { label: 'Bounced', value: campaign.bounced, detail: 'Rejected or failed delivery' },
        { label: 'Suppressed', value: campaign.suppressed, detail: 'Unsubscribed or removed' },
        { label: 'Still queued', value: pacing.remainingEmails, detail: campaign.status === 'draft' ? 'Will be queued when sent' : 'Waiting for paced delivery' },
      ];

      return <>
        <div className="mb-5">
          <Button variant="outline" testId="button-back-to-campaigns" onClick={() => setLocation('/campaigns')}><ArrowLeft className="h-4 w-4"/>Back to campaigns</Button>
        </div>
        <Heading eyebrow="DELIVERY / CAMPAIGNS / DASHBOARD" title={campaign.name} detail={campaign.subject} action={<Status tone={statusTone}>{campaign.status}</Status>}/>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(metric => <div key={metric.label} className={`${panelClass} p-4`}>
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
            <p className="mt-4 border-t border-[#edf0f2] pt-3 text-[10px] leading-5 text-[#8993a0]">Estimate assumes no other campaigns use the sending allowance. Existing queued work and SMTP response times can make delivery take longer.</p>
          </section>

          <section className={`${panelClass} p-5`}>
            <h2 className="display text-[17px] font-bold text-[#1b293a]">Target list</h2>
            {targetList ? <>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-[#647183]"><Users className="h-4 w-4 text-[#245b9b]"/>{targetList.name}<Status tone={targetList.active ? 'green' : 'gray'}>{targetList.active ? 'active' : 'inactive'}</Status></div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[['All contacts', targetList.totalContacts], ['Eligible', targetList.eligibleContacts], ['Unsubscribed', targetList.unsubscribedContacts]].map(([label, value]) => <div key={label} className="rounded-md bg-[#f7f9fb] p-3"><div className="text-[10px] text-[#7a8795]">{label}</div><div className="mt-1 text-[16px] font-bold text-[#26364a]">{Number(value).toLocaleString()}</div></div>)}
              </div>
              <p className="mt-4 text-[10px] leading-5 text-[#8993a0]">Only subscribed contacts in the selected list are eligible. The recipient total is fixed when a draft is queued.</p>
            </> : <p className="mt-3 text-[12px] text-[#7b8794]">The campaign’s target list has been removed.</p>}
          </section>
        </div>

        <section className={`${panelClass} mb-5 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-[#e9edf0] px-5 py-4"><div><h2 className="display text-[17px] font-bold text-[#1b293a]">Delivery progress</h2><p className="mt-1 text-[11px] text-[#788392]">{resolved.toLocaleString()} of {campaign.recipients.toLocaleString()} recipients resolved</p></div><span className="mono text-[11px] text-[#647183]">{progress}%</span></div>
          <div className="px-5 py-4"><div className="h-2 overflow-hidden rounded-full bg-[#edf0f2]"><div className="h-full rounded-full bg-[#397050] transition-all" style={{ width: `${progress}%` }}/></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[['Delivered', campaign.delivered, '#397050'], ['Bounced', campaign.bounced, '#ae642c'], ['Suppressed', campaign.suppressed, '#66717e'], ['Unknown', campaign.unknown, '#8a65a2']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between text-[11px]"><span className="text-[#778291]">{label}</span><span className="font-semibold" style={{ color: String(color) }}>{Number(value).toLocaleString()}</span></div>)}
            </div>
          </div>
        </section>

        <section className={`${panelClass} p-5`}>
          <h2 className="display text-[17px] font-bold text-[#1b293a]">Campaign message</h2>
          <div className="mt-4 border-b border-[#edf0f2] pb-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">Subject</div><p className="mt-1 text-[13px] font-semibold text-[#29384a]">{campaign.subject}</p></div>
           <div className="pt-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-[#7c8794]">{campaign.htmlBody ? 'Formatted message' : 'Plain-text message'}</div>{campaign.htmlBody ? <div className="campaign-message-preview mt-2 rounded-md bg-[#f8fafb] p-4 text-[12px] leading-6 text-[#566476] [&_a]:text-[#245b9b] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[#9abbe1] [&_blockquote]:pl-3 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-2 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-bold [&_u]:underline [&_ul]:my-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: campaign.htmlBody }}/> : <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-6 text-[#566476]">{campaign.textBody}</pre>}</div>
          <div className="mt-5 flex flex-wrap gap-5 border-t border-[#edf0f2] pt-4 text-[10px] text-[#7c8794]"><span>Created: {formatDate(campaign.createdAt)}</span><span>Queued: {formatDate(campaign.queuedAt)}</span><span>Completed: {formatDate(campaign.completedAt)}</span></div>
        </section>
      </>;
    })()}
  </QueryState>;
}