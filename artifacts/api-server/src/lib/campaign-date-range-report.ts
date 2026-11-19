export const CAMPAIGN_REPORT_PERIODS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "custom",
] as const;

export type CampaignReportPeriod = (typeof CAMPAIGN_REPORT_PERIODS)[number];

const PERIOD_LABELS: Record<CampaignReportPeriod, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  last_quarter: "Last Quarter",
  this_year: "This Year",
  last_year: "Last Year",
  custom: "Custom",
};

export class CampaignDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignDateRangeError";
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function calendarDateAt(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function parseCalendarDate(value: string | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CampaignDateRangeError("Choose both a start date and an end date.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new CampaignDateRangeError("Enter valid calendar dates.");
  }
  return parsed;
}

function formatCalendarDate(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function shiftDays(date: Date, amount: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return shifted;
}

function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

function resolvePreset(
  period: Exclude<CampaignReportPeriod, "custom">,
  today: Date,
): { start: Date; end: Date } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  switch (period) {
    case "this_week": {
      const mondayOffset = (today.getUTCDay() + 6) % 7;
      return { start: shiftDays(today, -mondayOffset), end: shiftDays(today, 6 - mondayOffset) };
    }
    case "last_week": {
      const mondayOffset = (today.getUTCDay() + 6) % 7;
      const start = shiftDays(today, -mondayOffset - 7);
      return { start, end: shiftDays(start, 6) };
    }
    case "this_month":
      return { start: monthStart(year, month), end: monthEnd(year, month) };
    case "last_month":
      return { start: monthStart(year, month - 1), end: monthEnd(year, month - 1) };
    case "this_quarter":
      return { start: monthStart(year, quarterStartMonth), end: monthEnd(year, quarterStartMonth + 2) };
    case "last_quarter": {
      const previousQuarterStart = quarterStartMonth - 3;
      const start = monthStart(year, previousQuarterStart);
      return { start, end: monthEnd(year, previousQuarterStart + 2) };
    }
    case "this_year":
      return { start: monthStart(year, 0), end: monthEnd(year, 11) };
    case "last_year":
      return { start: monthStart(year - 1, 0), end: monthEnd(year - 1, 11) };
  }
}

export function resolveCampaignDateRange(
  period: CampaignReportPeriod,
  startDate: string | undefined,
  endDate: string | undefined,
  requestedTimeZone: string,
  now = new Date(),
): { period: CampaignReportPeriod; periodLabel: string; startDate: string; endDate: string; timeZone: string } {
  const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : "UTC";
  let start: Date;
  let end: Date;
  if (period === "custom") {
    start = parseCalendarDate(startDate);
    end = parseCalendarDate(endDate);
    if (end < start) {
      throw new CampaignDateRangeError("The end date must be on or after the start date.");
    }
    const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (inclusiveDays > 180) {
      throw new CampaignDateRangeError("Custom date ranges cannot be longer than 180 days.");
    }
  } else {
    const today = parseCalendarDate(calendarDateAt(now, timeZone));
    ({ start, end } = resolvePreset(period, today));
  }
  return {
    period,
    periodLabel: PERIOD_LABELS[period],
    startDate: formatCalendarDate(start),
    endDate: formatCalendarDate(end),
    timeZone,
  };
}
