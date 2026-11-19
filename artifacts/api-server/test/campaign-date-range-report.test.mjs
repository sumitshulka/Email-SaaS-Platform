import assert from "node:assert/strict";
import test from "node:test";
import {
  CampaignDateRangeError,
  resolveCampaignDateRange,
} from "../src/lib/campaign-date-range-report.ts";

const now = new Date("2026-11-19T12:00:00.000Z");

test("resolves named campaign report periods in the user's calendar timezone", () => {
  const expected = {
    this_week: ["2026-11-16", "2026-11-22"],
    last_week: ["2026-11-09", "2026-11-15"],
    this_month: ["2026-11-01", "2026-11-30"],
    last_month: ["2026-10-01", "2026-10-31"],
    this_quarter: ["2026-10-01", "2026-12-31"],
    last_quarter: ["2026-07-01", "2026-09-30"],
    this_year: ["2026-01-01", "2026-12-31"],
    last_year: ["2025-01-01", "2025-12-31"],
  };
  for (const [period, [startDate, endDate]] of Object.entries(expected)) {
    const result = resolveCampaignDateRange(period, undefined, undefined, "Asia/Kolkata", now);
    assert.equal(result.startDate, startDate, `${period} start`);
    assert.equal(result.endDate, endDate, `${period} end`);
  }
});

test("custom ranges allow at most 180 inclusive calendar days", () => {
  const exactLimit = resolveCampaignDateRange(
    "custom",
    "2026-01-01",
    "2026-06-29",
    "UTC",
    now,
  );
  assert.equal(exactLimit.startDate, "2026-01-01");
  assert.equal(exactLimit.endDate, "2026-06-29");

  assert.throws(
    () => resolveCampaignDateRange("custom", "2026-01-01", "2026-06-30", "UTC", now),
    CampaignDateRangeError,
  );
});

test("custom ranges reject missing, reversed, and impossible dates", () => {
  assert.throws(
    () => resolveCampaignDateRange("custom", undefined, "2026-06-01", "UTC", now),
    /Choose both/,
  );
  assert.throws(
    () => resolveCampaignDateRange("custom", "2026-06-02", "2026-06-01", "UTC", now),
    /on or after/,
  );
  assert.throws(
    () => resolveCampaignDateRange("custom", "2026-02-30", "2026-03-01", "UTC", now),
    /valid calendar dates/,
  );
});
