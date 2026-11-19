import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetUserDashboardAnalyticsQueryKey,
  useGetUserDashboardAnalytics,
  type GetUserDashboardAnalyticsParams,
  type UserDashboard,
} from "@workspace/api-client-react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  Moon,
  Printer,
  RefreshCw,
  Sun,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Preset = "7d" | "30d" | "90d" | "this-month" | "last-month" | "custom";
type Range = { from: string; to: string };
type CsvValue = string | number;
type CsvRow = Record<string, CsvValue>;

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
} as const;
const CHART_COLOR_LIST = [
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.green,
  CHART_COLORS.red,
  CHART_COLORS.pink,
];
const DATA_SOURCES = ["App DB"];
const INTERVAL_OPTIONS = [
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
  { label: "Every 24 hours", ms: 24 * 60 * 60 * 1000 },
];
const PAGE_SIZES = [5, 10, 20, 50];

function dateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function daysBetweenInclusive(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(options ?? {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatMinorAmount(amountMinor: number, currency: string) {
  try {
    const digits = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 10 ** digits);
  } catch {
    return `${currency} ${(amountMinor / 100).toLocaleString()}`;
  }
}

function presetRange(preset: Exclude<Preset, "custom">, today: string): Range {
  if (preset === "this-month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "last-month") {
    const firstThisMonth = `${today.slice(0, 7)}-01`;
    const lastMonthEnd = shiftDate(firstThisMonth, -1);
    return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return { from: shiftDate(today, -(days - 1)), to: today };
}

function downloadCsv(filename: string, rows: CsvRow[]) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const escape = (value: CsvValue) => {
    const text = String(value);
    const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const contents = [columns.map(escape).join(","), ...rows.map(row => columns.map(column => escape(row[column])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function KpiCard({
  label, value, previous, note, tone, isDark, testId,
}: {
  label: string;
  value: number;
  previous: number;
  note: string;
  tone: "blue" | "purple" | "green" | "red";
  isDark: boolean;
  testId: string;
}) {
  const diff = value - previous;
  const change = previous > 0 ? (diff / previous) * 100 : null;
  const toneColor = CHART_COLORS[tone];
  return (
    <article
      className="relative overflow-hidden rounded-xl border px-4 py-4 sm:px-5 sm:py-5"
      style={{
        backgroundColor: isDark ? "#172526" : "#fffefa",
        borderColor: isDark ? "#304343" : "#e2e7df",
        boxShadow: isDark ? "none" : "0 3px 12px rgba(35,55,48,.035)",
      }}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: toneColor }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.12em]" style={{ color: isDark ? "#9aafaa" : "#778680" }}>{label}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-.045em] tabular-nums" style={{ color: isDark ? "#f0f4ec" : "#203b39" }} data-testid={testId}>
            {value.toLocaleString()}
          </p>
          <div className="mt-2 flex min-h-4 items-center gap-1.5 text-[10px]">
            {change === null ? (
              <span style={{ color: isDark ? "#849691" : "#89958e" }}>No prior-period baseline</span>
            ) : (
              <>
                {diff >= 0 ? <ArrowUp className="h-3 w-3" style={{ color: diff === 0 ? (isDark ? "#96a8a2" : "#84918b") : "#397f65" }} /> : <ArrowDown className="h-3 w-3" style={{ color: "#b44e42" }} />}
                <span className="font-semibold tabular-nums" style={{ color: diff > 0 ? "#397f65" : diff < 0 ? "#b44e42" : (isDark ? "#96a8a2" : "#84918b") }}>
                  {diff === 0 ? "0.0%" : `${Math.abs(change).toFixed(1)}%`}
                </span>
                <span style={{ color: isDark ? "#82948e" : "#89958e" }}>vs previous period</span>
              </>
            )}
          </div>
        </div>
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: toneColor, backgroundColor: `${toneColor}15` }}>
          {tone === "blue" ? <Activity className="h-4 w-4" /> : tone === "purple" ? <Users className="h-4 w-4" /> : tone === "green" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        </span>
      </div>
      <p className="mt-3 text-[10px] leading-4" style={{ color: isDark ? "#91a19b" : "#87938d" }}>{note}</p>
    </article>
  );
}

function ChartPanel({
  title, eyebrow, description, csvName, csvRows, children, isDark, action,
}: {
  title: string;
  eyebrow: string;
  description: string;
  csvName: string;
  csvRows: CsvRow[];
  children: React.ReactNode;
  isDark: boolean;
  action?: React.ReactNode;
}) {
  const border = isDark ? "#304343" : "#e2e7df";
  return (
    <section className="overflow-hidden rounded-xl border" style={{ borderColor: border, backgroundColor: isDark ? "#172526" : "#fffefa" }} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-5" style={{ borderColor: border, backgroundColor: isDark ? "#1b2b2b" : "#f4f5ee" }}>
        <div>
          <p className="font-mono text-[9px] font-medium uppercase tracking-[.16em]" style={{ color: isDark ? "#a8b8ad" : "#75877c" }}>{eyebrow}</p>
          <h3 className="mt-1 text-[16px] font-semibold tracking-[-.025em]" style={{ color: isDark ? "#edf2e9" : "#263a35" }}>{title}</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-5" style={{ color: isDark ? "#9aaca5" : "#7f8b84" }}>{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 print:hidden">
          {action}
          <button
            type="button"
            data-testid={`button-download-${csvName.replace(".csv", "")}`}
            aria-label={`Download ${title} chart data as CSV`}
            onClick={() => downloadCsv(csvName, csvRows)}
            disabled={!csvRows.length}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: border, backgroundColor: isDark ? "#223534" : "#fffefa", color: isDark ? "#cfdbd2" : "#4e665c" }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV
          </button>
        </div>
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function ChartEmpty({ isDark, title, detail }: { isDark: boolean; title: string; detail: string }) {
  return (
    <div className="flex min-h-[230px] flex-col items-center justify-center rounded-lg border border-dashed px-5 text-center" style={{ borderColor: isDark ? "#3a4c48" : "#d8e1d9", backgroundColor: isDark ? "#1a2928" : "#fafbf7" }}>
      <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ color: isDark ? "#99b6a4" : "#668d76", backgroundColor: isDark ? "#263c35" : "#eaf2eb" }}><Activity className="h-4 w-4" /></span>
      <h4 className="mt-3 text-[12px] font-semibold" style={{ color: isDark ? "#e3eae1" : "#40514a" }}>{title}</h4>
      <p className="mt-1 max-w-sm text-[11px] leading-5" style={{ color: isDark ? "#9aaba4" : "#839088" }}>{detail}</p>
    </div>
  );
}

function SkeletonAnalytics({ isDark }: { isDark: boolean }) {
  const fill = isDark ? "#273a37" : "#e9eee8";
  return (
    <div aria-label="Loading campaign analytics" aria-busy="true" data-testid="dashboard-analytics-loading" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="h-[140px] animate-pulse rounded-xl" style={{ backgroundColor: fill }} />)}</div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">{[0, 1].map(item => <div key={item} className="h-[370px] animate-pulse rounded-xl" style={{ backgroundColor: fill }} />)}</div>
      <div className="h-[260px] animate-pulse rounded-xl" style={{ backgroundColor: fill }} />
    </div>
  );
}

export function UserDashboardAnalytics({
  currentSnapshot,
  timeZone,
  onRefresh,
}: {
  currentSnapshot: UserDashboard;
  timeZone: string;
  onRefresh?: () => void;
}) {
  const today = dateInZone(new Date(), timeZone || "UTC");
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<Range>(() => presetRange("30d", today));
  const [draftRange, setDraftRange] = useState<Range>(range);
  const [rangeError, setRangeError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isDark, setIsDark] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(INTERVAL_OPTIONS[0].ms);
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const refreshMenuRef = useRef<HTMLDivElement>(null);

  const params: GetUserDashboardAnalyticsParams = useMemo(
    () => ({ from: range.from, to: range.to, page, pageSize }),
    [range.from, range.to, page, pageSize],
  );
  const query = useGetUserDashboardAnalytics(params, {
    query: {
      queryKey: getGetUserDashboardAnalyticsQueryKey(params),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: autoRefresh ? selectedIntervalMs : false,
    },
  });
  const data = query.data;
  const colors = {
    ink: isDark ? "#edf2e9" : "#263a35",
    muted: isDark ? "#9aaca5" : "#7f8b84",
    grid: isDark ? "rgba(224,238,226,.10)" : "#e6ebe5",
    tick: isDark ? "#9daea7" : "#75827b",
    surface: isDark ? "#1b2b2b" : "#fbfcf8",
    border: isDark ? "#304343" : "#e2e7df",
  };

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (refreshMenuRef.current && !refreshMenuRef.current.contains(event.target as Node)) setRefreshMenuOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  useEffect(() => {
    setDraftRange(range);
  }, [range]);

  useEffect(() => {
    if (query.isFetching) {
      setIsSpinning(true);
      return;
    }
    const timeout = window.setTimeout(() => setIsSpinning(false), 600);
    return () => window.clearTimeout(timeout);
  }, [query.isFetching]);

  const applyPreset = (next: Exclude<Preset, "custom">) => {
    const nextRange = presetRange(next, today);
    setPreset(next);
    setRange(nextRange);
    setPage(1);
    setRangeError("");
  };

  const applyCustomRange = () => {
    if (!draftRange.from || !draftRange.to || draftRange.from > draftRange.to) {
      setRangeError("Choose a valid start and end date.");
      return;
    }
    if (draftRange.to > today) {
      setRangeError("The end date cannot be in the future in your account timezone.");
      return;
    }
    if (daysBetweenInclusive(draftRange.from, draftRange.to) > 180) {
      setRangeError("Custom ranges are limited to 180 inclusive days.");
      return;
    }
    setRangeError("");
    setPreset("custom");
    setRange(draftRange);
    setPage(1);
  };

  const refreshLabel = data?.generatedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timeZone || "UTC" }).format(new Date(data.generatedAt))
    : null;
  const rangeLabel = data
    ? `${formatDate(data.period.from)} – ${formatDate(data.period.to, { year: "numeric" })}`
    : `${formatDate(range.from)} – ${formatDate(range.to, { year: "numeric" })}`;
  const trend = data?.trend ?? [];
  const outcomeRows = data?.recipientOutcomes ?? [];
  const campaignsTrendCsv = trend.map(point => ({ Date: point.date, "Campaigns created": point.campaignsCreated }));
  const recipientsTrendCsv = trend.map(point => ({ Date: point.date, "Campaign recipient records": point.recipients }));
  const contactsTrendCsv = trend.map(point => ({ Date: point.date, "Contacts added": point.contactsAdded }));
  const outcomesCsv = outcomeRows.map(outcome => ({ Outcome: outcome.label, Recipients: outcome.count }));
  const trendWithDate = trend.map(point => ({ ...point, day: formatDate(point.date) }));
  const campaignsCreatedTotal = trend.reduce((sum, point) => sum + point.campaignsCreated, 0);
  const recipientsTotal = trend.reduce((sum, point) => sum + point.recipients, 0);
  const contactsAddedTotal = trend.reduce((sum, point) => sum + point.contactsAdded, 0);
  const hasCampaignTrend = campaignsCreatedTotal > 0;
  const hasRecipientTrend = recipientsTotal > 0;
  const hasContactTrend = contactsAddedTotal > 0;
  const hasOutcomeData = outcomeRows.some(item => item.count > 0);

  const chartTooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: isDark ? "#fdfcf8" : "#fffefa",
    color: "#263a35",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(30,46,41,.1)",
  };
  const totalPages = data?.pagination.totalPages ?? 0;
  const startRow = data && data.pagination.totalCampaigns ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0;
  const endRow = data ? Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.totalCampaigns) : 0;
  const customRangeValidity = draftRange.from && draftRange.to ? daysBetweenInclusive(draftRange.from, draftRange.to) : 0;
  const refreshDashboard = () => {
    void query.refetch();
    onRefresh?.();
  };

  return (
    <section
      className="space-y-4 rounded-2xl p-3 transition-colors sm:space-y-5 sm:p-5 lg:p-6"
      data-testid="user-dashboard-analytics"
      aria-label="Campaign and contact analytics"
      style={{
        backgroundColor: isDark ? "#101d1d" : "#edf1e9",
        color: colors.ink,
        ["--analytics-border" as string]: colors.border,
      }}
    >
      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          body * { visibility: hidden !important; }
          [data-testid="user-dashboard-analytics"],
          [data-testid="user-dashboard-analytics"] * { visibility: visible !important; }
          [data-testid="user-dashboard-analytics"] {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: #fff !important;
            color: #1f2937 !important;
          }
          [data-testid="user-dashboard-analytics"] * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      <header className="relative overflow-visible rounded-xl border px-4 py-5 sm:px-6 sm:py-6" style={{ backgroundColor: isDark ? "#1a2b2a" : "#f7f6ed", borderColor: colors.border }}>
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[9px] font-medium uppercase tracking-[.17em]" style={{ color: isDark ? "#a9bdaf" : "#658174" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CHART_COLORS.green }} />
              Activity intelligence <span style={{ color: isDark ? "#60746b" : "#b2bcb0" }}>/</span> tenant workspace
            </div>
            <h2 className="mt-2 text-[25px] font-semibold leading-tight tracking-[-.045em] sm:text-[31px]" style={{ color: isDark ? "#eef3ea" : "#203b39" }}>The work behind every send.</h2>
            <p className="mt-2 max-w-2xl text-[12px] leading-5 sm:text-[13px]" style={{ color: isDark ? "#a3b4ac" : "#718078" }}>
              Track campaign creation, recipient activity and contacts added. SMTP acceptance is not confirmation of inbox delivery.
            </p>
            {DATA_SOURCES.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="shrink-0 text-[10px]" style={{ color: isDark ? "#9aaca5" : "#7f8b84" }}>Data sources:</span>
              {DATA_SOURCES.map(source => <span key={source} title={source} className="max-w-[20ch] truncate rounded px-2 py-0.5 text-[10px] font-semibold print:bg-[#e5e7eb] print:text-[#4b5563]" style={{ backgroundColor: isDark ? "rgba(255,255,255,.1)" : "#e5e7eb", color: isDark ? "#c8c9cc" : "#4b5563" }}>{source}</span>)}
            </div>}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: isDark ? "#93a69c" : "#7d8981" }}>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Selected period: <strong className="font-semibold" style={{ color: isDark ? "#d8e2d8" : "#40574d" }} data-testid="analytics-date-scope">{rangeLabel}</strong></span>
              <span className="hidden h-3 w-px sm:block" style={{ backgroundColor: colors.border }} />
              <span data-testid="analytics-timezone">Account timezone: {timeZone || "UTC"}</span>
              {refreshLabel && <><span className="hidden h-3 w-px sm:block" style={{ backgroundColor: colors.border }} /><span data-testid="analytics-last-refreshed">Updated {refreshLabel}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative" ref={refreshMenuRef}>
              <div className="flex h-9 overflow-hidden rounded-md border" style={{ borderColor: colors.border, backgroundColor: isDark ? "#253735" : "#e8ece5", color: isDark ? "#d3ded6" : "#50635a" }}>
                <button
                  type="button"
                  data-testid="button-refresh-analytics"
                  onClick={refreshDashboard}
                  disabled={query.isFetching}
                  aria-label="Refresh analytics now"
                  className="inline-flex items-center gap-2 px-3 text-[11px] font-semibold transition hover:opacity-75 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSpinning ? "animate-spin" : ""}`} aria-hidden="true" />
                  {query.isFetching ? "Refreshing" : "Refresh"}
                </button>
                <span className="my-2 w-px" style={{ backgroundColor: isDark ? "#40534e" : "#cdd6ce" }} />
                <button
                  type="button"
                  data-testid="button-auto-refresh-menu"
                  aria-label="Auto-refresh settings"
                  aria-expanded={refreshMenuOpen}
                  onClick={() => setRefreshMenuOpen(open => !open)}
                  className="grid w-9 place-items-center transition hover:opacity-75"
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              {refreshMenuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-[230px] rounded-lg border p-2 shadow-xl" style={{ borderColor: colors.border, backgroundColor: isDark ? "#203130" : "#fffefa" }} data-testid="analytics-refresh-menu">
                  <button
                    type="button"
                    data-testid="toggle-auto-refresh"
                    onClick={() => setAutoRefresh(value => !value)}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[11px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    Auto-refresh <span className="rounded-full px-2 py-0.5 text-[9px]" style={{ color: autoRefresh ? "#286c52" : colors.muted, backgroundColor: autoRefresh ? "#dcefe1" : (isDark ? "#31413d" : "#edf0ea") }}>{autoRefresh ? "On" : "Off"}</span>
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: colors.border }} />
                  {INTERVAL_OPTIONS.map(option => (
                    <button
                      key={option.ms}
                      type="button"
                      data-testid={`option-refresh-${option.ms}`}
                      onClick={() => { setSelectedIntervalMs(option.ms); setAutoRefresh(true); setRefreshMenuOpen(false); }}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[10px] transition hover:opacity-75"
                      style={{ color: isDark ? "#c1cec5" : "#596a60" }}
                    >
                      {option.label}{selectedIntervalMs === option.ms && autoRefresh ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    </button>
                  ))}
                  <p className="px-2.5 pb-1 pt-1 text-[9px] leading-4" style={{ color: colors.muted }}>Auto-refresh is off until enabled. The shortest interval is 5 minutes.</p>
                </div>
              )}
            </div>
            <button type="button" data-testid="button-print-analytics" onClick={() => window.print()} aria-label="Print or save analytics as PDF" className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[11px] font-semibold transition hover:opacity-75" style={{ borderColor: colors.border, backgroundColor: isDark ? "#253735" : "#e8ece5", color: isDark ? "#d3ded6" : "#50635a" }}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Print / PDF</span>
            </button>
            <button type="button" data-testid="toggle-analytics-dark-mode" onClick={() => setIsDark(value => !value)} aria-label={isDark ? "Use light analytics theme" : "Use dark analytics theme"} aria-pressed={isDark} className="grid h-9 w-9 place-items-center rounded-md border transition hover:opacity-75" style={{ borderColor: colors.border, backgroundColor: isDark ? "#253735" : "#e8ece5", color: isDark ? "#e7c78f" : "#50635a" }}>
              {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="mt-5 rounded-lg border px-3.5 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4" style={{ borderColor: isDark ? "#354842" : "#dfe6dc", backgroundColor: isDark ? "#1d302c" : "#eff3e9" }}>
          <div className="flex items-start gap-2.5">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: isDark ? "#a9bea8" : "#6b8871" }} aria-hidden="true" />
            <p className="text-[10px] leading-4" style={{ color: isDark ? "#b2c0b5" : "#65796d" }}>
              <strong className="font-semibold" style={{ color: isDark ? "#e1e9dd" : "#3d574a" }}>Cohort lens.</strong> Campaign outcomes show each campaign’s current observed status for campaigns created in this date range; outcomes can change after creation.
            </p>
          </div>
          <span className="mt-2 inline-flex shrink-0 items-center gap-1.5 text-[9px] font-medium sm:mt-0" style={{ color: isDark ? "#9fb1a4" : "#728277" }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CHART_COLORS.blue }} /> SMTP accepted ≠ inbox delivered</span>
        </div>
      </header>

      <section aria-label="Analytics date filters" className="rounded-xl border p-4 sm:p-5" style={{ borderColor: colors.border, backgroundColor: isDark ? "#172526" : "#fffefa" }}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[9px] font-medium uppercase tracking-[.16em]" style={{ color: isDark ? "#a4b7aa" : "#77877c" }}>Reporting window</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"],
                ["this-month", "This month"], ["last-month", "Last month"],
              ] as [Exclude<Preset, "custom">, string][]).map(([key, label]) => (
                <button key={key} type="button" data-testid={`button-date-preset-${key}`} onClick={() => applyPreset(key)} aria-pressed={preset === key} className="min-h-8 rounded-md border px-3 text-[10px] font-semibold transition" style={{ borderColor: preset === key ? (isDark ? "#749a86" : "#93ad9a") : colors.border, backgroundColor: preset === key ? (isDark ? "#2c463d" : "#e9f1e9") : (isDark ? "#1d2d2c" : "#fbfcf8"), color: preset === key ? (isDark ? "#dce9dd" : "#3d6953") : colors.muted }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(145px,1fr)_minmax(145px,1fr)_auto] sm:items-end">
            <label className="flex min-w-0 flex-col gap-1 text-[9px] font-semibold uppercase tracking-[.1em]" style={{ color: colors.muted }}>
              Start date
              <input type="date" data-testid="input-analytics-from" value={draftRange.from} max={draftRange.to || today} onChange={event => { setDraftRange(current => ({ ...current, from: event.target.value })); setPreset("custom"); }} className="h-9 min-w-0 rounded-md border px-2.5 text-[11px] font-medium normal-case tracking-normal outline-none focus:ring-2" style={{ borderColor: colors.border, backgroundColor: isDark ? "#1d2d2c" : "#fffefa", color: colors.ink, ["--tw-ring-color" as string]: isDark ? "#678e7b" : "#8fb09a" }} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[9px] font-semibold uppercase tracking-[.1em]" style={{ color: colors.muted }}>
              End date
              <input type="date" data-testid="input-analytics-to" value={draftRange.to} min={draftRange.from} max={today} onChange={event => { setDraftRange(current => ({ ...current, to: event.target.value })); setPreset("custom"); }} className="h-9 min-w-0 rounded-md border px-2.5 text-[11px] font-medium normal-case tracking-normal outline-none focus:ring-2" style={{ borderColor: colors.border, backgroundColor: isDark ? "#1d2d2c" : "#fffefa", color: colors.ink, ["--tw-ring-color" as string]: isDark ? "#678e7b" : "#8fb09a" }} />
            </label>
            <button type="button" data-testid="button-apply-analytics-range" onClick={applyCustomRange} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-[10px] font-semibold text-white transition hover:opacity-90" style={{ backgroundColor: isDark ? "#527c68" : "#34755f" }}>
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Apply range
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] leading-4" style={{ color: colors.muted }}>
          <span>Dates follow {timeZone || "UTC"} account-local calendar days. Comparisons use the equal-length period immediately before the selected range.</span>
          <span data-testid="analytics-range-length" className="font-medium">{customRangeValidity ? `${customRangeValidity} inclusive days` : "Select a date window"}</span>
        </div>
        {rangeError && <p data-testid="analytics-range-error" role="alert" className="mt-2 rounded-md border px-3 py-2 text-[10px]" style={{ borderColor: "#e6c4b8", backgroundColor: isDark ? "#3a2926" : "#fff4ef", color: isDark ? "#f0b6a3" : "#9c4c39" }}>{rangeError} Maximum custom range: 180 days.</p>}
      </section>

      {query.isLoading && !data ? <SkeletonAnalytics isDark={isDark} /> : null}
      {query.isError && !data ? (
        <section role="alert" aria-label="Analytics load error" data-testid="dashboard-analytics-error" className="rounded-xl border px-5 py-6" style={{ borderColor: isDark ? "#765143" : "#e8cbbb", backgroundColor: isDark ? "#302522" : "#fff8f2" }}>
          <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#bd692d" }} /><div><h3 className="text-[13px] font-semibold" style={{ color: isDark ? "#f0c7af" : "#75421f" }}>Analytics couldn’t load</h3><p className="mt-1 text-[11px] leading-5" style={{ color: isDark ? "#c4a18e" : "#93694c" }}>Your workspace snapshot is still available. Retry to reload the selected reporting window.</p></div></div>
          <button type="button" data-testid="button-retry-analytics" onClick={refreshDashboard} disabled={query.isFetching} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-[10px] font-semibold disabled:opacity-50" style={{ borderColor: isDark ? "#805941" : "#e8c5a8", backgroundColor: isDark ? "#3b2c27" : "#fff", color: isDark ? "#f0c7af" : "#94501f" }}><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />Try again</button>
        </section>
      ) : null}
      {query.isError && data ? <div role="status" data-testid="analytics-refresh-warning" className="rounded-lg border px-4 py-3 text-[10px]" style={{ borderColor: isDark ? "#765143" : "#e8cbbb", backgroundColor: isDark ? "#302522" : "#fff8f2", color: isDark ? "#e1b59e" : "#87583a" }}>Could not refresh this range. Showing the last loaded analytics. <button type="button" onClick={refreshDashboard} className="font-semibold underline underline-offset-2">Retry</button></div> : null}

      {data && !query.isLoading ? (
        <>
          {query.isFetching && <p className="sr-only" role="status" data-testid="analytics-refreshing-status">Refreshing analytics</p>}
          <section aria-label="Selected period analytics totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard isDark={isDark} label="Campaigns created" value={data.totals.campaignsCreated} previous={data.previousTotals.campaignsCreated} note="Campaigns first created in this period" tone="blue" testId="analytics-kpi-campaigns-created" />
            <KpiCard isDark={isDark} label="Campaign recipients" value={data.totals.campaignRecipients} previous={data.previousTotals.campaignRecipients} note="Recipient records in this campaign cohort; people repeated across campaigns count again" tone="purple" testId="analytics-kpi-campaign-recipients" />
            <KpiCard isDark={isDark} label="SMTP accepted" value={data.totals.smtpAccepted} previous={data.previousTotals.smtpAccepted} note="Accepted by the sender's SMTP server; not inbox delivery" tone="green" testId="analytics-kpi-smtp-accepted" />
            <KpiCard isDark={isDark} label="Contacts added" value={data.totals.contactsAdded} previous={data.previousTotals.contactsAdded} note="Contacts added during the selected period" tone="blue" testId="analytics-kpi-contacts-added" />
          </section>

          <section className="grid gap-4 xl:grid-cols-2" aria-label="Campaign and contact activity charts">
            <ChartPanel isDark={isDark} eyebrow="CAMPAIGN COHORT" title="Campaigns created" description="Campaign records first created on each account-local day in this reporting window." csvName="campaigns-created-by-day.csv" csvRows={campaignsTrendCsv}>
              {hasCampaignTrend ? <TrendArea data={trendWithDate} dataKey="campaignsCreated" color={CHART_COLORS.blue} colors={colors} tooltipStyle={chartTooltipStyle} /> : <ChartEmpty isDark={isDark} title="No campaigns in this window" detail="Campaign activity will appear when a campaign is created during the selected dates." />}
            </ChartPanel>
            <ChartPanel isDark={isDark} eyebrow="CAMPAIGN COHORT" title="Campaign recipient records" description="Recipient records attached to campaigns created on each day; repeated people across campaigns are counted separately." csvName="campaign-recipient-records-by-day.csv" csvRows={recipientsTrendCsv}>
              {hasRecipientTrend ? <TrendArea data={trendWithDate} dataKey="recipients" color={CHART_COLORS.purple} colors={colors} tooltipStyle={chartTooltipStyle} /> : <ChartEmpty isDark={isDark} title="No campaign recipients in this window" detail="Recipient records will appear when campaigns in this period have an audience." />}
            </ChartPanel>
            <ChartPanel isDark={isDark} eyebrow="AUDIENCE GROWTH" title="Contacts added" description="New contact records created on each account-local day in this reporting window." csvName="contacts-added-by-day.csv" csvRows={contactsTrendCsv}>
              {hasContactTrend ? <TrendArea data={trendWithDate} dataKey="contactsAdded" color={CHART_COLORS.green} colors={colors} tooltipStyle={chartTooltipStyle} /> : <ChartEmpty isDark={isDark} title="No contacts added in this window" detail="New contacts will appear here when they are created during the selected dates." />}
            </ChartPanel>
            <ChartPanel isDark={isDark} eyebrow="OBSERVED STATUS SIGNALS" title="Recipient status signals" description="Independent counts of current recipient statuses and reports. Signals may overlap and are not a part-to-whole total." csvName="campaign-recipient-status-signals.csv" csvRows={outcomesCsv}>
              {hasOutcomeData ? (
                <div className="h-[260px] sm:h-[300px]" role="img" aria-label="Horizontal bar chart comparing current recipient status signals">
                  <ResponsiveContainer width="100%" height="100%" debounce={0}>
                    <BarChart data={outcomeRows} layout="vertical" margin={{ top: 8, right: 14, bottom: 2, left: 0 }} accessibilityLayer>
                      <CartesianGrid stroke={colors.grid} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: colors.tick }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 9, fill: colors.tick }} axisLine={false} tickLine={false} />
                      <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,.04)" }} contentStyle={chartTooltipStyle} formatter={(value: number) => [value.toLocaleString(), "Recipients"]} />
                      <Bar dataKey="count" name="Recipients" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={24}>
                        {outcomeRows.map((row, index) => <Cell key={row.key} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <ChartEmpty isDark={isDark} title="No recipient status signals yet" detail="Status counts appear as recipient sending outcomes are observed." />}
              <p className="mt-2 border-t pt-3 text-[9px] leading-4" style={{ borderColor: colors.border, color: colors.muted }}>SMTP acceptance is not confirmation of inbox delivery. A later provider report can add a bounce signal for an SMTP-accepted message.</p>
            </ChartPanel>
          </section>

          <section aria-label="Current workspace snapshots" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SnapshotTile isDark={isDark} label="Contacts in workspace" value={currentSnapshot.contacts} note="Current workspace snapshot · not date-filtered" testId="analytics-current-contacts" icon={<Users className="h-4 w-4" />} />
            <SnapshotTile isDark={isDark} label="Companies" value={currentSnapshot.companies} note="Current workspace snapshot · not date-filtered" testId="analytics-current-companies" icon={<Activity className="h-4 w-4" />} />
            <SnapshotTile isDark={isDark} label="Active lists" value={currentSnapshot.activeLists} note="Current workspace snapshot · not date-filtered" testId="analytics-current-active-lists" icon={<Users className="h-4 w-4" />} />
            <SnapshotTile isDark={isDark} label="Campaigns in workspace" value={currentSnapshot.campaignCount} note="Current / lifetime workspace snapshot · not date-filtered" testId="analytics-current-campaign-count" icon={<Activity className="h-4 w-4" />} />
            <SnapshotSpendTile isDark={isDark} amounts={currentSnapshot.amountSpentByCurrency} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2" aria-label="Current contact profile snapshots">
            <ProfileDistribution
              isDark={isDark}
              colors={colors}
              tooltipStyle={chartTooltipStyle}
              title="Lifecycle stages"
              eyebrow="CURRENT CONTACT PROFILE"
              description="Current workspace contact counts by lifecycle stage; not filtered by the reporting window."
              csvName="current-contact-lifecycle-stages.csv"
              testId="chart-current-lifecycle-stages"
              rows={currentSnapshot.lifecycleStages}
              hasContacts={currentSnapshot.contacts > 0}
              color={CHART_COLORS.blue}
            />
            <ProfileDistribution
              isDark={isDark}
              colors={colors}
              tooltipStyle={chartTooltipStyle}
              title="Lead status"
              eyebrow="CURRENT CONTACT PROFILE"
              description="Current workspace contact counts by lead status; not filtered by the reporting window."
              csvName="current-contact-lead-status.csv"
              testId="chart-current-lead-status"
              rows={currentSnapshot.leadStatuses}
              hasContacts={currentSnapshot.contacts > 0}
              color={CHART_COLORS.purple}
            />
          </section>

          <section className="overflow-hidden rounded-xl border" style={{ borderColor: colors.border, backgroundColor: isDark ? "#172526" : "#fffefa" }} aria-label="Campaign cohort table">
            <header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5" style={{ borderColor: colors.border, backgroundColor: isDark ? "#1b2b2b" : "#f4f5ee" }}>
              <div>
                <p className="font-mono text-[9px] font-medium uppercase tracking-[.16em]" style={{ color: isDark ? "#a8b8ad" : "#75877c" }}>Campaign cohort / {rangeLabel}</p>
                <h3 className="mt-1 text-[16px] font-semibold tracking-[-.025em]" style={{ color: colors.ink }}>Campaigns created in this period</h3>
                <p className="mt-1 text-[10px] leading-4" style={{ color: colors.muted }}>Outcome columns show current observed status for this selected campaign cohort.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/campaigns" data-testid="link-analytics-manage-campaigns" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold no-underline transition hover:opacity-75" style={{ borderColor: colors.border, backgroundColor: isDark ? "#223534" : "#fffefa", color: isDark ? "#d3ded6" : "#355f84" }}>Manage campaigns <ArrowUpRight className="h-3 w-3" /></Link>
                <label className="flex items-center gap-2 text-[10px] font-medium" style={{ color: colors.muted }}>
                  Rows
                  <select data-testid="select-analytics-page-size" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="h-8 rounded-md border px-2 text-[10px] outline-none" style={{ borderColor: colors.border, backgroundColor: isDark ? "#1d2d2c" : "#fffefa", color: colors.ink }}>
                    {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
              </div>
            </header>
            {data.campaigns.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] border-collapse text-left">
                    <thead>
                      <tr className="border-b font-mono text-[9px] uppercase tracking-[.1em]" style={{ borderColor: colors.border, color: colors.muted }}>
                        <th scope="col" className="px-4 py-3 font-medium sm:px-5">Campaign</th>
                        <th scope="col" className="px-3 py-3 font-medium">Status</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Recipients</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">SMTP accepted</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Bounced</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Suppressed</th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">Queued / sending</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">Unknown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map(campaign => (
                        <tr key={campaign.id} data-testid={`analytics-campaign-row-${campaign.id}`} className="border-b last:border-0" style={{ borderColor: colors.border }}>
                          <td className="max-w-[260px] px-4 py-3 sm:px-5">
                            <div className="truncate text-sm font-semibold" style={{ color: colors.ink }} title={campaign.name}>{campaign.name}</div>
                            <div className="mt-1 text-xs tabular-nums" style={{ color: colors.muted }}>Created {formatDate(dateInZone(new Date(campaign.createdAt), timeZone))}</div>
                          </td>
                          <td className="px-3 py-3"><StatusPill status={campaign.status} isDark={isDark} /></td>
                          <TableNumber value={campaign.recipients} isDark={isDark} />
                          <TableNumber value={campaign.smtpAccepted} isDark={isDark} />
                          <TableNumber value={campaign.bounced} isDark={isDark} />
                          <TableNumber value={campaign.suppressed} isDark={isDark} />
                          <TableNumber value={campaign.queuedOrSending} isDark={isDark} />
                          <TableNumber value={campaign.unknown} isDark={isDark} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5" style={{ borderColor: colors.border }}>
                  <p className="text-[10px] tabular-nums" style={{ color: colors.muted }} data-testid="analytics-campaign-pagination-summary">
                    {startRow ? `Showing ${startRow}–${endRow} of ${data.pagination.totalCampaigns.toLocaleString()} campaigns` : "No campaigns"}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="mr-1 text-[10px] tabular-nums" style={{ color: colors.muted }} data-testid="analytics-campaign-page">Page {data.pagination.page} of {Math.max(totalPages, 1)}</span>
                    <button type="button" data-testid="button-analytics-previous-page" aria-label="Previous campaign page" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => Math.max(1, value - 1))} className="grid h-8 w-8 place-items-center rounded-md border disabled:opacity-40" style={{ borderColor: colors.border, color: colors.ink }}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" data-testid="button-analytics-next-page" aria-label="Next campaign page" disabled={page >= totalPages || query.isFetching} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="grid h-8 w-8 place-items-center rounded-md border disabled:opacity-40" style={{ borderColor: colors.border, color: colors.ink }}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="px-4 py-10 sm:px-6"><ChartEmpty isDark={isDark} title="No campaigns created in this window" detail="Try a wider date range. Campaigns are grouped by their creation date, while outcomes represent their current observed status." /></div>
            )}
            <div className="border-t px-4 py-3 text-[9px] leading-4 sm:px-5" style={{ borderColor: colors.border, backgroundColor: isDark ? "#1a2928" : "#fafbf7", color: colors.muted }}>
              SMTP accepted means the sender’s SMTP server accepted the message. It does not mean the message reached the recipient’s inbox.
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] leading-4" style={{ color: colors.muted }}>
            <span data-testid="analytics-report-generated">Report generated {refreshLabel ?? "—"} · {data.period.timezone}</span>
            <span>Workspace analytics only · no inbox-delivery claims</span>
          </div>
        </>
      ) : null}
    </section>
  );
}

