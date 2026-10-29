import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { findSimilarCompanies } from "../lib/company-similarity";
import {
  BulkImportCompaniesBody,
  BulkImportCompaniesResponse,
  BackfillCompanyProfilesResponse,
  BulkUpdateCompanyBusinessAreaBody,
  BulkUpdateCompanyBusinessAreaResponse,
  CreateCompanyBody,
  CreateCompanyResponse,
  ExportCompaniesBody,
  DeleteCompanyParams,
  GetCompanyParams,
  GetCompanyResponse,
  ListCompaniesResponse,
  ListUnlinkedCompanyProfilesResponse,
  SearchCompaniesQueryParams,
  SearchCompaniesResponse,
  UpdateCompanyBody,
  UpdateCompanyParams,
  UpdateCompanyResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  contactsTable,
  db,
  globalCompaniesTable,
  companyImportTemplatesTable,
  usersTable,
} from "@workspace/db";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import {
  companyDomainKey,
  companyProfileFrom,
  normalizeCompanyDomain,
  type CompanyProfileValues,
} from "../lib/company-profile";
import {
  backfillCompanyProfilesInTransaction,
  listUnlinkedCompanyProfilesForTenant,
} from "../lib/company-backfill";
import { requireUserRole } from "../lib/session";
import { getCompanyBusinessAreaValues } from "../lib/company-business-areas";

const router: IRouter = Router();
const COMPANY_EXPORT_BATCH_SIZE = 250;
const EXCEL_MAX_DATA_ROWS = 1_048_575;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

