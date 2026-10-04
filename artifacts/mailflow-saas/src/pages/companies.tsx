import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowUpRight, Building2, Check, CircleAlert, Globe2, MapPin, Pencil, Plus,
  RefreshCw, Search, Trash2, Users, X,
} from 'lucide-react';
import {
  getGetCompanyQueryKey, getGetContactQueryKey, getListCompaniesQueryKey, getListContactsQueryKey,
  useBackfillCompanyProfiles, useCreateCompany, useDeleteCompany, useGetCompany,
  useListCompanies, useUpdateCompany,
} from '@workspace/api-client-react';
import type { Company, CompanyInput, CompanyUpdate } from '@workspace/api-client-react';

const card = 'rounded-lg border border-[#e0e4e9] bg-white';
const input = 'h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]';
const labelClass = 'mb-1.5 block text-[11px] font-semibold text-[#465568]';
const fields = [
  ['companyWebsiteUrl', 'Website URL', 'url'], ['companyDomain', 'Domain', 'text'],
  ['companyIndustry', 'Industry', 'text'], ['companySize', 'Company size', 'text'],
  ['companyRevenueRange', 'Revenue range', 'text'], ['companyPhoneNumber', 'Phone number', 'tel'],
  ['companyLocation', 'Location', 'text'], ['companyLinkedinUrl', 'LinkedIn URL', 'url'],
] as const;
type FieldKey = typeof fields[number][0];
type CompanyForm = Record<FieldKey, string> & { companyName: string; companyDescription: string };
const blankForm = (): CompanyForm => ({
  companyName: '', companyWebsiteUrl: '', companyDomain: '', companyIndustry: '',
  companySize: '', companyRevenueRange: '', companyPhoneNumber: '', companyLocation: '',
  companyLinkedinUrl: '', companyDescription: '',
});
const formFrom = (company?: Company): CompanyForm => company ? ({
  companyName: company.companyName,
  companyWebsiteUrl: company.companyWebsiteUrl || '',
  companyDomain: company.companyDomain || '',
  companyIndustry: company.companyIndustry || '',
  companySize: company.companySize || '',
  companyRevenueRange: company.companyRevenueRange || '',
  companyPhoneNumber: company.companyPhoneNumber || '',
  companyLocation: company.companyLocation || '',
  companyLinkedinUrl: company.companyLinkedinUrl || '',
  companyDescription: company.companyDescription || '',
}) : blankForm();
const errorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
};
const prettyDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function TextInput({ title, value, onChange, testId, type = 'text', required = false }: {
  title: string; value: string; onChange: (value: string) => void; testId: string; type?: string; required?: boolean;
}) {
  return <label className="block min-w-0"><span className={labelClass}>{title}</span><input className={input} type={type} required={required} data-testid={testId} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

function CompanyMetadata({ company }: { company: Pick<Company, 'companySize' | 'companyRevenueRange' | 'companyPhoneNumber'> }) {
  const rows = [
    ['COMPANY SIZE', company.companySize],
    ['REVENUE RANGE', company.companyRevenueRange],
    ['PHONE', company.companyPhoneNumber],
  ];
  return <div className="grid grid-cols-2 gap-x-4 border-b border-[#e8edf1] pb-3">
    {rows.map(([title, value]) => <div key={title} className="py-2"><div className="mono text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">{title}</div><div className="mt-1 break-words text-[11px] text-[#3b4d61]">{value || 'Not provided'}</div></div>)}
  </div>;
}

function CompanyEditor({ company, onClose, onSaved }: { company?: Company; onClose: () => void; onSaved: () => void }) {
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => formFrom(company));
  const pending = create.isPending || update.isPending;
  const change = (key: keyof CompanyForm, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (company) {
      const data: CompanyUpdate = {
        companyName: form.companyName,
        ...Object.fromEntries(fields.map(([key]) => [key, form[key] || null])),
        companyDescription: form.companyDescription || null,
      } as CompanyUpdate;
      update.mutate({ companyId: company.id, data }, {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(company.id) });
          onSaved();
        },
      });
    } else {
      const data: CompanyInput = {
        companyName: form.companyName,
        ...Object.fromEntries(fields.map(([key]) => [key, form[key] || undefined])),
        companyDescription: form.companyDescription || undefined,
      } as CompanyInput;
      create.mutate({ data }, {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
          onSaved();
        },
      });
    }
  };
  const error = create.isError ? create.error : update.isError ? update.error : null;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#172334]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="company-editor-title" className="fade-in max-h-[94dvh] w-full max-w-[700px] overflow-y-auto rounded-t-xl border border-[#dce3e9] bg-[#fbfcfd] shadow-xl sm:rounded-xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[#e5e9ed] bg-[#fbfcfd]/95 px-5 py-4 backdrop-blur sm:px-7">
        <div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#8090a0]">SHARED COMPANY PROFILE</div><h2 id="company-editor-title" className="display mt-1 text-[22px] font-bold text-[#172334]">{company ? 'Edit company' : 'Add a company'}</h2><p className="mt-1 text-[12px] text-[#728092]">One workspace record, available to every linked contact.</p></div>
        <button type="button" aria-label="Close company form" data-testid="button-close-company-form" onClick={onClose} className="rounded-md p-2 text-[#758292] hover:bg-[#eef2f5]"><X className="h-4 w-4"/></button>
      </header>
      <form onSubmit={submit} className="space-y-5 p-5 sm:p-7">
        <TextInput title="Company name" value={form.companyName} onChange={value => change('companyName', value)} testId="input-company-name" required/>
        <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, title, type]) => <TextInput key={key} title={title} type={type} value={form[key]} onChange={value => change(key, value)} testId={`input-${key}`}/>)}</div>
        <label className="block"><span className={labelClass}>Description</span><textarea className="min-h-[100px] w-full rounded-md border border-[#d8dde4] bg-white px-3 py-2 text-[13px] leading-5 text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]" data-testid="input-company-description" value={form.companyDescription} onChange={event => change('companyDescription', event.target.value)}/></label>
        {error && <div role="alert" data-testid="status-company-form-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] text-[#99501e]">{errorMessage(error)}</div>}
        <div className="flex flex-col-reverse gap-2 border-t border-[#e7ebef] pt-4 sm:flex-row sm:justify-end">
          <button type="button" data-testid="button-cancel-company" onClick={onClose} className="min-h-10 rounded-md border border-[#d7dce3] bg-white px-4 text-[12px] font-semibold text-[#4c5b6d] hover:bg-[#f7f9fb]">Cancel</button>
          <button type="submit" data-testid="button-save-company" disabled={pending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e] disabled:opacity-60">{pending ? 'Saving…' : <><Check className="h-4 w-4"/>{company ? 'Save company' : 'Create company'}</>}</button>
        </div>
      </form>
    </section>
  </div>;
}

