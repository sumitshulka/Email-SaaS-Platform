import { useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  exportCampaignDateRangeReportPdf,
  exportCampaignDateRangeReportXlsx,
  getGetCampaignDateRangeReportQueryKey,
  useGetCampaignDateRangeReport,
} from "@workspace/api-client-react";
import type {
  CampaignDateRangeReport,
  CampaignDateRangeReportInput,
  GetCampaignDateRangeReportParams,
} from "@workspace/api-client-react";

const periods: Array<{ value: GetCampaignDateRangeReportParams["period"]; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "custom", label: "Custom" },
];

const metrics = [
  { key: "campaignCount", label: "Campaigns", surface: { backgroundColor: "#eaf3ff", borderColor: "#c7dcf3", color: "#245b9b" } },
  { key: "totalRecipients", label: "Recipients", surface: { backgroundColor: "#eff8f1", borderColor: "#d5ead9", color: "#397050" } },
  { key: "smtpAccepted", label: "SMTP accepted", surface: { backgroundColor: "#edf5f4", borderColor: "#cde3dd", color: "#347060" } },
  { key: "rejectedOrFailed", label: "Rejected / failed", surface: { backgroundColor: "#fff5eb", borderColor: "#f0dfcb", color: "#ae642c" } },
  { key: "suppressed", label: "Suppressed", surface: { backgroundColor: "#f3f5f8", borderColor: "#dfe4e9", color: "#596675" } },
  { key: "queuedRecipients", label: "Still queued", surface: { backgroundColor: "#f3f0fc", borderColor: "#e1dcf4", color: "#65509b" } },
] as const;

const statusLabels: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  sending: "Sending",
  completed: "Completed",
};

function customRangeError(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return "Choose both a start date and an end date.";
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "Enter valid calendar dates.";
  }
  if (end < start) return "The end date must be on or after the start date.";
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > 180) return "Custom date ranges cannot be longer than 180 days.";
  return null;
}

