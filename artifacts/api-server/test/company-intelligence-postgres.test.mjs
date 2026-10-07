import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { source, profileFixture } from "./fixtures/company-intelligence.mjs";

test("PostgreSQL research is explicit, deduplicated, versioned and isolated from master/contact data", { skip: !process.env.RUN_COMPANY_RESEARCH_DB_TESTS }, async () => {
  process.env.NODE_ENV = "test";
  const schema = await import("@workspace/db");
  const { pool, setTestDatabase, globalCompaniesTable, companyResearchJobsTable, companyIntelligenceTable } = schema;
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
      const safe = GetCompanyIntelligenceResponse.parse(current);
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
      throw rollback;
    }), error => error === rollback);
  } finally {
    setTestDatabase(realDb);
    await pool.end();
  }
});
