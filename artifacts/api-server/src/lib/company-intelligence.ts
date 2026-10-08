import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { addOnEntitlementsTable, auditLogsTable, companyIntelligenceTable, companyResearchJobsTable, db, globalCompaniesTable, paymentsTable, subscriptionPackagesTable, userSubscriptionsTable, usersTable, type CompanyIntelligence, type CompanyResearchJob } from "@workspace/db";
import { getAIProviderConfigurationStatus, getStoredAIProviderApiKey } from "./ai-provider-configuration";
import type { AIProviderId } from "./ai-provider-client";
import { intelligenceProfileSchema, researchFreshness, validateIntelligence } from "./company-intelligence-schema";
import { estimateResearchCost, getResearchSettings, parseResearchSettings, type ResearchSettings } from "./company-research-settings";
import { collectCompanyEvidence } from "./company-research-sources";
import { analysisPrompt, discoveryPrompt, researchProviderRequest, ResearchProviderError, type ResearchUsage } from "./company-research-provider";
import { logger } from "./logger";

export function presentResearchJob(job: CompanyResearchJob) {
  return { id: job.id, status: job.status, stage: job.stage, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null, error: job.error };
}

type VersionMetadata = Omit<CompanyIntelligence, "profile" | "jobId" | "globalCompanyId"> & { profile?: unknown };
export function presentIntelligenceVersion(row: VersionMetadata, full = true) {
  return {
    id: row.id, version: `1.${row.version - 1}`, schemaVersion: row.schemaVersion,
    researchedAt: row.researchedAt.toISOString(), validUntil: row.validUntil.toISOString(),
    provider: row.provider, model: row.model, confidence: Number(row.confidence), sourceCount: row.sourceCount,
    ...(full ? { profile: intelligenceProfileSchema.parse(row.profile) } : {}),
  };
}

export async function getCompanyResearchAllowance(userId: string, now = new Date()) {
  const [active] = await db.select({
    packageType: subscriptionPackagesTable.packageType,
    amountMinor: subscriptionPackagesTable.amountMinor,
    baseLimit: subscriptionPackagesTable.researchAllowance,
    startsAt: userSubscriptionsTable.startsAt,
    endsAt: userSubscriptionsTable.endsAt,
  }).from(userSubscriptionsTable).innerJoin(
    subscriptionPackagesTable,
    eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
  ).where(and(
    eq(userSubscriptionsTable.userId, userId),
    eq(userSubscriptionsTable.status, "active"),
    lte(userSubscriptionsTable.startsAt, now),
    gt(userSubscriptionsTable.endsAt, now),
  )).orderBy(desc(userSubscriptionsTable.endsAt)).limit(1);
  if (!active) return null;
  const [usage] = await db.select({
    used: sql<number>`count(*)::int`,
  }).from(companyResearchJobsTable).where(and(
    eq(companyResearchJobsTable.requestedBy, userId),
    gte(companyResearchJobsTable.createdAt, active.startsAt),
    lt(companyResearchJobsTable.createdAt, active.endsAt),
  ));
  const [addOn] = await db.select({
    limit: sql<number>`coalesce(sum(${addOnEntitlementsTable.researchAllowance}), 0)::int`,
    used: sql<number>`coalesce(sum(${addOnEntitlementsTable.researchUsed}), 0)::int`,
  }).from(addOnEntitlementsTable).leftJoin(
    paymentsTable,
    eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
  ).where(and(
    eq(addOnEntitlementsTable.userId, userId),
    or(
      isNull(addOnEntitlementsTable.paymentId),
      eq(paymentsTable.status, "captured"),
    ),
  ));
  const baseUsed = Math.min(Number(usage?.used ?? 0), active.baseLimit);
  const isPaidPrimary =
    active.packageType === "primary" && active.amountMinor > 0;
  const addOnLimit = isPaidPrimary ? Number(addOn?.limit ?? 0) : 0;
  const addOnUsed = isPaidPrimary ? Number(addOn?.used ?? 0) : 0;
  const limit = active.baseLimit + addOnLimit;
  const used = baseUsed + addOnUsed;
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt: active.endsAt.toISOString(),
  };
}

