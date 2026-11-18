import ExcelJS from "exceljs";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  savedReportDefinitionsTable,
} from "@workspace/db";
import {
  CreateSavedReportBody,
  CreateSavedReportResponse,
  DeleteSavedReportParams,
  GetReportWorkareaCatalogResponse,
  GetSavedReportParams,
  GetSavedReportResponse,
  ListSavedReportsResponse,
  RunReportWorkareaQueryBody,
  RunReportWorkareaQueryResponse,
  UpdateSavedReportBody,
  UpdateSavedReportParams,
  UpdateSavedReportResponse,
  ExportReportWorkareaCsvBody,
  ExportReportWorkareaXlsxBody,
} from "@workspace/api-zod";
import { requireUserRole } from "../lib/session";
import { getReportWorkareaCatalog } from "../lib/report-workarea-catalog";
import {
  exportReport,
  formatReportCell,
  normalizeReportDefinition,
  protectSpreadsheetFormula,
  ReportDefinitionError,
  ReportExportLimitError,
  runReport,
} from "../lib/report-workarea-query";

const router: IRouter = Router();
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function sendReportError(res: any, error: unknown): boolean {
  if (error instanceof ReportDefinitionError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.statusCode === 422 ? "REPORT_FIELD_UNAVAILABLE" : "INVALID_REPORT_DEFINITION",
    });
    return true;
  }
  if (error instanceof ReportExportLimitError) {
    res.status(413).json({
      error: error.message,
      code: "REPORT_EXPORT_LIMIT",
    });
    return true;
  }
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; cause?: { code?: string } };
  return record.code === "23505" || record.cause?.code === "23505";
}

function formatSavedReport(row: typeof savedReportDefinitionsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    baseEntityId: row.baseEntityId,
    definition: row.definition,
    definitionVersion: row.definitionVersion,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function csvCell(value: unknown, isText: boolean): string {
  let text = formatReportCell(value);
  if (isText) text = protectSpreadsheetFormula(text);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(result: Awaited<ReturnType<typeof exportReport>>): string {
  const header = result.columns.map((column) => csvCell(column.label, true));
  const rows = result.rows.map((row) =>
    result.columns.map((column) =>
      csvCell(row[column.fieldId], column.dataType === "text"),
    ),
  );
  return `\uFEFF${[header, ...rows].map((row) => row.join(",")).join("\r\n")}`;
}

async function buildXlsx(result: Awaited<ReturnType<typeof exportReport>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mailflow";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = result.columns.map((column) => ({
    header: column.label,
    key: column.fieldId,
    width: Math.max(14, Math.min(42, column.label.length + 4)),
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173D5B" },
  };

  for (const row of result.rows) {
    const excelRow: Record<string, string | number | boolean | Date | null> = {};
    for (const column of result.columns) {
      const value = row[column.fieldId];
      if (value === null || value === undefined) {
        excelRow[column.fieldId] = null;
      } else if (column.dataType === "boolean") {
        excelRow[column.fieldId] = Boolean(value);
      } else if (column.dataType === "number") {
        const numeric = Number(value);
        excelRow[column.fieldId] = Number.isFinite(numeric) ? numeric : formatReportCell(value);
      } else if (column.dataType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        excelRow[column.fieldId] = new Date(`${value}T00:00:00.000Z`);
      } else if (column.dataType === "datetime" && Number.isFinite(Date.parse(String(value)))) {
        excelRow[column.fieldId] = new Date(String(value));
      } else {
        const text = formatReportCell(value);
        excelRow[column.fieldId] = column.dataType === "text"
          ? protectSpreadsheetFormula(text)
          : text;
      }
    }
    sheet.addRow(excelRow);
  }

  result.columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    if (column.dataType === "currency") {
      excelColumn.numFmt = "#,##0.0000;[Red]-#,##0.0000";
      // Preserve PostgreSQL's exact decimal text rather than silently rounding
      // values that exceed JavaScript's exact integer precision.
    } else if (column.dataType === "date") {
      excelColumn.numFmt = "yyyy-mm-dd";
    } else if (column.dataType === "datetime") {
      excelColumn.numFmt = "yyyy-mm-dd hh:mm";
    }
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: result.columns.length },
  };

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

router.get("/report-workarea/catalog", requireUserRole, (_req, res): void => {
  res.json(GetReportWorkareaCatalogResponse.parse(getReportWorkareaCatalog()));
});

router.post("/report-workarea/run", requireUserRole, async (req, res): Promise<void> => {
  const parsed = RunReportWorkareaQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "The report request is incomplete or invalid.",
      code: "INVALID_REPORT_DEFINITION",
    });
    return;
  }

  const userId = req.authUser!.id;
  let definition: unknown = parsed.data.definition;
  let savedReportId = parsed.data.savedReportId;
  if (savedReportId) {
    const [saved] = await db.select()
      .from(savedReportDefinitionsTable)
      .where(and(
        eq(savedReportDefinitionsTable.id, savedReportId),
        eq(savedReportDefinitionsTable.userId, userId),
      ))
      .limit(1);
    if (!saved) {
      res.status(404).json({ error: "Saved report not found.", code: "SAVED_REPORT_NOT_FOUND" });
      return;
    }
    definition = saved.definition;
  }

  try {
    const result = await runReport(userId, definition, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      timeZone: req.authUser!.timezone,
    });
    const response = RunReportWorkareaQueryResponse.parse(result);
    if (savedReportId) {
      await db.update(savedReportDefinitionsTable)
        .set({ lastRunAt: new Date() })
        .where(and(
          eq(savedReportDefinitionsTable.id, savedReportId),
          eq(savedReportDefinitionsTable.userId, userId),
        ));
    }
    res.json(response);
  } catch (error) {
    if (!sendReportError(res, error)) throw error;
  }
});

