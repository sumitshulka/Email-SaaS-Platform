import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  buildCampaignDateRangeReportPdf,
  buildCampaignDateRangeReportXlsx,
} from "../src/lib/campaign-report-export.ts";

const report = {
  periodLabel: "This Month",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-11-19T12:00:00.000Z",
  summary: {
    campaignCount: 1,
    draftCount: 0,
    queuedCount: 0,
    sendingCount: 0,
    completedCount: 1,
    pausedCount: 0,
    totalRecipients: 12,
    queuedRecipients: 0,
    smtpAccepted: 10,
    rejectedOrFailed: 1,
    suppressed: 1,
    unknown: 0,
  },
  campaigns: [{
    id: "e4ff1d7a-20d1-4b19-96c3-899b2c94f65a",
    name: "Quarterly update",
    campaignType: "primary",
    status: "completed",
    paused: false,
    createdAt: "2026-11-05T10:00:00.000Z",
    scheduledAt: null,
    completedAt: "2026-11-05T12:00:00.000Z",
    recipients: 12,
    queued: 0,
    accepted: 10,
    rejectedOrFailed: 1,
    suppressed: 1,
    unknown: 0,
  }],
};

test("creates a PDF with the selected date range and campaign summary", async () => {
  const output = await buildCampaignDateRangeReportPdf(report);
  assert.ok(output.byteLength > 1000);
  assert.equal(output.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("creates an Excel workbook with summary and campaign detail sheets", async () => {
  const output = await buildCampaignDateRangeReportXlsx(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Summary", "Campaigns"]);
  assert.equal(workbook.getWorksheet("Summary").getCell("B8").value, 1);
  const campaignSheet = workbook.getWorksheet("Campaigns");
  assert.equal(campaignSheet.getCell("A2").value, "Quarterly update");
  assert.equal(campaignSheet.getCell("I2").value, 10);
});

test("escapes spreadsheet formula-like campaign names", async () => {
  const output = await buildCampaignDateRangeReportXlsx({
    ...report,
    campaigns: [{ ...report.campaigns[0], name: "=HYPERLINK(\"https://bad.example\")" }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.equal(workbook.getWorksheet("Campaigns").getCell("A2").value, "'=HYPERLINK(\"https://bad.example\")");
});
