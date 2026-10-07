import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { ArrowLeft, CircleAlert, LoaderCircle } from 'lucide-react';
import {
  getGetCompanyResearchSettingsQueryKey, getGetCompanyResearchUsageQueryKey, getListAdminGlobalCompaniesQueryKey,
  getGetAIProviderSettingsQueryKey, useGetAIProviderSettings, useGetCompanyResearchSettings, useGetCompanyResearchUsage,
  useTestAIProviderConnection, useUpdateCompanyResearchSettings,
} from '@workspace/api-client-react';
import type { AIProviderModel, CompanyResearchSettings, IntelligenceSourceType } from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';
import { fmtDate } from '@/components/company-intelligence-panel';

const card = 'rounded-lg border border-[#e0e4e9] bg-white';
const lab = 'mono text-[11px] uppercase tracking-[.12em] text-[#667386]';
const inp = 'h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] disabled:bg-[#f5f6f8]';
const sourceTypes: IntelligenceSourceType[] = ['company_website', 'company_product_page', 'company_newsroom', 'investor_relation', 'regulatory_filing', 'government', 'reputable_news', 'industry_source', 'other'];
const human = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const usd = (n: number | null | undefined) => n === null || n === undefined ? 'Unavailable' : `$${n.toFixed(n < 1 ? 4 : 2)}`;
const errText = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Please try again.';

type FormValues = {
  freshDays: string; agingDays: string; maxResearchDepth: string; maxWebSearches: string; researchCreditCost: string; usdToInr: string;
  deepResearchEnabled: boolean; allowedSourceTypes: IntelligenceSourceType[]; preferredModel: string; backupModel: string;
  inputCostPerMillionUsd: string; outputCostPerMillionUsd: string; searchCostUsd: string;
};
const optStr = (n: number | null) => n === null ? '' : String(n);
const toForm = (s: CompanyResearchSettings): FormValues => ({
  freshDays: String(s.freshDays), agingDays: String(s.agingDays), maxResearchDepth: String(s.maxResearchDepth), maxWebSearches: String(s.maxWebSearches),
  researchCreditCost: String(s.researchCreditCost), usdToInr: String(s.usdToInr), deepResearchEnabled: s.deepResearchEnabled, allowedSourceTypes: s.allowedSourceTypes,
  preferredModel: s.preferredModel ?? '', backupModel: s.backupModel ?? '', inputCostPerMillionUsd: optStr(s.inputCostPerMillionUsd),
  outputCostPerMillionUsd: optStr(s.outputCostPerMillionUsd), searchCostUsd: optStr(s.searchCostUsd),
});
const optNum = (v: string) => v.trim() === '' ? null : Number(v);

