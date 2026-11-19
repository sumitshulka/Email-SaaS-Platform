import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { CampaignReportPeriod } from "./campaign-date-range-report";

export type CampaignDateRangeReportRow = {
  id: string;
  name: string;
  campaignType: "primary" | "follow_up";
  status: "draft" | "queued" | "sending" | "completed";
  paused: boolean;
  createdAt: Date | string;
  scheduledAt: Date | string | null;
  completedAt: Date | string | null;
  recipients: number;
  queued: number;
  accepted: number;
  rejectedOrFailed: number;
  suppressed: number;
  unknown: number;
};

export type CampaignDateRangeReportData = {
  period: CampaignReportPeriod;
  periodLabel: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  generatedAt: Date | string;
  summary: {
    campaignCount: number;
    draftCount: number;
    queuedCount: number;
    sendingCount: number;
    completedCount: number;
    pausedCount: number;
    totalRecipients: number;
    queuedRecipients: number;
    smtpAccepted: number;
    rejectedOrFailed: number;
    suppressed: number;
    unknown: number;
  };
  campaigns: CampaignDateRangeReportRow[];
};

function safeSpreadsheetText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function buildCampaignDateRangeReportXlsx(
  report: CampaignDateRangeReportData,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mailflow";
  workbook.created = new Date();
  workbook.subject = `${report.periodLabel} campaign summary`;

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 34 }, { width: 24 }];
  summary.mergeCells("A1:B1");
  summary.getCell("A1").value = "Mailflow campaign report";
  summary.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF173D5B" } };
  summary.getCell("A2").value = "Campaigns created";
  summary.getCell("B2").value = `${report.startDate} to ${report.endDate}`;
  summary.getCell("A3").value = "Period";
  summary.getCell("B3").value = report.periodLabel;
  summary.getCell("A4").value = "Time zone";
  summary.getCell("B4").value = report.timeZone;
  summary.getCell("A5").value = "Generated";
  summary.getCell("B5").value = new Date(report.generatedAt);
  summary.getCell("B5").numFmt = "yyyy-mm-dd hh:mm";
  const metricRows: Array<[string, number]> = [
    ["Campaigns", report.summary.campaignCount],
    ["Drafts", report.summary.draftCount],
    ["Queued", report.summary.queuedCount],
    ["Sending", report.summary.sendingCount],
    ["Completed", report.summary.completedCount],
    ["Paused", report.summary.pausedCount],
    ["Recipients", report.summary.totalRecipients],
    ["Still queued", report.summary.queuedRecipients],
    ["SMTP accepted", report.summary.smtpAccepted],
    ["Rejected / failed", report.summary.rejectedOrFailed],
    ["Suppressed", report.summary.suppressed],
    ["Unknown outcome", report.summary.unknown],
  ];
  summary.addRow([]);
  summary.addRow(["Summary metric", "Count"]);
  const metricHeader = summary.getRow(7);
  metricHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  metricHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173D5B" } };
  for (const row of metricRows) summary.addRow(row);
  summary.views = [{ state: "frozen", ySplit: 7 }];

  const campaigns = workbook.addWorksheet("Campaigns", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  campaigns.columns = [
    { header: "Campaign", key: "name", width: 34 },
    { header: "Type", key: "type", width: 14 },
    { header: "Status", key: "status", width: 16 },
    { header: "Created", key: "createdAt", width: 20 },
    { header: "Scheduled", key: "scheduledAt", width: 20 },
    { header: "Completed", key: "completedAt", width: 20 },
    { header: "Recipients", key: "recipients", width: 14 },
    { header: "Queued", key: "queued", width: 12 },
    { header: "SMTP accepted", key: "accepted", width: 16 },
    { header: "Rejected / failed", key: "rejectedOrFailed", width: 18 },
    { header: "Suppressed", key: "suppressed", width: 14 },
    { header: "Unknown", key: "unknown", width: 12 },
  ];
  campaigns.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  campaigns.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173D5B" } };
  for (const campaign of report.campaigns) {
    campaigns.addRow({
      name: safeSpreadsheetText(campaign.name),
      type: campaign.campaignType === "follow_up" ? "Follow-up" : "Primary",
      status: campaign.paused ? "Paused" : campaign.status,
      createdAt: new Date(campaign.createdAt),
      scheduledAt: campaign.scheduledAt ? new Date(campaign.scheduledAt) : null,
      completedAt: campaign.completedAt ? new Date(campaign.completedAt) : null,
      recipients: campaign.recipients,
      queued: campaign.queued,
      accepted: campaign.accepted,
      rejectedOrFailed: campaign.rejectedOrFailed,
      suppressed: campaign.suppressed,
      unknown: campaign.unknown,
    });
  }
  for (const key of ["createdAt", "scheduledAt", "completedAt"]) {
    campaigns.getColumn(key).numFmt = "yyyy-mm-dd hh:mm";
  }
  campaigns.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, campaigns.rowCount), column: campaigns.columnCount },
  };
  campaigns.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function pdfDate(value: Date | string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

function addPdfTableHeader(doc: PDFKit.PDFDocument, y: number, widths: number[], x: number): number {
  const headers = ["Campaign", "Type", "Status", "Created", "Recipients", "Queued", "Accepted", "Failed", "Suppressed", "Unknown"];
  const rowHeight = 24;
  doc.rect(x, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill("#173D5B");
  let currentX = x;
  headers.forEach((header, index) => {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7)
      .text(header, currentX + 4, y + 8, { width: widths[index] - 8, lineBreak: false, ellipsis: true });
    currentX += widths[index];
  });
  return y + rowHeight;
}

export async function buildCampaignDateRangeReportPdf(
  report: CampaignDateRangeReportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    doc.fillColor("#173D5B").font("Helvetica-Bold").fontSize(19)
      .text("Campaign summary report", left, 30);
    doc.fillColor("#53677B").font("Helvetica").fontSize(9)
      .text(`${report.periodLabel} · Campaigns created ${report.startDate} to ${report.endDate}`, left, 58);
    doc.fillColor("#778697").fontSize(8)
      .text(`Time zone: ${report.timeZone} · Generated: ${new Date(report.generatedAt).toLocaleString("en-GB", { timeZone: report.timeZone })}`, left, 73);

    const metrics: Array<[string, number]> = [
      ["Campaigns", report.summary.campaignCount],
      ["Recipients", report.summary.totalRecipients],
      ["SMTP accepted", report.summary.smtpAccepted],
      ["Rejected / failed", report.summary.rejectedOrFailed],
      ["Suppressed", report.summary.suppressed],
      ["Still queued", report.summary.queuedRecipients],
    ];
    const gap = 8;
    const cardWidth = (right - left - gap * (metrics.length - 1)) / metrics.length;
    const cardY = 96;
    metrics.forEach(([label, value], index) => {
      const x = left + index * (cardWidth + gap);
      doc.roundedRect(x, cardY, cardWidth, 42, 5).fill("#F0F5FA");
      doc.fillColor("#64758A").font("Helvetica").fontSize(7).text(label, x + 8, cardY + 8, { width: cardWidth - 16 });
      doc.fillColor("#173D5B").font("Helvetica-Bold").fontSize(15).text(value.toLocaleString(), x + 8, cardY + 21, { width: cardWidth - 16 });
    });
    doc.fillColor("#53677B").font("Helvetica").fontSize(8)
      .text(`Status totals: ${report.summary.draftCount} drafts · ${report.summary.queuedCount} queued · ${report.summary.sendingCount} sending · ${report.summary.completedCount} completed · ${report.summary.pausedCount} paused`, left, 149, { width: right - left });
    doc.fillColor("#778697").fontSize(7)
      .text("SMTP acceptance does not confirm inbox delivery. Drafts have no captured recipient totals until they are queued.", left, 162, { width: right - left });

    const widths = [170, 48, 54, 66, 54, 46, 54, 50, 54, 46];
    let y = addPdfTableHeader(doc, 182, widths, left);
    const rowHeight = 23;
    report.campaigns.forEach((campaign, index) => {
      if (y + rowHeight > doc.page.height - 35) {
        doc.addPage();
        y = addPdfTableHeader(doc, 32, widths, left);
      }
      if (index % 2 === 0) {
        doc.rect(left, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill("#F7F9FB");
      }
      const values = [
        campaign.name,
        campaign.campaignType === "follow_up" ? "Follow-up" : "Primary",
        campaign.paused ? "Paused" : campaign.status,
        pdfDate(campaign.createdAt, report.timeZone),
        campaign.recipients.toLocaleString(),
        campaign.queued.toLocaleString(),
        campaign.accepted.toLocaleString(),
        campaign.rejectedOrFailed.toLocaleString(),
        campaign.suppressed.toLocaleString(),
        campaign.unknown.toLocaleString(),
      ];
      let currentX = left;
      values.forEach((value, columnIndex) => {
        doc.fillColor("#26364A").font(columnIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7)
          .text(value, currentX + 4, y + 7, { width: widths[columnIndex] - 8, height: 10, lineBreak: false, ellipsis: true });
        currentX += widths[columnIndex];
      });
      y += rowHeight;
      doc.moveTo(left, y).lineTo(left + widths.reduce((sum, width) => sum + width, 0), y).strokeColor("#E6EBF0").lineWidth(0.5).stroke();
    });
    if (report.campaigns.length === 0) {
      doc.fillColor("#687587").font("Helvetica").fontSize(10)
        .text("No campaigns were created in this date range.", left, y + 16);
    }
    doc.end();
  });
}
