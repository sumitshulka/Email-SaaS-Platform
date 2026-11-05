import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { companiesTable, companyIntelligenceTable, companyResearchJobsTable, companyResearchRequestsTable, db, globalCompaniesTable, platformNotificationRecipientsTable, platformNotificationsTable, systemConfigurationTable, subscriptionPackagesTable, userSubscriptionsTable, usersTable } from "@workspace/db";
import {
  GetCompanyIntelligenceParams, GetCompanyIntelligenceResponse, GetCompanyIntelligenceVersionParams, GetCompanyIntelligenceVersionResponse,
  GetCompanyResearchAllowanceResponse, GetCompanyResearchRequestAccessResponse, GetCompanyResearchSettingsResponse, GetCompanyResearchUsageQueryParams, GetCompanyResearchUsageResponse,
  ListAdminCompanyResearchRequestsQueryParams, ListAdminCompanyResearchRequestsResponse, RequestGlobalCompanyResearchParams, RequestGlobalCompanyResearchResponse, RequestPrivateCompanyResearchParams, RequestPrivateCompanyResearchResponse, StartAdminCompanyResearchRequestParams, StartAdminCompanyResearchRequestResponse,
  StartCompanyResearchBody, StartCompanyResearchParams, StartCompanyResearchResponse,
  UpdateCompanyResearchSettingsBody, UpdateCompanyResearchSettingsResponse,
} from "@workspace/api-zod";
import { requireSuperadmin, requireUserRole } from "../lib/session";
import { getAIProviderConfigurationStatus, getStoredAIProviderApiKey } from "../lib/ai-provider-configuration";
import { listAIProviderModels } from "../lib/ai-provider-client";
import { getResearchSettings, researchSettingsKey } from "../lib/company-research-settings";
import { enqueueCompanyResearch, getCompanyResearchAllowance, hasPaidPrimaryResearchRequestAccess, presentCompanyResearchRequest, presentIntelligenceVersion, presentResearchJob, readCompanyIntelligence, researchUsageMetrics } from "../lib/company-intelligence";
import { writeAuditLog } from "../lib/audit";
import { companyDomainKey, companyProfileFrom } from "../lib/company-profile";

const router: IRouter = Router();
const researchRole: RequestHandler = (req, res, next) => req.authUser?.role === "SUPERADMIN" ? requireSuperadmin(req, res, next) : requireUserRole(req, res, next);

router.get("/company-intelligence/allowance", requireUserRole, async (req, res): Promise<void> => {
  const allowance = await getCompanyResearchAllowance(req.authUser!.id);
  res.json(GetCompanyResearchAllowanceResponse.parse({ allowance }));
});

router.get("/company-intelligence/request-access", requireUserRole, async (req, res): Promise<void> => {
  const eligible = await hasPaidPrimaryResearchRequestAccess(req.authUser!.id);
  res.json(GetCompanyResearchRequestAccessResponse.parse({
    eligible,
    reason: eligible ? null : "active_paid_plan_required",
  }));
});

router.get("/company-intelligence/:globalCompanyId", researchRole, async (req, res): Promise<void> => {
  const params = GetCompanyIntelligenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid global company identifier." }); return; }
  const result = await readCompanyIntelligence(params.data.globalCompanyId);
  if (!result) { res.status(404).json({ error: "Global company not found." }); return; }
  const superadmin = req.authUser?.role === "SUPERADMIN";
  const [userRequest] = superadmin ? [] : await db.select().from(companyResearchRequestsTable)
    .where(and(
      eq(companyResearchRequestsTable.globalCompanyId, params.data.globalCompanyId),
      eq(companyResearchRequestsTable.requestedBy, req.authUser!.id),
    ))
    .orderBy(desc(companyResearchRequestsTable.createdAt))
    .limit(1);
  const researchAllowance = superadmin ? null : await getCompanyResearchAllowance(req.authUser!.id);
  const hasResearchAllowance = !!researchAllowance && researchAllowance.limit > 0;
  const remainingResearchRuns = researchAllowance?.remaining ?? 0;
  const researchAvailable = superadmin
    ? result.researchAvailable
    : result.researchAvailable && hasResearchAllowance && remainingResearchRuns > 0;
  res.json(GetCompanyIntelligenceResponse.parse({
    ...result,
    researchRequest: userRequest ? presentCompanyResearchRequest(userRequest, result.companyName) : null,
    researchAllowance,
    researchAvailable,
    researchAvailabilityReason: !result.researchAvailable
      ? "provider_not_configured"
      : superadmin
        ? null
        : !researchAllowance
          ? "ai_package_required"
          : researchAllowance.limit === 0
            ? "research_not_included"
          : remainingResearchRuns === 0
            ? "research_allowance_exhausted"
            : null,
  }));
});

