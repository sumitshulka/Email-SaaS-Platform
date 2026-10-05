import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { AlertCircle, ArrowLeft, CheckCircle2, LoaderCircle, Pencil, Save, ShieldCheck, Unlink2, Building2, Link2, Mail } from 'lucide-react';
import {
  getGetCompanyQueryKey, getGetContactEmailHistoryQueryKey, getGetContactFieldOptionsQueryKey, getGetContactQueryKey, getListCompaniesQueryKey, getListContactsQueryKey, getListUnlinkedCompanyProfilesQueryKey,
  useGetContact, useGetContactEmailHistory, useGetContactFieldOptions, useListCompanies, useListContactLists, useUpdateContact,
} from '@workspace/api-client-react';
import type { Company, Contact, ContactEmailHistoryItem, ContactUpdate } from '@workspace/api-client-react';
import { CompanyLinkConfirmation, CompanyProfileComparison, isCompanyProfileConflict, type CompanyLinkReplacement, type CompanyProfileSnapshot } from '@/components/company-link-confirmation';
import { ContactFieldSelect } from '@/components/contact-field-select';
import { ContactReportEvidence } from '@/components/delivery-evidence';

const panel = 'rounded-lg border border-[#e0e4e9] bg-white';
const input = 'h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]';
const label = 'mb-1.5 block text-[11px] font-semibold text-[#465568]';
const nullableFields = [
  'companyName', 'linkedinUrl', 'phoneNumber', 'jobTitle', 'department', 'seniority',
  'mobilePhone', 'websiteUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl', 'location',
  'preferredLanguage', 'timeZone', 'lifecycleStage', 'leadStatus', 'leadSource',
  'interests', 'goals', 'painPoints', 'personalizationContext', 'notes',
  'companyWebsiteUrl', 'companyDomain', 'companyIndustry', 'companySize', 'companyRevenueRange',
  'companyDescription', 'companyPhoneNumber', 'companyLinkedinUrl', 'companyLocation',
] as const;
type NullableField = typeof nullableFields[number];
type Editable = Record<NullableField, string> & {
  email: string; firstName: string; lastName: string; subscribed: boolean;
};
const fromContact = (contact: Contact): Editable => ({
  email: contact.email, firstName: contact.firstName, lastName: contact.lastName,
  subscribed: contact.subscribed,
  ...Object.fromEntries(nullableFields.map(key => [key, contact[key] ?? ''])),
} as Editable);
const nullableValue = (value: string) => value === '' ? null : value;
const date = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const profileFromContact = (contact: Contact): CompanyProfileSnapshot => ({
  companyName: contact.companyName,
  companyWebsiteUrl: contact.companyWebsiteUrl,
  companyDomain: contact.companyDomain,
  companyIndustry: contact.companyIndustry,
  companySize: contact.companySize,
  companyRevenueRange: contact.companyRevenueRange,
  companyDescription: contact.companyDescription,
  companyPhoneNumber: contact.companyPhoneNumber,
  companyLinkedinUrl: contact.companyLinkedinUrl,
  companyLocation: contact.companyLocation,
});
const profileFromCompany = (company: Company): CompanyProfileSnapshot => ({
  companyName: company.companyName,
  companyWebsiteUrl: company.companyWebsiteUrl,
  companyDomain: company.companyDomain,
  companyIndustry: company.companyIndustry,
  companySize: company.companySize,
  companyRevenueRange: company.companyRevenueRange,
  companyDescription: company.companyDescription,
  companyPhoneNumber: company.companyPhoneNumber,
  companyLinkedinUrl: company.companyLinkedinUrl,
  companyLocation: company.companyLocation,
});

