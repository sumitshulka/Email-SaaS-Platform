import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { companyIntelligenceTable, companyResearchJobsTable, db, globalCompaniesTable, systemConfigurationTable } from "@workspace/db";
import {
  GetCompanyIntelligenceParams, GetCompanyIntelligenceResponse, GetCompanyIntelligenceVersionParams, GetCompanyIntelligenceVersionResponse,
  GetCompanyResearchAllowanceResponse, GetCompanyResearchSettingsResponse, GetCompanyResearchUsageQueryParams, GetCompanyResearchUsageResponse,
  StartCompanyResearchBody, StartCompanyResearchParams, StartCompanyResearchResponse,
  UpdateCompanyResearchSettingsBody, UpdateCompanyResearchSettingsResponse,
} from "@workspace/api-zod";
import { requireSuperadmin, requireUserRole } from "../lib/session";
import { getAIProviderConfigurationStatus, getStoredAIProviderApiKey } from "../lib/ai-provider-configuration";
import { listAIProviderModels } from "../lib/ai-provider-client";
import { getResearchSettings, researchSettingsKey } from "../lib/company-research-settings";
import { enqueueCompanyResearch, getCompanyResearchAllowance, presentIntelligenceVersion, presentResearchJob, readCompanyIntelligence, researchUsageMetrics } from "../lib/company-intelligence";
import { writeAuditLog } from "../lib/audit";

const router: IRouter = Router();
const researchRole: RequestHandler = (req, res, next) => req.authUser?.role === "SUPERADMIN" ? requireSuperadmin(req, res, next) : requireUserRole(req, res, next);

router.get("/company-intelligence/allowance", requireUserRole, async (req, res): Promise<void> => {
  const allowance = await getCompanyResearchAllowance(req.authUser!.id);
  res.json(GetCompanyResearchAllowanceResponse.parse({ allowance }));
});

router.get("/company-intelligence/:globalCompanyId", researchRole, async (req, res): Promise<void> => {
  const params = GetCompanyIntelligenceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid global company identifier." }); return; }
  const result = await readCompanyIntelligence(params.data.globalCompanyId);
  if (!result) { res.status(404).json({ error: "Global company not found." }); return; }
  const superadmin = req.authUser?.role === "SUPERADMIN";
  const researchAllowance = superadmin ? null : await getCompanyResearchAllowance(req.authUser!.id);
  const hasResearchAllowance = !!researchAllowance && researchAllowance.limit > 0;
  const remainingResearchRuns = researchAllowance?.remaining ?? 0;
  const researchAvailable = superadmin
    ? result.researchAvailable
    : result.researchAvailable && hasResearchAllowance && remainingResearchRuns > 0;
  res.json(GetCompanyIntelligenceResponse.parse({
    ...result,
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

router.post("/company-intelligence/:globalCompanyId/research", researchRole, async (req, res): Promise<void> => {
  const params = StartCompanyResearchParams.safeParse(req.params);
  const parsed = StartCompanyResearchBody.safeParse(req.body);
  if (!params.success || !parsed.success || parsed.data.confirmed !== true) { res.status(400).json({ error: "Explicitly confirm research for this global company." }); return; }
  const superadmin = req.authUser?.role === "SUPERADMIN";
  const [settings, provider] = await Promise.all([getResearchSettings(), getAIProviderConfigurationStatus()]);
  if (!provider.provider || !provider.selectedModel || !await getStoredAIProviderApiKey(provider.provider)) { res.status(503).json({ error: "A superadmin must configure an AI provider and model before research is available.", code: "RESEARCH_UNAVAILABLE" }); return; }
  const depth = parsed.data.depth ?? 1;
  if (depth > settings.maxResearchDepth || (depth === 3 && !settings.deepResearchEnabled)) { res.status(400).json({ error: "That research depth is not enabled." }); return; }
  const result = await enqueueCompanyResearch({
    globalCompanyId: params.data.globalCompanyId, userId: req.authUser!.id,
    ...(superadmin ? {} : { tenantUserId: req.authUser!.id }),
    settings, depth, provider: provider.provider, selectedModel: provider.selectedModel,
    overrideFresh: parsed.data.overrideFresh ?? false, ipAddress: req.ip,
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Global company not found. Private companies are not researched or shared by this endpoint." }); return; }
  if (result.kind === "active") { res.status(409).json({ error: "Research is already in progress for this company.", code: "RESEARCH_IN_PROGRESS" }); return; }
  if (result.kind === "fresh") { res.status(409).json({ error: "This company was researched recently. Confirm a deliberate re-research to continue.", code: "RESEARCH_FRESH_OVERRIDE_REQUIRED" }); return; }
  if (result.kind === "no_allowance") { res.status(403).json({ error: "An active package with company research allowance is required to research companies.", code: "AI_PACKAGE_REQUIRED" }); return; }
  if (result.kind === "allowance_exhausted") { res.status(403).json({ error: "You have used all company research runs for this subscription term. Your allowance renews with a new package term.", code: "RESEARCH_ALLOWANCE_EXHAUSTED" }); return; }
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