router.get("/company-intelligence/:globalCompanyId/history/:versionId", researchRole, async (req, res): Promise<void> => {
  const params = GetCompanyIntelligenceVersionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid research version." }); return; }
  const [version] = await db.select().from(companyIntelligenceTable).where(and(eq(companyIntelligenceTable.globalCompanyId, params.data.globalCompanyId), eq(companyIntelligenceTable.id, params.data.versionId))).limit(1);
  if (!version) { res.status(404).json({ error: "Research version not found." }); return; }
  res.json(GetCompanyIntelligenceVersionResponse.parse(presentIntelligenceVersion(version)));
});

router.post("/company-intelligence/:globalCompanyId/requests", requireUserRole, async (req, res): Promise<void> => {
  const params = RequestGlobalCompanyResearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid global company identifier." }); return; }
  const userId = req.authUser!.id;
  const now = new Date();
  const result = await db.transaction(async tx => {
    const [user] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).limit(1).for("update");
    if (!user) return { kind: "missing_user" as const };
    const [paidPlan] = await tx.select({ id: userSubscriptionsTable.id })
      .from(userSubscriptionsTable)
      .innerJoin(subscriptionPackagesTable, eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id))
      .where(and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
        eq(subscriptionPackagesTable.packageType, "primary"),
        gt(subscriptionPackagesTable.amountMinor, 0),
      )).limit(1).for("update");
    if (!paidPlan) return { kind: "paid_plan_required" as const };
    const [company] = await tx.select({ id: globalCompaniesTable.id, name: globalCompaniesTable.companyName })
      .from(globalCompaniesTable).where(eq(globalCompaniesTable.id, params.data.globalCompanyId)).limit(1).for("update");
    if (!company) return { kind: "missing_company" as const };
    const [profile] = await tx.select({ id: companyIntelligenceTable.id })
      .from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, company.id)).limit(1);
    if (profile) return { kind: "already_researched" as const };
    const [existing] = await tx.select().from(companyResearchRequestsTable).where(and(
      eq(companyResearchRequestsTable.globalCompanyId, company.id),
      eq(companyResearchRequestsTable.requestedBy, userId),
      inArray(companyResearchRequestsTable.status, ["requested", "in_progress"]),
    )).limit(1);
    if (existing) return { kind: "existing" as const, request: existing, companyName: company.name };
    const [activeJob] = await tx.select({ id: companyResearchJobsTable.id })
      .from(companyResearchJobsTable).where(and(
        eq(companyResearchJobsTable.globalCompanyId, company.id),
        inArray(companyResearchJobsTable.status, ["queued", "running"]),
      )).limit(1);
    const [request] = await tx.insert(companyResearchRequestsTable).values({
      globalCompanyId: company.id,
      requestedBy: userId,
      status: activeJob ? "in_progress" : "requested",
      researchJobId: activeJob?.id ?? null,
      startedAt: activeJob ? now : null,
    }).returning();
    return { kind: "created" as const, request: request!, companyName: company.name };
  });
  if (result.kind === "paid_plan_required") { res.status(403).json({ error: "An active paid primary plan is required to request company research.", code: "PAID_PRIMARY_REQUIRED" }); return; }
  if (result.kind === "missing_user") { res.status(401).json({ error: "Please sign in to continue." }); return; }
  if (result.kind === "missing_company") { res.status(404).json({ error: "Global company not found." }); return; }
  if (result.kind === "already_researched") { res.status(409).json({ error: "This company already has completed research. Open its intelligence profile instead.", code: "COMPANY_ALREADY_RESEARCHED" }); return; }
  if (result.kind === "existing") {
    res.json(RequestGlobalCompanyResearchResponse.parse({
      request: presentCompanyResearchRequest(result.request, result.companyName),
    }));
    return;
  }
  await writeAuditLog({ actorId: userId, action: "company_intelligence.request_submitted", entity: "global_company", entityId: params.data.globalCompanyId, ipAddress: req.ip });
  res.status(201).json(RequestGlobalCompanyResearchResponse.parse({
    request: presentCompanyResearchRequest(result.request, result.companyName),
  }));
});

