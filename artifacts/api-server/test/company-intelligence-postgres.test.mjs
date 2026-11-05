import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { source, profileFixture } from "./fixtures/company-intelligence.mjs";

test("PostgreSQL research is explicit, deduplicated, versioned and isolated from master/contact data", { skip: !process.env.RUN_COMPANY_RESEARCH_DB_TESTS }, async () => {
  process.env.NODE_ENV = "test";
  const schema = await import("@workspace/db");
  const { pool, setTestDatabase, globalCompaniesTable, companyResearchJobsTable, companyIntelligenceTable, companyResearchRequestsTable, usersTable, platformNotificationsTable, platformNotificationRecipientsTable, subscriptionPackagesTable, userSubscriptionsTable } = schema;
  const realDb = drizzle(pool, { schema });
  const service = await import("../src/lib/company-intelligence.ts");
  const { defaultResearchSettings } = await import("../src/lib/company-research-settings.ts");
  const { GetCompanyIntelligenceResponse } = await import("@workspace/api-zod");
  const rollback = new Error("ROLLBACK_TEST_FIXTURES");
  const settings = { ...defaultResearchSettings, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 2, searchCostUsd: 0.01 };
  const prompts = [];
  const dependencies = {
    getApiKey: async () => "fake-test-key",
    collectEvidence: async () => [{ source, text: "Fixture evidence only, not real company research." }],
    requestProvider: async input => {
      prompts.push(input.prompt);
      return { text: input.search ? "Discovery" : JSON.stringify(profileFixture()), candidates: [{ url: source.url }], usage: { inputTokens: 100, outputTokens: 20, webSearchCount: input.search ? 1 : 0 } };
    },
  };
  try {
    await assert.rejects(realDb.transaction(async tx => {
      setTestDatabase(tx);
      const [company] = await tx.insert(globalCompaniesTable).values({ companyName: `Research invariant fixture ${randomUUID()}`, companyDescription: "Manual master record", companyWebsiteUrl: "https://example.com" }).returning();
      const input = { globalCompanyId: company.id, userId: null, provider: "openai", selectedModel: "test-model", settings, depth: 1, overrideFresh: false };
      const before = await service.readCompanyIntelligence(company.id);
      assert.equal(before.current, null);
      assert.equal(before.latestJob, null);
      assert.equal((await tx.select().from(companyResearchJobsTable).where(eq(companyResearchJobsTable.globalCompanyId, company.id))).length, 0, "A GET must never queue research");
      assert.equal((await service.enqueueCompanyResearch({ ...input, globalCompanyId: randomUUID() })).kind, "missing", "Private/non-global IDs cannot be researched");
      const queued = await service.enqueueCompanyResearch(input);
      assert.equal(queued.kind, "created");
      assert.equal((await service.enqueueCompanyResearch(input)).kind, "active");
      const [running] = await tx.update(companyResearchJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(companyResearchJobsTable.id, queued.job.id)).returning();
      await service.executeResearchJob(running, dependencies);
      const current = await service.readCompanyIntelligence(company.id);
      assert.equal(current.current.version, "1.0");
      assert.equal(current.latestJob.status, "completed");
      assert.equal(current.current.profile.executive_summary.one_liner, profileFixture().executive_summary.one_liner);
      const safe = GetCompanyIntelligenceResponse.parse({
        ...current,
        researchAllowance: null,
        researchAvailabilityReason: null,
      });
      const json = JSON.stringify(safe);
      for (const forbidden of ["requestedBy", "estimatedCostUsd", "estimatedCostInr", "apiKey", "inputTokens", "outputTokens"]) assert.equal(json.includes(forbidden), false);
      const [master] = await tx.select().from(globalCompaniesTable).where(eq(globalCompaniesTable.id, company.id));
      assert.equal(master.companyDescription, "Manual master record", "Research must not overwrite the company master");
      assert.equal((await service.enqueueCompanyResearch(input)).kind, "fresh");
      const retry = await service.enqueueCompanyResearch({ ...input, overrideFresh: true });
      const [retryRunning] = await tx.update(companyResearchJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(companyResearchJobsTable.id, retry.job.id)).returning();
      await service.executeResearchJob(retryRunning, { ...dependencies, requestProvider: async () => { throw new Error("simulated failure"); } });
      const afterFailure = await service.readCompanyIntelligence(company.id);
      assert.equal(afterFailure.current.id, current.current.id);
      assert.equal(afterFailure.latestJob.status, "failed");
      assert.equal(afterFailure.history.length, 1);
      const next = await service.enqueueCompanyResearch({ ...input, overrideFresh: true });
      const [nextRunning] = await tx.update(companyResearchJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(companyResearchJobsTable.id, next.job.id)).returning();
      await service.executeResearchJob(nextRunning, dependencies);
      const afterSuccess = await service.readCompanyIntelligence(company.id);
      assert.equal(afterSuccess.current.version, "1.1");
      assert.equal(afterSuccess.history.length, 2);
      const old = await tx.select().from(companyIntelligenceTable).where(and(eq(companyIntelligenceTable.id, current.current.id), eq(companyIntelligenceTable.globalCompanyId, company.id)));
      assert.equal(old.length, 1, "A successful update must retain the original version");
      assert.equal(prompts.length, 4, "Exactly two explicit successful jobs made provider calls; reads did not");
      const [requestUser] = await tx.insert(usersTable).values({
        username: `research-request-${randomUUID().slice(0, 8)}`,
        firstName: "Research",
        lastName: "Requester",
        email: `research-request-${randomUUID()}@example.test`,
        passwordHash: "test-only-hash",
      }).returning();
      const [giftedPremium] = await tx.insert(subscriptionPackagesTable).values({
        name: `Gifted premium fixture ${randomUUID()}`,
        amountMinor: 100,
        periodDays: 30,
      }).returning();
      const [giftedTerm] = await tx.insert(userSubscriptionsTable).values({
        userId: requestUser.id,
        packageId: giftedPremium.id,
        paymentId: null,
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }).returning();
      assert.equal(await service.hasPaidPrimaryResearchRequestAccess(requestUser.id), true, "An active gifted paid-premium term qualifies without a payment row");
      await tx.update(userSubscriptionsTable).set({ endsAt: new Date(Date.now() - 1) })
        .where(eq(userSubscriptionsTable.id, giftedTerm.id));
      assert.equal(await service.hasPaidPrimaryResearchRequestAccess(requestUser.id), false, "An expired gifted term does not qualify");
      const [requestCompany] = await tx.insert(globalCompaniesTable).values({
        companyName: `Requested research fixture ${randomUUID()}`,
        companyWebsiteUrl: "https://example.org",
      }).returning();
      const [request] = await tx.insert(companyResearchRequestsTable).values({
        globalCompanyId: requestCompany.id,
        requestedBy: requestUser.id,
      }).returning();
      const requestedJob = await service.enqueueCompanyResearch({
        globalCompanyId: requestCompany.id,
        userId: null,
        provider: "openai",
        selectedModel: "test-model",
        settings,
        depth: 1,
        overrideFresh: false,
        requestId: request.id,
      });
      assert.equal(requestedJob.kind, "created");
      const [requestedRunning] = await tx.update(companyResearchJobsTable)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(companyResearchJobsTable.id, requestedJob.job.id))
        .returning();
      await service.executeResearchJob(requestedRunning, dependencies);
      const [completedRequest] = await tx.select().from(companyResearchRequestsTable)
        .where(eq(companyResearchRequestsTable.id, request.id));
      assert.equal(completedRequest.status, "completed");
      assert.equal(completedRequest.researchJobId, requestedJob.job.id);
      const [completionNotice] = await tx.select().from(platformNotificationsTable)
        .where(eq(platformNotificationsTable.title, "Company research completed"));
      assert.ok(completionNotice, "Successful request completion creates an in-app notice");
      const [noticeRecipient] = await tx.select().from(platformNotificationRecipientsTable)
        .where(eq(platformNotificationRecipientsTable.notificationId, completionNotice.id));
      assert.equal(noticeRecipient.userId, requestUser.id);
      throw rollback;
    }), error => error === rollback);
  } finally {
    setTestDatabase(realDb);
    await pool.end();
  }
});