export async function getResearchSummaries(ids: string[]) {
  if (!ids.length) return new Map();
  const [profiles, jobs, settings] = await Promise.all([
    db.selectDistinctOn([companyIntelligenceTable.globalCompanyId], {
      companyId: companyIntelligenceTable.globalCompanyId, researchedAt: companyIntelligenceTable.researchedAt, sourceCount: companyIntelligenceTable.sourceCount,
    }).from(companyIntelligenceTable).where(inArray(companyIntelligenceTable.globalCompanyId, ids)).orderBy(companyIntelligenceTable.globalCompanyId, desc(companyIntelligenceTable.researchedAt)),
    db.selectDistinctOn([companyResearchJobsTable.globalCompanyId], {
      companyId: companyResearchJobsTable.globalCompanyId, status: companyResearchJobsTable.status,
    }).from(companyResearchJobsTable).where(inArray(companyResearchJobsTable.globalCompanyId, ids)).orderBy(companyResearchJobsTable.globalCompanyId, desc(companyResearchJobsTable.createdAt)),
    getResearchSettings(),
  ]);
  return new Map(ids.map(id => {
    const profile = profiles.find(row => row.companyId === id);
    const job = jobs.find(row => row.companyId === id);
    return [id, { status: job?.status ?? "not_researched", freshness: researchFreshness(profile?.researchedAt ?? null, settings.freshDays, settings.agingDays), researchedAt: profile?.researchedAt.toISOString() ?? null, sourceCount: profile?.sourceCount ?? 0 }];
  }));
}

export async function readCompanyIntelligence(companyId: string) {
  const [company] = await db.select({ id: globalCompaniesTable.id, name: globalCompaniesTable.companyName }).from(globalCompaniesTable).where(eq(globalCompaniesTable.id, companyId)).limit(1);
  if (!company) return null;
  const [[current], history, [latestJob], settings, provider] = await Promise.all([
    db.select().from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, companyId)).orderBy(desc(companyIntelligenceTable.version)).limit(1),
    db.select({
      id: companyIntelligenceTable.id, version: companyIntelligenceTable.version, schemaVersion: companyIntelligenceTable.schemaVersion,
      researchedAt: companyIntelligenceTable.researchedAt, validUntil: companyIntelligenceTable.validUntil,
      provider: companyIntelligenceTable.provider, model: companyIntelligenceTable.model,
      confidence: companyIntelligenceTable.confidence, sourceCount: companyIntelligenceTable.sourceCount,
    }).from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, companyId)).orderBy(desc(companyIntelligenceTable.version)),
    db.select().from(companyResearchJobsTable).where(eq(companyResearchJobsTable.globalCompanyId, companyId)).orderBy(desc(companyResearchJobsTable.createdAt)).limit(1),
    getResearchSettings(), getAIProviderConfigurationStatus(),
  ]);
  return {
    companyId, companyName: company.name,
    summary: { status: latestJob?.status ?? "not_researched", freshness: researchFreshness(current?.researchedAt ?? null, settings.freshDays, settings.agingDays), researchedAt: current?.researchedAt.toISOString() ?? null, sourceCount: current?.sourceCount ?? 0 },
    current: current ? presentIntelligenceVersion(current) : null,
    latestJob: latestJob ? presentResearchJob(latestJob) : null,
    history: history.map(row => presentIntelligenceVersion(row, false)),
    researchCreditCost: settings.researchCreditCost, maxResearchDepth: settings.maxResearchDepth,
    deepResearchEnabled: settings.deepResearchEnabled, researchAvailable: provider.configured,
  };
}

