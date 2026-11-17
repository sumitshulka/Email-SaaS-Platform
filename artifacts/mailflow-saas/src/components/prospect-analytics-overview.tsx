import { useState, type ReactNode } from "react";
import { getGetProspectDashboardQueryKey, useGetProspectDashboard, type ProspectDashboard } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, ArrowRight, Download, RefreshCw, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const palette = {
  ink: "#263447",
  muted: "#778591",
  border: "#e3e9e5",
  grid: "#edf1ee",
  blue: "#3f78ad",
  teal: "#4d897e",
  sage: "#71977c",
  amber: "#d88a52",
  plum: "#8875a4",
};
const productColors = [palette.blue, palette.teal, palette.amber, palette.plum, palette.sage, "#aab5ae"];

type CsvCell = string | number;
type CsvRow = Record<string, CsvCell>;

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function downloadCsv(filename: string, rows: CsvRow[]) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const escape = (value: CsvCell) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns.map(escape).join(","), ...rows.map(row => columns.map(column => escape(row[column])).join(","))].join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function currencyMetric(totals: ProspectDashboard["currencyTotals"], code: string) {
  return totals.find(item => item.currencyCode === code);
}

function ChartCard({
  eyebrow,
  title,
  detail,
  csvName,
  csvRows,
  toolbar,
  children,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  csvName: string;
  csvRows: CsvRow[];
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: palette.border }} aria-label={title}>
      <div className="border-b px-5 py-3 sm:px-6" style={{ borderColor: palette.grid }}>
        <div>
          <div className="mono text-[9px] uppercase tracking-[.16em]" style={{ color: "#8a969d" }}>{eyebrow}</div>
          <h3 className="display mt-1 text-[17px] font-bold" style={{ color: palette.ink }}>{title}</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-5" style={{ color: palette.muted }}>{detail}</p>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">{toolbar}</div>
          <button
            type="button"
            data-testid={`button-download-${csvName.replace(".csv", "")}`}
            onClick={() => downloadCsv(csvName, csvRows)}
            disabled={!csvRows.length}
            aria-label={`Download ${title} chart data as CSV`}
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border bg-white px-3 text-[11px] font-semibold transition hover:bg-[#f5f8f6] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: "#dce4df", color: "#526b63" }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV
          </button>
        </div>
        {children}
      </div>
    </section>
  );
}

function ChartEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[245px] flex-col items-center justify-center rounded-lg border border-dashed bg-[#fbfcfa] px-5 text-center" style={{ borderColor: "#dce4df" }}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf4ef] text-[#5f8775]"><Activity className="h-4 w-4" aria-hidden="true" /></span>
      <h4 className="mt-3 text-[12px] font-semibold" style={{ color: "#394a56" }}>{title}</h4>
      <p className="mt-1 max-w-sm text-[11px] leading-5" style={{ color: "#828d95" }}>{body}</p>
    </div>
  );
}