router.get("/companies/import-template", requireUserRole, async (req, res): Promise<void> => {
  const templateId = randomUUID();
  await db.insert(companyImportTemplatesTable).values({ id: templateId, userId: req.authUser!.id })
    .onConflictDoUpdate({ target: companyImportTemplatesTable.userId, set: { id: templateId, importSessionId: null, issuedAt: new Date(), consumedAt: null } });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mailflow";
  const sheet = workbook.addWorksheet("Companies");
  const headers = ["Company Name", "Website URL", "Domain", "Industry", "Company size", "Revenue range", "Location", "Phone number", "LinkedIn URL", "Description"];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174F99" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = headers.map(header => ({ width: header === "Description" ? 44 : 24 }));
  res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="mailflow-workspace-companies-template-${templateId}.xlsx"`);
  res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
});

router.post("/companies/bulk-import", requireUserRole, async (req, res): Promise<void> => {
  const parsed = BulkImportCompaniesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Review the company rows and try again.", code: "INVALID_INPUT" }); return; }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [template] = await tx.select().from(companyImportTemplatesTable).where(and(eq(companyImportTemplatesTable.userId, userId), eq(companyImportTemplatesTable.id, parsed.data.templateId))).limit(1).for("update");
    if (!template || template.consumedAt) return { error: "This company template is no longer active. Download a fresh template.", code: "TEMPLATE_EXPIRED" as const };
    if (template.importSessionId && template.importSessionId !== parsed.data.importSessionId) return { error: "This template is already in use by another import.", code: "IMPORT_SESSION_MISMATCH" as const };
    await tx.update(companyImportTemplatesTable).set({ importSessionId: parsed.data.importSessionId }).where(eq(companyImportTemplatesTable.id, template.id));
    const outcomes: Array<{rowNumber:number;status:"created"|"shared"|"duplicate"|"similar"|"rejected";message:string}> = [];
    for (const row of parsed.data.rows) {
      const profile = cleanCompanyInput(row.company as Record<string, unknown>);
      const domainKey = companyDomainKey(profile);
      const companyName = profile.companyName;
      if (!companyName || !validDomain(profile)) { outcomes.push({rowNumber:row.rowNumber,status:"rejected",message:"Enter a company name and valid domain."}); continue; }
      const [duplicate] = await tx.select({id:companiesTable.id}).from(companiesTable).where(and(eq(companiesTable.userId,userId),eq(companiesTable.companyDomainKey,domainKey ?? ""))).limit(1);
      if (domainKey && duplicate) { outcomes.push({rowNumber:row.rowNumber,status:"duplicate",message:"This domain already exists in your workspace."}); continue; }
       if (domainKey) {
         const [globalDuplicate] = await tx.select({id:globalCompaniesTable.id}).from(globalCompaniesTable).where(eq(globalCompaniesTable.companyDomainKey,domainKey)).limit(1);
         if (globalDuplicate) { outcomes.push({rowNumber:row.rowNumber,status:"duplicate",message:"This website domain already exists in the Global Company DB."}); continue; }
       }
       const similar = await findSimilarCompanies(companyName, { userId });
       if (domainKey && similar.some(candidate => candidate.domain === domainKey)) {
         outcomes.push({rowNumber:row.rowNumber,status:"duplicate",message:"A company with this website domain is already present."});
         continue;
       }
       if (similar.length && !row.company.allowSimilarCompany) {
         outcomes.push({rowNumber:row.rowNumber,status:"similar",message:`Possible match: ${similar.map(candidate => candidate.companyName).join(", ")}. Review before allowing this row.`});
         continue;
       }
      let globalCompanyId: string | null = null;
      if (row.company.shareWithGlobal) {
        const [global] = await tx.insert(globalCompaniesTable).values({...profile,companyName,companyDomainKey:domainKey})
          .onConflictDoNothing().returning({id:globalCompaniesTable.id});
        if (!global) { outcomes.push({rowNumber:row.rowNumber,status:"rejected",message:"This domain is already public. Add it from the Global Company DB instead."}); continue; }
        globalCompanyId = global.id;
      }
      await tx.insert(companiesTable).values({userId,...profile,companyName,companyDomainKey:domainKey,globalCompanyId});
      outcomes.push({rowNumber:row.rowNumber,status:row.company.shareWithGlobal?"shared":"created",message:row.company.shareWithGlobal?"Created and shared; contacts remain private.":"Created privately in your workspace."});
    }
    const hasSimilar = outcomes.some(outcome => outcome.status === "similar");
    const complete = parsed.data.isFinalBatch && !hasSimilar;
    if (complete) await tx.update(companyImportTemplatesTable).set({consumedAt:new Date()}).where(eq(companyImportTemplatesTable.id,template.id));
    return {importSessionId:parsed.data.importSessionId,processed:outcomes.length,complete,created:outcomes.filter(x=>x.status==="created").length,shared:outcomes.filter(x=>x.status==="shared").length,duplicates:outcomes.filter(x=>x.status==="duplicate").length,similar:outcomes.filter(x=>x.status==="similar").length,rejected:outcomes.filter(x=>x.status==="rejected").length,rows:outcomes};
  });
  if ("error" in result) { res.status(409).json({error:result.error,code:result.code}); return; }
  res.json(BulkImportCompaniesResponse.parse(result));
});

function presentCompany(company: typeof companiesTable.$inferSelect) {
  const {
    userId: _userId,
    companyDomainKey: _companyDomainKey,
    ...publicCompany
  } = company;
  return publicCompany;
}

function cleanCompanyInput(
  input: Record<string, unknown>,
  existing?: typeof companiesTable.$inferSelect,
): CompanyProfileValues {
  return companyProfileFrom({
    ...existing,
    ...input,
  });
}

function validDomain(profile: CompanyProfileValues): boolean {
  return (
    !profile.companyDomain ||
    normalizeCompanyDomain(profile.companyDomain) !== null ||
    normalizeCompanyDomain(profile.companyWebsiteUrl) !== null
  );
}

router.get("/companies", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const [companies, contactCounts] = await Promise.all([
    db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.userId, userId))
      .orderBy(asc(companiesTable.companyName), desc(companiesTable.createdAt)),
    db
      .select({
        companyId: contactsTable.companyId,
        contactCount: count(),
      })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.userId, userId),
          isNotNull(contactsTable.companyId),
        ),
      )
      .groupBy(contactsTable.companyId),
  ]);
  const countsByCompany = new Map(
    contactCounts.map((row) => [row.companyId, Number(row.contactCount)]),
  );
  res.json(
    ListCompaniesResponse.parse({
      companies: companies.map((company) => ({
        ...presentCompany(company),
        contactCount: countsByCompany.get(company.id) ?? 0,
      })),
    }),
  );
});

router.patch(
  "/companies/business-area",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = BulkUpdateCompanyBusinessAreaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Select companies and a valid business area to update.",
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

    const userId = req.authUser!.id;
    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!lockedUser) return { kind: "not_found" as const };

      const selectedCompanies = await tx
        .select({
          id: companiesTable.id,
          globalCompanyId: companiesTable.globalCompanyId,
        })
        .from(companiesTable)
        .where(
          and(
            eq(companiesTable.userId, userId),
            inArray(companiesTable.id, parsed.data.companyIds),
          ),
        )
        .for("update");
      if (selectedCompanies.length !== parsed.data.companyIds.length) {
        return { kind: "not_found" as const };
      }
      if (selectedCompanies.some((company) => company.globalCompanyId)) {
        return { kind: "global_managed" as const };
      }

      const updated = await tx
        .update(companiesTable)
        .set({
          companyBusinessArea: parsed.data.companyBusinessArea,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companiesTable.userId, userId),
            inArray(companiesTable.id, parsed.data.companyIds),
          ),
        )
        .returning({ id: companiesTable.id });
      return { kind: "updated" as const, updatedCount: updated.length };
    });

    if (result.kind === "not_found") {
      res.status(404).json({
        error: "One or more selected companies could not be found in this workspace.",
        code: "COMPANY_NOT_FOUND",
      });
      return;
    }
    if (result.kind === "global_managed") {
      res.status(409).json({
        error: "Companies managed by the Global Company DB must be updated there.",
        code: "GLOBAL_COMPANY_MANAGED",
      });
      return;
    }
    res.json(
      BulkUpdateCompanyBusinessAreaResponse.parse({
        updatedCount: result.updatedCount,
      }),
    );
  },
);

router.get(
  "/companies/search",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = SearchCompaniesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter valid company search and pagination values.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const { search, page, pageSize } = parsed.data;
    const userId = req.authUser!.id;
    const normalizedSearch = search.trim().replace(/[\\%_]/g, "\\$&");
    const where = normalizedSearch
      ? and(
          eq(companiesTable.userId, userId),
          or(
            ilike(companiesTable.companyName, `%${normalizedSearch}%`),
            ilike(companiesTable.companyDomain, `%${normalizedSearch}%`),
          ),
        )
      : eq(companiesTable.userId, userId);
    const [companies, countRows] = await Promise.all([
      db
        .select({
          id: companiesTable.id,
          companyName: companiesTable.companyName,
          companyDomain: companiesTable.companyDomain,
        })
        .from(companiesTable)
        .where(where)
        .orderBy(asc(companiesTable.companyName), desc(companiesTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: count() })
        .from(companiesTable)
        .where(where),
    ]);

    res.json(
      SearchCompaniesResponse.parse({
        companies,
        total: Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      }),
    );
  },
);

const companyExportHeaders: Record<string, string> = {
  id: "Company ID",
  companyName: "Company name",
  companyDomain: "Domain",
  companyWebsiteUrl: "Website",
  companyIndustry: "Industry",
  companySize: "Company size",
  companyRevenueRange: "Revenue range",
  companyDescription: "Description",
  companyPhoneNumber: "Phone",
  companyLinkedinUrl: "LinkedIn",
  companyLocation: "Location",
  contactCount: "Contacts",
  createdAt: "Date added",
  updatedAt: "Last updated",
};

router.post(
  "/companies/export",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = ExportCompaniesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose at least one valid company column to export.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    type ExportFilters = NonNullable<typeof parsed.data.filters>;
    const filters: ExportFilters =
      parsed.data.scope === "all" ? {} : (parsed.data.filters ?? {});
    const conditions = [eq(companiesTable.userId, userId)];
    const search = filters.search?.trim();
    if (search) {
      const searchableColumns = [
        companiesTable.companyName,
        companiesTable.companyDomain,
        companiesTable.companyWebsiteUrl,
        companiesTable.companyIndustry,
        companiesTable.companySize,
        companiesTable.companyRevenueRange,
        companiesTable.companyLocation,
        companiesTable.companyDescription,
      ];
      for (const term of search.split(/\s+/).filter(Boolean)) {
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push(
          or(...searchableColumns.map((column) => ilike(column, pattern)))!,
        );
      }
    }
    if (filters.industry && filters.industry !== "all") {
      conditions.push(eq(companiesTable.companyIndustry, filters.industry));
    }
    if (filters.size && filters.size !== "all") {
      conditions.push(eq(companiesTable.companySize, filters.size));
    }
    if (filters.revenueRange && filters.revenueRange !== "all") {
      conditions.push(
        eq(companiesTable.companyRevenueRange, filters.revenueRange),
      );
    }
    if (filters.location?.trim()) {
      conditions.push(
        ilike(
          companiesTable.companyLocation,
          `%${filters.location.trim().replace(/[\\%_]/g, "\\$&")}%`,
        ),
      );
    }

    const selectedColumns = parsed.data.columns;
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
      useSharedStrings: false,
    });
    let sheetNumber = 0;
    let sheetRowCount = 0;
    const createWorksheet = () => {
      sheetNumber += 1;
      sheetRowCount = 0;
      const sheet = workbook.addWorksheet(
        sheetNumber === 1 ? "Companies" : `Companies ${sheetNumber}`,
        { views: [{ state: "frozen", ySplit: 1 }] },
      );
      sheet.columns = selectedColumns.map((key) => ({
        header: companyExportHeaders[key],
        key,
        width: Math.min(34, Math.max(16, companyExportHeaders[key].length + 2)),
      }));
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FF172334" } };
      headerRow.commit();
      return sheet;
    };
    let worksheet = createWorksheet();

    try {
      res.status(200).set({
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="companies-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "private, no-store",
      });
      let cursor: {
        companyName: string;
        createdAt: Date;
        id: string;
      } | null = null;
      while (true) {
        const batchConditions = [...conditions];
        if (cursor) {
          batchConditions.push(
            or(
              gt(companiesTable.companyName, cursor.companyName),
              and(
                eq(companiesTable.companyName, cursor.companyName),
                lt(companiesTable.createdAt, cursor.createdAt),
              ),
              and(
                eq(companiesTable.companyName, cursor.companyName),
                eq(companiesTable.createdAt, cursor.createdAt),
                gt(companiesTable.id, cursor.id),
              ),
            )!,
          );
        }
        const batch = await db
          .select()
          .from(companiesTable)
          .where(and(...batchConditions))
          .orderBy(
            asc(companiesTable.companyName),
            desc(companiesTable.createdAt),
            asc(companiesTable.id),
          )
          .limit(COMPANY_EXPORT_BATCH_SIZE);
        if (!batch.length) break;

        const companyIds = batch.map((company) => company.id);
        const contactCounts = selectedColumns.includes("contactCount")
          ? await db
              .select({
                companyId: contactsTable.companyId,
                contactCount: count(),
              })
              .from(contactsTable)
              .where(
                and(
                  eq(contactsTable.userId, userId),
                  inArray(contactsTable.companyId, companyIds),
                ),
              )
              .groupBy(contactsTable.companyId)
          : [];
        const countsByCompany = new Map(
          contactCounts.map((row) => [
            row.companyId,
            Number(row.contactCount),
          ]),
        );

        for (const company of batch) {
          if (sheetRowCount >= EXCEL_MAX_DATA_ROWS) {
            worksheet.commit();
            worksheet = createWorksheet();
          }
          const exportValues: Record<
            string,
            string | number | Date | null
          > = {
            id: company.id,
            companyName: company.companyName,
            companyDomain: company.companyDomain,
            companyBusinessArea: company.companyBusinessArea,
            companyWebsiteUrl: company.companyWebsiteUrl,
            companyIndustry: company.companyIndustry,
            companySize: company.companySize,
            companyRevenueRange: company.companyRevenueRange,
            companyDescription: company.companyDescription,
            companyPhoneNumber: company.companyPhoneNumber,
            companyLinkedinUrl: company.companyLinkedinUrl,
            companyLocation: company.companyLocation,
            contactCount: countsByCompany.get(company.id) ?? 0,
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
          };
          worksheet.addRow(
            selectedColumns.map((key) => exportValues[key] ?? ""),
          ).commit();
          sheetRowCount += 1;
        }

        const lastCompany = batch[batch.length - 1];
        cursor = {
          companyName: lastCompany.companyName,
          createdAt: lastCompany.createdAt,
          id: lastCompany.id,
        };
        if (batch.length < COMPANY_EXPORT_BATCH_SIZE) break;
      }
      await workbook.commit();
    } catch (error) {
      req.log.error(
        {
          userId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Company workbook export failed",
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: "The company workbook could not be created. Try again.",
          code: "EXPORT_FAILED",
        });
      } else {
        res.destroy(error instanceof Error ? error : new Error("Company export failed"));
      }
    }
  },
);

router.post(
  "/companies/backfill",
  requireUserRole,
  async (req, res): Promise<void> => {
    const userId = req.authUser!.id;
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!user) return { linkedContacts: 0, createdCompanies: 0, skippedContacts: 0 };
      return backfillCompanyProfilesInTransaction(tx, userId);
    });
    res.json(BackfillCompanyProfilesResponse.parse(result));
  },
);

router.get(
  "/companies/unlinked-profiles",
  requireUserRole,
  async (req, res): Promise<void> => {
    const profiles = await listUnlinkedCompanyProfilesForTenant(
      req.authUser!.id,
    );
    res.json(ListUnlinkedCompanyProfilesResponse.parse({ profiles }));
  },
);

router.post("/companies", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a company name and valid company details.", code: "INVALID_INPUT" });
    return;
  }
  const profile = cleanCompanyInput(parsed.data as Record<string, unknown>);
  const domainKey = companyDomainKey(profile);
  const companyName = profile.companyName;
  const shareWithGlobal = parsed.data.shareWithGlobal === true;
  if (!companyName || !validDomain(profile)) {
    res.status(400).json({ error: "Enter a company name and a valid company domain.", code: "INVALID_INPUT" });
    return;
  }
  const userId = req.authUser!.id;
  if (domainKey) {
    const [globalDuplicate] = await db.select({ id: globalCompaniesTable.id })
      .from(globalCompaniesTable).where(eq(globalCompaniesTable.companyDomainKey, domainKey)).limit(1);
    if (globalDuplicate) {
      res.status(409).json({
        error: "A company with this website domain is already in the Global Company DB. Add the existing company instead.",
        code: "GLOBAL_COMPANY_DOMAIN_EXISTS",
      });
      return;
    }
  }
  if (!parsed.data.allowSimilarCompany) {
    const similarCompanies = await findSimilarCompanies(companyName, { userId });
    if (domainKey && similarCompanies.some(candidate => candidate.domain === domainKey)) {
      res.status(409).json({
        error: "A company with this website domain is already present. Add the existing company instead.",
        code: "COMPANY_DOMAIN_EXISTS",
      });
      return;
    }
    if (similarCompanies.length) {
      const names = similarCompanies.map(candidate => candidate.companyName).join(", ");
      res.status(409).json({
        error: `A similarly named company already exists (${names}). Review the matches before creating this company.`,
        code: "COMPANY_SIMILAR_NAME_WARNING",
        similarCompanies,
      });
      return;
    }
  }
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!user) return { kind: "missing_user" as const };
    if (domainKey) {
      const [duplicate] = await tx
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(
          and(
            eq(companiesTable.userId, userId),
            eq(companiesTable.companyDomainKey, domainKey),
          ),
        )
        .limit(1);
      if (duplicate) return { kind: "duplicate" as const };
    }
    let globalCompanyId: string | null = null;
    if (shareWithGlobal) {
      if (domainKey) {
        const [globalDuplicate] = await tx
          .select({ id: globalCompaniesTable.id })
          .from(globalCompaniesTable)
          .where(eq(globalCompaniesTable.companyDomainKey, domainKey))
          .limit(1);
        if (globalDuplicate) {
          return { kind: "global_domain_exists" as const };
        }
      }
      const [globalCompany] = await tx
        .insert(globalCompaniesTable)
        .values({ ...profile, companyName, companyDomainKey: domainKey })
        .onConflictDoNothing()
        .returning({ id: globalCompaniesTable.id });
      if (!globalCompany) {
        return { kind: "global_domain_exists" as const };
      }
      globalCompanyId = globalCompany.id;
    }
    const [created] = await tx
      .insert(companiesTable)
      .values({
        userId,
        ...profile,
        companyName,
        companyDomainKey: domainKey,
        globalCompanyId,
      })
      .returning();
    return created ? { kind: "created" as const, company: created } : { kind: "missing_user" as const };
  });
  if (result.kind === "duplicate") {
    res.status(409).json({
      error: "A company with this domain already exists. Link contacts to that company instead.",
      code: "COMPANY_DOMAIN_EXISTS",
    });
    return;
  }
  if (result.kind === "global_domain_exists") {
    res.status(409).json({
      error: "A company with this domain is already in the Global Company DB. Browse the global catalog to add the existing profile to your workspace.",
      code: "GLOBAL_COMPANY_DOMAIN_EXISTS",
    });
    return;
  }
  if (result.kind === "missing_user") {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  res.status(201).json(CreateCompanyResponse.parse(presentCompany(result.company)));
});

router.get(
  "/companies/:companyId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetCompanyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid company identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.id, params.data.companyId), eq(companiesTable.userId, userId)))
      .limit(1);
    if (!company) {
      res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
      return;
    }
    const contacts = await db
      .select({
        id: contactsTable.id,
        name: contactsTable.name,
        email: contactsTable.email,
        jobTitle: contactsTable.jobTitle,
      })
      .from(contactsTable)
      .where(and(eq(contactsTable.companyId, company.id), eq(contactsTable.userId, userId)))
      .orderBy(asc(contactsTable.firstName), asc(contactsTable.lastName));
    res.json(
      GetCompanyResponse.parse({
        company: presentCompany(company),
        contacts,
      }),
    );
  },
);

router.patch(
  "/companies/:companyId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = UpdateCompanyParams.safeParse(req.params);
    const parsed = UpdateCompanyBody.safeParse(req.body);
    if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      res.status(400).json({ error: "Enter valid company details to update.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!lockedUser) return { kind: "not_found" as const };
      const [company] = await tx
        .select()
        .from(companiesTable)
        .where(and(eq(companiesTable.id, params.data.companyId), eq(companiesTable.userId, userId)))
        .limit(1)
        .for("update");
      if (!company) return { kind: "not_found" as const };
      if (company.globalCompanyId) {
        return { kind: "global_managed" as const };
      }

      const profile = cleanCompanyInput(parsed.data as Record<string, unknown>, company);
      const domainKey = companyDomainKey(profile);
      const companyName = profile.companyName;
      if (!companyName || !validDomain(profile)) {
        return { kind: "invalid" as const };
      }
      if (domainKey) {
        const [duplicate] = await tx
          .select({ id: companiesTable.id })
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.userId, userId),
              eq(companiesTable.companyDomainKey, domainKey),
              ne(companiesTable.id, company.id),
            ),
          )
          .limit(1);
        if (duplicate) return { kind: "duplicate" as const };
      }
      const [updated] = await tx
        .update(companiesTable)
        .set({
          ...profile,
          companyName,
          companyDomainKey: domainKey,
          updatedAt: new Date(),
        })
        .where(and(eq(companiesTable.id, company.id), eq(companiesTable.userId, userId)))
        .returning();
      return updated ? { kind: "updated" as const, company: updated } : { kind: "not_found" as const };
    });
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
      return;
    }
    if (result.kind === "global_managed") {
      res.status(409).json({
        error: "This company profile is managed by the global company catalog.",
        code: "GLOBAL_COMPANY_MANAGED",
      });
      return;
    }
    if (result.kind === "invalid") {
      res.status(400).json({ error: "Enter a company name and a valid company domain.", code: "INVALID_INPUT" });
      return;
    }
    if (result.kind === "duplicate") {
      res.status(409).json({
        error: "A company with this domain already exists.",
        code: "COMPANY_DOMAIN_EXISTS",
      });
      return;
    }
    res.json(UpdateCompanyResponse.parse(presentCompany(result.company)));
  },
);

router.delete(
  "/companies/:companyId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteCompanyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid company identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const deleted = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!lockedUser) return "not_found" as const;
      const [company] = await tx
        .select()
        .from(companiesTable)
        .where(and(eq(companiesTable.id, params.data.companyId), eq(companiesTable.userId, userId)))
        .limit(1)
        .for("update");
      if (!company) return "not_found" as const;
      await tx
        .update(contactsTable)
        .set({
          ...companyProfileFrom(company),
          companyId: null,
          companyLinkSuppressed: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contactsTable.companyId, company.id),
            eq(contactsTable.userId, userId),
          ),
        );
      const [removedCompany] = await tx
        .delete(companiesTable)
        .where(and(eq(companiesTable.id, company.id), eq(companiesTable.userId, userId)))
        .returning({ id: companiesTable.id });
      if (!removedCompany) {
        throw new Error("Company disappeared while its linked contacts were being restored.");
      }
      return "deleted" as const;
    });
    if (deleted === "not_found") {
      res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
      return;
    }
    res.status(204).end();
  },
);

export default router;