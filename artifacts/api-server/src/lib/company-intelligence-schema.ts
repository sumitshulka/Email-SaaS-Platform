import { z } from "zod/v4";

export const sourceTypes = ["company_website", "company_product_page", "company_newsroom", "investor_relation", "regulatory_filing", "government", "reputable_news", "industry_source", "other"] as const;
const text = z.string().max(4000);
const list = z.array(z.string().min(1).max(1000)).max(30);
const ids = z.array(z.string().regex(/^SRC-\d{3}$/)).min(1).max(20);
const confidence = z.number().min(0).max(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "A real calendar date is required.");
const claim = z.object({ statement: text.min(1), confidence, basis: list, source_ids: ids }).strict();
const technology = z.object({ name: z.string().min(1).max(200), confidence, source_ids: ids }).strict();
export const intelligenceSourceSchema = z.object({
  source_id: z.string().regex(/^SRC-\d{3}$/), source_type: z.enum(sourceTypes),
  title: z.string().min(1).max(500), url: z.url().max(2048), publisher: z.string().max(255),
  published_date: date.nullable(), accessed_at: z.iso.datetime(),
  reliability: z.enum(["high", "medium", "low"]),
}).strict();

export const intelligenceProfileSchema = z.object({
  executive_summary: z.object({ one_liner: text.min(1), business_summary: text, key_observations: list }).strict(),
  company_profile: z.object({
    industry: text, sub_industry: text, company_type: text, founded_year: z.number().int().min(1000).max(2200).nullable(),
    headquarters: text, operating_regions: list, employee_range: text, revenue_range: text, ownership: text, parent_company: text,
  }).strict(),
  business: z.object({
    business_model: text, products_services: list, customer_segments: list, key_markets: list, business_units: list, competitive_position: text,
  }).strict(),
  technology: z.object(Object.fromEntries(
    ["erp", "crm", "hrms", "lms", "scm", "procurement", "inventory", "cloud", "data_platforms", "ai_platforms", "other"].map(key => [key, z.array(technology).max(15)]),
  )).strict(),
  current_signals: z.array(z.object({
    signal_id: z.string().max(50), type: z.enum(["expansion", "acquisition", "funding", "partnership", "product_launch", "technology_adoption", "ai_initiative", "digital_transformation", "hiring", "facility_expansion", "market_entry", "contract", "leadership_change", "cost_reduction", "restructuring", "sustainability", "supply_chain", "procurement", "other"]),
    title: text.min(1), description: text.min(1), event_date: date, source_published_date: date.nullable(),
    observed_at: z.iso.datetime(), importance: z.enum(["high", "medium", "low"]), sales_relevance: list, confidence, source_ids: ids,
  }).strict()).max(20),
  opportunity_signals: z.array(claim.extend({
    opportunity_id: z.string().max(50), type: z.enum(["potential_pain_point", "growth_opportunity", "technology_gap", "operational_complexity", "digital_transformation", "cost_optimization", "compliance", "inventory_complexity", "workforce", "data_modernization", "ai_adoption"]),
    generated_at: z.iso.datetime(),
  }).strict()).max(20),
  sales_intelligence: z.object(Object.fromEntries(
    ["buying_signals", "potential_pain_points", "digital_transformation_signals", "growth_signals", "risk_signals"].map(key => [key, z.array(claim).max(15)]),
  )).strict(),
  competitors: z.array(z.object({ name: text.min(1), category: text, relationship: z.enum(["direct", "indirect", "adjacent"]), confidence, source_ids: ids }).strict()).max(10),
  fact_sources: z.array(z.object({ path: z.string().min(1).max(200), confidence, source_ids: ids }).strict()).max(150),
  conflicts: z.array(claim).max(15),
  sources: z.array(intelligenceSourceSchema).min(1).max(20),
}).strict();

export type IntelligenceProfile = z.infer<typeof intelligenceProfileSchema>;
export type IntelligenceSource = z.infer<typeof intelligenceSourceSchema>;

export function factPaths(value: unknown, prefix = ""): string[] {
  if (value === null || value === "") return [];
  if (typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => factPaths(child, prefix ? `${prefix}.${key}` : key));
}

export function evidenceContainsDate(value: string, body: string): boolean {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const name = names[month - 1]!;
  const short = name.slice(0, 3);
  const normalized = body.toLowerCase().replace(/[,./-]/g, " ").replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ");
  return new RegExp(`(?:^|\\D)(?:${year} 0?${month} 0?${day}|0?${day} 0?${month} ${year}|0?${month} 0?${day} ${year}|(?:${name}|${short}) 0?${day} ${year}|0?${day} (?:${name}|${short}) ${year})(?:\\D|$)`).test(normalized);
}

export function validateIntelligence(value: unknown, sources: IntelligenceSource[], evidence: Array<{ source: IntelligenceSource; text: string }> = []): IntelligenceProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Research did not return a JSON object.");
  const profile = intelligenceProfileSchema.parse({ ...value, sources });
  const knownIds = new Set(sources.map(source => source.source_id));
  const reliableIds = new Set(sources.filter(source => source.reliability !== "low").map(source => source.source_id));
  function verifyReferences(item: unknown): void {
    if (!item || typeof item !== "object") return;
    if ("source_ids" in item) {
      const references = (item as { source_ids: string[] }).source_ids;
      if (!references.every(id => knownIds.has(id))) throw new Error("Research cited an unknown source.");
      if ("confidence" in item && typeof item.confidence === "number" && item.confidence > 0.6 && !references.some(id => reliableIds.has(id))) {
        throw new Error("Research expressed strong confidence using only low-reliability evidence.");
      }
    }
    Object.values(item).forEach(verifyReferences);
  }
  verifyReferences(profile);
  if (profile.current_signals.some(signal => !signal.source_ids.some(id =>
    sources.some(source => source.source_id === id && source.published_date === signal.event_date) ||
    evidence.some(item => item.source.source_id === id && evidenceContainsDate(signal.event_date, item.text)),
  ))) throw new Error("A current signal date is not corroborated by its cited evidence.");
  const paths = [...factPaths(profile.executive_summary, "executive_summary"), ...factPaths(profile.company_profile, "company_profile"), ...factPaths(profile.business, "business")];
  const provenance = new Set(profile.fact_sources.map(item => item.path));
  if (paths.some(path => !provenance.has(path))) throw new Error("A researched fact is missing its source reference.");
  if (profile.fact_sources.some(item => !paths.includes(item.path))) throw new Error("Research contained invalid fact provenance.");
  profile.current_signals.sort((a, b) => b.event_date.localeCompare(a.event_date));
  return profile;
}

export function researchFreshness(researchedAt: Date | null, freshDays: number, agingDays: number, now = new Date()): "not_researched" | "fresh" | "aging" | "stale" {
  if (!researchedAt) return "not_researched";
  const days = Math.max(0, (now.getTime() - researchedAt.getTime()) / 86_400_000);
  return days <= freshDays ? "fresh" : days <= agingDays ? "aging" : "stale";
}
