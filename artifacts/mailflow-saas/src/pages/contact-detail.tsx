import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { AlertCircle, ArrowLeft, CheckCircle2, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import { getGetContactQueryKey, getListContactsQueryKey, useGetContact, useListContactLists, useUpdateContact } from '@workspace/api-client-react';
import type { Contact, ContactUpdate } from '@workspace/api-client-react';

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

function DataField({ label: title, value, testId }: { label: string; value: string | null | undefined; testId: string }) {
  return <div className="min-w-0 border-b border-[#edf0f2] py-3 last:border-0">
    <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[.11em] text-[#8993a0]">{title}</dt>
    <dd data-testid={testId} className="break-words text-[12px] leading-5 text-[#344154]">{value || <span className="text-[#a0a8b3]">Not provided</span>}</dd>
  </div>;
}
function InputField({ title, value, onChange, testId, type = 'text' }: { title: string; value: string; onChange: (value: string) => void; testId: string; type?: string }) {
  return <label className="block min-w-0"><span className={label}>{title}</span><input className={input} type={type} data-testid={testId} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function TextAreaField({ title, value, onChange, testId, preview = false }: { title: string; value: string; onChange: (value: string) => void; testId: string; preview?: boolean }) {
  return <label className="block min-w-0"><span className={label}>{title}</span>
    {preview && <span data-testid={`${testId}-full-value`} className="mb-2 block min-h-8 break-all rounded-md border border-[#e8edf1] bg-[#f8fafb] px-3 py-2 font-mono text-[11px] leading-5 text-[#3e536b]">{value || <span className="font-sans text-[#a0a8b3]">Not provided</span>}</span>}
    <textarea className="min-h-[84px] w-full resize-y rounded-md border border-[#d8dde4] bg-white px-3 py-2 font-mono text-[12px] leading-5 text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:font-sans placeholder:text-[#a0a8b3]" data-testid={testId} value={value} onChange={event => onChange(event.target.value)} wrap="soft" />
  </label>;
}
function Section({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <section className={`${panel} overflow-hidden`}>
    <header className="border-b border-[#e9edf0] bg-[#fbfcfd] px-5 py-4">
      <div className="font-mono text-[9px] uppercase tracking-[.16em] text-[#818c99]">{eyebrow}</div>
      <h2 className="mt-1 text-[15px] font-bold tracking-[-.02em] text-[#1c2b3d]">{title}</h2>
    </header>
    <div className="p-5">{children}</div>
  </section>;
}

export function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const contactId = params.contactId || '';
  const query = useGetContact(contactId, {
    query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId), staleTime: 0, refetchOnMount: 'always' },
  });
  const listsQuery = useListContactLists();
  const update = useUpdateContact();
  const qc = useQueryClient();
  const [form, setForm] = useState<Editable | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const contact = query.data as Contact | undefined;

  // Reinitialize when a contact is first loaded or the server returns a newer revision.
  useEffect(() => {
    if (contact) setForm(fromContact(contact));
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
        setNotice({ kind: 'success', text: 'Contact changes saved.' });
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
  const setString = (key: Exclude<keyof Editable, 'subscribed'>) => (value: string) => change(key, value);

  return <div className="fade-in">
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
            <InputField title="Job title" value={form.jobTitle} onChange={setString('jobTitle')} testId="input-detail-job-title"/>
            <InputField title="Department" value={form.department} onChange={setString('department')} testId="input-detail-department"/>
            <InputField title="Seniority" value={form.seniority} onChange={setString('seniority')} testId="input-detail-seniority"/>
            <InputField title="Phone number" value={form.phoneNumber} onChange={setString('phoneNumber')} testId="input-detail-phone"/>
            <InputField title="Mobile phone" value={form.mobilePhone} onChange={setString('mobilePhone')} testId="input-detail-mobile-phone"/>
            <InputField title="Location" value={form.location} onChange={setString('location')} testId="input-detail-location"/>
            <InputField title="Preferred language" value={form.preferredLanguage} onChange={setString('preferredLanguage')} testId="input-detail-language"/>
            <InputField title="Time zone" value={form.timeZone} onChange={setString('timeZone')} testId="input-detail-time-zone"/>
          </div>
        </Section>
        <Section title="Audience and qualification" eyebrow="SEGMENT / CONTEXT">
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField title="Lifecycle stage" value={form.lifecycleStage} onChange={setString('lifecycleStage')} testId="input-detail-lifecycle"/>
            <InputField title="Lead status" value={form.leadStatus} onChange={setString('leadStatus')} testId="input-detail-lead-status"/>
            <InputField title="Lead source" value={form.leadSource} onChange={setString('leadSource')} testId="input-detail-lead-source"/>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField title="Company" value={form.companyName} onChange={setString('companyName')} testId="input-detail-company"/>
            <InputField title="Domain" value={form.companyDomain} onChange={setString('companyDomain')} testId="input-detail-company-domain"/>
            <InputField title="Industry" value={form.companyIndustry} onChange={setString('companyIndustry')} testId="input-detail-company-industry"/>
            <InputField title="Company size" value={form.companySize} onChange={setString('companySize')} testId="input-detail-company-size"/>
            <InputField title="Revenue range" value={form.companyRevenueRange} onChange={setString('companyRevenueRange')} testId="input-detail-company-revenue"/>
            <InputField title="Company phone" value={form.companyPhoneNumber} onChange={setString('companyPhoneNumber')} testId="input-detail-company-phone"/>
            <InputField title="Company location" value={form.companyLocation} onChange={setString('companyLocation')} testId="input-detail-company-location"/>
            <div className="sm:col-span-2"><TextAreaField title="Company description" value={form.companyDescription} onChange={setString('companyDescription')} testId="input-detail-company-description"/></div>
          </div>
        </Section>
        <Section title="Online profiles" eyebrow="WEB / SOCIAL">
          <div className="grid gap-4">
            <TextAreaField title="LinkedIn URL" value={form.linkedinUrl} onChange={setString('linkedinUrl')} testId="input-detail-linkedin" preview/>
            <TextAreaField title="Personal website URL" value={form.websiteUrl} onChange={setString('websiteUrl')} testId="input-detail-website" preview/>
            <TextAreaField title="Twitter URL" value={form.twitterUrl} onChange={setString('twitterUrl')} testId="input-detail-twitter" preview/>
            <TextAreaField title="Facebook URL" value={form.facebookUrl} onChange={setString('facebookUrl')} testId="input-detail-facebook" preview/>
            <TextAreaField title="Instagram URL" value={form.instagramUrl} onChange={setString('instagramUrl')} testId="input-detail-instagram" preview/>
            <TextAreaField title="Company website URL" value={form.companyWebsiteUrl} onChange={setString('companyWebsiteUrl')} testId="input-detail-company-website" preview/>
            <TextAreaField title="Company LinkedIn URL" value={form.companyLinkedinUrl} onChange={setString('companyLinkedinUrl')} testId="input-detail-company-linkedin" preview/>
          </div>
          <p className="mt-3 break-words text-[10px] leading-4 text-[#8a95a2]">Each full saved address is shown above its editable field. Values remain plain text and wrap across lines.</p>
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
  </div>;
}