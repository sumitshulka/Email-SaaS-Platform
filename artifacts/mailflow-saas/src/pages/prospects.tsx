import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  Activity, ArrowLeft, ArrowRight, Archive, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Trash2,
  CircleAlert, Clock3, DollarSign, ExternalLink, Filter, History, Layers3, Plus, Search, Settings2,
  Tag, UserRound,
} from 'lucide-react';
import {
  getGetProspectDashboardQueryKey, getGetProspectQueryKey, getGetProspectCurrenciesQueryKey, getGetContactQueryKey,
  getListContactProspectsQueryKey, getListProspectActionsQueryKey, getListProspectActionTypesQueryKey,
  getListProspectProductCategoriesQueryKey,
  getListProspectGrowthAuditQueryKey, getListProspectProductsQueryKey, getListProspectStagesQueryKey,
  getListProspectsQueryKey, useChangeProspectStage, useCreateProspect, useCreateProspectProductCategory,
  useDeleteProspectProductCategory,
  useCreateProspectAction, useCreateProspectActionType, useCreateProspectProduct, useCreateProspectStage,
  useGetProspect, useGetProspectCurrencies, useGetProspectDashboard, useGetContact, useListContactOptions, useListContactProspects,
  useListContactTags, useListProspectActions, useListProspectActionTypes, useListProspectGrowthAudit,
  useListProspectProductCategories, useListProspectProducts, useListProspectStages, useListProspects, useSetProspectStageTransitions,
  useSetProspectTags, useUpdateProspect, useUpdateProspectActionType, useUpdateProspectCurrencies,
  useUpdateProspectProduct, useUpdateProspectStage,
} from '@workspace/api-client-react';
import type {
  CreateProspectInput, ListProspectsParams, ProspectActionTypeInput, ProspectProductInput,
  ProspectProductCategory, ProspectRecord, ProspectStageInput,
} from '@workspace/api-client-react';

const panel = 'rounded-xl border border-[#dce4ed] bg-white shadow-[0_4px_18px_rgba(19,43,70,.035)]';
const field = 'h-10 w-full rounded-lg border border-[#d7e0e9] bg-[#fff] px-3 text-[12px] text-[#1a2b40] outline-none transition focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6] disabled:bg-[#f3f6f8]';
const label = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[.1em] text-[#66778a]';
const masterFieldLabel = 'text-[10px] font-bold uppercase tracking-[.1em] text-[#66778a]';
const masterFieldGroup = 'flex flex-col gap-2';
const smallBtn = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#d7e0e9] bg-white px-3 text-[11px] font-semibold text-[#39516b] transition hover:border-[#b9cadb] hover:bg-[#f5f8fb] disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#164f91] bg-[#164f91] px-4 text-[12px] font-bold text-white transition hover:-translate-y-px hover:bg-[#103e76] disabled:cursor-not-allowed disabled:opacity-50';
const dangerBtn = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#efd0c9] bg-[#fff9f7] px-3 text-[11px] font-semibold text-[#a14638] transition hover:bg-[#fff0ec]';
const errText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded';
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 4 }).format(value); }
  catch { return `${currency} ${value.toLocaleString()}`; }
};
const localDateInput = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function Notice({ children, kind = 'success' }: { children: ReactNode; kind?: 'success' | 'error' }) {
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-3 text-[11px] leading-5 ${kind === 'error' ? 'border-[#efc9bf] bg-[#fff6f3] text-[#9b4837]' : 'border-[#cde2d7] bg-[#f1f8f4] text-[#35684f]'}`}>{children}</div>;
}
function Heading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div><div className="mono mb-2 text-[9px] font-semibold tracking-[.17em] text-[#66809a]">{eyebrow}</div><h1 className="display text-[29px] font-bold leading-tight text-[#172b43] sm:text-[34px]">{title}</h1><p className="mt-2 max-w-2xl text-[12px] leading-5 text-[#6b7b8e]">{detail}</p></div>{action}
  </div>;
}
function Loading({ label: title = 'Loading prospect workspace' }: { label?: string }) {
  return <div aria-label={title} className="space-y-4"><div className="h-8 w-52 animate-pulse rounded bg-[#e9eff5]"/><div className="grid gap-3 sm:grid-cols-3"><div className="h-24 animate-pulse rounded-xl bg-[#edf2f7]"/><div className="h-24 animate-pulse rounded-xl bg-[#edf2f7]"/><div className="h-24 animate-pulse rounded-xl bg-[#edf2f7]"/></div><div className="h-56 animate-pulse rounded-xl bg-[#edf2f7]"/></div>;
}
function ErrorState({ retry }: { retry: () => void }) {
  return <div className={`${panel} flex flex-wrap items-center justify-between gap-4 p-5`}><div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd5c42]"/><div><div className="text-[12px] font-bold text-[#24384e]">Prospect data could not be loaded</div><div className="mt-1 text-[11px] text-[#718093]">Your records are unchanged. Retry to reconnect.</div></div></div><button type="button" onClick={retry} className={smallBtn}>Retry</button></div>;
}
function TagStack({ tags, kind }: { tags: Array<{ id: string; name: string }>; kind: 'Contact' | 'Prospect' }) {
  return <div className="flex flex-wrap gap-1.5">{tags.length ? tags.map(tag => <span key={tag.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${kind === 'Contact' ? 'bg-[#eef3f7] text-[#586b7e]' : 'bg-[#edf4fc] text-[#245b91]'}`}><Tag className="h-2.5 w-2.5"/>{tag.name}</span>) : <span className="text-[10px] text-[#99a4b0]">None</span>}</div>;
}
function PageFrame({ children }: { children: ReactNode }) {
  return <main className="prospect-page fade-in mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</main>;
}

