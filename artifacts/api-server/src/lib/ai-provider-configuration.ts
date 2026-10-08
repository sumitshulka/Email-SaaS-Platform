import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";
import { decryptSecret, encryptSecret } from "./security";
import type { AIProviderId } from "./ai-provider-client";

const AI_PROVIDER_CONFIGURATION_KEY = "ai_provider";

type StoredAIProviderConfiguration = {
  provider: AIProviderId;
  apiKeyEncrypted: string;
  selectedModel: string;
  lastTestedAt: string;
};

function isAIProviderId(value: unknown): value is AIProviderId {
  return value === "openai" || value === "anthropic" || value === "gemini";
}

function parseStoredConfiguration(
  value: unknown,
): StoredAIProviderConfiguration | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    !isAIProviderId(record.provider) ||
    typeof record.apiKeyEncrypted !== "string" ||
    !record.apiKeyEncrypted ||
    typeof record.selectedModel !== "string" ||
    !record.selectedModel
  ) {
    return null;
  }

  return {
    provider: record.provider,
    apiKeyEncrypted: record.apiKeyEncrypted,
    selectedModel: record.selectedModel,
    lastTestedAt:
      typeof record.lastTestedAt === "string" ? record.lastTestedAt : "",
  };
}

async function readConfigurationRow() {
  const [row] = await db
    .select({
      value: systemConfigurationTable.value,
      updatedAt: systemConfigurationTable.updatedAt,
    })
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, AI_PROVIDER_CONFIGURATION_KEY))
    .limit(1);
  return row ?? null;
}

export async function getAIProviderConfigurationStatus() {
  const row = await readConfigurationRow();
  const stored = parseStoredConfiguration(row?.value);
  return {
    configured: Boolean(stored),
    provider: stored?.provider ?? null,
    selectedModel: stored?.selectedModel ?? null,
    apiKeyConfigured: Boolean(stored?.apiKeyEncrypted),
    lastTestedAt: stored?.lastTestedAt || null,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  };
}

export async function getStoredAIProviderApiKey(
  provider: AIProviderId,
): Promise<string | null> {
  const row = await readConfigurationRow();
  const stored = parseStoredConfiguration(row?.value);
  if (!stored || stored.provider !== provider) {
    return null;
  }
  try {
    return decryptSecret(stored.apiKeyEncrypted);
  } catch {
    return null;
  }
}

export async function saveAIProviderConfiguration(input: {
  provider: AIProviderId;
  apiKey: string;
  selectedModel: string;
  updatedBy: string;
}): Promise<void> {
  const previous = await readConfigurationRow();
  const value: StoredAIProviderConfiguration = {
    provider: input.provider,
    apiKeyEncrypted: encryptSecret(input.apiKey),
    selectedModel: input.selectedModel,
    lastTestedAt: new Date().toISOString(),
  };

  await db
    .insert(systemConfigurationTable)
    .values({
      key: AI_PROVIDER_CONFIGURATION_KEY,
      value,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: {
        value,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    });
  if (parseStoredConfiguration(previous?.value)?.provider !== input.provider) {
    const [research] = await db.select().from(systemConfigurationTable).where(eq(systemConfigurationTable.key, "company_intelligence")).limit(1);
    if (research?.value && typeof research.value === "object" && !Array.isArray(research.value)) {
      // A model from the former provider must never be sent to the new provider.
      await db.update(systemConfigurationTable).set({
        value: { ...research.value, preferredModel: null, backupModel: null, inputCostPerMillionUsd: null, outputCostPerMillionUsd: null, searchCostUsd: null },
        updatedBy: input.updatedBy, updatedAt: new Date(),
      }).where(eq(systemConfigurationTable.key, "company_intelligence"));
    }
  }
}

export async function removeAIProviderConfiguration(
  updatedBy: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, AI_PROVIDER_CONFIGURATION_KEY));

    const [research] = await tx
      .select({ value: systemConfigurationTable.value })
      .from(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, "company_intelligence"))
      .limit(1);
    if (
      research?.value &&
      typeof research.value === "object" &&
      !Array.isArray(research.value)
    ) {
      await tx
        .update(systemConfigurationTable)
        .set({
          value: {
            ...research.value,
            preferredModel: null,
            backupModel: null,
            inputCostPerMillionUsd: null,
            outputCostPerMillionUsd: null,
            searchCostUsd: null,
          },
          updatedBy,
          updatedAt: new Date(),
        })
        .where(eq(systemConfigurationTable.key, "company_intelligence"));
    }
  });
}
