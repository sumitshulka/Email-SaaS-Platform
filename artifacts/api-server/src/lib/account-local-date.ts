function parseDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function dateKeyAt(milliseconds: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(milliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month").padStart(2, "0")}-${part("day").padStart(2, "0")}`;
}

export function addCalendarDateDays(value: string, days: number): string {
  const date = parseDateKey(value);
  if (!date || !Number.isInteger(days)) throw new RangeError("Invalid calendar date or day offset.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function accountLocalDateStartUtc(value: string, timeZone: string): Date {
  const date = parseDateKey(value);
  if (!date) throw new RangeError("Invalid calendar date.");

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const targetDate = date.getTime();
  let low = targetDate - 36 * 60 * 60 * 1000;
  let high = targetDate + 36 * 60 * 60 * 1000;

  while (high - low > 1_000) {
    const middle = Math.floor((low + high) / 2_000) * 1_000;
    if (middle <= low) break;
    if (dateKeyAt(middle, formatter) >= value) high = middle;
    else low = middle;
  }

  return new Date(high);
}
