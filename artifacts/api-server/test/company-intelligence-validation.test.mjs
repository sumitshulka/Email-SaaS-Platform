import assert from "node:assert/strict";
import { test } from "node:test";
import { validateIntelligence, researchFreshness, evidenceContainsDate } from "../src/lib/company-intelligence-schema.ts";
import { isPublicResearchAddress, researchUrl, collectCompanyEvidence } from "../src/lib/company-research-sources.ts";
import { researchProviderRequest } from "../src/lib/company-research-provider.ts";
import { defaultResearchSettings, estimateResearchCost } from "../src/lib/company-research-settings.ts";
import { profileFixture, source } from "./fixtures/company-intelligence.mjs";

test("validated intelligence keeps real source URLs and requires provenance for every fact", () => {
  const fixture = profileFixture();
  fixture.sources = [{ ...source, url: "https://invented.invalid" }];
  assert.equal(validateIntelligence(fixture, [source]).sources[0].url, source.url);
  fixture.business.business_model = "Unsupported new fact";
  assert.throws(() => validateIntelligence(fixture, [source]), /missing its source/);
});
test("unknown citations, key people and impossible event dates are rejected", () => {
  let fixture = profileFixture();
  fixture.current_signals[0].source_ids = ["SRC-999"];
  assert.throws(() => validateIntelligence(fixture, [source]), /unknown source/);
  fixture = profileFixture();
  fixture.key_people = [{ name: "Not allowed" }];
  assert.throws(() => validateIntelligence(fixture, [source]));
  fixture = profileFixture();
  fixture.current_signals[0].event_date = "2026-02-30";
  assert.throws(() => validateIntelligence(fixture, [source]));
  fixture.current_signals[0].event_date = "";
  assert.throws(() => validateIntelligence(fixture, [source]));
});
test("low-reliability sources cannot support strong confidence", () => {
  assert.throws(() => validateIntelligence(profileFixture(), [{ ...source, reliability: "low" }]), /low-reliability/);
});
test("signal dates must be corroborated by the cited publication metadata or actual page text", () => {
  const fixture = profileFixture();
  const undated = { ...source, published_date: null };
  assert.throws(() => validateIntelligence(fixture, [undated]), /not corroborated/);
  assert.ok(validateIntelligence(fixture, [undated], [{ source: undated, text: "Product launch: 15th January, 2026." }]));
  assert.equal(evidenceContainsDate("2026-01-15", "January 15, 2026"), true);
  assert.equal(evidenceContainsDate("2026-01-15", "15 Jan 2026"), true);
  assert.equal(evidenceContainsDate("2026-01-15", "This page only says 2026."), false);
});
test("freshness uses configured thresholds and handles absence", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  assert.equal(researchFreshness(null, 30, 90, now), "not_researched");
  assert.equal(researchFreshness(new Date("2026-09-07T00:00:00Z"), 30, 90, now), "fresh");
  assert.equal(researchFreshness(new Date("2026-09-06T00:00:00Z"), 30, 90, now), "aging");
  assert.equal(researchFreshness(new Date("2026-07-08T00:00:00Z"), 30, 90, now), "stale");
});
test("research URLs block private addresses, credentials and nonweb ports", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "224.0.0.1"]) assert.equal(isPublicResearchAddress(ip), false, ip);
  assert.equal(isPublicResearchAddress("93.184.216.34"), true);
  assert.equal(isPublicResearchAddress("2606:4700:4700::1111"), true);
  for (const url of ["file:///etc/passwd", "http://localhost", "https://user:pass@example.com", "http://example.com:8080"]) assert.throws(() => researchUrl(url));
  await assert.rejects(collectCompanyEvidence({ officialUrl: "http://127.0.0.1", candidates: [], maxPages: 1, allowedSourceTypes: ["company_website"] }), /No readable evidence/);
});
test("public research collects actual page text rather than a search snippet", { skip: !process.env.RUN_PUBLIC_SOURCE_TESTS }, async () => {
  const evidence = await collectCompanyEvidence({ officialUrl: "https://example.com", candidates: [], maxPages: 1, allowedSourceTypes: ["company_website"] });
  assert.equal(evidence.length, 1);
  assert.match(evidence[0].text, /Example Domain/);
  assert.equal(evidence[0].source.url, "https://example.com/");
});
test("missing pricing rates stay unavailable, not zero; configured estimates use tracked usage", () => {
  const usage = { inputTokens: 1000, outputTokens: 500, webSearchCount: 2 };
  assert.deepEqual(estimateResearchCost(usage, defaultResearchSettings), { usd: null, inr: null });
  const cost = estimateResearchCost(usage, { ...defaultResearchSettings, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 2, searchCostUsd: 0.01, usdToInr: 80 });
  assert.equal(Number(cost.usd), 0.022);
  assert.equal(Number(cost.inr), 1.76);
});
for (const provider of ["openai", "anthropic", "gemini"]) {
  test(`${provider} research uses hosted web discovery with usage and real citations`, async () => {
    let sent;
    const fetcher = async (_url, options) => {
      sent = JSON.parse(options.body);
      const payload = provider === "openai"
        ? { output: [{ type: "web_search_call", action: { sources: [{ url: source.url, title: source.title }] } }, { content: [{ type: "output_text", text: "Discovery" }] }], usage: { input_tokens: 100, output_tokens: 20 } }
        : provider === "anthropic"
          ? { content: [{ type: "text", text: "Discovery" }, { type: "web_search_tool_result", content: [{ type: "web_search_result", url: source.url, title: source.title }] }], usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } }
          : { candidates: [{ content: { parts: [{ text: "Discovery" }] }, groundingMetadata: { webSearchQueries: ["company facts"], groundingChunks: [{ web: { uri: source.url, title: source.title } }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const result = await researchProviderRequest({ provider, model: "test-model", apiKey: "fake-test-key", prompt: "Find sources", search: true, maxWebSearches: 3 }, fetcher);
    assert.equal(result.candidates[0].url, source.url);
    assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20, webSearchCount: 1 });
    if (provider === "openai") assert.equal(sent.max_tool_calls, 3);
    if (provider === "anthropic") assert.equal(sent.tools[0].max_uses, 3);
    if (provider === "gemini") assert.deepEqual(sent.tools, [{ google_search: {} }]);
  });
}
test("provider failures never echo API keys or provider response bodies", async () => {
  await assert.rejects(
    researchProviderRequest({ provider: "openai", model: "test", apiKey: "fake-private-key", prompt: "private fixture", search: false, maxWebSearches: 0 }, async () => new Response("fake-private-key private fixture", { status: 401 })),
    error => !error.message.includes("fake-private-key") && !error.message.includes("private fixture"),
  );
});