function SkeletonOverview() {
  return (
    <div aria-label="Loading prospect analytics" aria-busy="true" className="space-y-4">
      <div className="h-24 animate-pulse rounded-xl bg-[#eaf0ec]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-xl bg-[#edf2ee]" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-[350px] animate-pulse rounded-xl bg-[#edf2ee]" />)}
      </div>
    </div>
  );
}

function MetricCard({ label, value, note, tone = "blue" }: { label: string; value: string; note: string; tone?: "blue" | "sage" | "amber" }) {
  const tones = {
    blue: { bg: "#eff6fc", border: "#cadcf0", title: "#52718f", value: "#193553" },
    sage: { bg: "#f0f8f3", border: "#cde2d5", title: "#4e7560", value: "#285b42" },
    amber: { bg: "#fff5e9", border: "#ead8bd", title: "#94704a", value: "#77502d" },
  }[tone];
  return (
    <div className="rounded-xl border px-4 py-4" style={{ backgroundColor: tones.bg, borderColor: tones.border }}>
      <div className="text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: tones.title }}>{label}</div>
      <div className="display mt-2 text-[28px] font-bold leading-none tracking-[-.045em]" style={{ color: tones.value }}>{value}</div>
      <p className="mt-2 text-[10px] leading-4" style={{ color: "#72808b" }}>{note}</p>
    </div>
  );
}

export function ProspectAnalyticsOverview() {
  const query = useGetProspectDashboard({ query: { queryKey: getGetProspectDashboardQueryKey() } });
  const [selectedCurrency, setSelectedCurrency] = useState("");

  if (query.isLoading && !query.data) return <SkeletonOverview />;
  if (query.isError && !query.data) {
    return (
      <section className="rounded-xl border border-[#efd8c7] bg-[#fff8f2] px-5 py-6" aria-label="Prospect analytics error" role="alert">
        <h2 className="text-[14px] font-semibold text-[#75421f]">Prospect analytics couldn’t load</h2>
        <p className="mt-1 text-[12px] leading-5 text-[#93694c]">Your workspace overview is still available. Try again to reload pipeline figures.</p>
        <button type="button" data-testid="button-retry-prospect-analytics" onClick={() => void query.refetch()} disabled={query.isFetching} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md border border-[#e8c5a8] bg-white px-3 text-[11px] font-semibold text-[#94501f] hover:bg-[#fff7f0] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" /> {query.isFetching ? "Retrying…" : "Retry"}
        </button>
      </section>
    );
  }

  const data = query.data;
  if (!data) return null;
  const hasProspects = data.byStage.some(stage => stage.count > 0);
  const currencies = data.currencyTotals.map(row => row.currencyCode);
  const activeCurrency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] ?? "";
  const decided = data.totalWon + data.totalLost;
  const winRate = decided > 0 ? (data.totalWon / decided) * 100 : null;

  const stageCounts = [...data.byStage]
    .sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName))
    .map(stage => ({
      stage: stage.stageName,
      count: stage.count,
      kind: stage.stageType === "terminal" ? (stage.terminalOutcome || "Terminal") : "Active",
    }));
  const activeStagePipeline = [...data.byStage]
    .filter(stage => stage.stageType === "active")
    .map(stage => ({
      stage: stage.stageName,
      weightedValue: currencyMetric(stage.currencyTotals, activeCurrency)?.weightedValue ?? 0,
      count: stage.count,
      probability: stage.probability,
    }))
    .sort((a, b) => b.weightedValue - a.weightedValue || a.stage.localeCompare(b.stage));
  const closureOutlook = [...data.byClosurePeriod]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(period => ({
      period: period.period,
      month: (() => {
        const [year, month] = period.period.split("-").map(Number);
        return Number.isFinite(year) && Number.isFinite(month)
          ? new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1))
          : period.period;
      })(),
      weightedValue: currencyMetric(period.currencyTotals, activeCurrency)?.weightedValue ?? 0,
      count: period.count,
    }));
  const productMix = [...data.byProduct].sort((a, b) => b.count - a.count || a.productName.localeCompare(b.productName));
  const productChartData = productMix.length <= 6
    ? productMix
    : [
        ...productMix.slice(0, 5),
        {
          productId: "other-products",
          productName: "Other",
          count: productMix.slice(5).reduce((sum, item) => sum + item.count, 0),
          currencyTotals: [],
        },
      ];
  const countsCsv = stageCounts.map(row => ({ Stage: row.stage, "Opportunity count": row.count, "Stage type": row.kind }));
  const pipelineCsv = activeStagePipeline.map(row => ({
    Stage: row.stage,
    Currency: activeCurrency,
    "Weighted active pipeline": row.weightedValue,
    "Opportunity count": row.count,
    "Current probability (%)": row.probability,
  }));
  const closureCsv = closureOutlook.map(row => ({
    Month: row.period,
    Currency: activeCurrency,
    "Weighted expected deal value": row.weightedValue,
    "Opportunity count": row.count,
  }));
  const productCsv = productMix.map(row => ({ "Product / service": row.productName, "Opportunity count": row.count }));

  return (
    <div className="space-y-4" data-testid="prospect-analytics-overview">
      <section className="overflow-hidden rounded-xl border bg-[#f0f6f2] px-5 py-5 sm:px-6" style={{ borderColor: "#d4e3d9" }} aria-label="Prospect pipeline overview">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-2xl">
            <div className="mono text-[9px] font-medium uppercase tracking-[.16em] text-[#668273]">Commercial opportunities / snapshot</div>
            <h2 className="display mt-1.5 text-[21px] font-bold tracking-[-.035em] text-[#203c39]">A grounded view of the pipeline.</h2>
            <p className="mt-1.5 text-[11px] leading-5 text-[#61766c]">Prospect totals reflect non-archived records in this workspace. Values stay separated by currency.</p>
          </div>
          <Link href="/prospects" data-testid="link-prospect-analytics-all-prospects" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[#245f8e] px-4 text-[11px] font-semibold text-white no-underline transition hover:bg-[#194d76] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245f8e]">
            Open prospects <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {query.isError && <div role="status" className="mt-4 rounded-md border border-[#ecd9c3] bg-[#fffaf3] px-3 py-2 text-[10px] text-[#7b5e3d]">Could not refresh this snapshot. Showing the last loaded figures. <button type="button" onClick={() => void query.refetch()} className="ml-1 font-bold underline underline-offset-2">Retry</button></div>}
      </section>

      {!hasProspects ? (
        <section className="rounded-xl border bg-white px-6 py-10 text-center shadow-sm" style={{ borderColor: palette.border }} aria-label="No prospects yet" data-testid="empty-prospect-analytics">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#edf4ef] text-[#5f8775]"><TrendingUp className="h-5 w-5" aria-hidden="true" /></span>
          <h3 className="display mt-3 text-[18px] font-bold text-[#263447]">No prospects to summarize yet</h3>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#778591]">Once opportunities enter your pipeline, this space will show stage movement, expected value, and outcomes.</p>
          <Link href="/prospects" data-testid="link-prospect-analytics-empty" className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md border border-[#d8e0e8] px-3 text-[11px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Go to prospects <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </section>
      ) : (
        <>
          <section aria-label="Prospect outcome summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Active" value={data.totalActive.toLocaleString()} note="Open opportunities in the pipeline" />
            <MetricCard label="Won" value={data.totalWon.toLocaleString()} note="Opportunities marked won" tone="sage" />
            <MetricCard label="Lost" value={data.totalLost.toLocaleString()} note="Opportunities marked lost" tone="amber" />
            <MetricCard label="Win rate" value={winRate === null ? "—" : `${winRate.toFixed(1)}%`} note={winRate === null ? "No decided outcomes yet" : `${data.totalWon.toLocaleString()} won ÷ (${data.totalWon.toLocaleString()} won + ${data.totalLost.toLocaleString()} lost)`} />
          </section>
          <p className="-mt-1 px-1 text-[10px] leading-4 text-[#7b8790]">Win rate = won ÷ (won + lost). Active opportunities are not part of the denominator.</p>

          <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: palette.border }} aria-label="Pipeline value by currency">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="mono text-[9px] uppercase tracking-[.16em] text-[#8a969d]">Pipeline value / currency ledger</div>
                <h3 className="display mt-1 text-[17px] font-bold text-[#263447]">Keep every currency in its lane.</h3>
                <p className="mt-1 text-[11px] text-[#778591]">Active, weighted, won, and lost values are displayed independently for each currency.</p>
              </div>
              <Link href="/prospects" data-testid="link-prospect-analytics-value-details" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#245b91] no-underline hover:underline">View pipeline <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
            {data.currencyTotals.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {data.currencyTotals.map(row => (
                  <div key={row.currencyCode} data-testid={`prospect-value-${row.currencyCode.toLowerCase()}`} className="rounded-lg border bg-[#fbfcfa] p-3.5" style={{ borderColor: "#e6ece8" }}>
                    <div className="flex items-center justify-between">
                      <span className="mono text-[10px] font-semibold tracking-[.08em] text-[#61766c]">{row.currencyCode}</span>
                      <span className="rounded-full bg-[#eaf3ff] px-2 py-0.5 text-[9px] font-semibold text-[#426b92]">separate total</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                      <CurrencyValue label="Active value" value={formatMoney(row.activeValue, row.currencyCode)} />
                      <CurrencyValue label="Weighted active" value={formatMoney(row.weightedValue, row.currencyCode)} />
                      <CurrencyValue label="Won" value={formatMoney(row.wonValue, row.currencyCode)} />
                      <CurrencyValue label="Lost" value={formatMoney(row.lostValue, row.currencyCode)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed bg-[#fbfcfa] px-4 py-5 text-[11px] text-[#7d8991]">No currency totals are available yet. Opportunity counts may still appear in the breakdowns below.</p>
            )}
            <p className="mt-3 text-[10px] leading-4 text-[#839089]">Weighted values mean expected deal value × current probability. Won and lost values are terminal outcomes, not active pipeline.</p>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard eyebrow="STAGE DISTRIBUTION" title="Opportunity count by stage" detail="Counts include active and terminal stages so outcomes remain visible." csvName="opportunity-count-by-stage.csv" csvRows={countsCsv}>
              {stageCounts.length ? (
                <div className="h-[265px]" role="img" aria-label={`Bar chart showing opportunity count by stage across ${stageCounts.length} stages`}>
                  <ResponsiveContainer width="100%" height="100%" debounce={0}>
                    <BarChart data={stageCounts} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 4 }} accessibilityLayer>
                      <CartesianGrid horizontal={false} stroke={palette.grid} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: palette.muted }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="stage" width={116} tick={{ fontSize: 11, fill: "#566474" }} axisLine={false} tickLine={false} />
                      <Tooltip isAnimationActive={false} cursor={{ fill: "#f4f6f3" }} contentStyle={{ borderRadius: 8, border: `1px solid ${palette.border}`, background: "#fffefa", fontSize: 12 }} formatter={(value: number) => [value.toLocaleString(), "Opportunities"]} />
                      <Bar dataKey="count" name="Opportunities" fill={palette.teal} radius={[0, 5, 5, 0]} isAnimationActive={false} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <ChartEmpty title="Stage counts are not available" body="The workspace has prospects, but no stage breakdown was returned for this snapshot." />}
            </ChartCard>

            <ChartCard eyebrow="ACTIVE PIPELINE" title="Weighted value by stage" detail={`Expected deal value × current probability, in ${activeCurrency || "a selected currency"}. Terminal stages are excluded from active pipeline.`} csvName="weighted-active-pipeline-by-stage.csv" csvRows={pipelineCsv} toolbar={<CurrencySelect currencies={currencies} value={activeCurrency} onChange={setSelectedCurrency} testId="select-stage-pipeline-currency" />}>
              {!activeCurrency ? <ChartEmpty title="No currency values to chart" body="Currency totals are not available for this snapshot. Stage counts remain available in the chart beside this one." />
                : activeStagePipeline.length ? activeStagePipeline.some(row => row.weightedValue !== 0) ? (
                  <div className="h-[230px]" role="img" aria-label={`Bar chart showing weighted active pipeline by stage in ${activeCurrency}`}>
                    <ResponsiveContainer width="100%" height="100%" debounce={0}>
                      <BarChart data={activeStagePipeline} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }} accessibilityLayer>
                        <CartesianGrid horizontal={false} stroke={palette.grid} />
                        <XAxis type="number" tickFormatter={value => compactMoney(value, activeCurrency)} tick={{ fontSize: 10, fill: palette.muted }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="stage" width={116} tick={{ fontSize: 11, fill: "#566474" }} axisLine={false} tickLine={false} />
                        <Tooltip isAnimationActive={false} cursor={{ fill: "#f4f6f3" }} contentStyle={{ borderRadius: 8, border: `1px solid ${palette.border}`, background: "#fffefa", fontSize: 12 }} formatter={(value: number, _name: string, item) => [formatMoney(value, activeCurrency), `Weighted · ${item.payload.probability}% probability`]} />
                        <Bar dataKey="weightedValue" name="Weighted active value" fill={palette.blue} radius={[0, 5, 5, 0]} isAnimationActive={false} maxBarSize={26} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <ChartEmpty title="No weighted value in this currency" body={`Active stages exist, but no ${activeCurrency} weighted values were returned.`} />
                  : <ChartEmpty title="No active stages in the breakdown" body="Won and lost terminal stages do not count as active pipeline." />}
            </ChartCard>

            <ChartCard eyebrow="EXPECTED CLOSURE" title="Monthly outlook" detail={`Expected weighted deal value by close month, in ${activeCurrency || "a selected currency"}. Counts include opportunities with a closure period.`} csvName="expected-closure-outlook.csv" csvRows={closureCsv} toolbar={<CurrencySelect currencies={currencies} value={activeCurrency} onChange={setSelectedCurrency} testId="select-closure-currency" />}>
              {!activeCurrency ? <ChartEmpty title="No currency values to chart" body="Choose a currency after pipeline currency totals become available." />
                : closureOutlook.length ? closureOutlook.some(row => row.weightedValue !== 0) ? (
                  <>
                    <div className="h-[230px]" role="img" aria-label={`Area chart showing weighted expected deal value by closure month in ${activeCurrency}`}>
                      <ResponsiveContainer width="100%" height="100%" debounce={0}>
                        <AreaChart data={closureOutlook} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} accessibilityLayer>
                          <defs><linearGradient id="prospectClosureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={palette.teal} stopOpacity={0.28} /><stop offset="100%" stopColor={palette.teal} stopOpacity={0.03} /></linearGradient></defs>
                          <CartesianGrid stroke={palette.grid} vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: palette.muted }} axisLine={false} tickLine={false} minTickGap={18} />
                          <YAxis tickFormatter={value => compactMoney(value, activeCurrency)} tick={{ fontSize: 10, fill: palette.muted }} axisLine={false} tickLine={false} width={64} />
                          <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(77,137,126,.07)", stroke: "none" }} contentStyle={{ borderRadius: 8, border: `1px solid ${palette.border}`, background: "#fffefa", fontSize: 12 }} labelFormatter={(_label, payload) => payload?.[0]?.payload?.period ?? _label} formatter={(value: number, _name: string, item) => [formatMoney(value, activeCurrency), `Weighted · ${item.payload.count} opportunities`]} />
                          <Area type="monotone" dataKey="weightedValue" name="Weighted expected value" stroke={palette.teal} strokeWidth={2.5} fill="url(#prospectClosureFill)" fillOpacity={1} activeDot={{ r: 4, fill: palette.teal, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-[#87928f]">Hover a month to see its opportunity count and weighted value.</p>
                  </>
                ) : <ChartEmpty title="No weighted closure value in this currency" body={`Closure months are present, but no ${activeCurrency} weighted values were returned.`} />
                  : <ChartEmpty title="No expected closure dates yet" body="Monthly outlook appears when prospects have an expected closure period." />}
            </ChartCard>

            <ChartCard eyebrow="OFFERING MIX" title="Opportunities by product or service" detail="Opportunity count by offering; this is a count mix, not a revenue comparison." csvName="opportunities-by-product-service.csv" csvRows={productCsv}>
              {productMix.length ? (
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,.9fr)]">
                <div className="h-[235px]" role="img" aria-label={`Donut chart showing opportunity counts across ${productChartData.length} product or service groups`}>
                    <ResponsiveContainer width="100%" height="100%" debounce={0}>
                      <PieChart accessibilityLayer>
                      <Pie data={productChartData} dataKey="count" nameKey="productName" cx="50%" cy="50%" outerRadius="76%" innerRadius="52%" cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                        {productChartData.map((item, index) => <Cell key={item.productId} fill={productColors[index % productColors.length]} />)}
                        </Pie>
                        <Tooltip isAnimationActive={false} contentStyle={{ borderRadius: 8, border: `1px solid ${palette.border}`, background: "#fffefa", fontSize: 12 }} formatter={(value: number) => [value.toLocaleString(), "Opportunities"]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="max-h-[235px] space-y-2 overflow-y-auto" aria-label="Product and service opportunity counts">
                    {productMix.map((item, index) => (
                      <li key={item.productId} data-testid={`product-mix-${item.productId}`} className="flex items-center justify-between gap-3 rounded-md bg-[#fafbf9] px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2 text-[11px] text-[#596779]"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: productColors[index % productColors.length] }} /><span className="truncate">{item.productName}</span></span>
                        <span className="mono shrink-0 text-[11px] font-medium text-[#34495a]">{item.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <ChartEmpty title="No product mix to show" body="Product and service counts appear once prospects are assigned to an offering." />}
            </ChartCard>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-[#f8faf8] px-4 py-3 text-[10px] leading-4 text-[#7d8985]" style={{ borderColor: "#e4ebe6" }}>
            <span>Snapshot includes non-archived prospects only. Currency totals are never converted or combined.</span>
            <Link href="/prospects" data-testid="link-prospect-analytics-footer" className="inline-flex items-center gap-1 font-semibold text-[#245b91] no-underline hover:underline">Review prospects <ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>
          </div>
        </>
      )}
    </div>
  );
}

function CurrencyValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-[9px] text-[#89948f]">{label}</div><div className="mt-0.5 truncate text-[12px] font-semibold tabular-nums text-[#354858]">{value}</div></div>;
}

function CurrencySelect({ currencies, value, onChange, testId }: { currencies: string[]; value: string; onChange: (value: string) => void; testId: string }) {
  return currencies.length > 0 ? (
    <label className="flex w-fit items-center gap-2 text-[10px] font-medium text-[#697a75]">
      <span>Currency</span>
      <select data-testid={testId} aria-label="Select chart currency" value={value} onChange={event => onChange(event.target.value)} className="min-h-9 rounded-md border bg-white px-2.5 text-[11px] font-semibold text-[#34495a] outline-none focus-visible:ring-2 focus-visible:ring-[#77a899]" style={{ borderColor: "#dce4df" }}>
        {currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}
      </select>
    </label>
  ) : null;
}

function compactMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${currency} ${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  }
}
