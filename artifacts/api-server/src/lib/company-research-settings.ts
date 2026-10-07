import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";
import { UpdateCompanyResearchSettingsBody } from "@workspace/api-zod";
import { sourceTypes } from "./company-intelligence-schema";

export const defaultResearchSettings = {
  freshDays: 30, agingDays: 90, maxResearchDepth: 2, maxWebSearches: 3,
  allowedSourceTypes: [...sourceTypes], researchCreditCost: 1, deepResearchEnabled: false,
  preferredModel: null as string | null, backupModel: null as string | null,
  inputCostPerMillionUsd: null as number | null, outputCostPerMillionUsd: null as number | null,
  searchCostUsd: null as number | null, usdToInr: 85,
};
export type ResearchSettings = typeof defaultResearchSettings;
export const researchSettingsKey = "company_intelligence";

export function parseResearchSettings(value: unknown): ResearchSettings {
  const parsed = UpdateCompanyResearchSettingsBody.safeParse(value);
  if (!parsed.success || parsed.data.agingDays <= parsed.data.freshDays) return { ...defaultResearchSettings };
  return parsed.data as ResearchSettings;
}

export async function getResearchSettings(): Promise<ResearchSettings> {
  const [row] = await db.select({ value: systemConfigurationTable.value }).from(systemConfigurationTable).where(eq(systemConfigurationTable.key, researchSettingsKey)).limit(1);
  return parseResearchSettings(row?.value);
}

export function estimateResearchCost(usage: { inputTokens: number; outputTokens: number; webSearchCount: number }, settings: ResearchSettings) {
  const { inputCostPerMillionUsd: input, outputCostPerMillionUsd: output, searchCostUsd: search } = settings;
  if (input === null || output === null || search === null || usage.inputTokens + usage.outputTokens + usage.webSearchCount === 0) return { usd: null, inr: null };
  const usd = usage.inputTokens * input / 1_000_000 + usage.outputTokens * output / 1_000_000 + usage.webSearchCount * search;
  return { usd: usd.toFixed(8), inr: (usd * settings.usdToInr).toFixed(8) };
}
