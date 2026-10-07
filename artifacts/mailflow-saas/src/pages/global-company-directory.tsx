import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Building2, Check, CircleAlert, MapPin, Search, ShieldCheck } from 'lucide-react';
import {
  getListCompaniesQueryKey, getSearchGlobalCompaniesQueryKey, useAddGlobalCompanyToWorkspace, useSearchGlobalCompanies,
} from '@workspace/api-client-react';
import type { SearchGlobalCompaniesParams } from '@workspace/api-client-react';

const panel = 'rounded-xl border border-[#dce6e1] bg-[#fbfdfb] shadow-[0_2px_8px_rgba(33,65,54,.035)]';
const profileFields = [
  ['Industry', 'companyIndustry'], ['Company size', 'companySize'], ['Revenue range', 'companyRevenueRange'],
  ['Location', 'companyLocation'], ['Website', 'companyWebsiteUrl'], ['Domain', 'companyDomain'],
] as const;

export function GlobalCompanyDirectoryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = useMemo<SearchGlobalCompaniesParams>(() => ({
    search: search.trim() || undefined, page, pageSize: 10,
  }), [search, page]);
  const query = useSearchGlobalCompanies(params, { query: { queryKey: getSearchGlobalCompaniesQueryKey(params), placeholderData: previous => previous } });
  const add = useAddGlobalCompanyToWorkspace();
  const companies = query.data?.companies ?? [];
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 10));
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const addCompany = (id: string, name: string) => {
    setNotice(null);
    add.mutate({ globalCompanyId: id }, {
      onSuccess: () => {
        setNotice({ kind: 'ok', text: `${name} was added to your workspace. Its shared profile stays managed in the global catalog.` });
        void qc.invalidateQueries({ queryKey: getSearchGlobalCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      },
      onError: error => {
        const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.';
        setNotice({ kind: 'error', text: /domain|conflict|already exists|duplicate/i.test(message)
          ? `This company could not be added because its domain conflicts with a profile already in your workspace. No contact data was moved. ${message}`
          : `This company could not be added. No contact data was moved. ${message}` });
      },
    });
  };

  if (query.isLoading && !query.data) return <div aria-label="Loading global company directory" className="space-y-5"><div className="h-8 w-56 animate-pulse rounded bg-[#e7efea]"/><div className="h-24 animate-pulse rounded-xl bg-[#eaf1ed]"/><div className="h-72 animate-pulse rounded-xl bg-[#eaf1ed]"/></div>;
  if (query.isError && !query.data) return <section className={`${panel} p-7`} role="alert"><div className="flex items-center gap-2 text-sm font-bold text-[#29443b]"><CircleAlert className="h-4 w-4 text-[#bf7043]"/>Directory unavailable</div><p className="mt-2 text-xs text-[#718078]">Global company profiles could not be loaded.</p><button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-md border border-[#cad8d0] px-3 py-2 text-xs font-semibold text-[#315c4e]">Retry</button></section>;
  return <main className="fade-in mx-auto max-w-[1120px]">
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div><div className="mono mb-2 text-[9px] uppercase tracking-[.18em] text-[#598274]">WORKSPACE / GLOBAL DIRECTORY</div><h1 className="display text-[30px] font-extrabold leading-tight tracking-[-.04em] text-[#1c3832]">Find your next customer</h1><p className="mt-2 max-w-xl text-[13px] leading-6 text-[#687c73]">Choose a verified company profile to add to your workspace. Shared details stay consistent across Mailflow.</p></div>
      <div className="inline-flex items-center gap-2 rounded-full border border-[#d3e5dc] bg-[#eef7f1] px-3 py-2 text-[10px] font-semibold text-[#3c7462]"><ShieldCheck className="h-3.5 w-3.5"/>Catalog profiles are managed centrally</div>
    </header>
    <section className={`${panel} overflow-hidden`}>
      <div className="flex flex-col gap-4 border-b border-[#e5ede8] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div><h2 className="text-[14px] font-bold text-[#26463c]">Global company catalog</h2><p className="mt-1 text-[11px] text-[#819088]">{(query.data?.total ?? 0).toLocaleString()} profiles available</p></div>
        <label className="relative block w-full sm:max-w-[340px]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80938a]"/><input aria-label="Search global companies" data-testid="input-search-global-companies" value={search} onChange={event => { setSearch(event.target.value); setPage(1); setNotice(null); }} placeholder="Search name, domain, or industry" className="h-10 w-full rounded-lg border border-[#d7e3dc] bg-[#f8fbf9] pl-10 pr-3 text-[12px] text-[#243e35] outline-none placeholder:text-[#98a89f] focus:border-[#488875] focus:ring-2 focus:ring-[#dbece4]"/></label>
      </div>
      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mx-5 mt-4 rounded-lg border px-4 py-3 text-[11px] leading-5 sm:mx-6 ${notice.kind === 'error' ? 'border-[#ead2c2] bg-[#fff8f2] text-[#935d39]' : 'border-[#cfe4d8] bg-[#f0f8f3] text-[#3a7058]'}`}>{notice.text}</div>}
      {query.isFetching && query.data && <div className="px-6 pt-3 text-[10px] text-[#82938a]">Updating results…</div>}
      {companies.length ? <div className="divide-y divide-[#e8efeb]">
        {companies.map((company, index) => <article key={company.id} data-testid={`row-global-company-${company.id}`} className="grid gap-4 px-5 py-5 transition-colors hover:bg-[#f7faf8] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6" style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}>
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d3e5dc] bg-[#edf6f0] text-[#347765]"><Building2 className="h-[18px] w-[18px]"/></span>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="truncate text-[13px] font-bold text-[#29443b]">{company.companyName}</h3>{company.alreadyAdded && <span className="inline-flex items-center gap-1 rounded-full bg-[#edf6f0] px-2 py-0.5 text-[9px] font-semibold text-[#46806c]"><Check className="h-3 w-3"/>In your workspace</span>}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#73867c]">{company.companyDomain && <span>{company.companyDomain}</span>}{company.companyIndustry && <span>{company.companyIndustry}</span>}{company.companyLocation && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3"/>{company.companyLocation}</span>}</div>
              {company.companyDescription && <p className="mt-2 line-clamp-2 max-w-2xl text-[11px] leading-5 text-[#718078]">{company.companyDescription}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 pl-[54px] sm:pl-0">
            {company.alreadyAdded ? <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dbe8e1] bg-[#f3f8f5] px-3 text-[10px] font-semibold text-[#598073]"><Check className="h-3.5 w-3.5"/>Added</span> :
              <button type="button" data-testid={`button-add-global-company-${company.id}`} disabled={add.isPending} onClick={() => addCompany(company.id, company.companyName)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[#286d5b] px-3.5 text-[10px] font-bold text-white transition hover:bg-[#205a4b] disabled:opacity-55">{add.isPending ? 'Adding…' : 'Add to workspace'}<ArrowUpRight className="h-3.5 w-3.5"/></button>}
          </div>
        </article>)}
      </div> : <div className="px-5 py-14 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#edf6f0] text-[#558b78]"><Building2 className="h-5 w-5"/></span><h3 className="mt-4 text-[13px] font-bold text-[#37564b]">{search.trim() ? 'No companies match that search' : 'The catalog is getting ready'}</h3><p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-[#829188]">{search.trim() ? 'Try a different company name, domain, or industry.' : 'Global company profiles will appear here when they are published.'}</p></div>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ede8] bg-[#f8fbf9] px-5 py-3.5 sm:px-6">
        <span className="text-[10px] text-[#788a81]">{query.data?.total ? `Showing ${(page - 1) * 10 + 1}–${Math.min(page * 10, query.data.total)} of ${query.data.total}` : 'No results'}</span>
        <div className="flex items-center gap-2"><button type="button" aria-label="Previous results page" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-md border border-[#d5e1da] px-3 py-1.5 text-[10px] font-semibold text-[#537365] disabled:opacity-40">Previous</button><span className="mono min-w-10 text-center text-[10px] text-[#71867c]">{page} / {pages}</span><button type="button" aria-label="Next results page" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)} className="rounded-md border border-[#d5e1da] px-3 py-1.5 text-[10px] font-semibold text-[#537365] disabled:opacity-40">Next</button></div>
      </footer>
    </section>
  </main>;
}

export function LinkedGlobalProfileNotice({ companyName }: { companyName: string }) {
  return <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#d3e5dc] bg-[#eff7f2] px-4 py-3.5">
    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3e806b]"/><div><p className="text-[11px] font-bold text-[#315f50]">Managed from the global catalog</p><p className="mt-1 text-[10px] leading-5 text-[#668075]">{companyName} is a shared profile. Its details are maintained centrally and can’t be edited from your workspace.</p></div>
  </div>;
}

