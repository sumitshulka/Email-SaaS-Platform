import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountLocalDateStartUtc,
  addCalendarDateDays,
} from "../src/lib/account-local-date.ts";

test("account-local date boundaries preserve 23- and 25-hour DST days", () => {
  const zone = "America/New_York";
  const springStart = accountLocalDateStartUtc("2026-03-08", zone);
  const springEnd = accountLocalDateStartUtc("2026-03-09", zone);
  assert.equal(springStart.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(springEnd.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(springEnd.getTime() - springStart.getTime(), 23 * 60 * 60 * 1000);

  const fallStart = accountLocalDateStartUtc("2026-11-01", zone);
  const fallEnd = accountLocalDateStartUtc("2026-11-02", zone);
  assert.equal(fallStart.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(fallEnd.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(fallEnd.getTime() - fallStart.getTime(), 25 * 60 * 60 * 1000);
});

test("calendar-day offsets do not depend on UTC offsets or leap-year length", () => {
  assert.equal(addCalendarDateDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDateDays("2024-02-29", 1), "2024-03-01");
  assert.equal(
    accountLocalDateStartUtc("2026-11-19", "Asia/Kolkata").toISOString(),
    "2026-11-18T18:30:00.000Z",
  );
});