export function CompaniesPage() {
  const qc = useQueryClient();
  const listQuery = useListCompanies();
  const backfill = useBackfillCompanyProfiles();
  const deleteCompany = useDeleteCompany();
  const started = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<'new' | Company | null>(null);
  const [search, setSearch] = useState('');
  const [backfillResult, setBackfillResult] = useState<{ linkedContacts: number; createdCompanies: number; skippedContacts: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const companies = listQuery.data?.companies ?? [];
  const filtered = useMemo(() => companies.filter(company => `${company.companyName} ${company.companyDomain || ''} ${company.companyIndustry || ''}`.toLowerCase().includes(search.toLowerCase())), [companies, search]);
  const selected = companies.find(company => company.id === selectedId) || companies[0];
  const detailQuery = useGetCompany(selected?.id || '', { query: { enabled: !!selected?.id, queryKey: getGetCompanyQueryKey(selected?.id || '') } });
  const linkedCount = detailQuery.data?.contacts.length ?? selected?.contactCount ?? 0;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    backfill.mutate(undefined, {
      onSuccess: result => {
        setBackfillResult(result);
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
      },
      onError: error => setNotice({ tone: 'error', text: `Legacy profile backfill could not run: ${errorMessage(error)}` }),
    });
  }, [backfill.mutate, qc]);
  const handleDelete = () => {
    if (!selected || linkedCount > 0) return;
    if (!window.confirm(`Delete ${selected.companyName}? This cannot be undone.`)) return;
    deleteCompany.mutate({ companyId: selected.id }, {
      onSuccess: () => {
        setNotice({ tone: 'success', text: `${selected.companyName} was deleted.` });
        setSelectedId('');
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      },
      onError: error => setNotice({ tone: 'error', text: errorMessage(error) }),
    });
  };
  const backfillRunning = backfill.isPending;
  if (listQuery.isLoading && !backfillRunning) return <div aria-label="Loading companies" className="space-y-5"><div className="h-8 w-56 animate-pulse rounded bg-[#edf0f3]"/><div className="h-24 rounded-lg bg-[#f1f3f5]"/><div className="h-[420px] rounded-lg bg-[#f1f3f5]"/></div>;
  if (listQuery.isError && !listQuery.data) return <section className={`${card} flex flex-col items-start gap-3 p-6`} role="alert"><div className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4 text-[#c16d31]"/>Companies could not be loaded</div><p className="text-xs text-[#778291]">Your shared records are unchanged.</p><button type="button" data-testid="button-retry-companies" onClick={() => void listQuery.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button></section>;
  return <div className="fade-in">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">CUSTOMER CONTEXT / DIRECTORY</div><h1 className="display text-[30px] font-bold leading-tight text-[#172334]">Companies</h1><p className="mt-2 max-w-2xl text-[13px] text-[#687484]">Shared profiles for the organizations behind your contacts.</p></div><button type="button" data-testid="button-add-company" onClick={() => setEditor('new')} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e]"><Plus className="h-4 w-4"/>Add company</button></div>
    {backfillResult && <div role="status" data-testid="status-company-backfill" className="mb-5 flex flex-col gap-3 rounded-lg border border-[#d8e5df] bg-[#f4f9f6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#43825e]"/><div><div className="text-[12px] font-semibold text-[#2c6547]">Legacy company profiles checked</div><p className="mt-1 text-[11px] leading-5 text-[#617c6d]">{backfillResult.linkedContacts} contacts linked · {backfillResult.createdCompanies} shared {backfillResult.createdCompanies === 1 ? 'company created' : 'companies created'} · {backfillResult.skippedContacts} contacts stayed unlinked</p></div></div><span className="text-[10px] text-[#789080]">Only safe matches are linked.</span></div>}
    {backfillRunning && <div className="mb-5 flex items-center gap-2 rounded-lg border border-[#dce5ec] bg-[#f7fafc] px-4 py-3 text-[11px] text-[#64768b]"><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Checking legacy company profiles…</div>}
    {notice && <div role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="status-company-notice" className={`mb-5 rounded-md border px-4 py-3 text-[12px] ${notice.tone === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{notice.text}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className={`${card} flex items-center gap-3 p-4`}><span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fc] text-[#245b9b]"><Building2 className="h-4 w-4"/></span><div><div className="mono text-[9px] uppercase tracking-[.12em] text-[#8390a0]">SHARED PROFILES</div><div className="mt-1 text-[20px] font-bold leading-none text-[#1c2b3d]">{companies.length}</div></div></div>
      <div className={`${card} flex items-center gap-3 p-4`}><span className="grid h-9 w-9 place-items-center rounded-md bg-[#eff6f3] text-[#478064]"><Users className="h-4 w-4"/></span><div><div className="mono text-[9px] uppercase tracking-[.12em] text-[#8390a0]">LINKED CONTACTS</div><div className="mt-1 text-[20px] font-bold leading-none text-[#1c2b3d]">{companies.reduce((sum, item) => sum + item.contactCount, 0)}</div></div></div>
      <div className={`${card} flex items-center gap-3 p-4`}><span className="grid h-9 w-9 place-items-center rounded-md bg-[#fff3e8] text-[#b86a30]"><RefreshCw className="h-4 w-4"/></span><div><div className="mono text-[9px] uppercase tracking-[.12em] text-[#8390a0]">PROFILE SYNC</div><div className="mt-1 text-[12px] font-semibold text-[#38495c]">{backfillResult ? 'Checked on this visit' : backfillRunning ? 'In progress' : 'Preparing check'}</div></div></div>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.76fr)]">
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><h2 className="text-[14px] font-bold text-[#223247]">Company directory</h2><p className="mt-1 text-[11px] text-[#84909e]">{filtered.length} {filtered.length === 1 ? 'record' : 'records'} in this workspace</p></div><label className="relative block w-full sm:max-w-[240px]"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b96a3]"/><input aria-label="Search companies" data-testid="input-search-companies" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, domain…" className="h-9 w-full rounded-md border border-[#dce2e8] bg-[#fbfcfd] pl-9 pr-3 text-[11px] outline-none focus:border-[#3b73b8]"/></label></div>
        {filtered.length ? <div className="divide-y divide-[#edf0f2]">{filtered.map(company => <button type="button" key={company.id} data-testid={`row-company-${company.id}`} onClick={() => setSelectedId(company.id)} className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[#f7f9fb] sm:px-5 ${selected?.id === company.id ? 'bg-[#f3f7fb]' : 'bg-white'}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#dbe5ef] bg-[#eef4fa] text-[#245b9b]"><Building2 className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[#26364a]">{company.companyName}</span><span className="mt-1 block truncate text-[11px] text-[#7c8998]">{company.companyDomain || company.companyIndustry || 'Company profile'}</span></span><span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#f0f4f7] px-2.5 py-1 text-[10px] font-semibold text-[#607184]"><Users className="h-3 w-3"/>{company.contactCount}</span><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#a2acb7]"/></button>)}</div> : <div className="px-5 py-14 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#eef4fa] text-[#51789f]"><Building2 className="h-5 w-5"/></span><h3 className="mt-4 text-[13px] font-semibold text-[#344154]">{search ? 'No matching companies' : 'No shared companies yet'}</h3><p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-[#818d9b]">{search ? 'Try another company name, domain, or industry.' : 'Add a company profile or let the legacy profile check link safe matches.'}</p>{!search && <button type="button" data-testid="button-empty-add-company" onClick={() => setEditor('new')} className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-[#245b9b]"><Plus className="h-3.5 w-3.5"/>Add first company</button>}</div>}
      </section>
      <section className={`${card} min-h-[310px] overflow-hidden`}>
        {!selected ? <div className="grid min-h-[310px] place-items-center p-6 text-center"><div><Building2 className="mx-auto h-7 w-7 text-[#9aabbc]"/><p className="mt-3 text-[12px] text-[#7e8b99]">Select a company to view its profile.</p></div></div> : detailQuery.isLoading ? <div aria-label="Loading company detail" className="space-y-4 p-5"><div className="h-7 w-44 animate-pulse rounded bg-[#edf0f3]"/><div className="h-24 rounded bg-[#f1f3f5]"/><div className="h-24 rounded bg-[#f1f3f5]"/></div> : detailQuery.isError ? <div className="p-5"><p className="text-[12px] font-semibold text-[#344154]">Company details could not be loaded.</p><button type="button" data-testid="button-retry-company-detail" onClick={() => void detailQuery.refetch()} className="mt-3 text-[11px] font-semibold text-[#245b9b]">Try again</button></div> : <><div className="border-b border-[#e8edf1] bg-[#fbfcfd] p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#eaf2fa] text-[#245b9b]"><Building2 className="h-4 w-4"/></span><div className="min-w-0 flex-1"><div className="mono text-[9px] uppercase tracking-[.14em] text-[#8a96a4]">COMPANY PROFILE</div><h2 className="mt-1 break-words text-[17px] font-bold leading-tight text-[#1e2e42]">{detailQuery.data?.company.companyName || selected.companyName}</h2><p className="mt-1 text-[11px] text-[#788696]">{detailQuery.data?.company.companyIndustry || 'Industry not provided'}</p></div><button type="button" aria-label="Edit company" data-testid="button-edit-company" onClick={() => setEditor(detailQuery.data?.company || selected)} className="rounded-md border border-[#dce2e8] bg-white p-2 text-[#627488] hover:bg-[#f4f7fa]"><Pencil className="h-3.5 w-3.5"/></button></div></div>
          <div className="space-y-4 p-5"><div className="grid grid-cols-2 gap-x-4"><div className="border-b border-[#edf0f2] py-2.5"><div className="mono text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">DOMAIN</div><div className="mt-1 break-all text-[11px] text-[#3b4d61]">{detailQuery.data?.company.companyDomain || 'Not provided'}</div></div><div className="border-b border-[#edf0f2] py-2.5"><div className="mono text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">LOCATION</div><div className="mt-1 flex items-center gap-1 break-words text-[11px] text-[#3b4d61]">{detailQuery.data?.company.companyLocation ? <><MapPin className="h-3 w-3 shrink-0 text-[#8a96a4]"/>{detailQuery.data.company.companyLocation}</> : 'Not provided'}</div></div></div>
            <div><div className="mono mb-1.5 text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">WEBSITE</div>{detailQuery.data?.company.companyWebsiteUrl ? <div className="break-all font-mono text-[10px] leading-5 text-[#3f6284]" data-testid="text-company-website">{detailQuery.data.company.companyWebsiteUrl}</div> : <p className="text-[11px] text-[#9aa4af]">Not provided</p>}</div>
            <div><div className="mono mb-1.5 text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">LINKEDIN</div>{detailQuery.data?.company.companyLinkedinUrl ? <div className="break-all font-mono text-[10px] leading-5 text-[#3f6284]" data-testid="text-company-linkedin">{detailQuery.data.company.companyLinkedinUrl}</div> : <p className="text-[11px] text-[#9aa4af]">Not provided</p>}</div>
             <div><div className="mono mb-1.5 text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">DESCRIPTION</div><p className="whitespace-pre-wrap text-[11px] leading-5 text-[#637285]">{detailQuery.data?.company.companyDescription || 'No description provided.'}</p></div>
             <CompanyMetadata company={detailQuery.data?.company || selected}/>
            <div className="border-t border-[#e8edf1] pt-4"><div className="mb-3 flex items-center justify-between"><div><div className="mono text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">LINKED CONTACTS</div><p className="mt-1 text-[11px] text-[#8290a0]">{detailQuery.data?.contacts.length ?? selected.contactCount} associated</p></div><Users className="h-4 w-4 text-[#8a96a4]"/></div>{detailQuery.data?.contacts.length ? <div className="space-y-2">{detailQuery.data.contacts.map(contact => <Link key={contact.id} href={`/contacts/${contact.id}`} data-testid={`link-company-contact-${contact.id}`} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 no-underline hover:bg-[#f5f8fa]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#edf2f7] text-[9px] font-bold text-[#526a82]">{(contact.name[0] || '?').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-[#36495d]">{contact.name}</span><span className="block truncate text-[10px] text-[#8793a0]">{contact.email}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</span></span></Link>)}</div> : <p className="text-[11px] text-[#8995a2]">No contacts linked. This company can be safely deleted.</p>}</div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8edf1] pt-3"><span className="flex items-center gap-1.5 text-[10px] text-[#8994a1]"><Globe2 className="h-3 w-3"/>Updated {prettyDate(detailQuery.data?.company.updatedAt || selected.updatedAt)}</span><button type="button" data-testid="button-delete-company" disabled={linkedCount > 0 || deleteCompany.isPending || detailQuery.isLoading} onClick={handleDelete} title={linkedCount > 0 ? 'Unlink all contacts before deleting this company.' : 'Delete company'} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[10px] font-semibold text-[#a35c31] hover:bg-[#fff5ec] disabled:cursor-not-allowed disabled:text-[#b8b0aa]"><Trash2 className="h-3.5 w-3.5"/>{deleteCompany.isPending ? 'Deleting…' : linkedCount > 0 ? 'Linked · cannot delete' : 'Delete company'}</button></div>
          </div></>}
      </section>
    </div>
    {editor && <CompanyEditor company={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice({ tone: 'success', text: 'Company profile saved.' }); void listQuery.refetch(); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); detailQuery.data?.contacts.forEach(contact => void qc.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) })); }}/>}
  </div>;
}