function SettingsForm({ settings }: { settings: CompanyResearchSettings }) {
  const qc = useQueryClient();
  const save = useUpdateCompanyResearchSettings();
  const provider = useGetAIProviderSettings({ query: { queryKey: getGetAIProviderSettingsQueryKey(), staleTime: 60_000 } });
  const test = useTestAIProviderConnection();
  const [models, setModels] = useState<AIProviderModel[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<FormValues>({ defaultValues: toForm(settings) });
  useEffect(() => { form.reset(toForm(settings)); }, [settings, form]);
  const connected = provider.data?.configured ? provider.data.provider : null;
  const loadModels = () => { if (connected) test.mutate({ data: { provider: connected } }, { onSuccess: r => setModels(r.models), onError: e => setMsg({ ok: false, text: `Models could not be loaded. ${errText(e)}` }) }); };
  const watched = form.watch();
  const modelOptions = (cur: string) => { const list = models.map(m => m.id); if (cur && !list.includes(cur)) list.unshift(cur); return list; };
  const submit = form.handleSubmit(v => {
    setMsg(null);
    const fresh = Number(v.freshDays), aging = Number(v.agingDays);
    if (aging <= fresh) { setMsg({ ok: false, text: 'Aging days must be greater than fresh days.' }); return; }
    if (!v.allowedSourceTypes.length) { setMsg({ ok: false, text: 'Choose at least one allowed source type.' }); return; }
    const data: CompanyResearchSettings = {
      freshDays: fresh, agingDays: aging, maxResearchDepth: Number(v.maxResearchDepth), maxWebSearches: Number(v.maxWebSearches),
      allowedSourceTypes: v.allowedSourceTypes, researchCreditCost: Number(v.researchCreditCost), deepResearchEnabled: v.deepResearchEnabled,
      preferredModel: v.preferredModel || null, backupModel: v.backupModel || null, inputCostPerMillionUsd: optNum(v.inputCostPerMillionUsd),
      outputCostPerMillionUsd: optNum(v.outputCostPerMillionUsd), searchCostUsd: optNum(v.searchCostUsd), usdToInr: Number(v.usdToInr),
    };
    save.mutate({ data }, {
      onSuccess: saved => {
        qc.setQueryData(getGetCompanyResearchSettingsQueryKey(), saved);
        void qc.invalidateQueries({ queryKey: getGetCompanyResearchSettingsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetCompanyResearchUsageQueryKey() });
        void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() });
        void qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('intelligence') });
        setMsg({ ok: true, text: 'Research settings saved.' });
      },
      onError: e => setMsg({ ok: false, text: `Settings were not saved. ${errText(e)}` }),
    });
  });
  const num = (name: keyof FormValues, text: string, testId: string, props: { min?: number; max?: number; step?: string; optional?: boolean } = {}) => (
    <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{text}{props.optional && <span className="ml-1 font-normal text-[#8a96a4]">(optional, blank = unknown)</span>}</span><input data-testid={testId} type="number" inputMode="decimal" min={props.min} max={props.max} step={props.step ?? '1'} required={!props.optional} className={inp} {...form.register(name as 'freshDays')} /></label>
  );
  const modelSelect = (name: 'preferredModel' | 'backupModel', text: string) => (
    <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{text}</span><select data-testid={`select-${name}`} className={inp} {...form.register(name)}><option value="">{name === 'backupModel' ? 'No backup model' : 'Use provider default'}</option>{modelOptions(watched[name]).map(id => <option key={id} value={id}>{id}</option>)}</select></label>
  );
  return <Form {...form}><form onSubmit={submit} data-testid="form-research-settings" className="space-y-5">
    <div className={`${card} p-5`}><h3 className="text-[14px] font-bold">Freshness and limits</h3><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {num('freshDays', 'Fresh for (days)', 'input-fresh-days', { min: 1, max: 365 })}
      {num('agingDays', 'Aging until (days)', 'input-aging-days', { min: 2, max: 730 })}
      {num('maxResearchDepth', 'Maximum research depth (1-3)', 'input-max-depth', { min: 1, max: 3 })}
      {num('maxWebSearches', 'Maximum web searches', 'input-max-web-searches', { min: 1, max: 10 })}
      {num('researchCreditCost', 'Metered units per research', 'input-research-credit-cost', { min: 0, max: 1000 })}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-[#7f8b99]">Maximum web searches caps hosted search tool uses for OpenAI and Anthropic. Gemini uses one grounded request, and the provider controls how many internal queries it runs, so this cap does not apply there. Metered units are tracked usage only; there is no credit wallet.</p>
    <label className="mt-4 flex items-center gap-2 text-[12px] font-semibold text-[#344154]"><input type="checkbox" data-testid="checkbox-deep-research" {...form.register('deepResearchEnabled')} />Deep research (depth 3) available</label></div>
    <div className={`${card} p-5`}><h3 className="text-[14px] font-bold">Allowed source types</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sourceTypes.map(t => <label key={t} className="flex items-center gap-2 text-[12px] text-[#3b4d61]"><input type="checkbox" data-testid={`checkbox-source-${t}`} value={t} {...form.register('allowedSourceTypes')} />{human(t)}</label>)}</div></div>
    <div className={`${card} p-5`}><h3 className="text-[14px] font-bold">Models</h3>
      <p className="mt-1 text-[11px] text-[#7f8b99]">Both models use the connected AI provider and its saved key. {connected ? `Connected provider: ${human(connected)}.` : 'No provider is connected, so research is unavailable.'}</p>
      <p className="mt-2 text-[12px] leading-5 text-[#667386]">Choose a primary model that supports hosted web search and JSON analysis. A backup retries analysis using the evidence already collected; it does not run another web search. Costs are unavailable when a backup is used because its pricing may differ.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{modelSelect('preferredModel', 'Preferred model')}{modelSelect('backupModel', 'Backup model')}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" data-testid="button-load-models" disabled={!connected || test.isPending} onClick={loadModels} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#d7dce3] px-3 text-[12px] font-semibold disabled:opacity-50">{test.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Load models from provider</button>{models.length > 0 && <span className="text-[11px] text-[#8a96a4]">{models.length} models available</span>}</div></div>
    <div className={`${card} p-5`}><h3 className="text-[14px] font-bold">Cost estimation rates</h3>
      <p data-testid="text-cost-warning" className="mt-1 rounded-md bg-[#fff8f1] px-3 py-2 text-[11px] leading-5 text-[#99501e]">Costs shown are estimates based on the rates saved here. They exclude any provider charges these rates do not represent. Leave a rate blank when unknown; it is stored as unknown, not zero, and affected jobs show cost as unavailable.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {num('inputCostPerMillionUsd', 'Input USD / 1M tokens', 'input-input-cost', { min: 0, max: 10000, step: 'any', optional: true })}
        {num('outputCostPerMillionUsd', 'Output USD / 1M tokens', 'input-output-cost', { min: 0, max: 10000, step: 'any', optional: true })}
        {num('searchCostUsd', 'USD per web search', 'input-search-cost', { min: 0, max: 100, step: 'any', optional: true })}
        {num('usdToInr', 'USD to INR', 'input-usd-inr', { min: 1, max: 1000, step: 'any' })}
      </div></div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" data-testid="button-save-research-settings" disabled={save.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-5 text-[13px] font-semibold text-white hover:bg-[#103f7e] disabled:opacity-55">{save.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{save.isPending ? 'Saving' : 'Save settings'}</button>
      {msg && <span data-testid="status-settings-save" role={msg.ok ? 'status' : 'alert'} className={`text-[12px] ${msg.ok ? 'text-[#2d704b]' : 'text-[#99501e]'}`}>{msg.text}</span>}
    </div></form></Form>;
}

function Usage() {
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 10 };
  const q = useGetCompanyResearchUsage(params, { query: { queryKey: getGetCompanyResearchUsageQueryKey(params), staleTime: 15_000, placeholderData: p => p } });
  if (q.isLoading) return <div data-testid="loading-usage" className="space-y-3"><div className="h-24 animate-pulse rounded-lg bg-[#f1f3f5]" /><div className="h-64 animate-pulse rounded-lg bg-[#f1f3f5]" /></div>;
  if (q.isError || !q.data) return <div role="alert" data-testid="error-usage" className={`${card} flex items-center justify-between p-5 text-[13px]`}><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-[#cd732f]" />Usage could not be loaded</span><button type="button" data-testid="button-retry-usage" onClick={() => void q.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button></div>;
  const d = q.data;
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const metrics: Array<[string, string]> = [
    ['Companies', d.totalCompanies.toLocaleString()], ['Researched', d.researchedCompanies.toLocaleString()], ['This month', d.researchesThisMonth.toLocaleString()],
    ['Successful', d.successfulResearches.toLocaleString()], ['Failed', d.failedResearches.toLocaleString()], ['Avg cost (est.)', usd(d.averageCostUsd)],
    ['Total cost (est.)', usd(d.totalCostUsd)], ['Costed jobs', d.costedJobs.toLocaleString()], ['Avg searches', d.averageSearches.toFixed(1)], ['Avg tokens', Math.round(d.averageTokens).toLocaleString()],
  ];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{metrics.map(([k, v]) => <div key={k} className={`${card} p-4`}><div className={lab}>{k}</div><div data-testid={`metric-${k.toLowerCase().replace(/[^a-z]+/g, '-')}`} className="mt-1 text-[18px] font-bold text-[#172334]">{v}</div></div>)}</div>
    <p className="text-[11px] text-[#7f8b99]">Costs are estimates from saved rates and exclude provider charges those rates do not represent.</p>
    <section className={`${card} overflow-hidden`}>{d.jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-[11px]"><thead className="bg-[#fbfcfd]"><tr className={lab}>{['Company', 'Status', 'Model', 'Tokens in/out', 'Searches', 'Sources', 'Duration', 'Units', 'Est. USD', 'Est. INR', 'Created'].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#edf0f2]">{d.jobs.map(j => <tr key={j.id} data-testid={`row-usage-${j.id}`}><td className="px-3 py-3 font-semibold">{j.companyName}</td><td className="px-3 py-3">{human(j.status)}{j.error && <span className="block max-w-[180px] truncate text-[10px] text-[#99501e]" title={j.error}>{j.error}</span>}</td><td className="px-3 py-3">{j.provider} / {j.model}</td><td className="px-3 py-3">{j.inputTokens.toLocaleString()} / {j.outputTokens.toLocaleString()}</td><td className="px-3 py-3">{j.webSearchCount}</td><td className="px-3 py-3">{j.sourceCount}</td><td className="px-3 py-3">{j.durationMs === null ? 'Unavailable' : `${(j.durationMs / 1000).toFixed(1)}s`}</td><td className="px-3 py-3">{j.creditCost}</td><td className="px-3 py-3">{usd(j.estimatedCostUsd)}</td><td className="px-3 py-3">{j.estimatedCostInr === null ? 'Unavailable' : `Rs ${j.estimatedCostInr.toFixed(2)}`}</td><td className="px-3 py-3">{fmtDate(j.createdAt)}</td></tr>)}</tbody></table></div> : <div data-testid="empty-usage" className="px-5 py-12 text-center"><p className="text-[13px] font-semibold text-[#45566a]">No research runs yet</p><p className="mt-1 text-[11px] text-[#8995a2]">Runs appear here after research is started from a company.</p></div>}
      <footer className="flex items-center justify-between border-t border-[#e8edf1] bg-[#fbfcfd] px-4 py-3 text-[11px]"><span>{d.total} runs</span><div className="flex items-center gap-2"><button type="button" data-testid="button-usage-prev" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-md border border-[#d7dce3] px-3 py-1.5 disabled:opacity-40">Previous</button><span className="mono">{page} / {pages}</span><button type="button" data-testid="button-usage-next" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-md border border-[#d7dce3] px-3 py-1.5 disabled:opacity-40">Next</button></div></footer></section>
  </div>;
}

export function AdminCompanyIntelligencePage() {
  const [tab, setTab] = useState<'usage' | 'settings'>('usage');
  const settings = useGetCompanyResearchSettings({ query: { queryKey: getGetCompanyResearchSettingsQueryKey(), staleTime: 30_000 } });
  return <main className="fade-in mx-auto max-w-[1180px]">
    <Link href="/admin/global-companies" data-testid="link-back-global-companies" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[#55708e] no-underline hover:text-[#174f99]"><ArrowLeft className="h-4 w-4" />Global companies</Link>
    <header className="mb-6"><div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">PLATFORM / COMPANY INTELLIGENCE</div><h1 className="display text-[30px] font-bold text-[#172334]">Company intelligence</h1><p className="mt-2 max-w-2xl text-[13px] text-[#687484]">Monitor research usage and tune freshness, limits, and models. Research itself starts from a company, after confirmation.</p></header>
    <div role="tablist" className="mb-5 flex gap-1 border-b border-[#e3e7eb]">{(['usage', 'settings'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`tab-${t}`} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold ${tab === t ? 'border-[#174f99] text-[#174f99]' : 'border-transparent text-[#687484]'}`}>{t === 'usage' ? 'Usage and jobs' : 'Settings'}</button>)}</div>
    {tab === 'usage' ? <Usage /> : settings.isLoading ? <div data-testid="loading-settings" className="h-64 animate-pulse rounded-lg bg-[#f1f3f5]" /> : settings.isError || !settings.data ? <div role="alert" data-testid="error-settings" className={`${card} flex items-center justify-between p-5 text-[13px]`}>Settings could not be loaded<button type="button" data-testid="button-retry-settings" onClick={() => void settings.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button></div> : <SettingsForm settings={settings.data} />}
  </main>;
}