router.get("/report-workarea/saved", requireUserRole, async (req, res): Promise<void> => {
  const rows = await db.select()
    .from(savedReportDefinitionsTable)
    .where(eq(savedReportDefinitionsTable.userId, req.authUser!.id))
    .orderBy(desc(savedReportDefinitionsTable.updatedAt));
  res.json(ListSavedReportsResponse.parse({
    reports: rows.map(formatSavedReport),
  }));
});

router.post("/report-workarea/saved", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateSavedReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a report name and valid definition." });
    return;
  }
  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() ?? "";
  const category = parsed.data.category?.trim() || "Custom";
  if (!name || name.length > 160 || description.length > 1000 || category.length > 80) {
    res.status(400).json({ error: "Check the report name, description, and category lengths." });
    return;
  }
  try {
    const definition = normalizeReportDefinition(parsed.data.definition);
    const [created] = await db.insert(savedReportDefinitionsTable)
      .values({
        userId: req.authUser!.id,
        name,
        description,
        category,
        baseEntityId: definition.baseEntityId,
        definition,
        definitionVersion: 1,
      })
      .returning();
    res.status(201).json(CreateSavedReportResponse.parse(formatSavedReport(created)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "A saved report with this name already exists.", code: "REPORT_NAME_IN_USE" });
      return;
    }
    if (!sendReportError(res, error)) throw error;
  }
});

router.get("/report-workarea/saved/:reportId", requireUserRole, async (req, res): Promise<void> => {
  const parsed = GetSavedReportParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid saved report." });
    return;
  }
  const [saved] = await db.select()
    .from(savedReportDefinitionsTable)
    .where(and(
      eq(savedReportDefinitionsTable.id, parsed.data.reportId),
      eq(savedReportDefinitionsTable.userId, req.authUser!.id),
    ))
    .limit(1);
  if (!saved) {
    res.status(404).json({ error: "Saved report not found.", code: "SAVED_REPORT_NOT_FOUND" });
    return;
  }
  res.json(GetSavedReportResponse.parse(formatSavedReport(saved)));
});

router.patch("/report-workarea/saved/:reportId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateSavedReportParams.safeParse(req.params);
  const parsed = UpdateSavedReportBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "The saved report update is invalid." });
    return;
  }

  const [existing] = await db.select()
    .from(savedReportDefinitionsTable)
    .where(and(
      eq(savedReportDefinitionsTable.id, params.data.reportId),
      eq(savedReportDefinitionsTable.userId, req.authUser!.id),
    ))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Saved report not found.", code: "SAVED_REPORT_NOT_FOUND" });
    return;
  }

  const name = parsed.data.name?.trim();
  const description = parsed.data.description?.trim();
  const category = parsed.data.category?.trim();
  if (
    (name !== undefined && (!name || name.length > 160))
    || (description !== undefined && description.length > 1000)
    || (category !== undefined && (!category || category.length > 80))
  ) {
    res.status(400).json({ error: "Check the report name, description, and category lengths." });
    return;
  }
  try {
    const definition = parsed.data.definition
      ? normalizeReportDefinition(parsed.data.definition)
      : undefined;
    const [updated] = await db.update(savedReportDefinitionsTable)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(definition
          ? { definition, baseEntityId: definition.baseEntityId, definitionVersion: 1 }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(savedReportDefinitionsTable.id, params.data.reportId),
        eq(savedReportDefinitionsTable.userId, req.authUser!.id),
      ))
      .returning();
    res.json(UpdateSavedReportResponse.parse(formatSavedReport(updated)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "A saved report with this name already exists.", code: "REPORT_NAME_IN_USE" });
      return;
    }
    if (!sendReportError(res, error)) throw error;
  }
});

router.delete("/report-workarea/saved/:reportId", requireUserRole, async (req, res): Promise<void> => {
  const parsed = DeleteSavedReportParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid saved report." });
    return;
  }
  const [deleted] = await db.delete(savedReportDefinitionsTable)
    .where(and(
      eq(savedReportDefinitionsTable.id, parsed.data.reportId),
      eq(savedReportDefinitionsTable.userId, req.authUser!.id),
    ))
    .returning({ id: savedReportDefinitionsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Saved report not found.", code: "SAVED_REPORT_NOT_FOUND" });
    return;
  }
  res.status(204).end();
});

router.post("/report-workarea/export/csv", requireUserRole, async (req, res): Promise<void> => {
  const parsed = ExportReportWorkareaCsvBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The report export request is invalid." });
    return;
  }
  try {
    const result = await exportReport(
      req.authUser!.id,
      parsed.data.definition,
      req.authUser!.timezone,
    );
    const csv = buildCsv(result);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="mailflow-report.csv"');
    res.status(200).send(csv);
  } catch (error) {
    if (!sendReportError(res, error)) throw error;
  }
});

router.post("/report-workarea/export/xlsx", requireUserRole, async (req, res): Promise<void> => {
  const parsed = ExportReportWorkareaXlsxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The report export request is invalid." });
    return;
  }
  try {
    const result = await exportReport(
      req.authUser!.id,
      parsed.data.definition,
      req.authUser!.timezone,
    );
    const workbook = await buildXlsx(result);
    res.setHeader("Content-Type", EXCEL_MIME);
    res.setHeader("Content-Disposition", 'attachment; filename="mailflow-report.xlsx"');
    res.status(200).send(workbook);
  } catch (error) {
    if (!sendReportError(res, error)) throw error;
  }
});

export default router;
