import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  ilike,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { alias } from "drizzle-orm/pg-core";
import { findSimilarCompanies } from "../lib/company-similarity";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import {
  BulkImportGlobalCompaniesBody,
  BulkImportGlobalCompaniesResponse,
  BulkUpdateGlobalCompanyBusinessAreaBody,
  BulkUpdateGlobalCompanyBusinessAreaResponse,
  ExportAdminGlobalCompaniesBody,
  CreateGlobalCompanyBody,
  DeleteGlobalCompanyParams,
  GetAdminGlobalCompanyNavigationResponse,
  ListAdminGlobalCompaniesQueryParams,
  UpdateGlobalCompanyBody,
  UpdateGlobalCompanyParams,
} from "@workspace/api-zod";
import { companiesTable, db, globalCompaniesTable, globalCompanyImportTemplatesTable } from "@workspace/db";
import { writeAuditLog } from "../lib/audit";
import {
  companyDomainKey,
  companyProfileFrom,
  normalizeCompanyDomain,
  type CompanyProfileValues,
} from "../lib/company-profile";
import { requireSuperadmin } from "../lib/session";
import { getResearchSummaries } from "../lib/company-intelligence";
import { getCompanyBusinessAreaValues } from "../lib/company-business-areas";

const router: IRouter = Router();
const linkedWorkspaceCompany = alias(companiesTable, "linked_workspace_company");

type UpdateGlobalCompanyResult =
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "global_domain_conflict" }
  | { kind: "domain_conflict" }
  | { kind: "updated"; company: typeof globalCompaniesTable.$inferSelect };

function validDomain(profile: CompanyProfileValues): boolean {
  return (
    !profile.companyDomain ||
    normalizeCompanyDomain(profile.companyDomain) !== null ||
    normalizeCompanyDomain(profile.companyWebsiteUrl) !== null
  );
}