function DataField({ label: title, value, testId }: { label: string; value: string | null | undefined; testId: string }) {
  return <div className="min-w-0 border-b border-[#edf0f2] py-3 last:border-0">
    <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[.11em] text-[#8993a0]">{title}</dt>
    <dd data-testid={testId} className="break-words text-[12px] leading-5 text-[#344154]">{value || <span className="text-[#a0a8b3]">Not provided</span>}</dd>
  </div>;
}
function InputField({ title, value, onChange, testId, type = 'text' }: { title: string; value: string; onChange: (value: string) => void; testId: string; type?: string }) {
  return <label className="block min-w-0"><span className={label}>{title}</span><input className={input} type={type} data-testid={testId} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function TextAreaField({ title, value, onChange, testId }: { title: string; value: string; onChange: (value: string) => void; testId: string }) {
  return <label className="block min-w-0"><span className={label}>{title}</span>
    <textarea className="min-h-[84px] w-full resize-y rounded-md border border-[#d8dde4] bg-white px-3 py-2 font-mono text-[12px] leading-5 text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:font-sans placeholder:text-[#a0a8b3]" data-testid={testId} value={value} onChange={event => onChange(event.target.value)} wrap="soft" />
  </label>;
}
function OnlineProfileField({ title, value, onChange, testId, editing, onToggleEdit }: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  return <div className="min-w-0">
    <div className="mb-1.5 flex items-center justify-between gap-3">
      <span className={label}>{title}</span>
      <button type="button" aria-label={`${editing ? 'Finish editing' : 'Edit'} ${title}`} onClick={onToggleEdit} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-[#55708e] hover:bg-[#edf4fc] hover:text-[#174f99]">
        {editing ? 'Done' : <><Pencil className="h-3 w-3"/>Edit</>}
      </button>
    </div>
    {editing
      ? <input aria-label={title} className={input} type="text" data-testid={testId} value={value} onChange={event => onChange(event.target.value)} />
      : <div data-testid={`${testId}-full-value`} className="min-h-10 break-all rounded-md border border-[#e8edf1] bg-[#f8fafb] px-3 py-2 font-mono text-[11px] leading-5 text-[#3e536b]">{value || <span className="font-sans text-[#a0a8b3]">Not provided</span>}</div>}
  </div>;
}
function Section({ title, eyebrow, children, testId }: { title: string; eyebrow: string; children: ReactNode; testId?: string }) {
  return <section data-testid={testId} className={`${panel} overflow-hidden`}>
    <header className="border-b border-[#e9edf0] bg-[#fbfcfd] px-5 py-4">
      <div className="font-mono text-[9px] uppercase tracking-[.16em] text-[#818c99]">{eyebrow}</div>
      <h2 className="mt-1 text-[15px] font-bold tracking-[-.02em] text-[#1c2b3d]">{title}</h2>
    </header>
    <div className="p-5">{children}</div>
  </section>;
}

const emailHistoryStatus: Record<ContactEmailHistoryItem['status'], { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-[#edf4fc] text-[#245b9b]' },
  sending: { label: 'Sending', className: 'bg-[#edf4fc] text-[#245b9b]' },
  delivered: { label: 'SMTP accepted', className: 'bg-[#edf7f0] text-[#397050]' },
  bounced: { label: 'Rejected / failed', className: 'bg-[#fff3e8] text-[#a95218]' },
  suppressed: { label: 'Suppressed', className: 'bg-[#f0f2f4] text-[#66717e]' },
  unknown: { label: 'Outcome unknown', className: 'bg-[#f0f2f4] text-[#66717e]' },
};

function ContactEmailHistorySection({ contactId, email }: { contactId: string; email: string }) {
  const query = useGetContactEmailHistory(contactId, {
    query: {
      enabled: !!contactId,
      queryKey: getGetContactEmailHistoryQueryKey(contactId),
      refetchInterval: 30_000,
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });

  return <Section title="Email history" eyebrow="CAMPAIGN / DELIVERY ACTIVITY" testId="section-contact-email-history">
    <p className="mb-4 text-[11px] leading-5 text-[#7c8794]">Campaign email attempts to <span className="font-medium text-[#526174]">{email}</span>. SMTP acceptance is not proof of inbox delivery; provider reports are shown separately.</p>
    {query.isError && !query.data ? <div role="alert" data-testid="status-contact-email-history-error" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] p-4">
      <div><p className="text-[12px] font-semibold text-[#99501e]">We couldn’t load this contact’s email history.</p><p className="mt-1 text-[11px] text-[#93694c]">Your sending history is unchanged. Retry to load it again.</p></div>
      <button type="button" data-testid="button-retry-contact-email-history-detail" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#e8c5a8] bg-white px-3 text-[11px] font-semibold text-[#94501f] hover:bg-[#fff7f0] disabled:opacity-50">{query.isFetching ? 'Retrying…' : 'Retry'}</button>
    </div> : query.isLoading ? <div aria-label="Loading contact email history" data-testid="loading-contact-email-history" className="space-y-3">
      {[0, 1, 2].map(item => <div key={item} className="h-24 animate-pulse rounded-lg border border-[#e8ecef] bg-[#f6f8f9]"/> )}
    </div> : query.data?.length ? <div>
      {query.isError && <div role="status" data-testid="status-contact-email-history-stale" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[11px] text-[#99501e]"><span>Couldn’t refresh. Showing the latest history already loaded.</span><button type="button" data-testid="button-retry-contact-email-history-stale" onClick={() => void query.refetch()} className="font-semibold underline underline-offset-2">Retry</button></div>}
      <ol data-testid="list-contact-email-history" className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
        {query.data.map(emailItem => {
          const status = emailHistoryStatus[emailItem.status];
          return <li key={emailItem.id} data-testid={`item-contact-email-history-${emailItem.id}`} className="rounded-lg border border-[#e5e9ed] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div data-testid={`text-email-history-campaign-${emailItem.id}`} className="text-[13px] font-semibold text-[#26364a]">{emailItem.campaignName}</div>
                <div data-testid={`text-email-history-subject-${emailItem.id}`} className="mt-1 break-words text-[12px] text-[#697687]">{emailItem.subject}</div>
                <Link href={`/campaigns/${encodeURIComponent(emailItem.campaignId)}`} data-testid={`link-email-history-campaign-${emailItem.id}`} className="mt-2 inline-flex text-[10px] font-semibold text-[#245b9b] underline decoration-[#b9cce0] underline-offset-2 hover:text-[#174f99]">View campaign</Link>
              </div>
              <span data-testid={`status-email-history-${emailItem.id}`} className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
            </div>
            <dl className="mt-3 grid gap-3 border-t border-[#edf0f2] pt-3 text-[11px] sm:grid-cols-3">
              <div><dt className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#87919d]">Last attempt</dt><dd data-testid={`text-email-history-attempt-${emailItem.id}`} className="mt-1 text-[#586778]">{date(emailItem.lastAttemptAt)}</dd></div>
              <div><dt className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#87919d]">Attempts</dt><dd data-testid={`text-email-history-attempt-count-${emailItem.id}`} className="mt-1 text-[#586778]">{emailItem.attempts} {emailItem.attempts === 1 ? 'attempt' : 'attempts'}</dd></div>
              <div><dt className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#87919d]">SMTP acceptance</dt><dd data-testid={`text-email-history-accepted-${emailItem.id}`} className="mt-1 text-[#586778]">{emailItem.deliveredAt ? date(emailItem.deliveredAt) : 'Not recorded'}</dd></div>
            </dl>
            <ContactReportEvidence detailed id={emailItem.id} item={emailItem}/>
          </li>;
        })}
      </ol>
    </div> : <div>
      {query.isError && <div role="status" data-testid="status-contact-email-history-stale" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[11px] text-[#99501e]"><span>Couldn’t refresh. Showing the latest history already loaded.</span><button type="button" data-testid="button-retry-contact-email-history-stale" onClick={() => void query.refetch()} className="font-semibold underline underline-offset-2">Retry</button></div>}
      <div data-testid="empty-contact-email-history" className="rounded-lg border border-dashed border-[#d9dfe6] bg-[#fbfcfd] px-5 py-10 text-center">
        <Mail className="mx-auto h-5 w-5 text-[#557399]"/>
        <div className="mt-3 text-[14px] font-semibold text-[#26364a]">No email history yet</div>
        <p className="mt-1 text-[12px] text-[#738091]">No campaign email attempts have been recorded for this contact.</p>
      </div>
    </div>}
  </Section>;
}

export function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const contactId = params.contactId || '';
  const query = useGetContact(contactId, {
    query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId), staleTime: 0, refetchOnMount: 'always' },
  });
  const fieldOptionsQuery = useGetContactFieldOptions();
  const listsQuery = useListContactLists();
  const companiesQuery = useListCompanies();
  const update = useUpdateContact();
  const qc = useQueryClient();
  const [form, setForm] = useState<Editable | null>(null);
  const [editingProfiles, setEditingProfiles] = useState<Set<NullableField>>(() => new Set());
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [companyChoice, setCompanyChoice] = useState('');
  const [replacement, setReplacement] = useState<CompanyLinkReplacement | null>(null);
  const [companyNotice, setCompanyNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const contact = query.data as Contact | undefined;

  // Reinitialize when a contact is first loaded or the server returns a newer revision.
  useEffect(() => {
    if (contact) {
      setForm(fromContact(contact));
      setEditingProfiles(new Set());
    }
  }, [contact?.id, contact?.updatedAt]);

  const change = (key: keyof Editable, value: string | boolean) =>
    setForm(current => current ? { ...current, [key]: value } : current);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!contact || !form) return;
    const data: ContactUpdate = {
      email: form.email,
      firstName: form.firstName,
      lastName: form.lastName,
      ...Object.fromEntries(nullableFields.map(key => [key, nullableValue(form[key])])),
      subscribed: form.subscribed,
    };
    update.mutate({ contactId: contact.id, data }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ queryKey: getListUnlinkedCompanyProfilesQueryKey() });
        setNotice({ kind: 'success', text: 'Contact changes saved. This save does not change the company association.' });
      },
      onError: error => setNotice({ kind: 'error', text: errorText(error) }),
    });
  };

  if (query.isLoading || !contact || !form) {
    if (query.isError) return <div className={`${panel} flex flex-col items-start gap-3 p-6`} role="alert">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-[#26364a]"><AlertCircle className="h-4 w-4 text-[#c16d31]"/>Contact unavailable</div>
      <p className="text-[12px] text-[#778291]">This contact could not be found in the current workspace, or its details could not be loaded.</p>
      <div className="flex gap-2"><button type="button" onClick={() => void query.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-[12px] font-semibold text-[#344154] hover:bg-[#f7f9fb]">Retry</button><Link href="/contacts" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline hover:bg-[#edf4fc]"><ArrowLeft className="h-3.5 w-3.5"/>Contacts</Link></div>
    </div>;
    return <div aria-label="Loading contact" className="space-y-4"><div className="h-7 w-48 animate-pulse rounded bg-[#edf0f3]"/><div className="h-36 animate-pulse rounded-lg bg-[#f1f3f5]"/><div className="grid gap-4 md:grid-cols-2"><div className="h-72 animate-pulse rounded-lg bg-[#f1f3f5]"/><div className="h-72 animate-pulse rounded-lg bg-[#f1f3f5]"/></div></div>;
  }

  const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.email;
  const selectedCompany = companiesQuery.data?.companies.find(item => item.id === companyChoice);
  const setString = (key: Exclude<keyof Editable, 'subscribed'>) => (value: string) => change(key, value);
  const toggleProfileEdit = (key: NullableField) => setEditingProfiles(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const changeCompany = (companyId: string | null, confirmed = false) => {
    const targetCompany = companiesQuery.data?.companies.find(item => item.id === companyId);
    setCompanyNotice(null);
    setNotice(null);
    update.mutate({ contactId: contact.id, data: {
      companyId, ...(confirmed ? { replaceLegacyCompanyProfile: true } : {}),
    } }, {
      onSuccess: linkedContact => {
        setReplacement(null);
        qc.setQueryData(getGetContactQueryKey(contact.id), linkedContact);
        void qc.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListUnlinkedCompanyProfilesQueryKey() });
        if (contact.companyId) void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(contact.companyId) });
        if (linkedContact.companyId) void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(linkedContact.companyId) });
        if (linkedContact.companyId !== companyId) {
          setCompanyNotice({ kind: 'error', text: 'The server did not confirm the company association. Refresh and try again.' });
          return;
        }
        setCompanyChoice('');
        setCompanyNotice({ kind: 'success', text: linkedContact.companyId ? 'Shared company profile linked. Company details now come from the shared record.' : 'Company unlinked. The company profile was preserved on this contact.' });
      },
      onError: error => {
        setReplacement(!confirmed && targetCompany && isCompanyProfileConflict(error) ? {
          contactId: contact.id, contactName: contact.name, legacyCompanyName: contact.companyName,
          companyId: targetCompany.id, companyName: targetCompany.companyName,
          legacyProfile: profileFromContact(contact), sharedProfile: profileFromCompany(targetCompany),
        } : null);
        const text = errorText(error);
        const conflict = /conflict|domain|company profile/i.test(text);
        setCompanyNotice({ kind: 'error', text: conflict
          ? `This contact could not be linked because of a company profile or domain conflict. No contact or company data was discarded. ${text}`
          : text });
      },
    });
  };

  return <div className="fade-in">
    <CompanyLinkConfirmation replacement={replacement} pending={update.isPending}
      onCancel={() => setReplacement(null)} onConfirm={target => {
        if (target.contactId === contact.id) changeCompany(target.companyId, true);
        else setReplacement(null);
      }} />
    {companyNotice && <div role={companyNotice.kind === 'error' ? 'alert' : 'status'} data-testid="status-contact-company"
      className={`mb-5 rounded-md border px-4 py-3 text-[12px] ${companyNotice.kind === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{companyNotice.text}</div>}
    <div className="mb-5"><Link href="/contacts" data-testid="link-back-contacts" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#55708e] no-underline hover:text-[#174f99]"><ArrowLeft className="h-4 w-4"/>Back to contacts</Link></div>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[#d7e3ef] bg-[#edf4fc] font-semibold text-[#245b9b]">{(contact.firstName[0] || contact.email[0] || '?').toUpperCase()}{contact.lastName[0]?.toUpperCase() || ''}</div>
        <div className="min-w-0"><div className="mb-1 font-mono text-[9px] uppercase tracking-[.16em] text-[#7d8794]">CONTACT RECORD / {contact.id.slice(0, 8)}</div><h1 className="display break-words text-[27px] font-bold leading-tight text-[#172334]">{displayName}</h1><p className="mt-1 break-all text-[13px] text-[#687484]">{contact.email}</p></div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-[#dce5e0] bg-[#f5faf6] px-3 py-2 text-[11px] font-semibold text-[#397050]"><ShieldCheck className="h-4 w-4"/>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</div>
    </div>
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="status-contact-save" className={`mb-5 flex items-center gap-2 rounded-md border px-4 py-3 text-[12px] ${notice.kind === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}><CheckCircle2 className="h-4 w-4 shrink-0"/>{notice.text}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className={`${panel} p-4`}><div className="text-[10px] uppercase tracking-wide text-[#84909e]">Audience status</div><div className={`mt-2 text-[14px] font-semibold ${contact.subscribed ? 'text-[#397050]' : 'text-[#66717e]'}`}>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</div><p className="mt-1 text-[10px] text-[#8993a0]">Campaign eligibility follows this status.</p></div>
      <div className={`${panel} p-4`}><div className="text-[10px] uppercase tracking-wide text-[#84909e]">Record created</div><div className="mt-2 text-[13px] font-semibold text-[#29384a]">{date(contact.createdAt)}</div><p className="mt-1 text-[10px] text-[#8993a0]">In this workspace</p></div>
      <div className={`${panel} p-4`}><div className="text-[10px] uppercase tracking-wide text-[#84909e]">Last updated</div><div className="mt-2 text-[13px] font-semibold text-[#29384a]">{date(contact.updatedAt)}</div><p className="mt-1 text-[10px] text-[#8993a0]">Contact record revision</p></div>
    </div>
    <form onSubmit={save} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(330px,.88fr)]">
      <div className="space-y-5">
        <Section title="Contact details" eyebrow="PERSON / IDENTITY">
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField title="First name" value={form.firstName} onChange={setString('firstName')} testId="input-detail-first-name"/>
            <InputField title="Last name" value={form.lastName} onChange={setString('lastName')} testId="input-detail-last-name"/>
            <InputField title="Email address" type="email" value={form.email} onChange={setString('email')} testId="input-detail-email"/>
            <ContactFieldSelect field="jobTitle" title="Job title" value={form.jobTitle} options={fieldOptionsQuery.data?.options ?? []} onChange={setString('jobTitle')} testId="input-detail-job-title"/>
            <InputField title="Department" value={form.department} onChange={setString('department')} testId="input-detail-department"/>
            <InputField title="Seniority" value={form.seniority} onChange={setString('seniority')} testId="input-detail-seniority"/>
            <InputField title="Phone number" value={form.phoneNumber} onChange={setString('phoneNumber')} testId="input-detail-phone"/>
            <InputField title="Mobile phone" value={form.mobilePhone} onChange={setString('mobilePhone')} testId="input-detail-mobile-phone"/>
            <InputField title="Location" value={form.location} onChange={setString('location')} testId="input-detail-location"/>
            <ContactFieldSelect field="preferredLanguage" title="Preferred language" value={form.preferredLanguage} options={fieldOptionsQuery.data?.options ?? []} onChange={setString('preferredLanguage')} testId="input-detail-language"/>
            <ContactFieldSelect field="timeZone" title="Time zone" value={form.timeZone} options={[]} onChange={setString('timeZone')} testId="input-detail-time-zone"/>
          </div>
        </Section>
        <Section title="Audience and qualification" eyebrow="SEGMENT / CONTEXT">
          <div className="grid gap-4 sm:grid-cols-2">
            <ContactFieldSelect field="lifecycleStage" title="Lifecycle stage" value={form.lifecycleStage} options={fieldOptionsQuery.data?.options ?? []} onChange={setString('lifecycleStage')} testId="input-detail-lifecycle"/>
            <ContactFieldSelect field="leadStatus" title="Lead status" value={form.leadStatus} options={fieldOptionsQuery.data?.options ?? []} onChange={setString('leadStatus')} testId="input-detail-lead-status"/>
            <ContactFieldSelect field="leadSource" title="Lead source" value={form.leadSource} options={fieldOptionsQuery.data?.options ?? []} onChange={setString('leadSource')} testId="input-detail-lead-source"/>
            <TextAreaField title="Interests" value={form.interests} onChange={setString('interests')} testId="input-detail-interests"/>
            <TextAreaField title="Goals" value={form.goals} onChange={setString('goals')} testId="input-detail-goals"/>
            <TextAreaField title="Pain points" value={form.painPoints} onChange={setString('painPoints')} testId="input-detail-pain-points"/>
            <div className="sm:col-span-2"><TextAreaField title="Personalization context" value={form.personalizationContext} onChange={setString('personalizationContext')} testId="input-detail-personalization"/></div>
            <div className="sm:col-span-2"><TextAreaField title="Notes" value={form.notes} onChange={setString('notes')} testId="input-detail-notes"/></div>
          </div>
        </Section>
      </div>
      <div className="space-y-5">
        <Section title="Company profile" eyebrow="ORGANIZATION / ACCOUNT">
          {contact.company ? <div data-testid="panel-linked-company" className="rounded-md border border-[#dce6ef] bg-[#f7fafc] p-4">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e8f0f8] text-[#245b9b]"><Building2 className="h-4 w-4"/></span><div className="min-w-0 flex-1"><div className="text-[13px] font-bold text-[#26384b]">{contact.company.companyName}</div><div className="mt-1 break-all text-[11px] text-[#718196]">{contact.company.companyDomain || 'Domain not provided'}{contact.company.companyIndustry ? ` · ${contact.company.companyIndustry}` : ''}</div></div></div>
            {contact.company.companyDescription && <p className="mt-3 whitespace-pre-wrap text-[11px] leading-5 text-[#647589]">{contact.company.companyDescription}</p>}
            <dl className="mt-3 grid gap-2 border-t border-[#e3eaf0] pt-3 text-[10px]">
              <div><dt className="mb-1 font-semibold uppercase tracking-wide text-[#8a96a4]">Website URL</dt><dd data-testid="text-linked-company-website" className="break-all font-mono text-[#3e6284]">{contact.company.companyWebsiteUrl || 'Not provided'}</dd></div>
              <div><dt className="mb-1 font-semibold uppercase tracking-wide text-[#8a96a4]">LinkedIn URL</dt><dd data-testid="text-linked-company-linkedin" className="break-all font-mono text-[#3e6284]">{contact.company.companyLinkedinUrl || 'Not provided'}</dd></div>
               <div className="grid grid-cols-2 gap-3">
                 <DataField label="Company size" value={contact.company.companySize} testId="text-linked-company-size"/>
                 <DataField label="Revenue range" value={contact.company.companyRevenueRange} testId="text-linked-company-revenue"/>
                 <DataField label="Phone" value={contact.company.companyPhoneNumber} testId="text-linked-company-phone"/>
                 <DataField label="Location" value={contact.company.companyLocation} testId="text-linked-company-location"/>
               </div>
            </dl>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-[10px] text-[#7c8998]">Shared across contacts in this workspace</span><button type="button" data-testid="button-unlink-company" disabled={update.isPending} onClick={() => changeCompany(null)} className="inline-flex items-center gap-1.5 rounded-md border border-[#d8e0e7] bg-white px-3 py-2 text-[10px] font-semibold text-[#52667b] hover:bg-[#f1f5f8] disabled:opacity-50"><Unlink2 className="h-3.5 w-3.5"/>{update.isPending ? 'Updating…' : 'Unlink company'}</button></div>
          </div> : <div className="mb-4 rounded-md border border-[#e6eaf0] bg-[#fbfcfd] p-3.5"><div className="flex items-start gap-2.5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#8a96a4]"/><div><div className="text-[11px] font-semibold text-[#536477]">{form.companyName ? `Legacy profile: ${form.companyName}` : 'No shared company linked'}</div><p className="mt-1 text-[10px] leading-4 text-[#8793a0]">{form.companyName ? 'This contact’s existing company profile stays visible and unchanged until you choose to link a shared record.' : 'Choose a shared company profile to associate this contact.'}</p></div></div>
             <div className="mt-3 flex flex-col gap-2 sm:flex-row"><select aria-label="Choose company" data-testid="select-contact-company" value={companyChoice} onChange={event => setCompanyChoice(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] text-[#344154] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"><option value="">Choose a company…</option>{(companiesQuery.data?.companies || []).map(company => <option key={company.id} value={company.id}>{company.companyName}{company.companyDomain ? ` · ${company.companyDomain}` : ''}</option>)}</select><button type="button" data-testid="button-link-company" disabled={!companyChoice || update.isPending || companiesQuery.isLoading} onClick={() => changeCompany(companyChoice)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-[#174f99] bg-[#174f99] px-3 text-[10px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-50"><Link2 className="h-3.5 w-3.5"/>Link company</button></div>
             {selectedCompany && <div className="mt-4 space-y-2" data-testid="panel-selected-company-comparison">
               <CompanyProfileComparison
                 legacyProfile={profileFromContact(contact)}
                 sharedProfile={profileFromCompany(selectedCompany)}
                 testIdPrefix="contact-company-comparison"
               />
               <p className="text-[10px] leading-4 text-[#7c8998]">This preview does not link or replace anything. Link company is a separate action, and conflicting details require another confirmation.</p>
             </div>}
            {companiesQuery.isError && <p role="alert" className="mt-2 text-[10px] text-[#a45b30]">Company options could not be loaded. Retry from the Companies page.</p>}
          </div>}
          {!contact.company && <div className="grid gap-4 sm:grid-cols-2">
            <InputField title="Company" value={form.companyName} onChange={setString('companyName')} testId="input-detail-company"/>
            <InputField title="Domain" value={form.companyDomain} onChange={setString('companyDomain')} testId="input-detail-company-domain"/>
            <InputField title="Industry" value={form.companyIndustry} onChange={setString('companyIndustry')} testId="input-detail-company-industry"/>
            <InputField title="Company size" value={form.companySize} onChange={setString('companySize')} testId="input-detail-company-size"/>
            <InputField title="Revenue range" value={form.companyRevenueRange} onChange={setString('companyRevenueRange')} testId="input-detail-company-revenue"/>
            <InputField title="Company phone" value={form.companyPhoneNumber} onChange={setString('companyPhoneNumber')} testId="input-detail-company-phone"/>
            <InputField title="Company location" value={form.companyLocation} onChange={setString('companyLocation')} testId="input-detail-company-location"/>
            <div className="sm:col-span-2"><TextAreaField title="Company description" value={form.companyDescription} onChange={setString('companyDescription')} testId="input-detail-company-description"/></div>
          </div>}
        </Section>
        <Section title="Online profiles" eyebrow="WEB / SOCIAL">
           <div className="grid gap-4">
            <OnlineProfileField title="LinkedIn URL" value={form.linkedinUrl} onChange={setString('linkedinUrl')} testId="input-detail-linkedin" editing={editingProfiles.has('linkedinUrl')} onToggleEdit={() => toggleProfileEdit('linkedinUrl')}/>
            <OnlineProfileField title="Personal website URL" value={form.websiteUrl} onChange={setString('websiteUrl')} testId="input-detail-website" editing={editingProfiles.has('websiteUrl')} onToggleEdit={() => toggleProfileEdit('websiteUrl')}/>
            <OnlineProfileField title="Twitter URL" value={form.twitterUrl} onChange={setString('twitterUrl')} testId="input-detail-twitter" editing={editingProfiles.has('twitterUrl')} onToggleEdit={() => toggleProfileEdit('twitterUrl')}/>
            <OnlineProfileField title="Facebook URL" value={form.facebookUrl} onChange={setString('facebookUrl')} testId="input-detail-facebook" editing={editingProfiles.has('facebookUrl')} onToggleEdit={() => toggleProfileEdit('facebookUrl')}/>
            <OnlineProfileField title="Instagram URL" value={form.instagramUrl} onChange={setString('instagramUrl')} testId="input-detail-instagram" editing={editingProfiles.has('instagramUrl')} onToggleEdit={() => toggleProfileEdit('instagramUrl')}/>
             {!contact.company && <>
               <OnlineProfileField title="Company website URL" value={form.companyWebsiteUrl} onChange={setString('companyWebsiteUrl')} testId="input-detail-company-website" editing={editingProfiles.has('companyWebsiteUrl')} onToggleEdit={() => toggleProfileEdit('companyWebsiteUrl')}/>
               <OnlineProfileField title="Company LinkedIn URL" value={form.companyLinkedinUrl} onChange={setString('companyLinkedinUrl')} testId="input-detail-company-linkedin" editing={editingProfiles.has('companyLinkedinUrl')} onToggleEdit={() => toggleProfileEdit('companyLinkedinUrl')}/>
             </>}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#8a95a2]">Select Edit to add or change a profile, then save your contact changes.</p>
        </Section>
        <Section title="Workspace controls" eyebrow="CONSENT / MEMBERSHIP">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#e7ebef] bg-[#fbfcfd] p-3">
            <input data-testid="checkbox-detail-subscribed" type="checkbox" checked={form.subscribed} onChange={event => change('subscribed', event.target.checked)} className="mt-0.5 accent-[#174f99]"/>
            <span><span className="block text-[12px] font-semibold text-[#344154]">Subscribed to email</span><span className="mt-1 block text-[10px] leading-4 text-[#7c8794]">Only subscribed contacts are eligible for campaign sends.</span></span>
          </label>
          <div className="mt-4"><div className={label}>List memberships</div>{contact.listIds.length ? listsQuery.isLoading ? <p className="text-[11px] text-[#929ba6]">Loading list names…</p> : listsQuery.isError ? <p className="text-[11px] text-[#929ba6]">List names could not be loaded.</p> : <div className="flex flex-wrap gap-2">{contact.listIds.map(id => <span key={id} className="rounded bg-[#f1f4f7] px-2.5 py-1.5 text-[11px] text-[#5f6e7f]">{listsQuery.data?.find(list => list.id === id)?.name ?? 'List'}</span>)}</div> : <p className="text-[11px] text-[#929ba6]">No list memberships</p>}</div>
        </Section>
        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dce3e9] bg-white/95 p-3 shadow-sm backdrop-blur">
          <span className="flex items-center gap-2 text-[10px] text-[#788392]"><ShieldCheck className="h-4 w-4 text-[#598166]"/>Scoped to this workspace</span>
          <button type="submit" data-testid="button-save-contact-detail" disabled={update.isPending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[12px] font-semibold text-white transition hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55">{update.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{update.isPending ? 'Saving contact' : 'Save changes'}</button>
        </div>
      </div>
    </form>
    <div className="mt-5">
      <ContactEmailHistorySection contactId={contact.id} email={contact.email}/>
    </div>
  </div>;
}