type TrendPoint = {
  date: string;
  day: string;
  campaignsCreated: number;
  recipients: number;
  contactsAdded: number;
};

type AnalyticsColors = {
  ink: string;
  muted: string;
  grid: string;
  tick: string;
  surface: string;
  border: string;
};

function TrendArea({
  data,
  dataKey,
  color,
  colors,
  tooltipStyle,
}: {
  data: TrendPoint[];
  dataKey: "campaignsCreated" | "recipients" | "contactsAdded";
  color: string;
  colors: AnalyticsColors;
  tooltipStyle: React.CSSProperties;
}) {
  const metricName = dataKey === "campaignsCreated"
    ? "Campaigns created"
    : dataKey === "recipients"
      ? "Campaign recipient records"
      : "Contacts added";
  const gradientId = `analytics-gradient-${dataKey}`;
  return (
    <div className="rounded-lg border p-2 pt-3 sm:p-3" style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
      <div className="h-[230px] sm:h-[260px]" role="img" aria-label={`${metricName} by day`}>
        <ResponsiveContainer width="100%" height="100%" debounce={0}>
          <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 2, left: -14 }} accessibilityLayer>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: colors.tick }} axisLine={false} tickLine={false} minTickGap={18} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: colors.tick }} axisLine={false} tickLine={false} width={42} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: colors.tick, strokeDasharray: "3 3" }}
              contentStyle={tooltipStyle}
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? _label}
              formatter={(value: number) => [value.toLocaleString(), metricName]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              name={metricName}
              fill={`url(#${gradientId})`}
              fillOpacity={1}
              stroke={color}
              strokeWidth={2.4}
              activeDot={{ r: 4, fill: color, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SnapshotSpendTile({
  isDark,
  amounts,
}: {
  isDark: boolean;
  amounts: UserDashboard["amountSpentByCurrency"];
}) {
  return (
    <article
      className="overflow-hidden rounded-xl border px-4 py-4 sm:px-5"
      style={{ borderColor: isDark ? "#304343" : "#e2e7df", backgroundColor: isDark ? "#172526" : "#fffefa" }}
      data-testid="analytics-current-captured-spend"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[.11em]" style={{ color: isDark ? "#9aafaa" : "#778680" }}>Captured spend</p>
      <p className="mt-1.5 text-[9px]" style={{ color: isDark ? "#91a19b" : "#87938d" }}>Lifetime captured totals · not date-filtered</p>
      {amounts.length ? (
        <div className="mt-3 space-y-1.5">
          {amounts.map(item => (
            <div key={item.currency} data-testid={`analytics-spend-${item.currency.toLowerCase()}`} className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] font-medium" style={{ color: isDark ? "#9aaca5" : "#718078" }}>{item.currency}</span>
              <strong className="text-[15px] font-semibold tabular-nums" style={{ color: isDark ? "#f0f4ec" : "#203b39" }}>{formatMinorAmount(item.amountMinor, item.currency)}</strong>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-[13px] font-semibold" style={{ color: isDark ? "#d0d9d2" : "#40514a" }}>No captured spend</p>}
    </article>
  );
}

function ProfileDistribution({
  isDark,
  colors,
  tooltipStyle,
  title,
  eyebrow,
  description,
  csvName,
  testId,
  rows,
  hasContacts,
  color,
}: {
  isDark: boolean;
  colors: AnalyticsColors;
  tooltipStyle: React.CSSProperties;
  title: string;
  eyebrow: string;
  description: string;
  csvName: string;
  testId: string;
  rows: UserDashboard["lifecycleStages"];
  hasContacts: boolean;
  color: string;
}) {
  const chartRows = rows.map(row => ({ name: row.value.trim() || "Not set", count: row.count }));
  const csvRows = chartRows.map(row => ({ Stage: row.name, Contacts: row.count }));
  const height = Math.max(230, Math.min(430, chartRows.length * 34 + 40));
  return (
    <ChartPanel isDark={isDark} eyebrow={eyebrow} title={title} description={description} csvName={csvName} csvRows={csvRows}>
      {hasContacts && chartRows.length ? (
        <div className="rounded-lg border p-2 sm:p-3" style={{ borderColor: colors.border, backgroundColor: colors.surface }} data-testid={testId}>
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%" debounce={0}>
              <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 10, left: 0, bottom: 4 }} accessibilityLayer>
                <CartesianGrid stroke={colors.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: colors.tick }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 10, fill: colors.tick }} axisLine={false} tickLine={false} />
                <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,.04)" }} contentStyle={tooltipStyle} formatter={(value: number) => [value.toLocaleString(), "Contacts"]} />
                <Bar dataKey="count" name="Contacts" fill={color} fillOpacity={0.82} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={25} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : <ChartEmpty isDark={isDark} title="No contact profile data yet" detail={`Counts by ${title.toLowerCase()} will appear as contacts are categorized.`} />}
    </ChartPanel>
  );
}

function SnapshotTile({ isDark, label, value, note, testId, icon }: { isDark: boolean; label: string; value: number; note: string; testId: string; icon: React.ReactNode }) {
  return (
    <article className="flex items-center justify-between gap-4 rounded-xl border px-4 py-4 sm:px-5" style={{ borderColor: isDark ? "#304343" : "#e2e7df", backgroundColor: isDark ? "#172526" : "#fffefa" }}>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[.11em]" style={{ color: isDark ? "#9aafaa" : "#778680" }}>{label}</p>
        <strong className="mt-1.5 block text-[23px] font-semibold leading-none tracking-[-.04em] tabular-nums" style={{ color: isDark ? "#f0f4ec" : "#203b39" }} data-testid={testId}>{value.toLocaleString()}</strong>
        <p className="mt-1.5 text-[9px]" style={{ color: isDark ? "#91a19b" : "#87938d" }}>{note}</p>
      </div>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: isDark ? "#b0c8b5" : "#668d76", backgroundColor: isDark ? "#263c35" : "#eaf2eb" }}>{icon}</span>
    </article>
  );
}

function StatusPill({ status, isDark }: { status: string; isDark: boolean }) {
  const palette = status === "completed"
    ? { bg: isDark ? "#253d33" : "#e9f3eb", fg: isDark ? "#b7d9be" : "#39734f", dot: CHART_COLORS.green }
    : status === "sending" || status === "queued"
      ? { bg: isDark ? "#3d3425" : "#f6efe0", fg: isDark ? "#e5c994" : "#8c6b32", dot: "#b58638" }
      : { bg: isDark ? "#2c3634" : "#eef1ed", fg: isDark ? "#b7c2bb" : "#66756c", dot: "#89978e" };
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold capitalize" style={{ color: palette.fg, backgroundColor: palette.bg }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.dot }} />{status}</span>;
}

function TableNumber({ value, isDark }: { value: number; isDark: boolean }) {
  return <td className="px-3 py-3 text-right font-mono text-sm tabular-nums" style={{ color: isDark ? "#cfdbd2" : "#4e6056" }}>{value.toLocaleString()}</td>;
}

export default UserDashboardAnalytics;