function escapedSearchTerms(search: string): string[] {
  return search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function presentGlobalCompany(
  company: typeof globalCompaniesTable.$inferSelect,
) {
  const { companyDomainKey: _companyDomainKey, ...publicCompany } = company;
  return publicCompany;
}

router.get("/admin/global-companies/import-template", requireSuperadmin, async (req, res): Promise<void> => {
  const templateId = randomUUID();
  await db.insert(globalCompanyImportTemplatesTable).values({ id: templateId, userId: req.authUser!.id })
    .onConflictDoUpdate({
      target: globalCompanyImportTemplatesTable.userId,
      set: { id: templateId, importSessionId: null, issuedAt: new Date(), consumedAt: null },
    });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mailflow";
  const sheet = workbook.addWorksheet("Companies");
  const headers = ["Company Name", "Website URL", "Domain", "Industry", "Company size", "Revenue range", "Location", "Phone number", "LinkedIn URL", "Description"];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF286D5B" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = headers.map((header) => ({ width: header === "Description" ? 44 : 24 }));
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="mailflow-global-companies-template-${templateId}.xlsx"`);
  res.send(Buffer.from(buffer));
});

router.get(
  "/admin/global-companies",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ListAdminGlobalCompaniesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a valid search and page.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const { search, page, pageSize } = parsed.data;
    const conditions = [];
    for (const pattern of escapedSearchTerms(search ?? "")) {
      conditions.push(
        or(
          ilike(globalCompaniesTable.companyName, pattern),
          ilike(globalCompaniesTable.companyDomain, pattern),
          ilike(globalCompaniesTable.companyWebsiteUrl, pattern),
          ilike(globalCompaniesTable.companyIndustry, pattern),
          ilike(globalCompaniesTable.companyLocation, pattern),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(globalCompaniesTable)
        .where(where)
        .orderBy(asc(globalCompaniesTable.companyName), desc(globalCompaniesTable.createdAt), asc(globalCompaniesTable.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(globalCompaniesTable).where(where),
    ]);

    const researchSummaries = await getResearchSummaries(rows.map(row => row.id));
    res.json({
      globalCompanies: rows.map(row => ({ ...presentGlobalCompany(row), researchSummary: researchSummaries.get(row.id) })),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    });
  },
);

router.get(
  "/admin/global-companies/:globalCompanyId/navigation",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateGlobalCompanyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid global company identifier.", code: "INVALID_INPUT" });
      return;
    }
    const [company] = await db.select({
      id: globalCompaniesTable.id,
    }).from(globalCompaniesTable)
      .where(eq(globalCompaniesTable.id, params.data.globalCompanyId)).limit(1);
    if (!company) {
      res.status(404).json({ error: "Global company not found.", code: "NOT_FOUND" });
      return;
    }
    // Keep timestamp comparisons inside SQL; converting timestamptz to Date
    // loses microseconds and can make the current row its own neighbor.
    const companyCursor = db.select({
      id: globalCompaniesTable.id,
      companyName: globalCompaniesTable.companyName,
      createdAt: globalCompaniesTable.createdAt,
    }).from(globalCompaniesTable)
      .where(eq(globalCompaniesTable.id, params.data.globalCompanyId))
      .as("global_company_navigation_cursor");

    const previousConditions = or(
      lt(globalCompaniesTable.companyName, companyCursor.companyName),
      and(
        eq(globalCompaniesTable.companyName, companyCursor.companyName),
        gt(globalCompaniesTable.createdAt, companyCursor.createdAt),
      ),
      and(
        eq(globalCompaniesTable.companyName, companyCursor.companyName),
        eq(globalCompaniesTable.createdAt, companyCursor.createdAt),
        lt(globalCompaniesTable.id, companyCursor.id),
      ),
    );
    const nextConditions = or(
      gt(globalCompaniesTable.companyName, companyCursor.companyName),
      and(
        eq(globalCompaniesTable.companyName, companyCursor.companyName),
        lt(globalCompaniesTable.createdAt, companyCursor.createdAt),
      ),
      and(
        eq(globalCompaniesTable.companyName, companyCursor.companyName),
        eq(globalCompaniesTable.createdAt, companyCursor.createdAt),
        gt(globalCompaniesTable.id, companyCursor.id),
      ),
    );
    const [[previous], [next]] = await Promise.all([
      db.select({ id: globalCompaniesTable.id }).from(globalCompaniesTable)
        .innerJoin(companyCursor, sql`true`)
        .where(previousConditions)
        .orderBy(desc(globalCompaniesTable.companyName), asc(globalCompaniesTable.createdAt), desc(globalCompaniesTable.id))
        .limit(1),
      db.select({ id: globalCompaniesTable.id }).from(globalCompaniesTable)
        .innerJoin(companyCursor, sql`true`)
        .where(nextConditions)
        .orderBy(asc(globalCompaniesTable.companyName), desc(globalCompaniesTable.createdAt), asc(globalCompaniesTable.id))
        .limit(1),
    ]);

    res.json(GetAdminGlobalCompanyNavigationResponse.parse({
      previousCompanyId: previous?.id ?? null,
      nextCompanyId: next?.id ?? null,
    }));
  },
);

router.get(
  "/admin/global-companies/:globalCompanyId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateGlobalCompanyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid global company identifier.", code: "INVALID_INPUT" });
      return;
    }
    const [company] = await db.select().from(globalCompaniesTable)
      .where(eq(globalCompaniesTable.id, params.data.globalCompanyId)).limit(1);
    if (!company) {
      res.status(404).json({ error: "Global company not found.", code: "GLOBAL_COMPANY_NOT_FOUND" });
      return;
    }
    res.json(presentGlobalCompany(company));
  },
);

const globalCompanyExportHeaders = {
  id: "Company ID",
  companyName: "Company name",
  companyDomain: "Domain",
  companyWebsiteUrl: "Website",
  companyIndustry: "Industry",
  companySize: "Company size",
  companyRevenueRange: "Revenue range",
  companyLocation: "Location",
  companyPhoneNumber: "Phone",
  companyLinkedinUrl: "LinkedIn URL",
  companyDescription: "Description",
  createdAt: "Date added",
  updatedAt: "Last updated",
} as const;

router.post("/admin/global-companies/export", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = ExportAdminGlobalCompaniesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose at least one valid company field to export.", code: "INVALID_INPUT" });
    return;
  }
  const columns = parsed.data.columns;
  const conditions = [];
  for (const term of (parsed.data.search ?? "").trim().split(/\s+/).filter(Boolean)) {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(
      ilike(globalCompaniesTable.companyName, pattern),
      ilike(globalCompaniesTable.companyDomain, pattern),
      ilike(globalCompaniesTable.companyWebsiteUrl, pattern),
      ilike(globalCompaniesTable.companyIndustry, pattern),
      ilike(globalCompaniesTable.companyLocation, pattern),
    )!);
  }
  type Column = typeof columns[number];
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  let sheetNumber = 1;
  let sheet = workbook.addWorksheet("Global companies", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(key => ({ header: globalCompanyExportHeaders[key], key, width: key === "companyDescription" ? 48 : 24 }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FF1E3B32" } };
  sheet.getRow(1).commit();
  try {
    res.status(200).set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="global-companies-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "private, no-store",
    });
    let cursor: { companyName: string; id: string } | null = null;
    let worksheetRows = 0;
    while (true) {
      const where = [...conditions];
      if (cursor) where.push(or(
        gt(globalCompaniesTable.companyName, cursor.companyName),
        and(eq(globalCompaniesTable.companyName, cursor.companyName), gt(globalCompaniesTable.id, cursor.id))!,
      )!);
      const batch = await db.select().from(globalCompaniesTable).where(where.length ? and(...where) : undefined)
        .orderBy(asc(globalCompaniesTable.companyName), asc(globalCompaniesTable.id)).limit(500);
      if (!batch.length) break;
      for (const company of batch) {
        const values = {
          id: company.id, companyName: company.companyName, companyDomain: company.companyDomain,
          companyWebsiteUrl: company.companyWebsiteUrl, companyIndustry: company.companyIndustry,
          companySize: company.companySize, companyRevenueRange: company.companyRevenueRange,
          companyLocation: company.companyLocation, companyPhoneNumber: company.companyPhoneNumber,
          companyLinkedinUrl: company.companyLinkedinUrl, companyDescription: company.companyDescription,
          createdAt: company.createdAt, updatedAt: company.updatedAt,
        };
        const row: Record<Column, unknown> = Object.fromEntries(columns.map(key => [key, values[key]])) as Record<Column, unknown>;
        sheet.addRow(row).commit();
        worksheetRows++;
        if (worksheetRows >= 1_048_575) {
          sheet.commit();
          sheetNumber += 1;
          sheet = workbook.addWorksheet(`Global companies ${sheetNumber}`, { views: [{ state: "frozen", ySplit: 1 }] });
          sheet.columns = columns.map(key => ({ header: globalCompanyExportHeaders[key], key, width: key === "companyDescription" ? 48 : 24 }));
          sheet.getRow(1).font = { bold: true, color: { argb: "FF1E3B32" } };
          sheet.getRow(1).commit();
          worksheetRows = 0;
        }
      }
      const last = batch[batch.length - 1]!;
      cursor = { companyName: last.companyName, id: last.id };
      if (batch.length < 500) break;
    }
    sheet.commit();
    await workbook.commit();
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Global company workbook export failed");
    if (!res.headersSent) res.status(500).json({ error: "The global company workbook could not be created. Try again.", code: "EXPORT_FAILED" });
    else res.destroy(error instanceof Error ? error : new Error("Global company export failed"));
  }
});

router.post(
  "/admin/global-companies/bulk-import",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = BulkImportGlobalCompaniesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a valid batch of up to 25 company profiles.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const rowNumbers = parsed.data.rows.map((row) => row.rowNumber);
    if (new Set(rowNumbers).size !== rowNumbers.length) {
      res.status(400).json({
        error: "Each imported file row must have a unique row number.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const { templateId, importSessionId, finalBatch } = parsed.data;
    const templateAccepted = await db.transaction(async (tx) => {
      const [template] = await tx.select().from(globalCompanyImportTemplatesTable)
        .where(eq(globalCompanyImportTemplatesTable.userId, req.authUser!.id)).limit(1).for("update");
      if (!template || template.id !== templateId || template.consumedAt) return false;
      if (template.importSessionId && template.importSessionId !== importSessionId) return false;
      if (!template.importSessionId) {
        await tx.update(globalCompanyImportTemplatesTable)
          .set({ importSessionId })
          .where(eq(globalCompanyImportTemplatesTable.userId, req.authUser!.id));
      }
      return true;
    });
    if (!templateAccepted) {
      res.status(409).json({ error: "This template is no longer current or has already been used. Download a fresh template.", code: "IMPORT_TEMPLATE_INVALID" });
      return;
    }

    const results = new Map<
      number,
      {
        rowNumber: number;
        companyName: string;
        status: "imported" | "duplicate" | "similar" | "invalid";
        reason: string | null;
      }
    >();
    const seenDomains = new Map<string, number>();
    const candidates: Array<{
      rowNumber: number;
      profile: CompanyProfileValues;
      companyName: string;
      domainKey: string | null;
    }> = [];

    for (const row of parsed.data.rows) {
      const profile = companyProfileFrom(row.company);
      const companyName = profile.companyName?.trim() ?? "";
      const invalidDomain =
        (Boolean(profile.companyDomain) &&
          !normalizeCompanyDomain(profile.companyDomain)) ||
        (Boolean(profile.companyWebsiteUrl) &&
          !normalizeCompanyDomain(profile.companyWebsiteUrl));

      if (!companyName || invalidDomain) {
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName: companyName || "(blank company name)",
          status: "invalid",
          reason: !companyName
            ? "Company name is required."
            : "Enter a valid company domain or website URL.",
        });
        continue;
      }

      const domainKey = companyDomainKey(profile);
      const priorRow = domainKey ? seenDomains.get(domainKey) : undefined;
      if (domainKey && priorRow !== undefined) {
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName,
          status: "duplicate",
          reason: `Duplicate of row ${priorRow} in this file.`,
        });
        continue;
      }
      if (domainKey) seenDomains.set(domainKey, row.rowNumber);
      const similar = await findSimilarCompanies(companyName, { globalOnly: true });
      if (domainKey && similar.some(candidate => candidate.domain === domainKey)) {
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName,
          status: "duplicate",
          reason: "A global company already uses this website domain.",
        });
        continue;
      }
      if (similar.length && !row.company.allowSimilarCompany) {
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName,
          status: "similar",
          reason: `Possible match: ${similar.map(candidate => candidate.companyName).join(", ")}. Review before allowing this row.`,
        });
        continue;
      }
      candidates.push({ rowNumber: row.rowNumber, profile, companyName, domainKey });
    }

    await db.transaction(async (tx) => {
      const domainKeys = candidates
        .map((row) => row.domainKey)
        .filter((key): key is string => key !== null);
      const existing = domainKeys.length
        ? await tx
            .select({ companyDomainKey: globalCompaniesTable.companyDomainKey })
            .from(globalCompaniesTable)
            .where(inArray(globalCompaniesTable.companyDomainKey, domainKeys))
        : [];
      const tenantExisting = domainKeys.length
        ? await tx.select({ companyDomainKey: companiesTable.companyDomainKey })
            .from(companiesTable).where(inArray(companiesTable.companyDomainKey, domainKeys))
        : [];
      const existingKeys = new Set(
        [...existing, ...tenantExisting].flatMap((row) =>
          row.companyDomainKey ? [row.companyDomainKey] : [],
        ),
      );
      const pending = candidates.filter((row) => {
        if (!row.domainKey || !existingKeys.has(row.domainKey)) return true;
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName: row.companyName,
          status: "duplicate",
          reason: "A global company already uses this domain.",
        });
        return false;
      });

      if (!pending.length) return;
      const inserted = await tx
        .insert(globalCompaniesTable)
        .values(
          pending.map((row) => ({
            ...row.profile,
            companyName: row.companyName,
            companyDomainKey: row.domainKey,
          })),
        )
        .onConflictDoNothing()
        .returning({ companyDomainKey: globalCompaniesTable.companyDomainKey });
      const insertedKeys = new Set(
        inserted.flatMap((row) =>
          row.companyDomainKey ? [row.companyDomainKey] : [],
        ),
      );

      for (const row of pending) {
        if (row.domainKey && !insertedKeys.has(row.domainKey)) {
          results.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            companyName: row.companyName,
            status: "duplicate",
            reason: "A global company with this domain was added at the same time.",
          });
          continue;
        }
        results.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          companyName: row.companyName,
          status: "imported",
          reason: null,
        });
      }
    });
    const responseRows = parsed.data.rows.map((row) => results.get(row.rowNumber)!);
    const hasSimilar = responseRows.some((row) => row.status === "similar");
    if (finalBatch && !hasSimilar) {
      await db.update(globalCompanyImportTemplatesTable)
        .set({ consumedAt: new Date() })
        .where(eq(globalCompanyImportTemplatesTable.userId, req.authUser!.id));
    }
    const response = BulkImportGlobalCompaniesResponse.parse({
      imported: responseRows.filter((row) => row.status === "imported").length,
      duplicates: responseRows.filter((row) => row.status === "duplicate").length,
      similar: responseRows.filter((row) => row.status === "similar").length,
      invalid: responseRows.filter((row) => row.status === "invalid").length,
      rows: responseRows,
    });
    if (response.imported > 0) {
      await writeAuditLog({
        actorId: req.authUser!.id,
        action: "global_company.bulk_imported",
        entity: "global_company",
        metadata: {
          imported: response.imported,
          duplicates: response.duplicates,
          invalid: response.invalid,
        },
      });
    }
    res.json(response);
  },
);

router.post(
  "/admin/global-companies",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = CreateGlobalCompanyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a company name and valid company details.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const profile = companyProfileFrom(parsed.data);
    const domainKey = companyDomainKey(profile);
    const companyName = profile.companyName;
    if (!companyName || !validDomain(profile)) {
      res.status(400).json({
        error: "Enter a company name and a valid company domain.",
        code: "INVALID_INPUT",
      });
      return;
    }
    if (!parsed.data.allowSimilarCompany) {
      const similarCompanies = await findSimilarCompanies(companyName, { globalOnly: true });
      if (domainKey && similarCompanies.some(candidate => candidate.domain === domainKey)) {
        res.status(409).json({
          error: "A global company already uses this website domain.",
          code: "GLOBAL_COMPANY_DOMAIN_EXISTS",
        });
        return;
      }
      if (similarCompanies.length) {
        const names = similarCompanies.map(candidate => candidate.companyName).join(", ");
        res.status(409).json({
          error: `A similarly named global company already exists (${names}). Review the match before creating this company.`,
          code: "COMPANY_SIMILAR_NAME_WARNING",
          similarCompanies,
        });
        return;
      }
    }
    if (domainKey) {
      const [tenantDuplicate] = await db.select({ id: companiesTable.id })
        .from(companiesTable).where(eq(companiesTable.companyDomainKey, domainKey)).limit(1);
      if (tenantDuplicate) {
        res.status(409).json({
          error: "A workspace company already uses this website domain.",
          code: "COMPANY_DOMAIN_EXISTS",
        });
        return;
      }
    }
    try {
      const [created] = await db
        .insert(globalCompaniesTable)
        .values({ ...profile, companyName, companyDomainKey: domainKey })
        .returning();
      if (!created) {
        res.status(500).json({
          error: "The global company could not be created.",
          code: "GLOBAL_COMPANY_CREATE_FAILED",
        });
        return;
      }
      await writeAuditLog({
        actorId: req.authUser!.id,
        action: "global_company.created",
        entity: "global_company",
        entityId: created.id,
      });
      res.status(201).json(presentGlobalCompany(created));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({
          error: "A global company already uses this domain.",
          code: "GLOBAL_COMPANY_DOMAIN_EXISTS",
        });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/admin/global-companies/business-area",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = BulkUpdateGlobalCompanyBusinessAreaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Select global companies and a valid business area to update.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const allowedBusinessAreas = await getCompanyBusinessAreaValues();
    if (!allowedBusinessAreas.includes(parsed.data.companyBusinessArea)) {
      res.status(400).json({
        error: "Choose a business area from the current controlled list.",
        code: "BUSINESS_AREA_NOT_ALLOWED",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const selected = await tx
        .select({ id: globalCompaniesTable.id })
        .from(globalCompaniesTable)
        .where(inArray(globalCompaniesTable.id, parsed.data.globalCompanyIds))
        .for("update");
      if (selected.length !== parsed.data.globalCompanyIds.length) {
        return { kind: "not_found" as const };
      }

      const updated = await tx
        .update(globalCompaniesTable)
        .set({
          companyBusinessArea: parsed.data.companyBusinessArea,
          updatedAt: new Date(),
        })
        .where(inArray(globalCompaniesTable.id, parsed.data.globalCompanyIds))
        .returning({ id: globalCompaniesTable.id });
      if (updated.length !== parsed.data.globalCompanyIds.length) {
        return { kind: "not_found" as const };
      }

      await tx
        .update(companiesTable)
        .set({
          companyBusinessArea: parsed.data.companyBusinessArea,
          updatedAt: new Date(),
        })
        .where(inArray(companiesTable.globalCompanyId, parsed.data.globalCompanyIds));

      return { kind: "updated" as const, updatedCount: updated.length };
    });

    if (result.kind === "not_found") {
      res.status(404).json({
        error: "One or more selected global companies could not be found.",
        code: "GLOBAL_COMPANY_NOT_FOUND",
      });
      return;
    }

    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "global_company.business_area_bulk_updated",
      entity: "global_company",
      metadata: { updatedCount: result.updatedCount },
    });
    res.json(
      BulkUpdateGlobalCompanyBusinessAreaResponse.parse({
        updatedCount: result.updatedCount,
      }),
    );
  },
);

router.patch(
  "/admin/global-companies/:globalCompanyId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateGlobalCompanyParams.safeParse(req.params);
    const parsed = UpdateGlobalCompanyBody.safeParse(req.body);
    if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      res.status(400).json({
        error: "Enter valid company details to update.",
        code: "INVALID_INPUT",
      });
      return;
    }

    let result: UpdateGlobalCompanyResult;
    try {
      result = await db.transaction(async (tx): Promise<UpdateGlobalCompanyResult> => {
      const [current] = await tx
        .select()
        .from(globalCompaniesTable)
        .where(eq(globalCompaniesTable.id, params.data.globalCompanyId))
        .limit(1)
        .for("update");
      if (!current) return { kind: "not_found" as const };

      const profile = companyProfileFrom({
        ...current,
        ...parsed.data,
      });
      const domainKey = companyDomainKey(profile);
      const companyName = profile.companyName;
      if (!companyName || !validDomain(profile)) {
        return { kind: "invalid" as const };
      }

      if (domainKey) {
        const [catalogConflict] = await tx
          .select({ id: globalCompaniesTable.id })
          .from(globalCompaniesTable)
          .where(
            and(
              eq(globalCompaniesTable.companyDomainKey, domainKey),
              ne(globalCompaniesTable.id, current.id),
            ),
          )
          .limit(1);
        if (catalogConflict) return { kind: "global_domain_conflict" as const };
      }

      if (domainKey) {
        const [conflict] = await tx
          .select({ id: companiesTable.id })
          .from(companiesTable)
          .innerJoin(
            linkedWorkspaceCompany,
            and(
              eq(linkedWorkspaceCompany.userId, companiesTable.userId),
              eq(linkedWorkspaceCompany.globalCompanyId, current.id),
            ),
          )
          .where(
            and(
              eq(companiesTable.companyDomainKey, domainKey),
              or(
                isNull(companiesTable.globalCompanyId),
                ne(companiesTable.globalCompanyId, current.id),
              ),
            ),
          )
          .limit(1);
        if (conflict) return { kind: "domain_conflict" as const };
      }

      const [updated] = await tx
        .update(globalCompaniesTable)
        .set({
          ...profile,
          companyName,
          companyDomainKey: domainKey,
          updatedAt: new Date(),
        })
        .where(eq(globalCompaniesTable.id, current.id))
        .returning();
      if (!updated) return { kind: "not_found" as const };

      await tx
        .update(companiesTable)
        .set({
          ...profile,
          companyName,
          companyDomainKey: domainKey,
          updatedAt: new Date(),
        })
        .where(eq(companiesTable.globalCompanyId, current.id));

      return { kind: "updated" as const, company: updated };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({
          error: "The requested domain conflicts with another company profile. No changes were made.",
          code: "GLOBAL_COMPANY_DOMAIN_CONFLICT",
        });
        return;
      }
      throw error;
    }

    if (result.kind === "not_found") {
      res.status(404).json({
        error: "Global company not found.",
        code: "GLOBAL_COMPANY_NOT_FOUND",
      });
      return;
    }
    if (result.kind === "invalid") {
      res.status(400).json({
        error: "Enter a company name and a valid company domain.",
        code: "INVALID_INPUT",
      });
      return;
    }
    if (result.kind === "global_domain_conflict") {
      res.status(409).json({
        error: "A global company already uses this domain.",
        code: "GLOBAL_COMPANY_DOMAIN_EXISTS",
      });
      return;
    }
    if (result.kind === "domain_conflict") {
      res.status(409).json({
        error:
          "This domain conflicts with a private company in a linked workspace. The shared profile was not changed.",
        code: "GLOBAL_COMPANY_DOMAIN_CONFLICT",
      });
      return;
    }

    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "global_company.updated",
      entity: "global_company",
      entityId: result.company.id,
    });
    res.json(presentGlobalCompany(result.company));
  },
);

router.delete(
  "/admin/global-companies/:globalCompanyId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = DeleteGlobalCompanyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid global company identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const [deleted] = await db
      .delete(globalCompaniesTable)
      .where(eq(globalCompaniesTable.id, params.data.globalCompanyId))
      .returning({ id: globalCompaniesTable.id });
    if (!deleted) {
      res.status(404).json({
        error: "Global company not found.",
        code: "GLOBAL_COMPANY_NOT_FOUND",
      });
      return;
    }
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "global_company.deleted",
      entity: "global_company",
      entityId: deleted.id,
    });
    res.status(204).end();
  },
);

export default router;