function localizedDate(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

function startDownload(blob: Blob, filename: string): void {
  if (!blob.size) throw new Error("The report download was empty. Try again.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function CampaignDateRangeReportPage() {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<GetCampaignDateRangeReportParams["period"]>("this_month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const rangeError = period === "custom" ? customRangeError(startDate, endDate) : null;
  const params: GetCampaignDateRangeReportParams = {
    period,
    ...(period === "custom" ? { startDate, endDate } : {}),
  };
  const query = useGetCampaignDateRangeReport(params, {
    query: {
      queryKey: getGetCampaignDateRangeReportQueryKey(params),
      enabled: !rangeError,
      staleTime: 0,
    },
  });
  const report = query.data as CampaignDateRangeReport | undefined;

  const download = async (format: "pdf" | "xlsx") => {
    if (rangeError || !report) return;
    setDownloading(format);
    setDownloadError(null);
    const input: CampaignDateRangeReportInput = {
      period,
      ...(period === "custom" ? { startDate, endDate } : {}),
    };
    try {
      const blob = format === "pdf"
        ? await exportCampaignDateRangeReportPdf(input)
        : await exportCampaignDateRangeReportXlsx(input);
      startDownload(
        blob,
        `campaign-report-${report.startDate.slice(0, 10)}-to-${report.endDate.slice(0, 10)}.${format}`,
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not download the campaign report.");
    } finally {
      setDownloading(null);
    }
  };

  return <main className="mx-auto w-full max-w-[1440px] px-5 py-8 text-left sm:px-8">
    <div className="mb-5">
      <button type="button" data-testid="button-back-campaign-report" onClick={() => setLocation("/campaigns")} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#d7dce3] bg-white px-3 text-[12px] font-semibold text-[#344154] hover:bg-[#f7f9fb]">
        <ArrowLeft className="h-3.5 w-3.5"/>Back to campaigns
      </button>
    </div>
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#e5e9ed] pb-5">
      <div>
        <p className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">DELIVERY / CAMPAIGNS / REPORT</p>
        <h1 className="display text-[30px] font-bold leading-tight text-[#172334]">Campaign date report</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#687484]">Review campaign and sending totals for a selected period, then download the full report as PDF or Excel.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="button-export-campaign-report-pdf" disabled={!report || !!rangeError || downloading !== null} onClick={() => void download("pdf")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d7dce3] bg-white px-3.5 text-[12px] font-semibold text-[#344154] hover:bg-[#f7f9fb] disabled:cursor-not-allowed disabled:opacity-50">
          {downloading === "pdf" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <FileText className="h-3.5 w-3.5 text-[#a34b43]"/>}
          Download PDF
        </button>
        <button type="button" data-testid="button-export-campaign-report-xlsx" disabled={!report || !!rangeError || downloading !== null} onClick={() => void download("xlsx")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#cfe2d4] bg-[#f2f8f3] px-3.5 text-[12px] font-semibold text-[#397050] hover:bg-[#eaf4ec] disabled:cursor-not-allowed disabled:opacity-50">
          {downloading === "xlsx" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <FileSpreadsheet className="h-3.5 w-3.5"/>}
          Download Excel
        </button>
      </div>
    </header>

    <section className="mb-5 rounded-xl border border-[#d9e4ec] bg-[#f7fafc] p-4 sm:p-5" aria-label="Campaign report date range">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e8f1fa] text-[#245b9b]"><CalendarDays className="h-4 w-4"/></div>
        <div className="min-w-0 flex-1">
          <label htmlFor="campaign-report-period" className="mb-1.5 block text-[12px] font-semibold text-[#344154]">Date range</label>
          <div className="grid gap-3 sm:grid-cols-[minmax(210px,.7fr)_minmax(180px,1fr)_minmax(180px,1fr)]">
            <select id="campaign-report-period" data-testid="select-campaign-report-period" value={period} onChange={event => setPeriod(event.target.value as GetCampaignDateRangeReportParams["period"])} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[12px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]">
              {periods.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {period === "custom" && <>
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#687484]">Start date</span><input data-testid="input-campaign-report-start-date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[12px] outline-none focus:border-[#3b73b8]"/></label>
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#687484]">End date</span><input data-testid="input-campaign-report-end-date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[12px] outline-none focus:border-[#3b73b8]"/></label>
            </>}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#718091]">The report includes campaigns created during the selected dates. Weeks run Monday through Sunday. Custom ranges can include up to 180 calendar days.</p>
          {rangeError && <p role="alert" data-testid="text-campaign-report-range-error" className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[#a34b32]"><AlertCircle className="h-3.5 w-3.5"/>{rangeError}</p>}
        </div>
      </div>
    </section>

    {downloadError && <div role="alert" data-testid="text-campaign-report-download-error" className="mb-4 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] text-[#99501e]">{downloadError}</div>}
    {query.isLoading && <div role="status" className="rounded-lg border border-[#e0e4e9] bg-white px-5 py-16 text-center text-[12px] text-[#687484]"><LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin text-[#245b9b]"/>Loading campaign report…</div>}
    {query.isError && <div role="alert" className="rounded-lg border border-[#f0d5bd] bg-[#fff8f1] p-5 text-[12px] text-[#99501e]"><div className="flex flex-wrap items-center justify-between gap-3"><span>Could not load this campaign report.</span><button type="button" onClick={() => void query.refetch()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#e6c8af] bg-white px-2.5 text-[11px] font-semibold"><RefreshCw className="h-3 w-3"/>Retry</button></div></div>}
    {report && !query.isError && <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="display text-[17px] font-bold text-[#1b293a]">{report.periodLabel}</h2><p className="mt-1 text-[11px] text-[#788392]">{report.startDate.slice(0, 10)} to {report.endDate.slice(0, 10)} · {report.timeZone} · created {new Date(report.generatedAt).toLocaleString()}</p></div>
        <div className="text-[10px] text-[#84909d]">SMTP accepted does not confirm inbox delivery.</div>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(metric => <div key={metric.key} className="rounded-lg border p-4" style={{ backgroundColor: metric.surface.backgroundColor, borderColor: metric.surface.borderColor }}>
          <div className="text-[11px] text-[#657487]">{metric.label}</div>
          <div className="display mt-1.5 text-[25px] font-bold" style={{ color: metric.surface.color }}>{report.summary[metric.key].toLocaleString()}</div>
        </div>)}
      </div>
      <section className="mb-5 rounded-xl border border-[#e0e4e9] bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e9edf0] px-4 py-3.5">
          <div><h2 className="display text-[16px] font-bold text-[#1b293a]">Campaign breakdown</h2><p className="mt-1 text-[11px] text-[#788392]">{report.summary.campaignCount.toLocaleString()} campaigns · {report.summary.draftCount} drafts · {report.summary.queuedCount} queued · {report.summary.sendingCount} sending · {report.summary.completedCount} completed · {report.summary.pausedCount} paused</p></div>
          <span className="rounded-full bg-[#edf4fc] px-2.5 py-1 text-[10px] font-semibold text-[#245b9b]">{report.campaigns.length.toLocaleString()} rows</span>
        </header>
        <div className="overflow-x-auto">
          <table data-testid="table-campaign-date-report" className="w-full min-w-[1040px] text-left">
            <thead className="bg-[#fafbfc] text-[9px] uppercase tracking-[.12em] text-[#84909d]"><tr>
              {["Campaign", "Type", "Status", "Created", "Recipients", "Queued", "SMTP accepted", "Rejected / failed", "Suppressed", "Unknown"].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {report.campaigns.map(campaign => <tr key={campaign.id} data-testid={`row-campaign-report-${campaign.id}`} className="text-[11px] hover:bg-[#fbfcfd]">
                <td className="max-w-[260px] px-3 py-3 font-semibold text-[#26364a]"><span className="block truncate" title={campaign.name}>{campaign.name}</span></td>
                <td className="px-3 py-3 text-[#687484]">{campaign.campaignType === "follow_up" ? "Follow-up" : "Primary"}</td>
                <td className="px-3 py-3"><span className="rounded-full bg-[#f0f3f6] px-2 py-1 text-[10px] font-medium text-[#536172]">{campaign.paused ? "Paused" : statusLabels[campaign.status] ?? campaign.status}</span></td>
                <td className="px-3 py-3 text-[#687484]">{localizedDate(campaign.createdAt, report.timeZone)}</td>
                <td className="px-3 py-3 tabular-nums text-[#344154]">{campaign.recipients.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-[#344154]">{campaign.queued.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-[#397050]">{campaign.accepted.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-[#ae642c]">{campaign.rejectedOrFailed.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-[#596675]">{campaign.suppressed.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-[#65509b]">{campaign.unknown.toLocaleString()}</td>
              </tr>)}
              {!report.campaigns.length && <tr><td colSpan={10} className="px-4 py-14 text-center"><div className="text-[13px] font-semibold text-[#344154]">No campaigns in this date range</div><p className="mt-1 text-[11px] text-[#788392]">Choose another period to see campaign activity.</p></td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="border-t border-[#e9edf0] bg-[#fbfcfd] px-4 py-3 text-[10px] leading-5 text-[#788392]">Drafts do not have captured recipient totals until they are queued. Rejected / failed counts include SMTP failures and matched provider bounce or failure reports, without double-counting a recipient.</footer>
      </section>
    </>}
  </main>;
}