router.post("/companies/:companyId/research-requests", requireUserRole, async (req, res): Promise<void> => {
  const params = RequestPrivateCompanyResearchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid company identifier." }); return; }
  const userId = req.authUser!.id;
  const now = new Date();
  const result = await db.transaction(async tx => {
    const [user] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).limit(1).for("update");
    if (!user) return { kind: "missing_user" as const };
    const [paidPlan] = await tx.select({ id: userSubscriptionsTable.id })
      .from(userSubscriptionsTable)
      .innerJoin(subscriptionPackagesTable, eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id))
      .where(and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
        eq(subscriptionPackagesTable.packageType, "primary"),
        gt(subscriptionPackagesTable.amountMinor, 0),
      )).limit(1).for("update");
    if (!paidPlan) return { kind: "paid_plan_required" as const };
    const [company] = await tx.select().from(companiesTable).where(and(
      eq(companiesTable.id, params.data.companyId),
      eq(companiesTable.userId, userId),
    )).limit(1).for("update");
    if (!company) return { kind: "missing_company" as const };
    let globalCompanyId = company.globalCompanyId;
    if (!globalCompanyId) {
      const domainKey = companyDomainKey(company);
      if (domainKey) {
        const [duplicate] = await tx.select({ id: globalCompaniesTable.id })
          .from(globalCompaniesTable).where(eq(globalCompaniesTable.companyDomainKey, domainKey)).limit(1);
        if (duplicate) return { kind: "global_exists" as const };
      }
      const profile = companyProfileFrom(company);
      const [createdGlobal] = await tx.insert(globalCompaniesTable).values({
        ...profile,
        companyName: company.companyName,
        companyDomainKey: domainKey,
      }).returning({ id: globalCompaniesTable.id });
      if (!createdGlobal) return { kind: "global_create_failed" as const };
      globalCompanyId = createdGlobal.id;
      await tx.update(companiesTable).set({ globalCompanyId })
        .where(and(eq(companiesTable.id, company.id), eq(companiesTable.userId, userId)));
    }
    const [profile] = await tx.select({ id: companyIntelligenceTable.id })
      .from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, globalCompanyId)).limit(1);
    if (profile) return { kind: "already_researched" as const };
    const [existing] = await tx.select().from(companyResearchRequestsTable).where(and(
      eq(companyResearchRequestsTable.globalCompanyId, globalCompanyId),
      eq(companyResearchRequestsTable.requestedBy, userId),
      inArray(companyResearchRequestsTable.status, ["requested", "in_progress"]),
    )).limit(1);
    if (existing) {
      const [global] = await tx.select({ name: globalCompaniesTable.companyName })
        .from(globalCompaniesTable).where(eq(globalCompaniesTable.id, globalCompanyId)).limit(1);
      return { kind: "existing" as const, request: existing, companyName: global?.name ?? company.companyName };
    }
    const [activeJob] = await tx.select({ id: companyResearchJobsTable.id })
      .from(companyResearchJobsTable).where(and(
        eq(companyResearchJobsTable.globalCompanyId, globalCompanyId),
        inArray(companyResearchJobsTable.status, ["queued", "running"]),
      )).limit(1);
    const [request] = await tx.insert(companyResearchRequestsTable).values({
      globalCompanyId,
      requestedBy: userId,
      status: activeJob ? "in_progress" : "requested",
      researchJobId: activeJob?.id ?? null,
      startedAt: activeJob ? now : null,
    }).returning();
    const [global] = await tx.select({ name: globalCompaniesTable.companyName })
      .from(globalCompaniesTable).where(eq(globalCompaniesTable.id, globalCompanyId)).limit(1);
    return {
      kind: "created" as const,
      request: request!,
      companyName: global?.name ?? company.companyName,
      companyId: company.id,
    };
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return { kind: "global_exists" as const };
    }
    throw error;
  });
  if (result.kind === "paid_plan_required") { res.status(403).json({ error: "An active paid primary plan is required to request company research.", code: "PAID_PRIMARY_REQUIRED" }); return; }
  if (result.kind === "missing_user") { res.status(401).json({ error: "Please sign in to continue." }); return; }
  if (result.kind === "missing_company") { res.status(404).json({ error: "Company not found." }); return; }
  if (result.kind === "global_exists") { res.status(409).json({ error: "A company with this domain is already in the Global Company catalog. Add that catalog profile to your workspace and request research there.", code: "GLOBAL_COMPANY_DOMAIN_EXISTS" }); return; }
  if (result.kind === "global_create_failed") { res.status(409).json({ error: "This company could not be added to the Global Company catalog. Please retry.", code: "GLOBAL_COMPANY_CREATE_FAILED" }); return; }
  if (result.kind === "already_researched") { res.status(409).json({ error: "This company already has completed research. Open its intelligence profile instead.", code: "COMPANY_ALREADY_RESEARCHED" }); return; }
  if (result.kind === "existing") {
    res.json(RequestPrivateCompanyResearchResponse.parse({
      request: presentCompanyResearchRequest(result.request, result.companyName),
      companyId: params.data.companyId,
    }));
    return;
  }
  await writeAuditLog({ actorId: userId, action: "company_intelligence.private_company_shared_for_research", entity: "global_company", entityId: result.request.globalCompanyId, ipAddress: req.ip });
  res.status(201).json(RequestPrivateCompanyResearchResponse.parse({
    request: presentCompanyResearchRequest(result.request, result.companyName),
    companyId: result.companyId,
  }));
});

