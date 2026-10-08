import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, History, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import {
  getGetCompanyIntelligenceQueryKey, getGetCompanyIntelligenceVersionQueryKey, getListAdminGlobalCompaniesQueryKey,
  useGetCompanyIntelligence, useGetCompanyIntelligenceVersion, useStartCompanyResearch,
} from '@workspace/api-client-react';
import type { CompanyIntelligenceVersion, IntelligenceFactSource, IntelligenceSource } from '@workspace/api-client-react';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';

const card = 'rounded-lg border border-[#e0e4e9] bg-white';
const label = 'mono text-[11px] uppercase tracking-[.12em] text-[#667386]';
const errText = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Please try again.';
export const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
const pct = (n: number) => `${Math.round(n * 100)}%`;
const human = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const depthNames = ['Basic', 'Standard', 'Deep'];
const POLL_WINDOW_MS = 15 * 60_000;

export function FreshnessBadge({ freshness, status }: { freshness: string; status?: string }) {
  const active = status === 'queued' || status === 'running';
  const text = active ? human(status!) : human(freshness);
  const tone = active ? 'bg-[#edf4fc] text-[#245b9b]' : freshness === 'fresh' ? 'bg-[#eaf6ef] text-[#2d704b]' : freshness === 'aging' ? 'bg-[#fff3e8] text-[#a95218]' : freshness === 'stale' ? 'bg-[#fdeee8] text-[#a2431f]' : 'bg-[#f0f2f4] text-[#66717e]';
  return <span data-testid={`status-freshness-${freshness}`} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{text}</span>;
}

function Cite({ ids, sources }: { ids: string[]; sources: Map<string, IntelligenceSource & { n: number }> }) {
  return <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">{ids.map(id => {
    const s = sources.get(id);
    return s ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" title={`${s.title} - ${s.publisher}`} data-testid={`link-cite-${id}`} className="rounded bg-[#edf4fc] px-1 text-[10px] font-semibold text-[#245b9b] no-underline hover:bg-[#dbe8f7]">[{s.n}]</a> : <span key={id} className="rounded bg-[#f0f2f4] px-1 text-[10px] text-[#8a96a4]">[?]</span>;
  })}</span>;
}

function Section({ title, kicker, children, testId }: { title: ReactNode; kicker?: string; children: ReactNode; testId: string }) {
  return <section data-testid={testId} className={`${card} overflow-hidden`}><header className="border-b border-[#e8edf1] bg-[#fbfcfd] px-5 py-3.5">{kicker && <div className={label}>{kicker}</div>}<h3 className="text-[14px] font-bold text-[#223247]">{title}</h3></header><div className="p-5">{children}</div></section>;
}

function Chips({ items, citation }: { items: string[]; citation?: (index: number) => ReactNode }) {
  return items.length ? <div className="flex flex-wrap gap-1.5">{items.map((i, k) => <span key={`${i}-${k}`} className="rounded-md bg-[#f1f4f7] px-2 py-1 text-[12px] text-[#3b4d61]">{i}{citation?.(k)}</span>)}</div> : <span className="text-[12px] text-[#667386]">Unknown</span>;
}

