import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddGlobalCompanyToWorkspaceParams,
  CreateCompanyResponse,
  SearchGlobalCompaniesQueryParams,
} from "@workspace/api-zod";
import {
  companiesTable,
  db,
  globalCompaniesTable,
  usersTable,
} from "@workspace/db";
import {
  companyDomainKey,
  companyProfileFrom,
} from "../lib/company-profile";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();

function escapedSearchTerms(search: string): string[] {
  return search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
}

function presentGlobalCompany(
  company: typeof globalCompaniesTable.$inferSelect,
) {
  const { companyDomainKey: _companyDomainKey, ...publicCompany } = company;
  return publicCompany;
}

function presentCompany(company: typeof companiesTable.$inferSelect) {
  const {
    userId: _userId,
    companyDomainKey: _companyDomainKey,
    ...publicCompany
  } = company;
  return publicCompany;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

router.get(
  "/companies/global/search",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = SearchGlobalCompaniesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a valid search and page.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
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
        .orderBy(asc(globalCompaniesTable.companyName), desc(globalCompaniesTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(globalCompaniesTable).where(where),
    ]);
    const rowIds = rows.map((company) => company.id);
    const addedRows = rowIds.length
      ? await db
          .select({ globalCompanyId: companiesTable.globalCompanyId })
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.userId, userId),
              inArray(companiesTable.globalCompanyId, rowIds),
            ),
          )
      : [];
    const alreadyAdded = new Set(
      addedRows.flatMap(({ globalCompanyId }) =>
        globalCompanyId ? [globalCompanyId] : [],
      ),
    );
    res.json({
      companies: rows.map((company) => ({
        ...presentGlobalCompany(company),
        alreadyAdded: alreadyAdded.has(company.id),
      })),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    });
  },
);

router.post(
  "/companies/global/:globalCompanyId/add",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = AddGlobalCompanyToWorkspaceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid global company identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
    try {
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1)
          .for("update");
        if (!user) return { kind: "not_found" as const };

        // Serializes against catalog edits so a new workspace link receives the
        // current profile snapshot and cannot miss an in-flight propagation.
        const [globalCompany] = await tx
          .select()
          .from(globalCompaniesTable)
          .where(eq(globalCompaniesTable.id, params.data.globalCompanyId))
          .limit(1)
          .for("update");
        if (!globalCompany) return { kind: "missing_global" as const };

        const [alreadyAdded] = await tx
          .select({ id: companiesTable.id })
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.userId, userId),
              eq(companiesTable.globalCompanyId, globalCompany.id),
            ),
          )
          .limit(1);
        if (alreadyAdded) return { kind: "already_added" as const };

        const profile = companyProfileFrom(globalCompany);
        const domainKey = companyDomainKey(profile);
        if (domainKey) {
          const [domainConflict] = await tx
            .select({ id: companiesTable.id })
            .from(companiesTable)
            .where(
              and(
                eq(companiesTable.userId, userId),
                eq(companiesTable.companyDomainKey, domainKey),
              ),
            )
            .limit(1);
          if (domainConflict) return { kind: "domain_conflict" as const };
        }

        const [created] = await tx
          .insert(companiesTable)
          .values({
            userId,
            ...profile,
            companyName: globalCompany.companyName,
            companyDomainKey: domainKey,
            globalCompanyId: globalCompany.id,
          })
          .returning();
        return created
          ? { kind: "created" as const, company: created }
          : { kind: "not_found" as const };
      });

      if (result.kind === "missing_global") {
        res.status(404).json({
          error: "Global company not found.",
          code: "GLOBAL_COMPANY_NOT_FOUND",
        });
        return;
      }
      if (result.kind === "already_added") {
        res.status(409).json({
          error: "This company is already in your workspace.",
          code: "GLOBAL_COMPANY_ALREADY_ADDED",
        });
        return;
      }
      if (result.kind === "domain_conflict") {
        res.status(409).json({
          error:
            "A private company with the same domain is already in your workspace. No contacts were moved.",
          code: "COMPANY_DOMAIN_EXISTS",
        });
        return;
      }
      if (result.kind === "not_found") {
        res.status(401).json({
          error: "Please sign in to continue.",
          code: "UNAUTHENTICATED",
        });
        return;
      }
      res.status(201).json(
        CreateCompanyResponse.parse(presentCompany(result.company)),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({
          error:
            "This company conflicts with a company already in your workspace. No contacts were moved.",
          code: "COMPANY_DOMAIN_EXISTS",
        });
        return;
      }
      throw error;
    }
  },
);

export default router;