export function ProspectsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ search: '', stageId: '', productId: '', currencyCode: '', closeFrom: '', closeTo: '', contactTagId: '', prospectTagId: '', status: 'active', includeArchived: false, sortBy: 'updatedAt', sortDirection: 'desc' });
  const [page, setPage] = useState(1);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const params = useMemo<ListProspectsParams>(() => ({
    page, pageSize: 20, ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.stageId ? { stageId: filters.stageId } : {}), ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.currencyCode ? { currencyCode: filters.currencyCode } : {}),
    ...(filters.closeFrom ? { closeFrom: filters.closeFrom } : {}), ...(filters.closeTo ? { closeTo: filters.closeTo } : {}),
    ...(filters.contactTagId ? { contactTagId: filters.contactTagId } : {}),
    ...(filters.prospectTagId ? { prospectTagId: filters.prospectTagId } : {}),
    status: filters.status as ListProspectsParams['status'], includeArchived: filters.includeArchived,
    sortBy: filters.sortBy as ListProspectsParams['sortBy'], sortDirection: filters.sortDirection as ListProspectsParams['sortDirection'],
  }), [page, filters]);
  const list = useListProspects(params, { query: { queryKey: getListProspectsQueryKey(params), refetchOnMount: 'always' } });
  const dashboard = useGetProspectDashboard();
  const stages = useListProspectStages();
  const products = useListProspectProducts();
  const currencies = useGetProspectCurrencies();
  const tags = useListContactTags();
  const activeFilterCount = [
    filters.stageId, filters.productId, filters.currencyCode, filters.status === 'active' ? '' : filters.status,
    filters.contactTagId, filters.prospectTagId, filters.closeFrom, filters.closeTo, filters.includeArchived ? 'archived' : '',
  ].filter(Boolean).length;
  const hasAnyFilters = activeFilterCount > 0 || !!filters.search.trim() || filters.sortBy !== 'updatedAt' || filters.sortDirection !== 'desc';
  const resetFilters = () => {
    setPage(1);
    setFilters(f => ({ ...f, search: '', stageId: '', productId: '', currencyCode: '', closeFrom: '', closeTo: '', contactTagId: '', prospectTagId: '', status: 'active', includeArchived: false, sortBy: 'updatedAt', sortDirection: 'desc' }));
    setMoreFiltersOpen(false);
  };
  if (list.isLoading) return <PageFrame><Loading label="Loading prospects"/></PageFrame>;
  if (list.isError && !list.data) return <PageFrame><ErrorState retry={() => void list.refetch()}/></PageFrame>;
  const collection = list.data;
  const currencyRows = dashboard.data?.currencyTotals ?? [];
  return <PageFrame>
    <Heading eyebrow="COMMERCIAL OPPORTUNITIES / WORKSPACE" title="Prospects" detail="Track each potential deal alongside the contact record it belongs to. Pipeline values stay separated by currency." action={<Link href="/prospects/new" className={primaryBtn} data-testid="link-create-prospect"><Plus className="h-4 w-4"/>New prospect</Link>}/>
    {list.isError && <div className="mb-4"><Notice kind="error">Could not refresh the list. Showing the most recently loaded results.</Notice></div>}
    <section aria-label="Pipeline summary" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={`${panel.replace('bg-white ', '')} relative overflow-hidden border-[#cadcf0] bg-[#eff6fc] p-4`}><div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-[#dceaf7]"/><div className="relative text-[9px] font-bold uppercase tracking-[.12em] text-[#52718f]">Active prospects</div><div className="relative mt-2 text-[26px] font-bold tracking-[-.05em] text-[#193553]">{dashboard.isLoading ? '—' : dashboard.data?.totalActive ?? 0}</div><div className="relative mt-1 text-[10px] text-[#5d7489]">Open commercial opportunities</div></div>
      <div className={`${panel.replace('bg-white ', '')} border-[#cde2d5] bg-[#f0f8f3] p-4 sm:col-span-1 xl:col-span-3`}><div className="mb-3 flex items-center justify-between"><div><div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#4e7560]">Pipeline by currency</div><div className="mt-1 text-[10px] text-[#60796a]">Expected and weighted values are never combined across codes.</div></div><DollarSign className="h-4 w-4 text-[#3f7957]"/></div>
        {dashboard.isLoading ? <div className="h-9 animate-pulse rounded bg-[#edf2f7]"/> : dashboard.isError ? <button type="button" onClick={() => void dashboard.refetch()} className="text-[10px] font-semibold text-[#a04f3d] underline">Summary unavailable · retry</button> : currencyRows.length ? <div className="flex flex-wrap gap-2">{currencyRows.map(row => <div key={row.currencyCode} className="min-w-[158px] rounded-lg border border-[#e7edf3] bg-[#f9fbfd] px-3 py-2"><div className="mono text-[9px] font-semibold text-[#54708c]">{row.currencyCode}</div><div className="mt-1 text-[13px] font-bold text-[#243c57]">{money(row.activeValue, row.currencyCode)}</div><div className="mt-1 text-[9px] text-[#7d8a98]">Weighted {money(row.weightedValue, row.currencyCode)}</div><div className="mt-1 text-[9px] text-[#7d8a98]">Won {money(row.wonValue, row.currencyCode)} <span className="px-1 text-[#b1bac3]">/</span> Lost {money(row.lostValue, row.currencyCode)}</div></div>)}</div> : <div className="text-[11px] text-[#8492a0]">No pipeline values yet.</div>}
      </div>
    </section>
    {dashboard.data && <section aria-label="Prospect summary breakdowns" className="mb-5 grid gap-3 lg:grid-cols-3">
      <SummaryList tone="blue" title="By stage" icon={<Activity className="h-3.5 w-3.5"/>} rows={dashboard.data.byStage.map(s => ({ title: s.stageName, count: s.count, subtitle: `${s.probability}% · ${s.stageType === 'terminal' ? s.terminalOutcome || 'Terminal' : 'Active'}`, values: s.currencyTotals }))}/>
      <SummaryList tone="green" title="By product / service" icon={<Layers3 className="h-3.5 w-3.5"/>} rows={dashboard.data.byProduct.map(p => ({ title: p.productName, count: p.count, subtitle: 'Prospects', values: p.currencyTotals }))}/>
      <SummaryList tone="amber" title="Expected closure" icon={<CalendarDays className="h-3.5 w-3.5"/>} rows={dashboard.data.byClosurePeriod.map(p => ({ title: p.period, count: p.count, subtitle: 'Prospects', values: p.currencyTotals }))}/>
    </section>}
    {(stages.data?.length === 0 || products.data?.length === 0 || currencies.data?.currencies.length === 0) && <div className="mb-5 rounded-xl border border-[#e8d8bc] bg-[#fffaf1] px-4 py-3 text-[11px] leading-5 text-[#80613a]"><strong className="text-[#6c4f2e]">Finish pipeline setup to create prospects.</strong> Add stages, products or services, and permitted currencies in <Link href="/prospect-stages" className="font-bold text-[#245b91] underline underline-offset-2">stage settings</Link>, <Link href="/prospect-products" className="font-bold text-[#245b91] underline underline-offset-2">products</Link>, and <Link href="/prospect-currencies" className="font-bold text-[#245b91] underline underline-offset-2">currencies</Link>.</div>}
    <section className={`${panel} mb-4 overflow-hidden`} aria-label="Search and filters">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1"><span className={label}>Search prospects</span><span className="relative block"><Search className="absolute left-3 top-3 h-3.5 w-3.5 text-[#8796a5]"/><input className={`${field} pl-9`} value={filters.search} onChange={e => { setPage(1); setFilters(f => ({ ...f, search: e.target.value })); }} placeholder="Prospect, contact, email or company" data-testid="input-prospect-search"/></span></label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={smallBtn} aria-expanded={moreFiltersOpen} aria-controls="prospect-more-filters" onClick={() => setMoreFiltersOpen(open => !open)} data-testid="button-prospect-more-filters">
            <Filter className="h-3.5 w-3.5"/>More filters
            {activeFilterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#e8f0f8] px-1 text-[9px] font-bold text-[#245b91]">{activeFilterCount}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreFiltersOpen ? 'rotate-180' : ''}`}/>
          </button>
          {hasAnyFilters && <button type="button" className="px-2 py-2 text-[10px] font-semibold text-[#3c6893] hover:underline" onClick={resetFilters} data-testid="button-prospect-clear-filters">Clear all</button>}
        </div>
      </div>
      {moreFiltersOpen && <div id="prospect-more-filters" className="border-t border-[#e8edf2] bg-[#fbfcfd]">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <label><span className={label}>Stage</span><select className={field} value={filters.stageId} onChange={e => { setPage(1); setFilters(f => ({ ...f, stageId: e.target.value })); }} data-testid="select-prospect-stage-filter"><option value="">All stages</option>{stages.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><span className={label}>Product / service</span><select className={field} value={filters.productId} onChange={e => { setPage(1); setFilters(f => ({ ...f, productId: e.target.value })); }} data-testid="select-prospect-product-filter"><option value="">All products and services</option>{products.data?.map(p => <option key={p.id} value={p.id}>{p.itemType === 'service' ? 'Service' : 'Product'} · {p.name}</option>)}</select></label>
        <label><span className={label}>Currency</span><select className={field} value={filters.currencyCode} onChange={e => { setPage(1); setFilters(f => ({ ...f, currencyCode: e.target.value })); }} data-testid="select-prospect-currency-filter"><option value="">All currencies</option>{currencies.data?.currencies.map(c => <option key={c.code} value={c.code}>{c.code}{c.isDefault ? ' · default' : ''}</option>)}</select></label>
        <label><span className={label}>Status</span><select className={field} value={filters.status} onChange={e => { setPage(1); setFilters(f => ({ ...f, status: e.target.value })); }} data-testid="select-prospect-status-filter"><option value="active">Active</option><option value="won">Won</option><option value="lost">Lost</option><option value="other_terminal">Other terminal</option><option value="all">All statuses</option></select></label>
        <label><span className={label}>Contact tag</span><select className={field} value={filters.contactTagId} onChange={e => { setPage(1); setFilters(f => ({ ...f, contactTagId: e.target.value })); }} data-testid="select-prospect-contact-tag-filter"><option value="">Any contact tag</option>{tags.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label><span className={label}>Prospect tag</span><select className={field} value={filters.prospectTagId} onChange={e => { setPage(1); setFilters(f => ({ ...f, prospectTagId: e.target.value })); }} data-testid="select-prospect-tag-filter"><option value="">Any prospect tag</option>{tags.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label><span className={label}>Close from</span><input type="date" className={field} value={filters.closeFrom} onChange={e => { setPage(1); setFilters(f => ({ ...f, closeFrom: e.target.value })); }} data-testid="input-prospect-close-from"/></label>
        <label><span className={label}>Close through</span><input type="date" className={field} value={filters.closeTo} onChange={e => { setPage(1); setFilters(f => ({ ...f, closeTo: e.target.value })); }} data-testid="input-prospect-close-to"/></label>
        <label><span className={label}>Sort by</span><select className={field} value={filters.sortBy} onChange={e => setFilters(f => ({ ...f, sortBy: e.target.value }))} data-testid="select-prospect-sort"><option value="updatedAt">Recently updated</option><option value="name">Name</option><option value="expectedDealValue">Expected value</option><option value="expectedClosureDate">Expected close</option><option value="lastActivityAt">Last activity</option></select></label>
        <label><span className={label}>Direction</span><select className={field} value={filters.sortDirection} onChange={e => setFilters(f => ({ ...f, sortDirection: e.target.value }))} data-testid="select-prospect-sort-direction"><option value="desc">Newest / highest</option><option value="asc">Oldest / lowest</option></select></label>
      </div>
      <label className="flex items-center gap-2 border-t border-[#edf1f4] px-4 py-3 text-[10px] font-semibold text-[#586d81]"><input type="checkbox" checked={filters.includeArchived} onChange={e => { setPage(1); setFilters(f => ({ ...f, includeArchived: e.target.checked })); }} className="h-3.5 w-3.5 accent-[#174f91]" data-testid="checkbox-prospect-include-archived"/>Include archived prospects</label>
      </div>}
    </section>
    <section className={`${panel} overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8edf2] px-4 py-3.5"><div><h2 className="text-[13px] font-bold text-[#233a53]">Opportunity register</h2><p className="mt-1 text-[10px] text-[#8290a0]">{collection?.total ?? 0} records · probability and activity reflect the API’s current state</p></div><span className="mono rounded-md bg-[#eff4f8] px-2.5 py-1 text-[9px] text-[#567089]">{collection?.page ?? 1} / {collection?.pageCount ?? 1}</span></header>
      {!collection?.prospects.length ? <div className="px-5 py-14 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#edf4fb] text-[#2c639b]"><Layers3 className="h-5 w-5"/></div><h3 className="mt-4 text-[14px] font-bold text-[#263b52]">{hasAnyFilters ? 'No prospects match these filters' : 'No prospects in this view'}</h3><p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-[#7d8b99]">Each prospect is its own deal linked to an existing contact. Clear filters or add an opportunity to begin.</p><div className="mt-4 flex justify-center gap-2">{hasAnyFilters && <button type="button" className={smallBtn} onClick={resetFilters}>Clear filters</button>}<Link href="/prospects/new" className={primaryBtn}><Plus className="h-3.5 w-3.5"/>Create prospect</Link></div></div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="bg-[#f7f9fb] text-[9px] font-bold uppercase tracking-[.1em] text-[#8290a0]"><tr><th className="px-4 py-3">Prospect / contact</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Expected value</th><th className="px-4 py-3">Close date</th><th className="px-4 py-3">Probability</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3">Tags</th></tr></thead><tbody className="divide-y divide-[#edf1f4]">{collection.prospects.map(prospect => <ProspectRow key={prospect.id} prospect={prospect}/>)}</tbody></table></div>}
      {collection && collection.pageCount > 1 && <div className="flex items-center justify-between border-t border-[#e8edf2] px-4 py-3"><span className="text-[10px] text-[#7f8c9a]">Showing {(collection.page - 1) * collection.pageSize + 1}–{Math.min(collection.page * collection.pageSize, collection.total)} of {collection.total}</span><div className="flex gap-2"><button type="button" className={smallBtn} disabled={page <= 1} onClick={() => setPage(n => Math.max(1, n - 1))}><ChevronLeft className="h-3.5 w-3.5"/>Previous</button><button type="button" className={smallBtn} disabled={page >= collection.pageCount} onClick={() => setPage(n => n + 1)}>Next<ChevronRight className="h-3.5 w-3.5"/></button></div></div>}
    </section>
  </PageFrame>;
  function ProspectRow({ prospect }: { prospect: ProspectRecord }) {
    const link = `/prospects/${encodeURIComponent(prospect.id)}`;
    return <tr className="align-top transition-colors hover:bg-[#fbfcfe]" data-testid={`row-prospect-${prospect.id}`}>
      <td className="px-4 py-3.5"><Link href={link} className="text-[12px] font-bold text-[#1e4f7f] no-underline hover:underline" data-testid={`link-prospect-${prospect.id}`}>{prospect.name}</Link><div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#65778a]"><UserRound className="h-3 w-3"/>{prospect.contact.name}</div><div className="mt-0.5 text-[10px] text-[#8b98a6]">{prospect.contact.email}{prospect.contact.companyName ? ` · ${prospect.contact.companyName}` : ''}</div><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-[#8290a0]"><span className="rounded-full bg-[#edf4fb] px-2 py-0.5 font-semibold uppercase text-[#3a668e]">{prospect.product.itemType}</span>{prospect.product.name}<span>· {prospect.product.category ?? 'Uncategorized'}</span></div></td>
      <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${prospect.currentStage.stageType === 'terminal' ? 'bg-[#fff1ed] text-[#a04f3d]' : 'bg-[#edf4fc] text-[#245b91]'}`}><span className={`h-1.5 w-1.5 rounded-full ${prospect.currentStage.stageType === 'terminal' ? 'bg-[#ce755f]' : 'bg-[#4784bd]'}`}/>{prospect.currentStage.name}</span>{prospect.archivedAt && <div className="mt-1 text-[9px] text-[#8996a2]">Archived</div>}</td>
      <td className="px-4 py-3.5"><div className="text-[12px] font-bold text-[#243b53]">{money(prospect.expectedDealValue, prospect.currencyCode)}</div><div className="mt-1 text-[9px] text-[#8391a0]">{prospect.currencyCode}</div></td>
      <td className="px-4 py-3.5 text-[11px] text-[#51667b]">{dateLabel(prospect.expectedClosureDate)}</td>
      <td className="px-4 py-3.5"><div className="flex items-center gap-2"><span className="mono text-[10px] font-bold text-[#365b7d]">{prospect.currentProbability}%</span><span className="h-1.5 w-16 overflow-hidden rounded-full bg-[#eaf0f5]"><span className="block h-full rounded-full bg-[#3d79ac]" style={{ width: `${prospect.currentProbability}%` }} /></span></div></td>
      <td className="px-4 py-3.5"><div className="flex items-center gap-1.5 text-[10px] text-[#65788b]"><Clock3 className="h-3 w-3"/>{dateLabel(prospect.lastActivityAt)}</div></td>
      <td className="px-4 py-3.5"><div className="space-y-1.5"><TagStack tags={prospect.contact.tags} kind="Contact"/><TagStack tags={prospect.prospectTags} kind="Prospect"/></div></td>
    </tr>;
  }
}

function SummaryList({ title, icon, rows, tone }: { title: string; icon: ReactNode; tone: 'blue' | 'green' | 'amber'; rows: Array<{ title: string; count: number; subtitle: string; values: Array<{ currencyCode: string; activeValue: number; weightedValue: number; wonValue: number; lostValue: number }> }> }) {
  const colors = {
    blue: { card: 'border-[#c8daed] bg-[#eff6fc]', header: 'border-[#cfdeec] bg-[#e3eef8]', icon: 'text-[#356b9e]' },
    green: { card: 'border-[#cbe1d3] bg-[#eff8f2]', header: 'border-[#d4e7da] bg-[#e2f1e7]', icon: 'text-[#477859]' },
    amber: { card: 'border-[#ead9ba] bg-[#fff8ec]', header: 'border-[#eee0c7] bg-[#f8edd9]', icon: 'text-[#96713b]' },
  }[tone];
  return <section className={`${panel.replace('bg-white ', '')} overflow-hidden ${colors.card}`}><header className={`flex items-center gap-2 border-b px-4 py-3 text-[11px] font-bold text-[#324b65] ${colors.header}`}>{<span className={colors.icon}>{icon}</span>}{title}</header><div className="divide-y divide-white/70">{rows.length ? rows.slice(0, 5).map((row, index) => <div key={`${row.title}-${index}`} className="flex items-start justify-between gap-3 px-4 py-3"><div><div className="text-[11px] font-semibold text-[#354c64]">{row.title}</div><div className="mt-1 text-[9px] text-[#64788b]">{row.count} {row.subtitle.toLowerCase()}</div></div><div className="flex max-w-[60%] flex-wrap justify-end gap-1.5">{row.values.map(value => <span key={value.currencyCode} className="rounded-md bg-white/75 px-2 py-1 text-right text-[9px] text-[#52687d]">{value.activeValue > 0 && <><strong className="text-[#354f68]">{money(value.activeValue, value.currencyCode)}</strong><br/>Weighted {money(value.weightedValue, value.currencyCode)}<br/></>}{value.wonValue > 0 && <>Won {money(value.wonValue, value.currencyCode)}<br/></>}{value.lostValue > 0 && <>Lost {money(value.lostValue, value.currencyCode)}</>}{value.activeValue <= 0 && value.wonValue <= 0 && value.lostValue <= 0 && money(0, value.currencyCode)}</span>)}</div></div>) : <div className="px-4 py-6 text-center text-[10px] text-[#5e7183]">No pipeline data</div>}</div></section>;
}

function ProspectForm({ prospectId, initialContactId }: { prospectId?: string; initialContactId?: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const detail = useGetProspect(prospectId ?? '', { query: { enabled: !!prospectId, queryKey: getGetProspectQueryKey(prospectId ?? ''), refetchOnMount: 'always' } });
  const stages = useListProspectStages();
  const products = useListProspectProducts();
  const currencies = useGetProspectCurrencies();
  const tags = useListContactTags();
  const [contactSearch, setContactSearch] = useState('');
  const contacts = useListContactOptions({ limit: 100, ...(contactSearch.trim() ? { search: contactSearch.trim() } : {}) });
  const initialContactQuery = useGetContact(initialContactId ?? '', { query: { enabled: Boolean(initialContactId), queryKey: getGetContactQueryKey(initialContactId ?? '') } });
  const create = useCreateProspect();
  const update = useUpdateProspect();
  const setTags = useSetProspectTags();
  const record = detail.data?.prospect;
  const [name, setName] = useState('');
  const [contactId, setContactId] = useState(initialContactId ?? '');
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [stageId, setStageId] = useState('');
  const [notes, setNotes] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  if (prospectId && record && !initialized) {
    setName(record.name); setContactId(record.contact.id); setProductId(record.product.id); setAmount(String(record.expectedDealValue)); setCurrency(record.currencyCode);
    setCloseDate(record.expectedClosureDate.slice(0, 10)); setStageId(record.currentStage.id); setNotes(record.notes); setTagIds(record.prospectTags.map(t => t.id)); setInitialized(true);
  }
  const isSetupReady = Boolean(stages.data?.some(s => s.active && s.stageType === 'active') && products.data?.some(p => p.active) && currencies.data?.currencies.length);
  const submit = (event: FormEvent) => {
    event.preventDefault(); setNotice(null);
    if (!prospectId) {
      const data: CreateProspectInput = { contactId, name: name.trim(), productId, expectedDealValue: Number(amount), currencyCode: currency || currencies.data?.defaultCurrencyCode || '', expectedClosureDate: closeDate, stageId, notes: notes.trim(), prospectTagIds: tagIds };
      create.mutate({ data }, { onSuccess: result => {
        void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactProspectsQueryKey(contactId) });
        setLocation(`/prospects/${encodeURIComponent(result.prospect.id)}`);
      }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    } else {
      update.mutate({ prospectId, data: { name: name.trim(), productId, expectedDealValue: Number(amount), currencyCode: currency || currencies.data?.defaultCurrencyCode || '', expectedClosureDate: closeDate, notes: notes.trim() } }, {
        onSuccess: () => {
          setTags.mutate({ prospectId, data: { tagIds } }, {
            onSuccess: () => {
              setNotice({ kind: 'success', text: 'Prospect details and tags saved.' });
              void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(prospectId) }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() });
            },
            onError: e => {
              setNotice({ kind: 'error', text: `Prospect details saved, but tags could not be updated: ${errText(e)}` });
              void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(prospectId) });
            },
          });
        }, onError: e => setNotice({ kind: 'error', text: errText(e) }),
      });
    }
  };
  if (detail.isLoading && prospectId) return <Loading label="Loading prospect details"/>;
  if (detail.isError && prospectId) return <ErrorState retry={() => void detail.refetch()}/>;
  const availableStages = (stages.data ?? []).filter(s => s.active && s.stageType === 'active');
  const activeProducts = (products.data ?? []).filter(p => p.active);
  const selectedContact = contacts.data?.contacts.find(c => c.id === contactId);
  const pending = create.isPending || update.isPending || setTags.isPending;
  return <form onSubmit={submit} className="space-y-4">
    {!isSetupReady && <div className="rounded-lg border border-[#ead8b9] bg-[#fffaf1] p-4 text-[11px] leading-5 text-[#7a603c]"><strong>Pipeline setup is incomplete.</strong> Configure at least one active stage, an active product or service, and one permitted currency before saving a prospect. <div className="mt-2 flex flex-wrap gap-3 font-semibold"><Link className="text-[#245b91] underline" href="/prospect-stages">Stages</Link><Link className="text-[#245b91] underline" href="/prospect-products">Products</Link><Link className="text-[#245b91] underline" href="/prospect-currencies">Currencies</Link></div></div>}
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <section className={`${panel} p-5`}>
      <div className="mb-4 border-b border-[#e9eef3] pb-3"><div className="mono text-[9px] font-semibold tracking-[.14em] text-[#71869a]">DEAL INFORMATION</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Opportunity details</h2></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className={label}>Prospect name <em className="not-italic text-[#b45743]">*</em></span><input required maxLength={180} className={field} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring campaign retainer" data-testid="input-prospect-name"/></label>
        {!prospectId && <div className="sm:col-span-2"><span className={label}>Existing contact <em className="not-italic text-[#b45743]">*</em></span><div className="grid gap-2 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]"><input className={field} value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Search by name, email or company" aria-label="Search contacts" data-testid="input-prospect-contact-search"/><select required className={field} value={contactId} onChange={e => setContactId(e.target.value)} data-testid="select-prospect-contact"><option value="">Choose a contact</option>{initialContactId && initialContactQuery.data && !contacts.data?.contacts.some(c => c.id === initialContactId) && <option value={initialContactQuery.data.id}>{initialContactQuery.data.name} · {initialContactQuery.data.email}</option>}{contacts.data?.contacts.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}{c.companyName ? ` · ${c.companyName}` : ''}</option>)}</select></div>{contacts.isLoading && <span className="mt-1 block text-[10px] text-[#77899b]">Searching contacts…</span>}{!contacts.data?.contacts.length && !initialContactQuery.data && <span className="mt-1 block text-[10px] text-[#9a6247]">No contacts match. Add a contact before creating a prospect.</span>}</div>}
        {prospectId && selectedContact && <div className="sm:col-span-2 rounded-lg bg-[#f5f8fb] p-3"><span className={label}>Linked contact · unchanged</span><div className="text-[12px] font-semibold text-[#344d66]">{selectedContact.name} · {selectedContact.email}</div></div>}
         <label><span className={label}>Product or service <em className="not-italic text-[#b45743]">*</em></span><select required className={field} value={productId} onChange={e => setProductId(e.target.value)} data-testid="select-prospect-product"><option value="">Choose a product or service</option>{activeProducts.map(p => <option key={p.id} value={p.id}>{p.itemType === 'service' ? 'Service' : 'Product'} · {p.name}{p.category ? ` · ${p.category}` : ''}</option>)}</select></label>
        {!prospectId && <label><span className={label}>Initial stage <em className="not-italic text-[#b45743]">*</em></span><select required className={field} value={stageId} onChange={e => setStageId(e.target.value)} data-testid="select-prospect-initial-stage"><option value="">Choose a stage</option>{availableStages.map(s => <option key={s.id} value={s.id}>{s.name} · {s.probability}%</option>)}</select></label>}
        <label><span className={label}>Expected deal value <em className="not-italic text-[#b45743]">*</em></span><input required min="0" step="0.0001" type="number" className={field} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" data-testid="input-prospect-value"/></label>
        <label><span className={label}>Currency <em className="not-italic text-[#b45743]">*</em></span><select required className={field} value={currency || currencies.data?.defaultCurrencyCode || ''} onChange={e => setCurrency(e.target.value)} data-testid="select-prospect-currency"><option value="">Choose a currency</option>{currencies.data?.currencies.map(c => <option key={c.code} value={c.code}>{c.code}{c.isDefault ? ' · default' : ''}</option>)}</select></label>
        <label><span className={label}>Expected closure date <em className="not-italic text-[#b45743]">*</em></span><input required type="date" className={field} value={closeDate} onChange={e => setCloseDate(e.target.value)} data-testid="input-prospect-close-date"/></label>
        <label className="sm:col-span-2"><span className={label}>Prospect notes <em className="not-italic text-[#b45743]">*</em></span><textarea required maxLength={20000} className="min-h-[108px] w-full resize-y rounded-lg border border-[#d7e0e9] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#1a2b40] outline-none focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6]" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Capture the context that belongs to this opportunity. Contact notes remain separate." data-testid="input-prospect-notes"/></label>
      </div>
    </section>
    <section className={`${panel} p-5`}><div className="mb-3"><div className="mono text-[9px] font-semibold tracking-[.14em] text-[#71869a]">SEGMENT / DEAL ONLY</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Prospect tags</h2><p className="mt-1 text-[10px] text-[#8290a0]">Select from the contact tag library. These tags apply to this prospect only and do not edit the contact.</p></div>
      {tags.isLoading ? <div className="h-9 animate-pulse rounded bg-[#edf2f7]"/> : tags.isError ? <div className="text-[11px] text-[#9b4837]">Tag library unavailable. <button type="button" className="underline" onClick={() => void tags.refetch()}>Retry</button></div> : tags.data?.length ? <div className="flex flex-wrap gap-2">{tags.data.map(tag => <label key={tag.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-semibold transition ${tagIds.includes(tag.id) ? 'border-[#9bbadb] bg-[#eef5fc] text-[#214f7e]' : 'border-[#e2e8ee] text-[#5d7084] hover:bg-[#f7f9fb]'}`}><input type="checkbox" checked={tagIds.includes(tag.id)} disabled={!tagIds.includes(tag.id) && tagIds.length >= 20} onChange={e => setTagIds(current => e.target.checked ? [...current, tag.id] : current.filter(id => id !== tag.id))} className="accent-[#174f91]" data-testid={`checkbox-prospect-tag-${tag.id}`}/>{tag.name}</label>)}</div> : <p className="text-[10px] text-[#8794a1]">There are no tags in the shared contact tag library yet.</p>}
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href={prospectId ? `/prospects/${prospectId}` : '/prospects'} className={smallBtn}><ArrowLeft className="h-3.5 w-3.5"/>Cancel</Link><button type="submit" disabled={pending || !isSetupReady || !contactId && !prospectId || !tags.data} className={primaryBtn}>{pending ? 'Saving…' : prospectId ? 'Save changes' : 'Create prospect'}<ArrowRight className="h-3.5 w-3.5"/></button></div>
  </form>;
}

export function NewProspectPage() {
  const params = new URLSearchParams(window.location.search);
  return <PageFrame><Heading eyebrow="PIPELINE / NEW OPPORTUNITY" title="Create a prospect" detail="Create a deal record attached to an existing contact. Contact profile data and campaign history remain untouched."/><ProspectForm initialContactId={params.get('contactId') ?? undefined}/></PageFrame>;
}

export function ProspectDetailPage() {
  const params = useParams<{ prospectId: string }>();
  const id = params.prospectId ?? '';
  const prospectQuery = useGetProspect(id, { query: { enabled: !!id, queryKey: getGetProspectQueryKey(id), refetchOnMount: 'always' } });
  const record = prospectQuery.data?.prospect;
  const [edit, setEdit] = useState(false);
  if (prospectQuery.isLoading) return <PageFrame><Loading label="Loading prospect"/></PageFrame>;
  if (prospectQuery.isError || !record) return <PageFrame><ErrorState retry={() => void prospectQuery.refetch()}/></PageFrame>;
  if (edit) return <PageFrame><Heading eyebrow="PIPELINE / EDIT OPPORTUNITY" title="Edit prospect" detail="Update deal-specific details and tags. The linked contact stays unchanged."/><ProspectForm key={id} prospectId={id}/></PageFrame>;
  return <PageFrame>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link href="/prospects" className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#526d86] no-underline hover:text-[#174f91]"><ArrowLeft className="h-3.5 w-3.5"/>All prospects</Link><div className="flex gap-2"><button type="button" onClick={() => setEdit(true)} className={smallBtn} data-testid="button-edit-prospect">Edit prospect</button><ArchiveProspect record={record}/></div></div>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><div className="mono mb-2 text-[9px] tracking-[.16em] text-[#70859a]">PROSPECT / {record.id.slice(0, 8)}</div><h1 className="display break-words text-[29px] font-bold text-[#172b43] sm:text-[35px]">{record.name}</h1><p className="mt-2 text-[12px] text-[#718093]">{record.product.itemType === 'service' ? 'Service' : 'Product'} · {record.product.name}{record.product.category ? ` · ${record.product.category}` : ''} · created {dateLabel(record.createdAt)} · updated {dateLabel(record.updatedAt)}</p></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${record.currentStage.stageType === 'terminal' ? 'bg-[#fff1ed] text-[#a04f3d]' : 'bg-[#edf4fc] text-[#245b91]'}`}>{record.currentStage.name} · {record.currentProbability}%</span></div>
    {record.archivedAt && <div className="mb-4"><Notice>Archived {dateLabel(record.archivedAt)}. This record is retained for history.</Notice></div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Expected deal value" value={money(record.expectedDealValue, record.currencyCode)} note={record.currencyCode} icon={<DollarSign className="h-4 w-4"/>}/>
      <Metric title="Expected closure" value={dateLabel(record.expectedClosureDate)} note={record.actualClosureDate ? `Closed ${dateLabel(record.actualClosureDate)}` : 'Target date'} icon={<CalendarDays className="h-4 w-4"/>}/>
      <Metric title="Current probability" value={`${record.currentProbability}%`} note={record.currentStage.name} icon={<Activity className="h-4 w-4"/>}/>
      <Metric title="Last activity" value={dateLabel(record.lastActivityAt)} note="Most recent recorded touch" icon={<Clock3 className="h-4 w-4"/>}/>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
      <div className="space-y-5">
        <StageChangePanel record={record}/>
        <div className="grid gap-5 lg:grid-cols-2"><ActionPanel prospectId={id} stageName={record.currentStage.name}/><AuditPanel prospectId={id}/></div>
        <section className={`${panel} p-5`}><div className="mono text-[9px] font-semibold tracking-[.14em] text-[#71869a]">OPPORTUNITY CONTEXT</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Prospect notes</h2><p className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-[#52667b]">{record.notes}</p></section>
      </div>
      <aside className="space-y-5">
        <section className={`${panel} overflow-hidden`}><header className="border-b border-[#d6e3ef] bg-[#edf4fb] px-4 py-3"><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">LINKED CONTACT / AUTHORITATIVE</div><h2 className="mt-1 text-[13px] font-bold text-[#263c53]">Contact record</h2></header><div className="p-4"><Link href={`/contacts/${encodeURIComponent(record.contact.id)}`} className="flex items-center gap-3 rounded-lg border border-[#e5ebf0] p-3 no-underline transition hover:bg-[#f7f9fb]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf3f8] text-[#355c80]"><UserRound className="h-4 w-4"/></span><span className="min-w-0 flex-1"><strong className="block truncate text-[12px] text-[#2b4259]">{record.contact.name}</strong><span className="block truncate text-[10px] text-[#7b8997]">{record.contact.email}</span>{record.contact.companyName && <span className="block truncate text-[10px] text-[#7b8997]">{record.contact.companyName}</span>}</span><ExternalLink className="h-3.5 w-3.5 text-[#7b8c9c]"/></Link><div className="mt-4"><div className="mb-2 text-[9px] font-bold uppercase tracking-[.1em] text-[#76899c]">Contact tags</div><TagStack tags={record.contact.tags} kind="Contact"/></div><div className="mt-4 border-t border-[#edf1f4] pt-4"><div className="mb-2 text-[9px] font-bold uppercase tracking-[.1em] text-[#76899c]">Prospect tags</div><TagStack tags={record.prospectTags} kind="Prospect"/></div><p className="mt-4 border-t border-[#edf1f4] pt-3 text-[9px] leading-4 text-[#8996a3]">Contact name, email, company, phone, notes, tags and campaign history are managed on the contact record.</p></div></section>
        <ClosurePanel record={record}/>
      </aside>
    </div>
  </PageFrame>;
}

function Metric({ title, value, note, icon }: { title: string; value: string; note: string; icon: ReactNode }) {
  return <div className={`${panel} p-4`}><div className="flex items-center justify-between text-[#6e8398]"><span className="text-[9px] font-bold uppercase tracking-[.1em]">{title}</span>{icon}</div><div className="mt-3 truncate text-[18px] font-bold tracking-[-.04em] text-[#213a55]">{value}</div><div className="mt-1 text-[9px] text-[#8391a0]">{note}</div></div>;
}
function StageChangePanel({ record }: { record: ProspectRecord }) {
  const qc = useQueryClient();
  const stages = useListProspectStages();
  const changeStage = useChangeProspectStage();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const current = stages.data?.find(s => s.id === record.currentStage.id) ?? record.currentStage;
  const permitted = current.allowedNextStageIds.length ? stages.data?.filter(s => current.allowedNextStageIds.includes(s.id) && s.active) : stages.data?.filter(s => s.active && s.id !== current.id);
  const transition = (e: FormEvent) => {
    e.preventDefault(); if (!target || reason.trim().length < 3) return;
    changeStage.mutate({ prospectId: record.id, data: { newStageId: target, reason: reason.trim() } }, { onSuccess: () => {
      setReason(''); setTarget(''); setNotice({ kind: 'success', text: 'Stage updated. The change and its reason were recorded in the growth audit.' });
      void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(record.id) }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() }); void qc.invalidateQueries({ queryKey: getListProspectGrowthAuditQueryKey(record.id) });
      void qc.invalidateQueries({ queryKey: getListContactProspectsQueryKey(record.contact.id) });
    }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
  };
  return <section className={`${panel} overflow-hidden`}><header className="border-b border-[#d6e3ef] bg-[#edf4fb] px-5 py-4"><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">STAGE / REQUIRED REASON</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Move this opportunity</h2></header><div className="p-5">
    <div className="mb-4 flex items-center gap-3"><span className="rounded-lg bg-[#edf4fb] px-3 py-2 text-[11px] font-bold text-[#2d5d8b]">{current.name}</span><ArrowRight className="h-3.5 w-3.5 text-[#95a2ae]"/><span className="text-[10px] text-[#77899a]">{current.probability}% probability</span></div>
    {notice && <div className="mb-3"><Notice kind={notice.kind}>{notice.text}</Notice></div>}
     {permitted?.length ? <form onSubmit={transition} className="space-y-5">
       <label className={masterFieldGroup}><span className={masterFieldLabel}>Next stage</span><select required className={field} value={target} onChange={e => setTarget(e.target.value)} data-testid="select-prospect-next-stage"><option value="">Choose allowed stage</option>{permitted.map(s => <option key={s.id} value={s.id}>{s.name} · {s.probability}%{s.terminalOutcome ? ` · ${s.terminalOutcome}` : ''}</option>)}</select></label>
       <label className={masterFieldGroup}><span className={masterFieldLabel}>Reason for change <em className="not-italic text-[#b45743]">required</em></span><textarea minLength={3} maxLength={4000} required className="min-h-[78px] w-full resize-y rounded-lg border border-[#d7e0e9] p-3 text-[11px] leading-5 outline-none focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6]" value={reason} onChange={e => setReason(e.target.value)} placeholder="What changed in the opportunity?" data-testid="input-prospect-stage-reason"/></label>
      <button type="submit" disabled={changeStage.isPending || !target || reason.trim().length < 3} className={primaryBtn}>{changeStage.isPending ? 'Updating stage…' : 'Confirm stage change'}<ArrowRight className="h-3.5 w-3.5"/></button>
    </form> : <div className="rounded-lg border border-dashed border-[#dbe3ea] bg-[#fafbfd] p-4 text-[10px] leading-5 text-[#7e8b98]">{current.stageType === 'terminal' ? 'No move out of this terminal outcome is currently allowed.' : 'No allowed next stages are configured.'} <Link href="/prospect-stages" className="font-bold text-[#245b91] underline">Update transitions in stage settings</Link>.</div>}
  </div></section>;
}
function ArchiveProspect({ record }: { record: ProspectRecord }) {
  const qc = useQueryClient();
  const update = useUpdateProspect();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const toggle = () => update.mutate({ prospectId: record.id, data: { archived: !record.archivedAt } }, { onSuccess: () => {
    setConfirm(false); setError(''); void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(record.id) }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() }); void qc.invalidateQueries({ queryKey: getListContactProspectsQueryKey(record.contact.id) });
  }, onError: e => setError(errText(e)) });
  return <div className="relative"><button type="button" className={record.archivedAt ? smallBtn : dangerBtn} onClick={() => setConfirm(v => !v)} disabled={update.isPending} data-testid="button-archive-prospect"><Archive className="h-3.5 w-3.5"/>{record.archivedAt ? 'Restore' : 'Archive'}</button>{confirm && <div className="absolute right-0 top-11 z-10 w-64 rounded-xl border border-[#dce4ed] bg-white p-4 shadow-xl"><div className="text-[11px] font-bold text-[#2a4058]">{record.archivedAt ? 'Restore this prospect?' : 'Archive this prospect?'}</div><p className="mt-1 text-[10px] leading-4 text-[#778697]">You can change this later. The prospect history remains intact.</p>{error && <p role="alert" className="mt-2 text-[10px] text-[#a14638]">{error}</p>}<div className="mt-3 flex justify-end gap-2"><button type="button" className={smallBtn} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className={record.archivedAt ? primaryBtn : dangerBtn} onClick={toggle} disabled={update.isPending}>{update.isPending ? 'Saving…' : record.archivedAt ? 'Restore' : 'Archive'}</button></div></div>}</div>;
}
function ClosurePanel({ record }: { record: ProspectRecord }) {
  const update = useUpdateProspect();
  const qc = useQueryClient();
  const [actualDate, setActualDate] = useState(record.actualClosureDate?.slice(0, 10) ?? '');
  const [remarks, setRemarks] = useState(record.closureRemarks ?? '');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setActualDate(record.actualClosureDate?.slice(0, 10) ?? '');
    setRemarks(record.closureRemarks ?? '');
    setNotice('');
  }, [record.id, record.actualClosureDate, record.closureRemarks]);
  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ prospectId: record.id, data: { actualClosureDate: actualDate || null, closureRemarks: remarks || null } }, { onSuccess: () => { setNotice('Closure details saved.'); void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(record.id) }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() }); }, onError: e => setNotice(errText(e)) });
  };
  return <section className={`${panel} p-4`}><div className="mono text-[9px] tracking-[.14em] text-[#71869a]">TERMINAL OUTCOME</div><h2 className="mt-1 text-[13px] font-bold text-[#263c53]">Closure record</h2><div className="mt-3 rounded-lg bg-[#f7f9fb] p-3"><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#8090a0]">Configured outcome</div><div className="mt-1 text-[12px] font-semibold text-[#394f65]">{record.closureOutcome || (record.currentStage.stageType === 'terminal' ? record.currentStage.terminalOutcome : null) || 'Not closed'}</div></div>{record.currentStage.stageType === 'terminal' && <form onSubmit={save} className="mt-4 space-y-5"><label className={masterFieldGroup}><span className={masterFieldLabel}>Actual closure date</span><input className={field} type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} data-testid="input-prospect-actual-close-date"/></label><label className={masterFieldGroup}><span className={masterFieldLabel}>Closure remarks</span><textarea className="min-h-[68px] w-full rounded-lg border border-[#d7e0e9] p-2.5 text-[11px] outline-none focus:border-[#4c80b8]" value={remarks} onChange={e => setRemarks(e.target.value)} data-testid="input-prospect-closure-remarks"/></label><button className={smallBtn} disabled={update.isPending} type="submit">{update.isPending ? 'Saving…' : 'Save closure details'}</button>{notice && <div role="status" className="text-[10px] text-[#56704f]">{notice}</div>}</form>}</section>;
}
function ActionPanel({ prospectId, stageName }: { prospectId: string; stageName: string }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ actionTypeId: '', fromDate: '', toDate: '' });
  const params = useMemo(() => ({ ...(filters.actionTypeId ? { actionTypeId: filters.actionTypeId } : {}), ...(filters.fromDate ? { fromDate: filters.fromDate } : {}), ...(filters.toDate ? { toDate: filters.toDate } : {}) }), [filters]);
  const actions = useListProspectActions(prospectId, params, { query: { queryKey: getListProspectActionsQueryKey(prospectId, params), refetchOnMount: 'always' } });
  const types = useListProspectActionTypes();
  const create = useCreateProspectAction();
  const [actionTypeId, setActionTypeId] = useState('');
  const [actionDate, setActionDate] = useState(localDateInput);
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ prospectId, data: { actionTypeId, actionDate, notes: notes.trim() } }, { onSuccess: () => {
    setNotes(''); setNotice({ kind: 'success', text: 'Activity recorded in the current stage period.' }); void qc.invalidateQueries({ queryKey: getListProspectActionsQueryKey(prospectId) }); void qc.invalidateQueries({ queryKey: getListProspectGrowthAuditQueryKey(prospectId) }); void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(prospectId) }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() });
  }, onError: e => setNotice({ kind: 'error', text: errText(e) }) }); };
  return <section className={`${panel} overflow-hidden`}><header className="border-b border-[#d6e3ef] bg-[#edf4fb] px-4 py-3"><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">STAGE-PERIOD ACTIVITY</div><h2 className="mt-1 text-[13px] font-bold text-[#263c53]">Actions</h2></header><div className="space-y-4 p-4">
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {types.data?.some(t => t.active) ? <form onSubmit={submit} className="space-y-4 rounded-lg bg-[#f7f9fb] p-4">
      <div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#74889c]">Add activity · {stageName}</div>
      <label className={masterFieldGroup}><span className={masterFieldLabel}>Action type</span><select className={field} required value={actionTypeId} onChange={e => setActionTypeId(e.target.value)} data-testid="select-prospect-action-type"><option value="">Choose an action</option>{types.data.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className={masterFieldGroup}><span className={masterFieldLabel}>Date</span><input type="date" required className={field} value={actionDate} onChange={e => setActionDate(e.target.value)} data-testid="input-prospect-action-date"/></label><label className={`${masterFieldGroup} sm:col-span-2`}><span className={masterFieldLabel}>Notes</span><textarea required maxLength={10000} className="min-h-[66px] w-full rounded-lg border border-[#d7e0e9] p-2.5 text-[11px] outline-none focus:border-[#4c80b8]" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened?" data-testid="input-prospect-action-notes"/></label></div>
      <button type="submit" className={primaryBtn} disabled={create.isPending || !actionTypeId}>{create.isPending ? 'Recording…' : 'Record action'}<Plus className="h-3.5 w-3.5"/></button>
    </form> : <div className="rounded-lg border border-dashed border-[#e2e7ec] p-3 text-[10px] leading-5 text-[#7b8997]">No active action types are set up. Configure them in <Link href="/prospect-actions" className="font-bold text-[#245b91] underline">action settings</Link>.</div>}
    <div className="grid gap-4 sm:grid-cols-3"><label className={masterFieldGroup}><span className={masterFieldLabel}>Type filter</span><select className={field} value={filters.actionTypeId} onChange={e => setFilters(f => ({ ...f, actionTypeId: e.target.value }))}><option value="">All</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className={masterFieldGroup}><span className={masterFieldLabel}>From</span><input className={field} type="date" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))}/></label><label className={masterFieldGroup}><span className={masterFieldLabel}>To</span><input className={field} type="date" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))}/></label></div>
    {actions.isLoading ? <div className="h-20 animate-pulse rounded bg-[#edf2f7]"/> : actions.isError ? <div role="alert" className="text-[10px] text-[#a04d3b]">Actions could not load. <button type="button" onClick={() => void actions.refetch()} className="font-bold underline">Retry</button></div> : actions.data?.length ? <ol className="max-h-[380px] space-y-2 overflow-y-auto">{actions.data.map(action => <li key={action.id} className="rounded-lg border border-[#e7edf2] p-3"><div className="flex justify-between gap-2"><div className="text-[10px] font-bold text-[#344e68]">{action.actionType.name}</div><time className="text-[9px] text-[#8290a0]">{dateLabel(action.actionDate)}</time></div><div className="mt-1 text-[9px] text-[#718398]">During {action.stageNameAtAction} · {action.recordedByName}</div><p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-[#53677b]">{action.notes}</p></li>)}</ol> : <div className="rounded-lg bg-[#fafbfd] px-3 py-5 text-center text-[10px] text-[#8794a1]">No actions match this stage period and filter.</div>}
    <button type="button" className={`${smallBtn} w-full`} onClick={() => { setFilters({ actionTypeId: '', fromDate: '', toDate: '' }); }}>Reset action filters</button>
  </div></section>;
}
function AuditPanel({ prospectId }: { prospectId: string }) {
  const query = useListProspectGrowthAudit(prospectId, { query: { enabled: !!prospectId, queryKey: getListProspectGrowthAuditQueryKey(prospectId), refetchOnMount: 'always' } });
  return <section className={`${panel} overflow-hidden`}><header className="border-b border-[#d6e3ef] bg-[#edf4fb] px-4 py-3"><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">IMMUTABLE GROWTH AUDIT</div><h2 className="mt-1 text-[13px] font-bold text-[#263c53]">Stage history</h2></header><div className="max-h-[560px] overflow-y-auto p-4">
    {query.isLoading ? <div className="space-y-2"><div className="h-20 animate-pulse rounded bg-[#edf2f7]"/><div className="h-20 animate-pulse rounded bg-[#edf2f7]"/></div> : query.isError ? <div role="alert" className="text-[10px] text-[#a04d3b]">Audit history unavailable. <button type="button" onClick={() => void query.refetch()} className="font-bold underline">Retry</button></div> : query.data?.length ? <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-[#dbe5ee]">{query.data.map(entry => <li key={entry.id} className="relative pl-6"><span className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-[3px] border-white bg-[#477eae] ring-1 ring-[#a9c3d9]"/><div className="text-[10px] font-bold text-[#354e67]">{entry.previousStage ? `${entry.previousStage.name} → ${entry.newStage.name}` : `Created in ${entry.newStage.name}`}</div><div className="mt-1 text-[9px] text-[#8290a0]">{dateLabel(entry.createdAt)} · {entry.changedByName} · {entry.newProbability}%</div>{entry.reason && <p className="mt-2 rounded-md bg-[#f7f9fb] p-2 text-[9px] leading-4 text-[#607387]">{entry.reason}</p>}{entry.notesSnapshot && <details className="mt-2"><summary className="cursor-pointer text-[9px] font-semibold text-[#35678f]">View note snapshot</summary><p className="mt-1 whitespace-pre-wrap text-[9px] leading-4 text-[#738394]">{entry.notesSnapshot}</p></details>}</li>)}</ol> : <div className="py-8 text-center text-[10px] text-[#8794a1]"><History className="mx-auto mb-2 h-4 w-4"/>No audit entries available.</div>}
  </div></section>;
}

export function ContactProspectsPanel({ contactId, contactName }: { contactId: string; contactName: string }) {
  const query = useListContactProspects(contactId, { query: { enabled: !!contactId, queryKey: getListContactProspectsQueryKey(contactId), refetchOnMount: 'always' } });
  return <section className={`${panel} overflow-hidden`} data-testid="section-contact-prospects"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8edf2] bg-[#fbfcfd] px-5 py-4"><div><div className="mono text-[9px] tracking-[.14em] text-[#71869a]">COMMERCIAL OPPORTUNITIES</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Linked prospects</h2></div><Link href={`/prospects/new?contactId=${encodeURIComponent(contactId)}`} className={primaryBtn} data-testid="link-convert-contact-to-prospect"><Plus className="h-3.5 w-3.5"/>Convert to Prospect</Link></header><div className="p-5">{query.isLoading ? <div className="h-20 animate-pulse rounded-lg bg-[#edf2f7]"/> : query.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#9b4837]"><span>Linked prospects could not be loaded.</span><button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button></div> : query.data?.length ? <div className="divide-y divide-[#edf1f4]">{query.data.map(p => <Link key={p.id} href={`/prospects/${encodeURIComponent(p.id)}`} className="flex flex-wrap items-center justify-between gap-3 py-3 no-underline first:pt-0 last:pb-0 hover:bg-[#fbfcfd]" data-testid={`link-contact-prospect-${p.id}`}><span><span className="block text-[12px] font-bold text-[#2b4d70]">{p.name}</span><span className="mt-1 block text-[10px] text-[#7d8b99]">{p.product.itemType === 'service' ? 'Service' : 'Product'} · {p.product.name} · {p.currentStage.name} · {p.currentProbability}%</span></span><span className="text-right"><strong className="block text-[12px] text-[#334a61]">{money(p.expectedDealValue, p.currencyCode)}</strong><span className="mt-1 block text-[9px] text-[#8794a1]">Expected {dateLabel(p.expectedClosureDate)}</span></span></Link>)}</div> : <div className="rounded-lg border border-dashed border-[#dbe3ea] bg-[#fafbfd] px-4 py-6 text-center"><div className="text-[12px] font-bold text-[#3b5066]">No prospect linked to {contactName}</div><p className="mt-1 text-[10px] text-[#84919f]">Create a separate deal without changing this contact’s record.</p></div>}</div></section>;
}

function SetupPage({ kind }: { kind: 'products' | 'stages' | 'actions' | 'currencies' }) {
  const qc = useQueryClient();
  const productQuery = useListProspectProducts();
  const productCategoriesQuery = useListProspectProductCategories({ query: { queryKey: getListProspectProductCategoriesQueryKey(), enabled: kind === 'products' } });
  const stageQuery = useListProspectStages();
  const actionQuery = useListProspectActionTypes();
  const currenciesQuery = useGetProspectCurrencies();
  const productCreate = useCreateProspectProduct(); const productUpdate = useUpdateProspectProduct();
  const categoryCreate = useCreateProspectProductCategory(); const categoryDelete = useDeleteProspectProductCategory();
  const stageCreate = useCreateProspectStage(); const stageUpdate = useUpdateProspectStage();
  const transitionUpdate = useSetProspectStageTransitions();
  const actionCreate = useCreateProspectActionType(); const actionUpdate = useUpdateProspectActionType();
  const currencyUpdate = useUpdateProspectCurrencies();
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [category, setCategory] = useState('');
  const [itemType, setItemType] = useState<'product' | 'service'>('product'); const [categoryDraft, setCategoryDraft] = useState('');
  const [probability, setProbability] = useState(''); const [outcome, setOutcome] = useState(''); const [stageType, setStageType] = useState<'active' | 'terminal'>('active');
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]); const [defaultCurrency, setDefaultCurrency] = useState('');
  const [currencyDraft, setCurrencyDraft] = useState('');
  const [currencyInitialized, setCurrencyInitialized] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const loading = kind === 'products' ? productQuery.isLoading || productCategoriesQuery.isLoading : kind === 'stages' ? stageQuery.isLoading : kind === 'actions' ? actionQuery.isLoading : currenciesQuery.isLoading;
  const failed = kind === 'products' ? productQuery.isError || productCategoriesQuery.isError : kind === 'stages' ? stageQuery.isError : kind === 'actions' ? actionQuery.isError : currenciesQuery.isError;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListProspectProductsQueryKey() }); void qc.invalidateQueries({ queryKey: getListProspectStagesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListProspectProductCategoriesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListProspectActionTypesQueryKey() }); void qc.invalidateQueries({ queryKey: getGetProspectCurrenciesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() }); void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() });
  };
  const title = { products: 'Products & services', stages: 'Pipeline stages', actions: 'Action types', currencies: 'Currencies' }[kind];
  const descriptions = { products: 'Choose whether each catalog item is a Product or Service, then group it with a built-in or custom category. Inactive items remain in past prospect history.', stages: 'Define stage probabilities, terminal outcomes, display order, and allowed transitions.', actions: 'Name the repeatable activity types your team records against stage periods.', currencies: 'Control permitted ISO 4217 currency codes. Values remain separate in every pipeline summary.' };
  const saveItem = (e: FormEvent) => {
    e.preventDefault(); setNotice(null);
    if (kind === 'products') {
      const data: ProspectProductInput = { name: name.trim(), itemType, description, category: category.trim() || null, active: true, displayOrder: (productQuery.data?.length ?? 0) };
      productCreate.mutate({ data }, { onSuccess: () => { setName(''); setDescription(''); setCategory(''); setItemType('product'); setNotice({ kind: 'success', text: 'Product or service added.' }); refresh(); }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    } else if (kind === 'stages') {
      const data: ProspectStageInput = { name: name.trim(), description, probability: Number(probability), stageType, terminalOutcome: stageType === 'terminal' ? outcome.trim() || null : null, active: true, displayOrder: stageQuery.data?.length ?? 0 };
      stageCreate.mutate({ data }, { onSuccess: () => { setName(''); setDescription(''); setProbability(''); setOutcome(''); setNotice({ kind: 'success', text: 'Stage created. Configure its outgoing transitions below.' }); refresh(); }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    } else {
      const data: ProspectActionTypeInput = { name: name.trim(), description, active: true, displayOrder: actionQuery.data?.length ?? 0 };
      actionCreate.mutate({ data }, { onSuccess: () => { setName(''); setDescription(''); setNotice({ kind: 'success', text: 'Action type created.' }); refresh(); }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    }
  };
  const saveCurrencies = (e: FormEvent) => {
    e.preventDefault(); setNotice(null);
    if (!selectedCurrencies.length || !defaultCurrency || !selectedCurrencies.includes(defaultCurrency)) { setNotice({ kind: 'error', text: 'Select at least one currency and choose a default from that selection.' }); return; }
    currencyUpdate.mutate({ data: { currencies: selectedCurrencies, defaultCurrencyCode: defaultCurrency } }, { onSuccess: () => { setNotice({ kind: 'success', text: 'Currency settings saved.' }); refresh(); }, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
  };
  const toggleActive = (id: string, active: boolean) => {
    if (kind === 'products') {
      const p = productQuery.data?.find(x => x.id === id); if (p) productUpdate.mutate({ productId: id, data: { name: p.name, itemType: p.itemType, description: p.description, category: p.category, active, displayOrder: p.displayOrder } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    } else if (kind === 'stages') {
      const s = stageQuery.data?.find(x => x.id === id); if (s) stageUpdate.mutate({ stageId: id, data: { name: s.name, description: s.description, probability: s.probability, stageType: s.stageType, terminalOutcome: s.terminalOutcome, active, displayOrder: s.displayOrder } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    } else {
      const a = actionQuery.data?.find(x => x.id === id); if (a) actionUpdate.mutate({ actionTypeId: id, data: { name: a.name, description: a.description, active, displayOrder: a.displayOrder } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    }
  };
  const stageOrder = (id: string, direction: -1 | 1) => {
    const rows = [...(stageQuery.data ?? [])]; const i = rows.findIndex(s => s.id === id); const j = i + direction; if (i < 0 || j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    stageUpdate.mutate({ stageId: a.id, data: { name: a.name, description: a.description, probability: a.probability, stageType: a.stageType, terminalOutcome: a.terminalOutcome, active: a.active, displayOrder: b.displayOrder } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
    stageUpdate.mutate({ stageId: b.id, data: { name: b.name, description: b.description, probability: b.probability, stageType: b.stageType, terminalOutcome: b.terminalOutcome, active: b.active, displayOrder: a.displayOrder } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) });
  };
  const currentCurrencies = currenciesQuery.data?.currencies ?? [];
  const addProductCategory = (e: FormEvent) => {
    e.preventDefault();
    const value = categoryDraft.trim();
    if (!value) return;
    categoryCreate.mutate({ data: { name: value } }, {
      onSuccess: () => {
        setCategoryDraft('');
        setNotice({ kind: 'success', text: 'Custom category added.' });
        void qc.invalidateQueries({ queryKey: getListProspectProductCategoriesQueryKey() });
      },
      onError: error => setNotice({ kind: 'error', text: errText(error) }),
    });
  };
  const removeProductCategory = (customCategory: ProspectProductCategory) => {
    categoryDelete.mutate({ categoryId: customCategory.id }, {
      onSuccess: () => {
        if (category === customCategory.name) setCategory('');
        setNotice({ kind: 'success', text: 'Custom category removed.' });
        void qc.invalidateQueries({ queryKey: getListProspectProductCategoriesQueryKey() });
      },
      onError: error => setNotice({ kind: 'error', text: errText(error) }),
    });
  };
  useEffect(() => {
    if (kind === 'currencies' && currenciesQuery.data && !currencyInitialized) {
      setSelectedCurrencies(currenciesQuery.data.currencies.map(c => c.code));
      setDefaultCurrency(currenciesQuery.data.defaultCurrencyCode ?? '');
      setCurrencyInitialized(true);
    }
  }, [kind, currenciesQuery.data?.defaultCurrencyCode, currenciesQuery.data?.currencies.map(c => c.code).join(','), currencyInitialized]);
  if (loading) return <PageFrame><Loading label={`Loading ${title.toLowerCase()}`}/></PageFrame>;
  if (failed) return <PageFrame><ErrorState retry={refresh}/></PageFrame>;
  const addCurrency = () => {
    const code = currencyDraft.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      setNotice({ kind: 'error', text: 'Enter a three-letter ISO currency code, such as USD or EUR.' });
      return;
    }
    setSelectedCurrencies(current => current.includes(code) ? current : [...current, code]);
    setCurrencyDraft('');
    setNotice(null);
  };
  const currenciesReady = selectedCurrencies.length > 0 || currentCurrencies.length > 0;
  return <PageFrame>
    <Heading eyebrow="PROSPECT SETUP / TENANT CONFIGURATION" title={title} detail={descriptions[kind]} action={<Link href="/prospects" className={smallBtn}><ArrowLeft className="h-3.5 w-3.5"/>Pipeline</Link>}/>
    <div className="mb-4 flex flex-wrap gap-2">{[['/prospect-products','Products'],['/prospect-stages','Stages'],['/prospect-actions','Action types'],['/prospect-currencies','Currencies']].map(([href, text]) => <Link key={href} href={href} className={`rounded-lg border px-3 py-2 text-[10px] font-semibold no-underline ${href === ({ products: '/prospect-products', stages: '/prospect-stages', actions: '/prospect-actions', currencies: '/prospect-currencies' }[kind]) ? 'border-[#a8c1d9] bg-[#edf4fb] text-[#235687]' : 'border-[#dce4ed] bg-white text-[#64788c] hover:bg-[#f7f9fb]'}`}>{text}</Link>)}</div>
    {notice && <div className="mb-4"><Notice kind={notice.kind}>{notice.text}</Notice></div>}
    {kind === 'currencies' ? <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.72fr)]">
      <section className={`${panel} p-5`}>
        <div className="mono text-[9px] tracking-[.14em] text-[#71869a]">TENANT CURRENCY POLICY</div>
        <h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Permitted codes</h2>
        <p className="mt-1 text-[10px] leading-5 text-[#8290a0]">Select ISO 4217 currency codes your team can use on prospects. The server validates codes when saved.</p>
        <form onSubmit={saveCurrencies} className="mt-5 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {[...new Set([...currentCurrencies.map(c => c.code), ...selectedCurrencies, 'USD','EUR','GBP','CAD','AUD','NZD','JPY','CHF','SGD','INR','AED','ZAR'])].map(code => (
              <label key={code} className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-3 text-[11px] font-semibold ${selectedCurrencies.includes(code) ? 'border-[#a4bfd8] bg-[#f0f6fb] text-[#2a5a84]' : 'border-[#e3e9ee] text-[#5e7081]'}`}>
                <span>{code}</span>
                <input type="checkbox" checked={selectedCurrencies.includes(code)} onChange={e => { setSelectedCurrencies(v => e.target.checked ? [...new Set([...v, code])] : v.filter(c => c !== code)); if (!e.target.checked && defaultCurrency === code) setDefaultCurrency(''); }} className="accent-[#174f91]" data-testid={`checkbox-currency-${code}`}/>
              </label>
            ))}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <label className={`${masterFieldGroup} min-w-0 flex-1`}>
              <span className={masterFieldLabel}>Add another ISO code</span>
              <input className={field} maxLength={3} value={currencyDraft} onChange={e => setCurrencyDraft(e.target.value.toUpperCase())} placeholder="e.g. SEK" data-testid="input-custom-currency"/>
            </label>
            <button type="button" className={smallBtn} onClick={addCurrency}>Add code</button>
          </div>
          <label className={masterFieldGroup}>
            <span className={masterFieldLabel}>Default currency</span>
            <select className={field} value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)}><option value="">Choose a default</option>{selectedCurrencies.map(code => <option key={code} value={code}>{code}</option>)}</select>
          </label>
          <button type="submit" className={primaryBtn} disabled={currencyUpdate.isPending || !currenciesReady}>{currencyUpdate.isPending ? 'Saving…' : 'Save currency settings'}<Check className="h-3.5 w-3.5"/></button>
        </form>
      </section>
      <section className={`${panel} p-5`}>
        <div className="mono text-[9px] tracking-[.14em] text-[#71869a]">CURRENT SETTINGS</div>
        <h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Active currency set</h2>
        <div className="mt-4 space-y-2">{currentCurrencies.length ? currentCurrencies.map(c => <div key={c.code} className="flex justify-between rounded-lg bg-[#f7f9fb] px-3 py-2 text-[11px]"><span className="font-semibold text-[#40576e]">{c.code}</span>{c.isDefault && <span className="rounded-full bg-[#eaf3ec] px-2 py-0.5 text-[9px] font-bold text-[#477255]">Default</span>}</div>) : <div className="rounded-lg border border-dashed border-[#dce4ed] px-3 py-6 text-center text-[10px] text-[#8290a0]">No currency settings yet.</div>}</div>
        <p className="mt-4 text-[10px] leading-5 text-[#8290a0]">Changing the default affects new prospect forms only; historical prospect values retain their currency code.</p>
      </section>
    </div> : <div className="grid items-start gap-5 xl:grid-cols-[minmax(290px,.7fr)_minmax(0,1.3fr)]">
      <section className={`${panel} p-5`}>
        <div className="mono text-[9px] tracking-[.14em] text-[#71869a]">NEW TENANT CONFIGURATION</div>
        <h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Add {kind === 'products' ? 'a product or service' : kind === 'stages' ? 'a stage' : 'an action type'}</h2>
        <form onSubmit={saveItem} className="mt-5 space-y-5">
          <label className={masterFieldGroup}>
            <span className={masterFieldLabel}>Name</span>
            <input required maxLength={160} className={field} value={name} onChange={e => setName(e.target.value)} data-testid={`input-new-${kind}-name`}/>
          </label>
          {kind === 'products' && <>
            <label className={masterFieldGroup}>
              <span className={masterFieldLabel}>Item type</span>
              <select required className={field} value={itemType} onChange={e => setItemType(e.target.value as 'product' | 'service')} data-testid="select-prospect-item-type">
                <option value="product">Product</option><option value="service">Service</option>
              </select>
            </label>
            <label className={masterFieldGroup}>
              <span className={masterFieldLabel}>Category</span>
              <select required className={field} value={category} onChange={e => setCategory(e.target.value)} data-testid="select-prospect-product-category">
                <option value="">Choose a category</option>
                <optgroup label="Built-in categories">{productCategoriesQuery.data?.filter(item => item.isSystem).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</optgroup>
                {!!productCategoriesQuery.data?.some(item => !item.isSystem) && <optgroup label="My categories">{productCategoriesQuery.data.filter(item => !item.isSystem).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</optgroup>}
              </select>
              <span className="text-[10px] leading-4 text-[#8290a0]">Built-in categories are always available. Add your own below.</span>
            </label>
          </>}
          {kind === 'stages' && <>
            <div className="grid grid-cols-2 gap-4">
              <label className={masterFieldGroup}>
                <span className={masterFieldLabel}>Probability</span>
                <input required min="0" max="100" type="number" className={field} value={probability} onChange={e => setProbability(e.target.value)} placeholder="0–100"/>
              </label>
              <label className={masterFieldGroup}>
                <span className={masterFieldLabel}>Stage kind</span>
                <select className={field} value={stageType} onChange={e => setStageType(e.target.value as 'active' | 'terminal')}><option value="active">Active</option><option value="terminal">Terminal</option></select>
              </label>
            </div>
            {stageType === 'terminal' && <label className={masterFieldGroup}>
              <span className={masterFieldLabel}>Terminal outcome</span>
              <input required className={field} value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Won, lost, disqualified"/>
            </label>}
          </>}
          <label className={masterFieldGroup}>
            <span className={masterFieldLabel}>Description</span>
            <textarea maxLength={10000} className="min-h-[80px] w-full rounded-lg border border-[#d7e0e9] p-3 text-[11px] leading-5 outline-none focus:border-[#4c80b8]" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional context for your team"/>
          </label>
          <button type="submit" disabled={productCreate.isPending || stageCreate.isPending || actionCreate.isPending} className={primaryBtn}><Plus className="h-3.5 w-3.5"/>Add {kind === 'products' ? 'item' : kind === 'stages' ? 'stage' : 'action type'}</button>
        </form>
        {kind === 'products' && <div className="mt-6 border-t border-[#e8edf2] pt-5">
          <div className="text-[11px] font-bold text-[#344b63]">Your custom categories</div>
          <p className="mt-1 text-[10px] leading-4 text-[#8290a0]">Add categories for your business. Built-in categories cannot be removed.</p>
          <form onSubmit={addProductCategory} className="mt-3 flex gap-2">
            <input maxLength={100} className={field} value={categoryDraft} onChange={e => setCategoryDraft(e.target.value)} placeholder="e.g. Data analytics" aria-label="New custom category"/>
            <button type="submit" className={smallBtn} disabled={categoryCreate.isPending || !categoryDraft.trim()}>{categoryCreate.isPending ? 'Adding…' : 'Add'}</button>
          </form>
          <div className="mt-3 space-y-2">
            {productCategoriesQuery.data?.filter(item => !item.isSystem).map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#f7f9fb] px-3 py-2">
              <span className="text-[10px] font-semibold text-[#52677c]">{item.name}</span>
              <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9a5245] hover:bg-[#fff0ec] disabled:opacity-50" aria-label={`Remove ${item.name}`} title="Remove custom category" disabled={categoryDelete.isPending} onClick={() => removeProductCategory(item)}><Trash2 className="h-3.5 w-3.5"/></button>
            </div>)}
            {!productCategoriesQuery.data?.some(item => !item.isSystem) && <div className="rounded-lg border border-dashed border-[#e1e7ed] px-3 py-3 text-center text-[10px] text-[#8996a3]">No custom categories yet.</div>}
          </div>
        </div>}
      </section>
      <section className={`${panel} overflow-hidden`}><header className="flex items-center justify-between border-b border-[#e8edf2] bg-[#fbfcfd] px-5 py-4"><div><div className="mono text-[9px] tracking-[.14em] text-[#71869a]">SAVED SETTINGS</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Configured {title.toLowerCase()}</h2></div><Settings2 className="h-4 w-4 text-[#65819b]"/></header>
        {kind === 'products' ? <div className="divide-y divide-[#edf1f4]">{productQuery.data?.length ? productQuery.data.map(p => <ProductSetupRow key={p.id} product={p} categories={productCategoriesQuery.data ?? []} onToggle={() => toggleActive(p.id, !p.active)} onError={e => setNotice({ kind: 'error', text: e })} onSaved={() => { setNotice({ kind: 'success', text: 'Product or service updated.' }); refresh(); }}/>) : <EmptySetup text="No products or services configured yet."/>}</div> :
        kind === 'actions' ? <div className="divide-y divide-[#edf1f4]">{actionQuery.data?.length ? actionQuery.data.map(a => <ActionTypeSetupRow key={a.id} action={a} onToggle={() => toggleActive(a.id, !a.active)} onError={e => setNotice({ kind: 'error', text: e })} onSaved={() => { setNotice({ kind: 'success', text: 'Action type updated.' }); refresh(); }}/>) : <EmptySetup text="No action types configured yet."/>}</div> :
        <div className="divide-y divide-[#edf1f4]">{stageQuery.data?.length ? stageQuery.data.map((s, index) => <StageSetupRow key={s.id} stage={s} index={index} allStages={stageQuery.data ?? []} onToggle={() => toggleActive(s.id, !s.active)} onOrder={direction => stageOrder(s.id, direction)} onSave={data => stageUpdate.mutate({ stageId: s.id, data }, { onSuccess: () => { setNotice({ kind: 'success', text: 'Stage settings updated.' }); refresh(); }, onError: e => setNotice({ kind: 'error', text: errText(e) }) })} onTransitions={(ids) => transitionUpdate.mutate({ stageId: s.id, data: { toStageIds: ids } }, { onSuccess: refresh, onError: e => setNotice({ kind: 'error', text: errText(e) }) })} busy={stageUpdate.isPending || transitionUpdate.isPending}/>) : <EmptySetup text="No stages configured yet."/>}</div>}
      </section>
    </div>}
  </PageFrame>;
}
function EmptySetup({ text }: { text: string }) {
  return <div className="px-5 py-12 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f0f4f7] text-[#69839b]"><Layers3 className="h-4 w-4"/></div><p className="mt-3 text-[11px] text-[#8290a0]">{text}</p></div>;
}
function ProductSetupRow({ product, categories, onToggle, onError, onSaved }: { product: { id: string; name: string; itemType: 'product' | 'service'; description: string; category: string | null; active: boolean; displayOrder: number }; categories: ProspectProductCategory[]; onToggle: () => void; onError: (message: string) => void; onSaved: () => void }) {
  const update = useUpdateProspectProduct();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(product.name); const [description, setDescription] = useState(product.description); const [category, setCategory] = useState(product.category ?? ''); const [itemType, setItemType] = useState<'product' | 'service'>(product.itemType);
  const save = (e: FormEvent) => { e.preventDefault(); update.mutate({ productId: product.id, data: { name: name.trim(), itemType, description, category: category.trim() || null, active: product.active, displayOrder: product.displayOrder } }, { onSuccess: () => { setEditing(false); onSaved(); }, onError: e => onError(errText(e)) }); };
   return <div className="px-5 py-4">{editing ? <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
     <label className={masterFieldGroup}><span className={masterFieldLabel}>Item name</span><input required className={field} value={name} onChange={e => setName(e.target.value)} aria-label="Item name"/></label>
     <label className={masterFieldGroup}><span className={masterFieldLabel}>Item type</span><select required className={field} value={itemType} onChange={e => setItemType(e.target.value as 'product' | 'service')} aria-label="Item type"><option value="product">Product</option><option value="service">Service</option></select></label>
     <label className={masterFieldGroup}><span className={masterFieldLabel}>Category</span><select required className={field} value={category} onChange={e => setCategory(e.target.value)} aria-label="Item category"><option value="">Choose a category</option><optgroup label="Built-in categories">{categories.filter(item => item.isSystem).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</optgroup>{categories.some(item => !item.isSystem) && <optgroup label="My categories">{categories.filter(item => !item.isSystem).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</optgroup>}</select></label>
     <label className={`${masterFieldGroup} sm:col-span-2`}><span className={masterFieldLabel}>Description</span><textarea className="min-h-[64px] rounded-lg border border-[#d7e0e9] p-2.5 text-[11px]" value={description} onChange={e => setDescription(e.target.value)} aria-label="Item description"/></label>
     <div className="flex gap-2 sm:col-span-2"><button className={primaryBtn} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save item'}</button><button type="button" className={smallBtn} onClick={() => setEditing(false)}>Cancel</button></div>
   </form> : <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#344b63]">{product.name}<span className="rounded-full bg-[#edf4fb] px-2 py-0.5 text-[9px] font-semibold uppercase text-[#3a668e]">{product.itemType}</span></div><div className="mt-1 text-[10px] text-[#8190a0]">{product.category || 'Uncategorized'}{product.description ? ` · ${product.description}` : ''}</div></div><div className="flex gap-2"><button type="button" className={smallBtn} onClick={() => setEditing(true)}>Edit</button><button type="button" className={product.active ? smallBtn : dangerBtn} onClick={onToggle} disabled={update.isPending}>{product.active ? 'Active · deactivate' : 'Inactive · activate'}</button></div></div>}</div>;
}
function ActionTypeSetupRow({ action, onToggle, onError, onSaved }: { action: { id: string; name: string; description: string; active: boolean; displayOrder: number }; onToggle: () => void; onError: (message: string) => void; onSaved: () => void }) {
  const update = useUpdateProspectActionType();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(action.name); const [description, setDescription] = useState(action.description);
  const save = (e: FormEvent) => { e.preventDefault(); update.mutate({ actionTypeId: action.id, data: { name: name.trim(), description, active: action.active, displayOrder: action.displayOrder } }, { onSuccess: () => { setEditing(false); onSaved(); }, onError: e => onError(errText(e)) }); };
   return <div className="px-5 py-4">{editing ? <form onSubmit={save} className="space-y-5">
     <label className={masterFieldGroup}><span className={masterFieldLabel}>Action type name</span><input required className={field} value={name} onChange={e => setName(e.target.value)} aria-label="Action type name"/></label>
     <label className={masterFieldGroup}><span className={masterFieldLabel}>Description</span><textarea className="min-h-[64px] w-full rounded-lg border border-[#d7e0e9] p-2.5 text-[11px]" value={description} onChange={e => setDescription(e.target.value)} aria-label="Action type description"/></label>
     <div className="flex gap-2"><button className={primaryBtn} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save action type'}</button><button type="button" className={smallBtn} onClick={() => setEditing(false)}>Cancel</button></div>
   </form> : <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[12px] font-bold text-[#344b63]">{action.name}</div><div className="mt-1 text-[10px] text-[#8190a0]">{action.description || 'No description'}</div></div><div className="flex gap-2"><button type="button" className={smallBtn} onClick={() => setEditing(true)}>Edit</button><button type="button" className={action.active ? smallBtn : dangerBtn} onClick={onToggle} disabled={update.isPending}>{action.active ? 'Active · deactivate' : 'Inactive · activate'}</button></div></div>}</div>;
}
function StageSetupRow({ stage, index, allStages, onToggle, onOrder, onSave, onTransitions, busy }: { stage: { id: string; name: string; description: string; probability: number; stageType: 'active' | 'terminal'; terminalOutcome: string | null; displayOrder: number; active: boolean; allowedNextStageIds: string[] }; index: number; allStages: Array<{ id: string; name: string; active: boolean }>; onToggle: () => void; onOrder: (direction: -1 | 1) => void; onSave: (data: ProspectStageInput) => void; onTransitions: (ids: string[]) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nextIds, setNextIds] = useState(stage.allowedNextStageIds);
  const [name, setName] = useState(stage.name); const [description, setDescription] = useState(stage.description); const [probability, setProbability] = useState(String(stage.probability)); const [stageType, setStageType] = useState<'active' | 'terminal'>(stage.stageType); const [outcome, setOutcome] = useState(stage.terminalOutcome ?? '');
  const save = (e: FormEvent) => { e.preventDefault(); onSave({ name: name.trim(), description, probability: Number(probability), stageType, terminalOutcome: stageType === 'terminal' ? outcome.trim() || null : null, active: stage.active, displayOrder: stage.displayOrder }); setEditing(false); };
   return <div className="px-5 py-4">
     {editing ? <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
       <label className={masterFieldGroup}><span className={masterFieldLabel}>Stage name</span><input required className={field} value={name} onChange={e => setName(e.target.value)} aria-label="Stage name"/></label>
       <label className={masterFieldGroup}><span className={masterFieldLabel}>Probability</span><input required min="0" max="100" type="number" className={field} value={probability} onChange={e => setProbability(e.target.value)} aria-label="Stage probability"/></label>
       <label className={masterFieldGroup}><span className={masterFieldLabel}>Stage kind</span><select className={field} value={stageType} onChange={e => setStageType(e.target.value as 'active' | 'terminal')} aria-label="Stage type"><option value="active">Active</option><option value="terminal">Terminal</option></select></label>
       {stageType === 'terminal' && <label className={masterFieldGroup}><span className={masterFieldLabel}>Terminal outcome</span><input required className={field} value={outcome} onChange={e => setOutcome(e.target.value)} aria-label="Terminal outcome"/></label>}
       <label className={`${masterFieldGroup} sm:col-span-2`}><span className={masterFieldLabel}>Description</span><textarea className="min-h-[64px] rounded-lg border border-[#d7e0e9] p-2.5 text-[11px]" value={description} onChange={e => setDescription(e.target.value)} aria-label="Stage description"/></label>
       <div className="flex gap-2 sm:col-span-2"><button className={primaryBtn} disabled={busy}>Save stage</button><button type="button" className={smallBtn} onClick={() => setEditing(false)}>Cancel</button></div>
     </form> : <>
       <div className="flex flex-wrap items-start justify-between gap-3">
         <div className="min-w-0">
           <div className="flex flex-wrap items-center gap-2">
             <span className="text-[12px] font-bold text-[#344b63]">{stage.name}</span>
             <span className="mono rounded bg-[#f1f5f8] px-2 py-1 text-[9px] text-[#5f7890]">{stage.probability}%</span>
             <span className={`rounded-full px-2 py-1 text-[8px] font-bold ${stage.stageType === 'terminal' ? 'bg-[#fff1ed] text-[#a04f3d]' : 'bg-[#edf4fc] text-[#245b91]'}`}>{stage.stageType === 'terminal' ? stage.terminalOutcome || 'Terminal' : 'Active stage'}</span>
             {!stage.active && <span className="text-[9px] text-[#9a604b]">Inactive</span>}
           </div>
           <div className="mt-1 text-[10px] text-[#8190a0]">Order {stage.displayOrder}{stage.description ? ` · ${stage.description}` : ''}</div>
         </div>
         <div className="flex flex-wrap gap-1.5">
           <button type="button" className={smallBtn} aria-label="Move stage up" disabled={busy || index === 0} onClick={() => onOrder(-1)}>↑</button>
           <button type="button" className={smallBtn} aria-label="Move stage down" disabled={busy || index === allStages.length - 1} onClick={() => onOrder(1)}>↓</button>
           <button type="button" className={smallBtn} onClick={() => setEditing(true)}>Edit</button>
           <button type="button" className={smallBtn} onClick={() => setOpen(v => !v)}><ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}/>Transitions</button>
           <button type="button" className={stage.active ? smallBtn : dangerBtn} onClick={onToggle} disabled={busy}>{stage.active ? 'Deactivate' : 'Activate'}</button>
         </div>
       </div>
       {open && <div className="mt-4 rounded-lg border border-[#e5ebf0] bg-[#fafbfd] p-3">
         <div className="flex flex-wrap items-center justify-between gap-2">
           <div><div className="text-[10px] font-bold text-[#40566c]">Allowed next stages</div><p className="mt-1 text-[9px] text-[#8290a0]">No selected stages means any active stage is allowed.</p></div>
           <button type="button" className={primaryBtn} disabled={busy} onClick={() => onTransitions(nextIds.filter(id => allStages.some(s => s.id === id && s.active)))}>Save transitions</button>
         </div>
         <div className="mt-3 flex flex-wrap gap-2">{allStages.filter(s => s.active && s.id !== stage.id).map(s => <label key={s.id} className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-2 text-[9px] ${nextIds.includes(s.id) ? 'border-[#a8bfd6] bg-[#edf4fb] text-[#2c5d87]' : 'border-[#e1e7ed] text-[#697b8d]'}`}><input type="checkbox" checked={nextIds.includes(s.id)} onChange={e => setNextIds(v => e.target.checked ? [...v, s.id] : v.filter(x => x !== s.id))} className="accent-[#174f91]"/>{s.name}</label>)}</div>
       </div>}
     </>}
   </div>;
}
export function ProspectProductsPage() { return <SetupPage kind="products"/>; }
export function ProspectStagesPage() { return <SetupPage kind="stages"/>; }
export function ProspectActionsPage() { return <SetupPage kind="actions"/>; }
export function ProspectCurrenciesPage() { return <SetupPage kind="currencies"/>; }