export async function enqueueCompanyResearch(input: {
  globalCompanyId: string; userId: string | null; tenantUserId?: string; provider: AIProviderId; selectedModel: string;
  settings: ResearchSettings; depth: number; overrideFresh: boolean; ipAddress?: string;
}) {
  return db.transaction(async tx => {
    const [company] = await tx.select({ id: globalCompaniesTable.id }).from(globalCompaniesTable).where(eq(globalCompaniesTable.id, input.globalCompanyId)).for("update");
    if (!company) return { kind: "missing" as const };
    const [active] = await tx.select({ id: companyResearchJobsTable.id }).from(companyResearchJobsTable).where(and(eq(companyResearchJobsTable.globalCompanyId, company.id), inArray(companyResearchJobsTable.status, ["queued", "running"]))).limit(1);
    if (active) return { kind: "active" as const };
    const [latest] = await tx.select({ researchedAt: companyIntelligenceTable.researchedAt }).from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, company.id)).orderBy(desc(companyIntelligenceTable.version)).limit(1);
    if (latest && researchFreshness(latest.researchedAt, input.settings.freshDays, input.settings.agingDays) === "fresh" && !input.overrideFresh) return { kind: "fresh" as const };
    if (input.tenantUserId) {
      const now = new Date();
      const [lockedUser] = await tx.select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, input.tenantUserId))
        .limit(1)
        .for("update");
      if (!lockedUser) return { kind: "no_allowance" as const };
      const [subscription] = await tx.select({
        subscription: userSubscriptionsTable,
        pkg: subscriptionPackagesTable,
      }).from(userSubscriptionsTable).innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      ).where(and(
        eq(userSubscriptionsTable.userId, input.tenantUserId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      )).orderBy(desc(userSubscriptionsTable.endsAt)).limit(1).for("update");
      if (!subscription) return { kind: "no_allowance" as const };
      const [usage] = await tx.select({
        used: sql<number>`count(*)::int`,
      }).from(companyResearchJobsTable).where(and(
        eq(companyResearchJobsTable.requestedBy, input.tenantUserId),
        gte(companyResearchJobsTable.createdAt, subscription.subscription.startsAt),
        lt(companyResearchJobsTable.createdAt, subscription.subscription.endsAt),
      ));
      if (Number(usage?.used ?? 0) >= subscription.pkg.researchAllowance) {
        if (
          subscription.pkg.packageType !== "primary" ||
          subscription.pkg.amountMinor <= 0
        ) {
          return { kind: "allowance_exhausted" as const };
        }
        const entitlementRows = await tx.select().from(addOnEntitlementsTable)
          .where(and(
            eq(addOnEntitlementsTable.userId, input.tenantUserId),
            gt(addOnEntitlementsTable.researchAllowance, addOnEntitlementsTable.researchUsed),
          ))
          .orderBy(asc(addOnEntitlementsTable.createdAt))
          .for("update");
        const paymentIds = entitlementRows
          .map(row => row.paymentId)
          .filter((id): id is string => id !== null);
        const capturedPayments = paymentIds.length
          ? await tx.select({ id: paymentsTable.id }).from(paymentsTable).where(and(
              inArray(paymentsTable.id, paymentIds),
              eq(paymentsTable.status, "captured"),
            ))
          : [];
        const capturedIds = new Set(capturedPayments.map(row => row.id));
        const available = entitlementRows.find(row =>
          row.paymentId === null || capturedIds.has(row.paymentId),
        );
        if (!available) return { kind: "allowance_exhausted" as const };
        await tx.update(addOnEntitlementsTable).set({
          researchUsed: sql`${addOnEntitlementsTable.researchUsed} + 1`,
        }).where(eq(addOnEntitlementsTable.id, available.id));
      }
    }
    const [job] = await tx.insert(companyResearchJobsTable).values({
      globalCompanyId: company.id, requestedBy: input.userId, status: "queued", stage: "queued", depth: input.depth,
      creditCost: input.settings.researchCreditCost, settings: input.settings, provider: input.provider, model: input.settings.preferredModel ?? input.selectedModel,
    }).returning();
    await tx.insert(auditLogsTable).values({
      actorId: input.userId, action: "company_intelligence.research_requested", entity: "global_company", entityId: company.id,
      ipAddress: input.ipAddress?.slice(0, 80) ?? null, metadata: { depth: input.depth },
    });
    return { kind: "created" as const, job: job! };
  });
}

function officialWebsite(company: { companyWebsiteUrl: string | null; companyDomain: string | null }): string | null {
  const raw = company.companyWebsiteUrl || company.companyDomain;
  return raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
}

