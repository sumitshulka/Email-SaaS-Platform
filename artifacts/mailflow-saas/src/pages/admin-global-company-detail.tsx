import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, CircleAlert, Pencil } from 'lucide-react';
import {
  getGetAdminGlobalCompanyNavigationQueryKey, getGetAdminGlobalCompanyQueryKey,
  getGetCompanyIntelligenceQueryKey, getListAdminGlobalCompaniesQueryKey,
  useGetAdminGlobalCompany, useGetAdminGlobalCompanyNavigation, useListAdminGlobalCompanies,
} from '@workspace/api-client-react';
import { Link, useLocation, useParams } from 'wouter';
import { CompanyIntelligencePanel } from '@/components/company-intelligence-panel';
import { GlobalCompanyForm } from '@/pages/admin-global-companies';

const fields = [
  ['Business area', 'companyBusinessArea'],
  ['Industry', 'companyIndustry'],
  ['Website', 'companyWebsiteUrl'],
  ['Website domain', 'companyDomain'],
  ['Company size', 'companySize'],
  ['Revenue range', 'companyRevenueRange'],
  ['Location', 'companyLocation'],
  ['Phone', 'companyPhoneNumber'],
  ['LinkedIn', 'companyLinkedinUrl'],
] as const;

export function AdminGlobalCompanyDetailPage() {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [businessAreas, setBusinessAreas] = useState<string[]>([]);
  const [businessAreaLoadError, setBusinessAreaLoadError] = useState('');
  const locationQuery = new URLSearchParams(window.location.search);
  const hasListPageContext = locationQuery.has('listPage');
  const listSearch = locationQuery.get('listSearch') ?? '';
  const requestedPage = Number(locationQuery.get('listPage') ?? 1);
  const listPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const listParams = { search: listSearch.trim() || undefined, page: listPage, pageSize: 10 };
  const listQuery = useListAdminGlobalCompanies(listParams, {
    query: { queryKey: getListAdminGlobalCompaniesQueryKey(listParams), enabled: hasListPageContext },
  });
  const records = listQuery.data?.globalCompanies ?? [];
  const recordIndex = records.findIndex(record => record.id === companyId);
  const pageCount = Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / 10));
  const previousParams = { ...listParams, page: Math.max(1, listPage - 1) };
  const nextParams = { ...listParams, page: listPage + 1 };
  const previousQuery = useListAdminGlobalCompanies(previousParams, {
    query: {
      queryKey: getListAdminGlobalCompaniesQueryKey(previousParams),
      enabled: hasListPageContext && listPage > 1 && recordIndex === 0 && !listQuery.isFetching,
    },
  });
  const nextQuery = useListAdminGlobalCompanies(nextParams, {
    query: {
      queryKey: getListAdminGlobalCompaniesQueryKey(nextParams),
      enabled: hasListPageContext && listPage < pageCount && recordIndex === records.length - 1 && records.length > 0 && !listQuery.isFetching,
    },
  });
  const previousRecord = recordIndex > 0
    ? records[recordIndex - 1]
    : previousQuery.data?.globalCompanies.at(-1);
  const nextRecord = recordIndex >= 0 && recordIndex < records.length - 1
    ? records[recordIndex + 1]
    : nextQuery.data?.globalCompanies[0];
  const fallbackNavigationQuery = useGetAdminGlobalCompanyNavigation(companyId, {
    query: {
      queryKey: getGetAdminGlobalCompanyNavigationQueryKey(companyId),
      enabled: !!companyId && (!hasListPageContext || (listQuery.isSuccess && recordIndex < 0)),
    },
  });
  const previousCompanyId = previousRecord?.id ?? fallbackNavigationQuery.data?.previousCompanyId ?? null;
  const nextCompanyId = nextRecord?.id ?? fallbackNavigationQuery.data?.nextCompanyId ?? null;
  const detailHref = (recordId: string, page: number) => {
    const params = new URLSearchParams({ listPage: String(page) });
    if (listSearch.trim()) params.set('listSearch', listSearch.trim());
    return `/companies/${recordId}?${params.toString()}`;
  };
  const previousPage = recordIndex === 0 ? listPage - 1 : listPage;
  const nextPage = recordIndex === records.length - 1 ? listPage + 1 : listPage;
  const query = useGetAdminGlobalCompany(companyId, {
    query: { enabled: !!companyId, retry: false, queryKey: getGetAdminGlobalCompanyQueryKey(companyId) },
  });
  useEffect(() => {
    let active = true;
    fetch('/api/company-business-areas', { credentials: 'include' })
      .then(async response => {
        const body = await response.json() as { values?: string[]; error?: string };
        if (!response.ok || !body.values) throw new Error(body.error || 'Could not load business-area choices.');
        if (active) setBusinessAreas(body.values);
      })
      .catch(error => { if (active) setBusinessAreaLoadError(error instanceof Error ? error.message : 'Could not load business-area choices.'); });
    return () => { active = false; };
  }, []);
  if (query.isLoading) return <div aria-label="Loading global company details" className="w-full space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-[#eaf1ed]"/><div className="h-48 animate-pulse rounded-xl bg-[#eaf1ed]"/></div>;
  if (query.isError || !query.data) return <section role="alert" className="w-full rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-6"><div className="flex items-center gap-2 text-sm font-bold text-[#29443b]"><CircleAlert className="h-4 w-4 text-[#bf7043]"/>Global company details could not be loaded</div><p className="mt-2 text-xs text-[#71847a]">The profile may have been removed or the catalog could not be reached.</p><div className="mt-4 flex gap-3"><button type="button" onClick={() => void query.refetch()} className="rounded-md border border-[#cad8d0] px-3 py-2 text-xs font-semibold text-[#315c4e]">Retry</button><Link href={`/admin/global-companies?${new URLSearchParams({ listPage: String(listPage), ...(listSearch.trim() ? { listSearch: listSearch.trim() } : {}) }).toString()}`} className="rounded-md px-3 py-2 text-xs font-semibold text-[#315c4e] no-underline">Global companies</Link></div></section>;

  const company = query.data;
  return <main data-testid="admin-global-company-detail" className="fade-in w-full">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Link href={`/admin/global-companies?${new URLSearchParams({ listPage: String(listPage), ...(listSearch.trim() ? { listSearch: listSearch.trim() } : {}) }).toString()}`} data-testid="link-back-global-companies" className="text-xs font-semibold text-[#347765] no-underline hover:underline">← Global companies</Link>
      <nav aria-label="Global company record navigation" data-testid="global-company-record-navigation" className="inline-flex items-center gap-2">
        <button type="button" data-testid="button-previous-global-company" disabled={(hasListPageContext && listQuery.isFetching) || fallbackNavigationQuery.isFetching || !previousCompanyId || previousQuery.isFetching} onClick={() => previousRecord ? setLocation(detailHref(previousRecord.id, previousPage)) : previousCompanyId && setLocation(`/companies/${previousCompanyId}`)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#d5e1da] bg-white px-3 text-[11px] font-semibold text-[#537365] hover:bg-[#f5f9f6] disabled:cursor-not-allowed disabled:opacity-45"><ChevronLeft className="h-4 w-4"/>Previous</button>
        <span data-testid="text-global-company-navigation-position" aria-live="polite" className="min-w-[54px] text-center text-[10px] text-[#71867c]">{recordIndex >= 0 && listQuery.data ? `${(listPage - 1) * 10 + recordIndex + 1} of ${listQuery.data.total}` : fallbackNavigationQuery.isFetching ? 'Loading…' : 'Catalog'}</span>
        <button type="button" data-testid="button-next-global-company" disabled={(hasListPageContext && listQuery.isFetching) || fallbackNavigationQuery.isFetching || !nextCompanyId || nextQuery.isFetching} onClick={() => nextRecord ? setLocation(detailHref(nextRecord.id, nextPage)) : nextCompanyId && setLocation(`/companies/${nextCompanyId}`)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#d5e1da] bg-white px-3 text-[11px] font-semibold text-[#537365] hover:bg-[#f5f9f6] disabled:cursor-not-allowed disabled:opacity-45">Next<ChevronRight className="h-4 w-4"/></button>
      </nav>
    </div>
    <header className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 sm:p-7">
      <div className="flex min-w-0 items-start gap-4">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#edf6f0] text-[#3b7a67]"><Building2 className="h-5 w-5"/></span>
      <div className="min-w-0"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#638a7b]">GLOBAL COMPANY PROFILE · SUPERADMIN VIEW</div><h1 className="display mt-1 break-words text-[25px] font-extrabold tracking-[-.03em] text-[#1e3b32]">{company.companyName}</h1><p className="mt-1 text-[11px] text-[#71847a]">Shared company information only. Workspace contacts and campaign data are not shown here.</p></div>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#cddbd3] bg-white px-3 text-[11px] font-bold text-[#416b5b] hover:bg-[#f5f9f6]"><Pencil className="h-3.5 w-3.5"/>Edit profile</button>
    </header>
    <section className="mt-4 rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 sm:p-7">
      <h2 className="text-[13px] font-bold text-[#29443b]">Company information</h2>
      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{fields.map(([label, key]) => <div key={key} className="min-w-0 border-b border-[#edf2ee] pb-3"><dt className="text-[10px] font-semibold text-[#819088]">{label}</dt><dd className="mt-1 break-words text-[12px] text-[#29443b]">{company[key] || '—'}</dd></div>)}</dl>
      <div className="mt-5"><h3 className="text-[10px] font-semibold text-[#819088]">Description</h3><p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-[#29443b]">{company.companyDescription || '—'}</p></div>
    </section>
    <section className="mt-5">
      <CompanyIntelligencePanel globalCompanyId={company.id} adminMode/>
    </section>
    {businessAreaLoadError && <p role="status" className="mt-3 text-[11px] text-[#a45335]">Business-area choices could not be loaded: {businessAreaLoadError}. The existing value is preserved.</p>}
    {editing && <GlobalCompanyForm
      key={company.id}
      record={company}
      businessAreas={company.companyBusinessArea && !businessAreas.includes(company.companyBusinessArea) ? [...businessAreas, company.companyBusinessArea] : businessAreas}
      onClose={() => setEditing(false)}
      onSaved={() => {
        setEditing(false);
        void queryClient.invalidateQueries({ queryKey: getGetAdminGlobalCompanyQueryKey(company.id) });
        void queryClient.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCompanyIntelligenceQueryKey(company.id) });
      }}
    />}
  </main>;
}
