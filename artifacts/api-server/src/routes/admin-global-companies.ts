import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { alias } from "drizzle-orm/pg-core";
import {
  CreateGlobalCompanyBody,
  DeleteGlobalCompanyParams,
  ListAdminGlobalCompaniesQueryParams,
  UpdateGlobalCompanyBody,
  UpdateGlobalCompanyParams,
} from "@workspace/api-zod";
import { companiesTable, db, globalCompaniesTable } from "@workspace/db";
import { writeAuditLog } from "../lib/audit";
import {
  companyDomainKey,
  companyProfileFrom,
  normalizeCompanyDomain,
  type CompanyProfileValues,
} from "../lib/company-profile";
import { requireSuperadmin } from "../lib/session";

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
        .orderBy(asc(globalCompaniesTable.companyName), desc(globalCompaniesTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(globalCompaniesTable).where(where),
    ]);

    res.json({
      globalCompanies: rows.map(presentGlobalCompany),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    });
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