export async function executeResearchJob(job: CompanyResearchJob, dependencies: {
  requestProvider?: typeof researchProviderRequest;
  collectEvidence?: typeof collectCompanyEvidence;
  getApiKey?: typeof getStoredAIProviderApiKey;
} = {}): Promise<void> {
  const requestProvider = dependencies.requestProvider ?? researchProviderRequest;
  const collectEvidence = dependencies.collectEvidence ?? collectCompanyEvidence;
  const settings = parseResearchSettings(job.settings);
  const usage: ResearchUsage = { inputTokens: 0, outputTokens: 0, webSearchCount: 0 };
  let model = job.model;
  const addUsage = (next: ResearchUsage) => {
    usage.inputTokens += next.inputTokens; usage.outputTokens += next.outputTokens; usage.webSearchCount += next.webSearchCount;
  };
  async function saveProgress(stage: string, sourceCount?: number) {
    const cost = model === job.model ? estimateResearchCost(usage, settings) : { usd: null, inr: null };
    await db.update(companyResearchJobsTable).set({ stage, model, ...usage, ...(sourceCount === undefined ? {} : { sourceCount }), estimatedCostUsd: cost.usd, estimatedCostInr: cost.inr }).where(and(eq(companyResearchJobsTable.id, job.id), eq(companyResearchJobsTable.status, "running")));
  }
  try {
    const [company] = await db.select().from(globalCompaniesTable).where(eq(globalCompaniesTable.id, job.globalCompanyId)).limit(1);
    if (!company) return;
    const provider = job.provider as AIProviderId;
    const apiKey = await (dependencies.getApiKey ?? getStoredAIProviderApiKey)(provider);
    if (!apiKey) throw new ResearchProviderError("The saved AI provider is unavailable. Ask the superadmin to reconnect it, then retry.");
    await saveProgress("discovering_sources");
    // Only public company master fields are sent. No tenant contacts or associations are queried.
    const master = { companyName: company.companyName, website: company.companyWebsiteUrl, domain: company.companyDomain, industry: company.companyIndustry, location: company.companyLocation, description: company.companyDescription };
    const discovery = await requestProvider({ provider, model, apiKey, prompt: discoveryPrompt(master, settings), search: true, maxWebSearches: settings.maxWebSearches });
    addUsage(discovery.usage);
    await saveProgress("collecting_evidence");
    const evidence = await collectEvidence({ officialUrl: officialWebsite(company), candidates: discovery.candidates, allowedSourceTypes: settings.allowedSourceTypes, maxPages: job.depth === 3 ? 12 : job.depth === 2 ? 8 : 4 });
    await saveProgress("analyzing", evidence.length);
    const now = new Date().toISOString();
    let profile;
    let analysisError: unknown;
    // A configured backup reuses collected evidence; it never performs another search.
    for (const candidateModel of [...new Set([job.model, settings.backupModel].filter((item): item is string => Boolean(item)))]) {
      model = candidateModel;
      try {
        const analysis = await requestProvider({ provider, model, apiKey, prompt: analysisPrompt(evidence, now, master), search: false, maxWebSearches: 0 });
        addUsage(analysis.usage);
        await saveProgress("validating", evidence.length);
        const raw = analysis.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        profile = validateIntelligence(JSON.parse(raw), evidence.map(item => item.source), evidence);
        profile.current_signals.forEach(signal => {
          signal.observed_at = now;
          signal.source_published_date = evidence.find(item => signal.source_ids.includes(item.source.source_id) && item.source.published_date)?.source.published_date ?? null;
        });
        profile.opportunity_signals.forEach(opportunity => { opportunity.generated_at = now; });
        break;
      } catch (error) { analysisError = error; await saveProgress("analyzing", evidence.length); }
    }
    if (!profile) throw analysisError ?? new Error("Invalid research");
    const scores = profile.fact_sources.map(item => item.confidence);
    const confidence = scores.reduce((total, score) => total + score, 0) / Math.max(1, scores.length);
    await db.transaction(async tx => {
      // Serialize completion with global deletion and any future master operations.
      const [exists] = await tx.select({ id: globalCompaniesTable.id }).from(globalCompaniesTable).where(eq(globalCompaniesTable.id, job.globalCompanyId)).for("update");
      const [active] = await tx.select({ id: companyResearchJobsTable.id }).from(companyResearchJobsTable).where(and(eq(companyResearchJobsTable.id, job.id), eq(companyResearchJobsTable.status, "running"))).for("update");
      if (!exists || !active) return;
      const [latest] = await tx.select({ version: companyIntelligenceTable.version }).from(companyIntelligenceTable).where(eq(companyIntelligenceTable.globalCompanyId, job.globalCompanyId)).orderBy(desc(companyIntelligenceTable.version)).limit(1);
      const completedAt = new Date();
      await tx.insert(companyIntelligenceTable).values({
        globalCompanyId: job.globalCompanyId, jobId: job.id, version: (latest?.version ?? 0) + 1, schemaVersion: "1.0",
        profile, provider, model, confidence: confidence.toFixed(4), sourceCount: evidence.length, researchedAt: completedAt,
        validUntil: new Date(completedAt.getTime() + settings.freshDays * 86_400_000),
      });
      const cost = model === job.model ? estimateResearchCost(usage, settings) : { usd: null, inr: null };
      await tx.update(companyResearchJobsTable).set({ status: "completed", stage: "completed", completedAt, model, ...usage, sourceCount: evidence.length, estimatedCostUsd: cost.usd, estimatedCostInr: cost.inr, error: null }).where(eq(companyResearchJobsTable.id, job.id));
    });
  } catch (error) {
    const message = error instanceof ResearchProviderError ? error.message
      : error instanceof Error && error.message.startsWith("No readable evidence") ? error.message
        : "Research could not be completed because the evidence or JSON failed validation. Existing intelligence has been retained.";
    await db.update(companyResearchJobsTable).set({ status: "failed", stage: "failed", completedAt: new Date(), error: message, model, ...usage, estimatedCostUsd: null, estimatedCostInr: null }).where(and(eq(companyResearchJobsTable.id, job.id), eq(companyResearchJobsTable.status, "running")));
    logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Company research failed; previous intelligence retained");
  }
}