router.post("/company-intelligence/:globalCompanyId/research", researchRole, async (req, res): Promise<void> => {
  const params = StartCompanyResearchParams.safeParse(req.params);
  const parsed = StartCompanyResearchBody.safeParse(req.body);
  if (!params.success || !parsed.success || parsed.data.confirmed !== true) { res.status(400).json({ error: "Explicitly confirm research for this global company." }); return; }
  const superadmin = req.authUser?.role === "SUPERADMIN";
  if (!superadmin && parsed.data.scope !== "full") {
    res.status(403).json({ error: "Focused section research is available to platform administrators only." }); return;
  }
  const [settings, provider] = await Promise.all([getResearchSettings(), getAIProviderConfigurationStatus()]);
  if (!provider.provider || !provider.selectedModel || !await getStoredAIProviderApiKey(provider.provider)) { res.status(503).json({ error: "A superadmin must configure an AI provider and model before research is available.", code: "RESEARCH_UNAVAILABLE" }); return; }
  const depth = parsed.data.depth ?? 1;
  if (depth > settings.maxResearchDepth || (depth === 3 && !settings.deepResearchEnabled)) { res.status(400).json({ error: "That research depth is not enabled." }); return; }
  const result = await enqueueCompanyResearch({
    globalCompanyId: params.data.globalCompanyId, userId: req.authUser!.id,
    ...(superadmin ? {} : { tenantUserId: req.authUser!.id }),
    settings, depth, provider: provider.provider, selectedModel: provider.selectedModel,
    overrideFresh: parsed.data.overrideFresh ?? false, scope: parsed.data.scope, ipAddress: req.ip,
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Global company not found. Private companies are not researched or shared by this endpoint." }); return; }
  if (result.kind === "active") { res.status(409).json({ error: "Research is already in progress for this company.", code: "RESEARCH_IN_PROGRESS" }); return; }
  if (result.kind === "fresh") { res.status(409).json({ error: "This company was researched recently. Confirm a deliberate re-research to continue.", code: "RESEARCH_FRESH_OVERRIDE_REQUIRED" }); return; }
  if (result.kind === "no_allowance") { res.status(403).json({ error: "An active package with company research allowance is required to research companies.", code: "AI_PACKAGE_REQUIRED" }); return; }
  if (result.kind === "allowance_exhausted") { res.status(403).json({ error: "You have used all company research runs for this subscription term. Your allowance renews with a new package term.", code: "RESEARCH_ALLOWANCE_EXHAUSTED" }); return; }
  if (result.kind === "profile_required") { res.status(409).json({ error: "Run full company research before refreshing an individual section.", code: "COMPANY_PROFILE_REQUIRED" }); return; }
  res.status(202).json(StartCompanyResearchResponse.parse(presentResearchJob(result.job)));
});

router.get("/admin/company-intelligence/settings", requireSuperadmin, async (_req, res): Promise<void> => {
  res.json(GetCompanyResearchSettingsResponse.parse(await getResearchSettings()));
});
router.put("/admin/company-intelligence/settings", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = UpdateCompanyResearchSettingsBody.safeParse(req.body);
  if (!parsed.success || parsed.data.agingDays <= parsed.data.freshDays) { res.status(400).json({ error: "Enter valid research limits; the aging threshold must exceed the freshness threshold." }); return; }
  const settings = { ...parsed.data, allowedSourceTypes: [...new Set(parsed.data.allowedSourceTypes)], preferredModel: parsed.data.preferredModel?.trim() || null, backupModel: parsed.data.backupModel?.trim() || null };
  if (settings.preferredModel || settings.backupModel) {
    const provider = await getAIProviderConfigurationStatus();
    const key = provider.provider ? await getStoredAIProviderApiKey(provider.provider) : null;
    if (!provider.provider || !key) { res.status(400).json({ error: "Connect an AI provider before choosing research models." }); return; }
    try {
      const models = await listAIProviderModels(provider.provider, key);
      if ([settings.preferredModel, settings.backupModel].some(model => model && !models.some(item => item.id === model))) { res.status(400).json({ error: "Choose models available from the currently connected provider." }); return; }
    } catch { res.status(400).json({ error: "The connected provider could not verify those models. Test the connection and retry." }); return; }
  }
  await db.insert(systemConfigurationTable).values({ key: researchSettingsKey, value: settings, updatedBy: req.authUser!.id }).onConflictDoUpdate({ target: systemConfigurationTable.key, set: { value: settings, updatedBy: req.authUser!.id, updatedAt: new Date() } });
  await writeAuditLog({ actorId: req.authUser!.id, action: "company_intelligence.settings_updated", entity: "system_configuration", entityId: researchSettingsKey, ipAddress: req.ip });
  res.json(UpdateCompanyResearchSettingsResponse.parse(settings));
});

router.get("/admin/company-intelligence/requests", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = ListAdminCompanyResearchRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request page." }); return; }
  const { page, pageSize } = parsed.data;
  const [rows, [totalRow]] = await Promise.all([
    db.select({
      request: companyResearchRequestsTable,
      companyName: globalCompaniesTable.companyName,
      requesterName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`,
      requesterEmail: usersTable.email,
    }).from(companyResearchRequestsTable)
      .innerJoin(globalCompaniesTable, eq(globalCompaniesTable.id, companyResearchRequestsTable.globalCompanyId))
      .innerJoin(usersTable, eq(usersTable.id, companyResearchRequestsTable.requestedBy))
      .orderBy(asc(companyResearchRequestsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(companyResearchRequestsTable),
  ]);
  res.json(ListAdminCompanyResearchRequestsResponse.parse({
    items: rows.map(({ request, companyName, requesterName, requesterEmail }) => ({
      ...presentCompanyResearchRequest(request, companyName),
      requesterName,
      requesterEmail,
    })),
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  }));
});

router.post("/admin/company-intelligence/requests/:requestId/start", requireSuperadmin, async (req, res): Promise<void> => {
  const params = StartAdminCompanyResearchRequestParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid research request identifier." }); return; }
  const [requestData] = await db.select({
    request: companyResearchRequestsTable,
    companyName: globalCompaniesTable.companyName,
  }).from(companyResearchRequestsTable)
    .innerJoin(globalCompaniesTable, eq(globalCompaniesTable.id, companyResearchRequestsTable.globalCompanyId))
    .where(eq(companyResearchRequestsTable.id, params.data.requestId)).limit(1);
  if (!requestData) { res.status(404).json({ error: "Research request not found." }); return; }
  if (requestData.request.status === "completed" || requestData.request.status === "in_progress") {
    res.status(409).json({ error: "This request is already complete or in progress.", code: "RESEARCH_REQUEST_NOT_STARTABLE" }); return;
  }
  const [existingProfile] = await db.select({
    jobId: companyIntelligenceTable.jobId,
  }).from(companyIntelligenceTable)
    .where(eq(companyIntelligenceTable.globalCompanyId, requestData.request.globalCompanyId))
    .orderBy(desc(companyIntelligenceTable.version)).limit(1);
  if (existingProfile) {
    const completedAt = new Date();
    const result = await db.transaction(async tx => {
      const [updated] = await tx.update(companyResearchRequestsTable).set({
        status: "completed",
        researchJobId: existingProfile.jobId,
        completedAt,
      }).where(and(
        eq(companyResearchRequestsTable.id, requestData.request.id),
        inArray(companyResearchRequestsTable.status, ["requested", "failed"]),
      )).returning();
      if (!updated) return null;
      const [notification] = await tx.insert(platformNotificationsTable).values({
        title: "Company research completed",
        message: `Company intelligence research for ${requestData.companyName} is complete and available in your workspace.`,
        audience: "focused",
        enabled: true,
        startsAt: completedAt,
        expiresAt: new Date(completedAt.getTime() + 5 * 365 * 24 * 60 * 60 * 1000),
      }).returning({ id: platformNotificationsTable.id });
      if (notification) {
        await tx.insert(platformNotificationRecipientsTable).values({
          notificationId: notification.id,
          userId: updated.requestedBy,
        }).onConflictDoNothing();
      }
      return updated;
    });
    if (result) {
      const [completedJob] = await db.select().from(companyResearchJobsTable)
        .where(eq(companyResearchJobsTable.id, existingProfile.jobId)).limit(1);
      if (completedJob) {
        res.status(202).json(StartAdminCompanyResearchRequestResponse.parse({
          request: presentCompanyResearchRequest(result, requestData.companyName),
          job: presentResearchJob(completedJob),
        }));
        return;
      }
    }
    res.status(409).json({ error: "This request is no longer available.", code: "RESEARCH_REQUEST_NOT_STARTABLE" });
    return;
  }
  const [settings, provider] = await Promise.all([getResearchSettings(), getAIProviderConfigurationStatus()]);
  if (!provider.provider || !provider.selectedModel || !await getStoredAIProviderApiKey(provider.provider)) {
    res.status(503).json({ error: "Connect an AI provider and model before starting company research.", code: "RESEARCH_UNAVAILABLE" });
    return;
  }
  const [activeJob] = await db.select().from(companyResearchJobsTable).where(and(
    eq(companyResearchJobsTable.globalCompanyId, requestData.request.globalCompanyId),
    inArray(companyResearchJobsTable.status, ["queued", "running"]),
  )).limit(1);
  let job = activeJob;
  if (!job) {
    const result = await enqueueCompanyResearch({
      globalCompanyId: requestData.request.globalCompanyId,
      userId: req.authUser!.id,
      settings,
      depth: 1,
      provider: provider.provider,
      selectedModel: provider.selectedModel,
      overrideFresh: false,
      ipAddress: req.ip,
      requestId: requestData.request.id,
    });
    if (result.kind === "created") job = result.job;
    else if (result.kind === "active") {
      [job] = await db.select().from(companyResearchJobsTable).where(and(
        eq(companyResearchJobsTable.globalCompanyId, requestData.request.globalCompanyId),
        inArray(companyResearchJobsTable.status, ["queued", "running"]),
      )).limit(1);
    } else if (result.kind === "fresh") {
      res.status(409).json({ error: "Research was completed by another run. Refresh the request queue.", code: "RESEARCH_ALREADY_COMPLETED" });
      return;
    } else {
      res.status(409).json({ error: "The company research request could not be started. Refresh the queue and retry.", code: "RESEARCH_REQUEST_NOT_STARTABLE" });
      return;
    }
  }
  if (!job) { res.status(409).json({ error: "No research job could be attached to this request.", code: "RESEARCH_REQUEST_NOT_STARTABLE" }); return; }
  const [updatedRequest] = await db.update(companyResearchRequestsTable).set({
    status: "in_progress",
    researchJobId: job.id,
    startedAt: requestData.request.startedAt ?? new Date(),
  }).where(and(
    eq(companyResearchRequestsTable.id, requestData.request.id),
    inArray(companyResearchRequestsTable.status, ["requested", "failed"]),
  )).returning();
  if (!updatedRequest) { res.status(409).json({ error: "This request was updated by another administrator.", code: "RESEARCH_REQUEST_NOT_STARTABLE" }); return; }
  await writeAuditLog({ actorId: req.authUser!.id, action: "company_intelligence.request_started", entity: "company_research_request", entityId: updatedRequest.id, ipAddress: req.ip });
  res.status(202).json(StartAdminCompanyResearchRequestResponse.parse({
    request: presentCompanyResearchRequest(updatedRequest, requestData.companyName),
    job: presentResearchJob(job),
  }));
});

router.get("/admin/company-intelligence/usage", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = GetCompanyResearchUsageQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid monitoring page." }); return; }
  const { page, pageSize } = parsed.data;
  const [metrics, jobs] = await Promise.all([
    researchUsageMetrics(),
    db.select({ job: companyResearchJobsTable, companyName: globalCompaniesTable.companyName }).from(companyResearchJobsTable).innerJoin(globalCompaniesTable, eq(globalCompaniesTable.id, companyResearchJobsTable.globalCompanyId)).orderBy(desc(companyResearchJobsTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
  ]);
  res.json(GetCompanyResearchUsageResponse.parse({
    ...metrics, page, pageSize,
    jobs: jobs.map(({ job, companyName }) => ({
      ...presentResearchJob(job), companyId: job.globalCompanyId, companyName, provider: job.provider, model: job.model,
      inputTokens: job.inputTokens, outputTokens: job.outputTokens, webSearchCount: job.webSearchCount, sourceCount: job.sourceCount,
      durationMs: job.startedAt && job.completedAt ? job.completedAt.getTime() - job.startedAt.getTime() : null,
      creditCost: job.creditCost, estimatedCostUsd: job.estimatedCostUsd === null ? null : Number(job.estimatedCostUsd), estimatedCostInr: job.estimatedCostInr === null ? null : Number(job.estimatedCostInr),
    })),
  }));
});
export default router;