function Profile({ version }: { version: CompanyIntelligenceVersion }) {
  const p = version.profile;
  const sources = useMemo(() => new Map(p.sources.map((s, i) => [s.source_id, { ...s, n: i + 1 }])), [p.sources]);
  const facts = useMemo(() => new Map<string, IntelligenceFactSource>(p.fact_sources.map(f => [f.path, f])), [p.fact_sources]);
  const signals = useMemo(() => [...p.current_signals].sort((a, b) => +new Date(b.event_date) - +new Date(a.event_date)), [p.current_signals]);
  const val = (v: string | number | null | undefined) => v === null || v === undefined || v === '' ? <span className="text-[#9aa4af]">Unknown</span> : v;
  const fact = (path: string) => { const f = facts.get(path); return f ? <><span className="ml-1 text-[10px] text-[#8a96a4]">{pct(f.confidence)}</span><Cite ids={f.source_ids} sources={sources} /></> : null; };
  const profileRows: Array<[string, string, string | number | null]> = [
    ['Industry', 'industry', p.company_profile.industry], ['Sub-industry', 'sub_industry', p.company_profile.sub_industry], ['Type', 'company_type', p.company_profile.company_type],
    ['Founded', 'founded_year', p.company_profile.founded_year], ['Headquarters', 'headquarters', p.company_profile.headquarters], ['Employees', 'employee_range', p.company_profile.employee_range],
    ['Revenue', 'revenue_range', p.company_profile.revenue_range], ['Ownership', 'ownership', p.company_profile.ownership], ['Parent company', 'parent_company', p.company_profile.parent_company],
  ];
  const techEntries = Object.entries(p.technology).filter(([, v]) => v.length);
  const salesEntries = Object.entries(p.sales_intelligence).filter(([, v]) => v.length);
  return <div className="space-y-4" data-testid="panel-intelligence-profile">
    <Section testId="section-executive-summary" kicker="EXECUTIVE SUMMARY" title={<>{p.executive_summary.one_liner || 'Summary unknown'}{fact('executive_summary.one_liner')}</>}>
      <p className="text-[12px] leading-6 text-[#3b4d61]">{p.executive_summary.business_summary || 'Unknown'}{fact('executive_summary.business_summary')}</p>
      {p.executive_summary.key_observations.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] leading-5 text-[#4c5d70]">{p.executive_summary.key_observations.map((o, i) => <li key={i}>{o}{fact(`executive_summary.key_observations.${i}`)}</li>)}</ul>}
    </Section>
    <div className="grid gap-4 lg:grid-cols-2">
      <Section testId="section-company-profile" kicker="COMPANY PROFILE" title="Organization">
        <dl className="grid gap-x-4 sm:grid-cols-2">{profileRows.map(([l, path, v]) => <div key={path} className="border-b border-[#edf0f2] py-2.5"><dt className={label}>{l}</dt><dd className="mt-1 text-[12px] text-[#3b4d61]">{val(v)}{fact(`company_profile.${path}`)}</dd></div>)}</dl>
        <div className="mt-3"><div className={`${label} mb-1.5`}>OPERATING REGIONS</div><Chips items={p.company_profile.operating_regions} citation={i => fact(`company_profile.operating_regions.${i}`)} /></div>
      </Section>
      <Section testId="section-business" kicker="BUSINESS" title="How it operates">
        <p className="text-[12px] leading-5 text-[#3b4d61]">{val(p.business.business_model)}{fact('business.business_model')}</p>
        <p className="mt-2 text-[12px] leading-5 text-[#637285]">{val(p.business.competitive_position)}{fact('business.competitive_position')}</p>
        {([['Products and services', 'products_services', p.business.products_services], ['Customer segments', 'customer_segments', p.business.customer_segments], ['Key markets', 'key_markets', p.business.key_markets], ['Business units', 'business_units', p.business.business_units]] as Array<[string, string, string[]]>).map(([l, path, items]) => <div key={l} className="mt-3"><div className={`${label} mb-1.5`}>{l}</div><Chips items={items} citation={i => fact(`business.${path}.${i}`)} /></div>)}
      </Section>
    </div>
    <Section testId="section-technology" kicker="TECHNOLOGY" title="Technology by category">
      {techEntries.length ? <div className="grid gap-4 sm:grid-cols-2">{techEntries.map(([cat, items]) => <div key={cat}><div className={`${label} mb-1.5`}>{human(cat)}</div><ul className="space-y-1">{items.map((t, i) => <li key={i} className="text-[12px] text-[#3b4d61]">{t.name}<span className="ml-1 text-[10px] text-[#8a96a4]">{pct(t.confidence)}</span><Cite ids={t.source_ids} sources={sources} /></li>)}</ul></div>)}</div> : <p className="text-[12px] text-[#9aa4af]">No technology found. Unknown.</p>}
    </Section>
    <Section testId="section-signals" kicker="CURRENT SIGNALS / NEWEST FIRST" title="Dated signals">
      {signals.length ? <ol className="space-y-3">{signals.map(s => <li key={s.signal_id} data-testid={`row-signal-${s.signal_id}`} className="rounded-md border border-[#edf0f2] p-3"><div className="flex flex-wrap items-center gap-2 text-[10px]"><span className="font-semibold text-[#245b9b]">{fmtDate(s.event_date)}</span><span className="rounded bg-[#f1f4f7] px-1.5 py-0.5 text-[#55708e]">{human(s.type)}</span><span className="text-[#8a96a4]">{human(s.importance)} importance · {pct(s.confidence)}</span></div><div className="mt-1 text-[12px] font-semibold text-[#223247]">{s.title}</div><p className="mt-1 text-[12px] leading-5 text-[#4c5d70]">{s.description}<Cite ids={s.source_ids} sources={sources} /></p>{s.sales_relevance.length > 0 && <div className="mt-2"><Chips items={s.sales_relevance} /></div>}</li>)}</ol> : <p className="text-[12px] text-[#9aa4af]">No dated signals found.</p>}
    </Section>
    <Section testId="section-opportunities" kicker="INFERENCE, NOT FACT" title="AI-Identified Opportunities">
      <p className="mb-3 rounded-md bg-[#fff8f1] px-3 py-2 text-[11px] text-[#99501e]">These are AI inferences drawn from the sources. Treat them as hypotheses to verify, not confirmed facts.</p>
      {p.opportunity_signals.length ? <ul className="space-y-3">{p.opportunity_signals.map(o => <li key={o.opportunity_id} data-testid={`row-opportunity-${o.opportunity_id}`} className="rounded-md border border-dashed border-[#e6c9ae] p-3"><div className="text-[10px] text-[#a95218]">{human(o.type)} · inferred · {pct(o.confidence)}</div><p className="mt-1 text-[12px] leading-5 text-[#3b4d61]">{o.statement}<Cite ids={o.source_ids} sources={sources} /></p>{o.basis.length > 0 && <p className="mt-1 text-[11px] text-[#8a96a4]">Basis: {o.basis.join('; ')}</p>}</li>)}</ul> : <p className="text-[12px] text-[#9aa4af]">None identified.</p>}
    </Section>
    <div className="grid gap-4 lg:grid-cols-2">
      <Section testId="section-sales-intelligence" kicker="SALES INTELLIGENCE" title="For outreach">
        {salesEntries.length ? salesEntries.map(([k, claims]) => <div key={k} className="mb-3 last:mb-0"><div className={`${label} mb-1.5`}>{human(k)}</div><ul className="space-y-1.5">{claims.map((c, i) => <li key={i} className="text-[12px] leading-5 text-[#3b4d61]">{c.statement}<span className="ml-1 text-[10px] text-[#8a96a4]">{pct(c.confidence)}</span><Cite ids={c.source_ids} sources={sources} /></li>)}</ul></div>) : <p className="text-[12px] text-[#9aa4af]">Unknown.</p>}
      </Section>
      <Section testId="section-competitors" kicker="COMPETITORS" title="Competitive set">
        {p.competitors.length ? <ul className="space-y-2">{p.competitors.map((c, i) => <li key={i} className="text-[12px] text-[#3b4d61]"><span className="font-semibold">{c.name}</span> <span className="text-[10px] text-[#8a96a4]">{human(c.relationship)} · {c.category} · {pct(c.confidence)}</span><Cite ids={c.source_ids} sources={sources} /></li>)}</ul> : <p className="text-[12px] text-[#9aa4af]">Unknown.</p>}
      </Section>
    </div>
    {p.conflicts.length > 0 && <Section testId="section-conflicts" kicker="CONFLICTS" title="Sources disagree"><ul className="space-y-2">{p.conflicts.map((c, i) => <li key={i} className="text-[12px] leading-5 text-[#3b4d61]">{c.statement}<Cite ids={c.source_ids} sources={sources} /></li>)}</ul></Section>}
    <Section testId="section-sources" kicker="SOURCES" title={`${p.sources.length} source${p.sources.length === 1 ? '' : 's'}`}>
      <ol className="space-y-2">{[...sources.values()].map(s => <li key={s.source_id} className="flex gap-2 text-[12px]"><span className="mono w-6 shrink-0 text-[#8a96a4]">[{s.n}]</span><span className="min-w-0"><a href={s.url} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${s.source_id}`} className="inline-flex items-center gap-1 break-words font-semibold text-[#245b9b] no-underline hover:underline">{s.title || s.url}<ExternalLink className="h-3 w-3 shrink-0" /></a><span className="block text-[10px] text-[#8a96a4]">{s.publisher} · {human(s.source_type)} · {human(s.reliability)} reliability · published {fmtDate(s.published_date)} · accessed {fmtDate(s.accessed_at)}</span></span></li>)}</ol>
    </Section>
  </div>;
}

export function CompanyIntelligencePanel({ globalCompanyId }: { globalCompanyId: string }) {
  const qc = useQueryClient();
  const key = getGetCompanyIntelligenceQueryKey(globalCompanyId);
  const query = useGetCompanyIntelligence(globalCompanyId, { query: {
    queryKey: key, staleTime: 15_000,
    refetchInterval: q => {
      const job = q.state.data?.latestJob;
      return job && (job.status === 'queued' || job.status === 'running') && Date.now() - +new Date(job.createdAt) < POLL_WINDOW_MS ? 4000 : false;
    },
  } });
  const start = useStartCompanyResearch();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [depth, setDepth] = useState(1);
  const [override, setOverride] = useState(false);
  const [selected, setSelected] = useState('');
  const [startError, setStartError] = useState('');
  const data = query.data;
  const current = data?.current ?? null;
  const viewingOld = !!selected && !!current && selected !== current.id;
  const versionQuery = useGetCompanyIntelligenceVersion(globalCompanyId, selected, { query: { enabled: viewingOld, queryKey: getGetCompanyIntelligenceVersionQueryKey(globalCompanyId, selected), staleTime: 60_000 } });
  const job = data?.latestJob ?? null;
  const active = job?.status === 'queued' || job?.status === 'running';
  const pollingExpired = active && Date.now() - +new Date(job.createdAt) >= POLL_WINDOW_MS;
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = job?.status;
    if (lastStatus.current && lastStatus.current !== s && (s === 'completed' || s === 'failed')) void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() });
    lastStatus.current = s;
  }, [job?.status, qc]);

  if (query.isLoading) return <div data-testid="loading-intelligence" aria-label="Loading company intelligence" className="space-y-3"><div className="h-24 animate-pulse rounded-lg bg-[#f1f3f5]" /><div className="h-48 animate-pulse rounded-lg bg-[#f1f3f5]" /></div>;
  if (query.isError || !data) return <div role="alert" data-testid="error-intelligence" className={`${card} flex items-center justify-between gap-3 p-5`}><span className="flex items-center gap-2 text-[13px] font-semibold"><CircleAlert className="h-4 w-4 text-[#cd732f]" />Company intelligence could not be loaded</span><button type="button" data-testid="button-retry-intelligence" onClick={() => void query.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button></div>;

  const fresh = data.summary.freshness === 'fresh' && !!current;
  const maxDepth = Math.max(1, Math.min(3, data.maxResearchDepth));
  const depthOk = (d: number) => d <= maxDepth && (d < 3 || data.deepResearchEnabled);
  const verb = job?.status === 'failed' ? 'Retry Research' : data.summary.freshness === 'stale' ? 'Research Update' : current ? 'Re-research' : 'Research';
  const shown = viewingOld ? versionQuery.data : current;
  const confirm = () => {
    setStartError('');
    start.mutate({ globalCompanyId, data: { confirmed: true, overrideFresh: fresh && override, depth } }, {
      onSuccess: queued => { setConfirmOpen(false); setOverride(false); qc.setQueryData(key, { ...data, latestJob: queued, summary: { ...data.summary, status: queued.status } }); void qc.invalidateQueries({ queryKey: key }); },
      onError: e => { setConfirmOpen(false); setStartError(errText(e)); },
    });
  };
  return <section data-testid="panel-company-intelligence" className="space-y-4">
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className={label}>COMPANY INTELLIGENCE</div><h2 className="mt-1 flex items-center gap-2 text-[16px] font-bold text-[#223247]"><Sparkles className="h-4 w-4 text-[#245b9b]" />{data.companyName}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#758394]"><FreshnessBadge freshness={data.summary.freshness} status={data.summary.status} /><span data-testid="text-last-researched">Last researched {fmtDate(data.summary.researchedAt)}</span><span data-testid="text-source-count">{data.summary.sourceCount} sources</span></div></div>
        <button type="button" data-testid="button-research" aria-describedby={!data.researchAvailable ? 'status-research-unavailable' : undefined} disabled={active || start.isPending || !data.researchAvailable} onClick={() => { setStartError(''); setDepth(1); setOverride(false); setConfirmOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[13px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55">{active ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{active ? (job?.status === 'queued' ? 'Queued' : 'Researching') : verb}</button>
      </div>
      {!data.researchAvailable && <p id="status-research-unavailable" data-testid="status-research-unavailable" className="mt-3 rounded-md bg-[#fff8f1] px-3 py-2 text-[12px] text-[#99501e]">{data.researchAvailabilityReason === 'ai_package_required' ? 'No AI research package is active for this account, so research and re-research are disabled.' : 'Research is not available because no AI provider is configured. Ask a platform administrator to connect one.'}</p>}
      {active && <p data-testid="status-research-active" role="status" className="mt-3 rounded-md bg-[#edf4fc] px-3 py-2 text-[12px] text-[#245b9b]">Research is {job!.status}. Stage: {human(job!.stage)}. {pollingExpired ? <>Automatic checking has stopped because this run is taking longer than usual. <button type="button" data-testid="button-refresh-research" className="font-semibold underline" onClick={() => void query.refetch()}>Refresh status</button></> : 'This page updates automatically.'}</p>}
      {job?.status === 'failed' && <p data-testid="status-research-failed" role="alert" className="mt-3 rounded-md bg-[#fff8f1] px-3 py-2 text-[12px] text-[#99501e]">The last research attempt failed{job.error ? `: ${job.error}` : '.'} {current ? 'Your existing profile is unchanged. ' : ''}You can retry when ready.</p>}
      {startError && <p role="alert" data-testid="status-research-start-error" className="mt-3 rounded-md bg-[#fff8f1] px-3 py-2 text-[12px] text-[#99501e]">Research was not started. {startError}</p>}
      {current && <dl className="mt-4 grid gap-3 border-t border-[#edf0f2] pt-4 text-[11px] sm:grid-cols-3 lg:grid-cols-6">{([['Version', shown?.version ?? current.version], ['Provider', shown?.provider ?? current.provider], ['Model', shown?.model ?? current.model], ['Valid until', fmtDate((shown ?? current).validUntil)], ['Confidence', pct((shown ?? current).confidence)], ['Researched', fmtDate((shown ?? current).researchedAt)]] as Array<[string, string]>).map(([k, v]) => <div key={k}><dt className={label}>{k}</dt><dd data-testid={`text-meta-${k.toLowerCase().replace(/ /g, '-')}`} className="mt-1 break-words font-semibold text-[#3b4d61]">{v}</dd></div>)}</dl>}
    </div>
    {data.history.length > 1 && <div className={`${card} p-4`} data-testid="panel-intelligence-history"><div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#223247]"><History className="h-4 w-4" />Research history</div><div className="flex flex-wrap gap-2">{data.history.map(h => { const on = (selected || current?.id) === h.id; return <button key={h.id} type="button" data-testid={`button-version-${h.id}`} aria-pressed={on} onClick={() => setSelected(h.id === current?.id ? '' : h.id)} className={`rounded-md border px-3 py-2 text-left text-[11px] ${on ? 'border-[#174f99] bg-[#edf4fc]' : 'border-[#dce2e8] bg-white hover:bg-[#f7f9fb]'}`}><span className="block font-semibold">{h.version}{h.id === current?.id ? ' (latest)' : ''}</span><span className="text-[#8a96a4]">{fmtDate(h.researchedAt)} · {h.sourceCount} sources</span></button>; })}</div>{viewingOld && <p data-testid="status-viewing-old" className="mt-2 text-[11px] text-[#a95218]">Viewing an older version. The latest profile is unchanged. <button type="button" data-testid="button-view-latest" className="font-semibold underline" onClick={() => setSelected('')}>Back to latest</button></p>}</div>}
    {viewingOld && versionQuery.isLoading && <div className="h-40 animate-pulse rounded-lg bg-[#f1f3f5]" data-testid="loading-version" />}
    {viewingOld && versionQuery.isError && <div role="alert" className={`${card} p-4 text-[12px]`}>This version could not be loaded. <button type="button" data-testid="button-retry-version" className="font-semibold text-[#245b9b]" onClick={() => void versionQuery.refetch()}>Retry</button></div>}
    {shown ? <Profile version={shown} /> : !viewingOld && <div data-testid="empty-intelligence" className="rounded-lg border border-dashed border-[#dfe5eb] bg-[#fbfcfd] px-5 py-10 text-center"><p className="text-[13px] font-semibold text-[#45566a]">No research yet</p><p className="mt-1 text-[11px] text-[#8995a2]">Run research to build a reusable profile with cited sources for this company.</p></div>}
    <ConfirmActionDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={confirm} pending={start.isPending} destructive={false} confirmDisabled={fresh && !override} testId="dialog-confirm-research" title={`${verb} ${data.companyName}?`} confirmLabel={verb}
      description="Research uses AI model and web search resources from the platform. It can take a few minutes, and the result becomes a shared company profile that is reused instead of researching again.">
      <div className="space-y-3 text-[12px]">
        <label className="block"><span className="mb-1 block font-semibold text-[#344154]">Research depth</span><select data-testid="select-research-depth" value={depth} onChange={e => setDepth(Number(e.target.value))} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3">{[1, 2, 3].map(d => <option key={d} value={d} disabled={!depthOk(d)}>{d} - {depthNames[d - 1]}{d > maxDepth ? ' (above your limit)' : d === 3 && !data.deepResearchEnabled ? ' (not enabled)' : ''}</option>)}</select></label>
        {fresh && <label className="flex items-start gap-2 rounded-md bg-[#fff8f1] p-3 text-[#99501e]"><input type="checkbox" data-testid="checkbox-override-fresh" checked={override} onChange={e => setOverride(e.target.checked)} className="mt-0.5" /><span>This profile is still fresh (researched {fmtDate(data.summary.researchedAt)}). Re-research anyway.</span></label>}
        {fresh && !override && <p data-testid="text-fresh-blocked" className="text-[11px] text-[#8a96a4]">Tick the box above to confirm a re-research of a fresh profile.</p>}
        <input type="hidden" data-testid="input-override-state" value={fresh && override ? 'override' : 'none'} readOnly />
      </div>
    </ConfirmActionDialog>
  </section>;
}