let started = false;
export function startCompanyResearchWorker(): void {
  if (started) return;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      // Crashed/interrupted jobs are failed, never silently re-researched. A user must retry.
      await db.update(companyResearchJobsTable).set({ status: "failed", stage: "failed", completedAt: new Date(), error: "Research was interrupted. Existing intelligence has been retained. Please retry explicitly." }).where(and(eq(companyResearchJobsTable.status, "running"), lt(companyResearchJobsTable.startedAt, new Date(Date.now() - 15 * 60_000))));
      const [next] = await db.select({ id: companyResearchJobsTable.id }).from(companyResearchJobsTable).where(eq(companyResearchJobsTable.status, "queued")).orderBy(companyResearchJobsTable.createdAt).limit(1);
      if (!next) return;
      const [claimed] = await db.update(companyResearchJobsTable).set({ status: "running", stage: "loading_company", startedAt: new Date() }).where(and(eq(companyResearchJobsTable.id, next.id), eq(companyResearchJobsTable.status, "queued"))).returning();
      if (claimed) await executeResearchJob(claimed);
    } catch (error) {
      logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Company research worker failed");
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 2500);
  timer.unref();
  void tick();
}

export async function researchUsageMetrics() {
  const [metrics] = await db.select({
    total: sql<number>`count(*)::int`,
    researchesThisMonth: sql<number>`count(*) filter (where ${companyResearchJobsTable.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')::int`,
    successfulResearches: sql<number>`count(*) filter (where ${companyResearchJobsTable.status} = 'completed')::int`,
    failedResearches: sql<number>`count(*) filter (where ${companyResearchJobsTable.status} = 'failed')::int`,
    averageCostUsd: sql<string | null>`avg(${companyResearchJobsTable.estimatedCostUsd})`,
    totalCostUsd: sql<string | null>`sum(${companyResearchJobsTable.estimatedCostUsd})`,
    costedJobs: sql<number>`count(${companyResearchJobsTable.estimatedCostUsd})::int`,
    averageSearches: sql<string | null>`avg(${companyResearchJobsTable.webSearchCount}) filter (where ${companyResearchJobsTable.status} in ('completed','failed'))`,
    averageTokens: sql<string | null>`avg(${companyResearchJobsTable.inputTokens} + ${companyResearchJobsTable.outputTokens}) filter (where ${companyResearchJobsTable.status} in ('completed','failed'))`,
  }).from(companyResearchJobsTable);
  const [companies, researched] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(globalCompaniesTable),
    db.select({ count: sql<number>`count(distinct ${companyIntelligenceTable.globalCompanyId})::int` }).from(companyIntelligenceTable),
  ]);
  return {
    ...metrics, totalCompanies: companies[0]?.count ?? 0, researchedCompanies: researched[0]?.count ?? 0,
    averageCostUsd: metrics?.averageCostUsd === null ? null : Number(metrics?.averageCostUsd),
    totalCostUsd: metrics?.totalCostUsd === null ? null : Number(metrics?.totalCostUsd),
    averageSearches: Number(metrics?.averageSearches ?? 0), averageTokens: Number(metrics?.averageTokens ?? 0),
  };
}
