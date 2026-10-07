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
}
