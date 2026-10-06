import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowUpRight, Building2, Check, CircleAlert, Download, Plus, RefreshCw, Search, Users, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  exportCompanies,
  getGetCompanyQueryKey, getListCompaniesQueryKey, getListContactsQueryKey, getListUnlinkedCompanyProfilesQueryKey,
  useBackfillCompanyProfiles, useCreateCompany,
  useListCompanies, useListUnlinkedCompanyProfiles, useUpdateCompany,
} from '@workspace/api-client-react';
import type { Company, CompanyExportInput, CompanyInput, CompanyUpdate, UnlinkedCompanyProfile } from '@workspace/api-client-react';
import { DownloadListDialog, type DownloadListColumn, type DownloadScope } from '@/components/download-list-dialog';
import { downloadWorkbook } from '@/lib/download-workbook';

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
type CompanyDirectoryFilters = { industry: string; size: string; revenueRange: string; location: string };
const emptyCompanyDirectoryFilters = (): CompanyDirectoryFilters => ({ industry: '', size: '', revenueRange: '', location: '' });
const companyDownloadColumns: DownloadListColumn<CompanyExportInput['columns'][number]>[] = [
  { key: 'companyName', label: 'Company name', group: 'standard' },
  { key: 'companyDomain', label: 'Domain', group: 'standard' },
  { key: 'companyLocation', label: 'Location', group: 'standard' },
  { key: 'contactCount', label: 'Contacts', group: 'standard' },
  { key: 'id', label: 'Company ID', group: 'additional' },
  { key: 'companyWebsiteUrl', label: 'Website', group: 'additional' },
  { key: 'companyIndustry', label: 'Industry', group: 'additional' },
  { key: 'companySize', label: 'Company size', group: 'additional' },
  { key: 'companyRevenueRange', label: 'Revenue range', group: 'additional' },
  { key: 'companyDescription', label: 'Description', group: 'additional' },
  { key: 'companyPhoneNumber', label: 'Phone', group: 'additional' },
  { key: 'companyLinkedinUrl', label: 'LinkedIn', group: 'additional' },
  { key: 'createdAt', label: 'Date added', group: 'additional' },
  { key: 'updatedAt', label: 'Last updated', group: 'additional' },
];
const uniqueCompanyFilterOptions = (values: Array<string | null | undefined>) =>
  [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
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
function TextInput({ title, value, onChange, testId, type = 'text', required = false }: {
  title: string; value: string; onChange: (value: string) => void; testId: string; type?: string; required?: boolean;
}) {
  return <label className="block min-w-0"><span className={labelClass}>{title}</span><input className={input} type={type} required={required} data-testid={testId} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

export function CompanyEditor({ company, onClose, onSaved }: { company?: Company; onClose: () => void; onSaved: () => void }) {
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
  const unlinkedProfilesQuery = useListUnlinkedCompanyProfiles();
  const backfill = useBackfillCompanyProfiles();
  const started = useRef(false);
  const [editor, setEditor] = useState<'new' | Company | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [companyFilters, setCompanyFilters] = useState<CompanyDirectoryFilters>(emptyCompanyDirectoryFilters);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ linkedContacts: number; createdCompanies: number; skippedContacts: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const companies = listQuery.data?.companies ?? [];
  const companyFilterOptions = useMemo(() => ({
    industries: uniqueCompanyFilterOptions(companies.map(company => company.companyIndustry)),
    sizes: uniqueCompanyFilterOptions(companies.map(company => company.companySize)),
    revenueRanges: uniqueCompanyFilterOptions(companies.map(company => company.companyRevenueRange)),
  }), [companies]);
  const hasActiveCompanyFilters = Object.values(companyFilters).some(value => value.trim().length > 0);
  const hasCompanySearchOrFilters = Boolean(search.trim() || hasActiveCompanyFilters);
  const companyFilterSummary = [
    search.trim() ? `Search: ${search.trim()}` : null,
    companyFilters.industry ? `Industry: ${companyFilters.industry}` : null,
    companyFilters.size ? `Size: ${companyFilters.size}` : null,
    companyFilters.revenueRange ? `Revenue: ${companyFilters.revenueRange}` : null,
    companyFilters.location.trim() ? `Location: ${companyFilters.location.trim()}` : null,
  ].filter((value): value is string => Boolean(value)).join(' · ');
  const downloadCompanies = async (scope: DownloadScope, columns: CompanyExportInput['columns']) => {
    const workbook = await exportCompanies({
      scope,
      columns,
      ...(scope === 'filtered' ? {
        filters: {
          search,
          industry: companyFilters.industry,
          size: companyFilters.size,
          revenueRange: companyFilters.revenueRange,
          location: companyFilters.location,
        },
      } : {}),
    });
    downloadWorkbook(workbook, 'companies');
  };
  const updateCompanyFilter = (key: keyof CompanyDirectoryFilters, value: string) => {
    setCompanyFilters(current => ({ ...current, [key]: value }));
    setPage(1);
  };
  const clearCompanyFilters = () => {
    setCompanyFilters(emptyCompanyDirectoryFilters());
    setPage(1);
  };
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const locationQuery = companyFilters.location.trim().toLowerCase();
    return companies.filter(company => {
      const searchableText = [
        company.companyName,
        company.companyDomain,
        company.companyWebsiteUrl,
        company.companyIndustry,
        company.companySize,
        company.companyRevenueRange,
        company.companyLocation,
        company.companyDescription,
      ].filter(Boolean).join(' ').toLowerCase();
      return (!query || searchableText.includes(query))
        && (!companyFilters.industry || company.companyIndustry === companyFilters.industry)
        && (!companyFilters.size || company.companySize === companyFilters.size)
        && (!companyFilters.revenueRange || company.companyRevenueRange === companyFilters.revenueRange)
        && (!locationQuery || company.companyLocation?.toLowerCase().includes(locationQuery));
    });
  }, [companies, companyFilters, search]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    backfill.mutate(undefined, {
      onSuccess: result => {
        setBackfillResult(result);
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
         void qc.invalidateQueries({ queryKey: getListUnlinkedCompanyProfilesQueryKey() });
      },
      onError: error => setNotice({ tone: 'error', text: `Legacy profile backfill could not run: ${errorMessage(error)}` }),
    });
  }, [backfill.mutate, qc]);
  const backfillRunning = backfill.isPending;
  if (listQuery.isLoading && !backfillRunning) return <div aria-label="Loading companies" className="space-y-5"><div className="h-8 w-56 animate-pulse rounded bg-[#edf0f3]"/><div className="h-24 rounded-lg bg-[#f1f3f5]"/><div className="h-[420px] rounded-lg bg-[#f1f3f5]"/></div>;
  if (listQuery.isError && !listQuery.data) return <section className={`${card} flex flex-col items-start gap-3 p-6`} role="alert"><div className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4 text-[#c16d31]"/>Companies could not be loaded</div><p className="text-xs text-[#778291]">Your shared records are unchanged.</p><button type="button" data-testid="button-retry-companies" onClick={() => void listQuery.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button></section>;
  return <div className="fade-in">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">CUSTOMER CONTEXT / DIRECTORY</div><h1 className="display text-[30px] font-bold leading-tight text-[#172334]">Companies</h1><p className="mt-2 max-w-2xl text-[13px] text-[#687484]">Shared profiles for the organizations behind your contacts.</p></div><div className="flex flex-wrap gap-2"><button type="button" data-testid="button-download-companies" disabled={listQuery.isFetching || backfillRunning} onClick={() => setDownloadOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d7dce3] bg-white px-3.5 text-[12px] font-semibold text-[#283545] hover:bg-[#f7f9fb] disabled:opacity-55"><Download className="h-4 w-4"/>Download list</button><button type="button" data-testid="button-add-company" onClick={() => setEditor('new')} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e]"><Plus className="h-4 w-4"/>Add company</button></div></div>
      {downloadOpen && <DownloadListDialog
        title="Download companies"
        description="Choose the rows and company fields to include in your Excel workbook."
        entityLabel="companies"
        currentCount={filtered.length}
        allCount={companies.length}
        hasActiveFilters={hasCompanySearchOrFilters}
        filterSummary={companyFilterSummary}
        defaultScope={hasCompanySearchOrFilters ? 'filtered' : 'all'}
        columns={companyDownloadColumns}
        defaultColumns={['companyName', 'companyDomain', 'companyLocation', 'contactCount']}
        onDownload={downloadCompanies}
        onClose={() => setDownloadOpen(false)}
      />}
     {backfillResult && <div role="status" data-testid="status-company-backfill" className="mb-5 flex flex-col gap-3 rounded-lg border border-[#d8e5df] bg-[#f4f9f6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#43825e]"/><div><div className="text-[12px] font-semibold text-[#2c6547]">Legacy company profiles checked</div><p className="mt-1 text-[11px] leading-5 text-[#617c6d]">{backfillResult.linkedContacts} contacts linked · {backfillResult.createdCompanies} shared {backfillResult.createdCompanies === 1 ? 'company created' : 'companies created'} · {backfillResult.skippedContacts} contacts stayed unlinked</p></div></div><span className="text-[10px] text-[#789080]">Only safe matches are linked.</span></div>}
    {backfillRunning && <div className="mb-5 flex items-center gap-2 rounded-lg border border-[#dce5ec] bg-[#f7fafc] px-4 py-3 text-[11px] text-[#64768b]"><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Checking legacy company profiles…</div>}
    {notice && <div role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="status-company-notice" className={`mb-5 rounded-md border px-4 py-3 text-[12px] ${notice.tone === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{notice.text}</div>}
     <section data-testid="section-unlinked-company-profiles" className={`${card} mb-5 overflow-hidden`}>
       <header className="border-b border-[#e8edf1] px-4 py-4 sm:px-5">
         <div className="flex flex-wrap items-start justify-between gap-3">
           <div><h2 className="text-[14px] font-bold text-[#223247]">Company profiles to review</h2><p className="mt-1 text-[11px] leading-5 text-[#788697]">Profiles that could not be safely linked stay on their contact. Automatic linking requires compatible details and a matching domain; names alone are never used.</p></div>
           {!unlinkedProfilesQuery.isLoading && !unlinkedProfilesQuery.isError && <span data-testid="text-unlinked-company-count" className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#647386]">{unlinkedProfilesQuery.data?.profiles.length ?? 0} to review</span>}
         </div>
       </header>
       {unlinkedProfilesQuery.isLoading ? <div className="px-5 py-7 text-[11px] text-[#8390a0]">Loading unlinked profiles…</div>
         : unlinkedProfilesQuery.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-5 py-5"><p className="text-[11px] text-[#8b6044]">Unlinked profiles could not be loaded.</p><button type="button" data-testid="button-retry-unlinked-profiles" onClick={() => void unlinkedProfilesQuery.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-[11px] font-semibold text-[#52667b]">Retry</button></div>
           : unlinkedProfilesQuery.data?.profiles.length ? <div className="max-h-[500px] divide-y divide-[#edf0f2] overflow-y-auto">{unlinkedProfilesQuery.data.profiles.map(profile => <UnlinkedProfileRow key={profile.contactId} profile={profile}/>)}</div>
             : <div data-testid="empty-unlinked-company-profiles" className="px-5 py-7"><p className="text-[12px] font-semibold text-[#405166]">No unlinked profiles need review</p><p className="mt-1 text-[11px] text-[#84909e]">When a legacy profile is incomplete or conflicts with another record, it will appear here.</p></div>}
       <footer className="border-t border-[#edf0f2] bg-[#fbfcfd] px-4 py-3 text-[10px] leading-4 text-[#778596] sm:px-5">To keep a profile unchanged, leave it as-is. It remains on the contact and in this list until you correct or link it.</footer>
     </section>
    <div className="grid items-start">
       <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><h2 className="text-[14px] font-bold text-[#223247]">Company directory</h2><p data-testid="text-company-result-count" className="mt-1 text-[11px] text-[#84909e]">{filtered.length} {filtered.length === 1 ? 'record' : 'records'} in this workspace</p></div><label className="relative block w-full sm:max-w-[280px]"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b96a3]"/><input aria-label="Search companies" data-testid="input-search-companies" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, domain, industry…" className="h-9 w-full rounded-md border border-[#dce2e8] bg-[#fbfcfd] pl-9 pr-3 text-[11px] outline-none focus:border-[#3b73b8]"/></label></div>
        <section data-testid="section-company-filters" aria-label="Smart company filters" className="border-b border-[#e8edf1] bg-[#fbfcfd] px-4 py-4 sm:px-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold text-[#344154]">Smart filters</h3>
              <p className="mt-1 text-[10px] text-[#7d8997]">Combine company profile filters; all selected values must match.</p>
            </div>
            {hasActiveCompanyFilters && <button type="button" data-testid="button-clear-company-filters" onClick={clearCompanyFilters} className="rounded-md px-2 py-1 text-[10px] font-semibold text-[#245b9b] hover:bg-[#edf4fc]">Clear filters</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className={labelClass}>Industry</span>
              <select data-testid="select-company-industry-filter" className={input} value={companyFilters.industry} onChange={event => updateCompanyFilter('industry', event.target.value)}>
                <option value="">All industries</option>
                {companyFilterOptions.industries.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Company size</span>
              <select data-testid="select-company-size-filter" className={input} value={companyFilters.size} onChange={event => updateCompanyFilter('size', event.target.value)}>
                <option value="">All sizes</option>
                {companyFilterOptions.sizes.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Revenue range</span>
              <select data-testid="select-company-revenue-filter" className={input} value={companyFilters.revenueRange} onChange={event => updateCompanyFilter('revenueRange', event.target.value)}>
                <option value="">Any revenue</option>
                {companyFilterOptions.revenueRanges.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Location</span>
              <input data-testid="input-company-location-filter" className={input} value={companyFilters.location} onChange={event => updateCompanyFilter('location', event.target.value)} placeholder="City, region, or country"/>
            </label>
          </div>
        </section>
        {pageItems.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-[#f8fafb]">
                <tr className="mono text-[9px] uppercase tracking-[.11em] text-[#84909e]">
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-5 py-3 font-medium">Contacts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f2]">
                {pageItems.map(company => (
                  <tr key={company.id} data-testid={`row-company-${company.id}`} className="group hover:bg-[#f8fafb]">
                    <td className="px-5 py-3.5">
                      <Link href={`/companies/${company.id}`} data-testid={`link-company-detail-${company.id}`} className="flex items-center gap-3 no-underline">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#dbe5ef] bg-[#eef4fa] text-[#245b9b]"><Building2 className="h-4 w-4"/></span>
                        <span className="min-w-0 truncate text-[12px] font-semibold text-[#26364a] group-hover:text-[#174f99]">{company.companyName}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-[11px] text-[#536477]">{company.companyDomain || '—'}</td>
                    <td className="max-w-[220px] px-4 py-3.5 text-[11px] text-[#536477]">
                      <span data-testid={`text-company-location-${company.id}`} title={company.companyLocation || undefined} className="block truncate">{company.companyLocation || '—'}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span data-testid={`text-company-contact-count-${company.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f4f7] px-2.5 py-1 text-[10px] font-semibold text-[#607184]"><Users className="h-3 w-3"/>{company.contactCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div data-testid="empty-company-directory" className="px-5 py-14 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#eef4fa] text-[#51789f]"><Building2 className="h-5 w-5"/></span>
            <h3 className="mt-4 text-[13px] font-semibold text-[#344154]">{hasCompanySearchOrFilters ? 'No matching companies' : 'No shared companies yet'}</h3>
            <p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-[#818d9b]">{hasCompanySearchOrFilters ? 'Adjust your search or clear one or more filters to see results.' : 'Add a company profile or let the legacy profile check link safe domain matches.'}</p>
            {!hasCompanySearchOrFilters && <button type="button" data-testid="button-empty-add-company" onClick={() => setEditor('new')} className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-[#245b9b]"><Plus className="h-3.5 w-3.5"/>Add first company</button>}
          </div>
        )}
         {filtered.length > 0 && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8edf1] px-5 py-3"><span data-testid="text-company-page" className="text-[10px] text-[#7f8b99]">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="flex items-center gap-2"><button type="button" data-testid="button-company-page-previous" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] text-[#536477] disabled:opacity-40"><ChevronLeft className="h-4 w-4"/></button><span className="mono min-w-[54px] text-center text-[10px] text-[#667586]">{page} / {pageCount}</span><button type="button" data-testid="button-company-page-next" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))} className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] text-[#536477] disabled:opacity-40"><ChevronRight className="h-4 w-4"/></button></div></footer>}
       </section>
     </div>
      {editor && <CompanyEditor company={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice({ tone: 'success', text: 'Company profile saved.' }); void listQuery.refetch(); void qc.invalidateQueries({ queryKey: getListContactsQueryKey() }); void qc.invalidateQueries({ queryKey: getListUnlinkedCompanyProfilesQueryKey() }); }}/>}
  </div>;
}

function UnlinkedProfileRow({ profile }: { profile: UnlinkedCompanyProfile }) {
  return <article data-testid={`row-unlinked-company-${profile.contactId}`} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#fff6ed] text-[#a7632f]"><CircleAlert className="h-4 w-4"/></span>
      <div className="min-w-0">
        <div className="break-words text-[12px] font-semibold text-[#26364a]">{profile.companyName || 'Company name missing'}</div>
        <p className="mt-0.5 break-all text-[10px] text-[#7b8898]">{profile.contactName} · {profile.email}</p>
        <p className="mt-1 break-all text-[10px] text-[#718196]">{profile.companyDomain || profile.companyWebsiteUrl || 'No company domain or website'}</p>
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#9a5b2d]">{profile.reason}</p>
      </div>
    </div>
         <Link href={`/contacts/${profile.contactId}`} data-testid={`link-review-unlinked-company-${profile.contactId}`} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-[#d6e1ed] bg-white px-3 text-[10px] font-semibold text-[#245b9b] no-underline hover:bg-[#f2f7fc] sm:self-center">
       Compare and review<ArrowUpRight className="h-3.5 w-3.5"/>
    </Link>
  </article>;
}