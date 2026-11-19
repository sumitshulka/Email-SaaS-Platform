import { eq } from "drizzle-orm";
import {
  db,
  tenantAIProviderConfigurationsTable,
} from "@workspace/db";
import { getAIProviderConfigurationStatus, getStoredAIProviderApiKey } from "./ai-provider-configuration";
import { getPackageFeatureAccess } from "./package-feature-access";
import { decryptSecret, encryptSecret } from "./security";
import type { AIProviderId } from "./ai-provider-client";

function isAIProviderId(value: unknown): value is AIProviderId {
  return value === "openai" || value === "anthropic" || value === "gemini";
}

export async function getTenantAIProviderConfiguration(userId: string) {
  const [row] = await db
    .select()
    .from(tenantAIProviderConfigurationsTable)
    .where(eq(tenantAIProviderConfigurationsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getTenantAIProviderConfigurationStatus(userId: string) {
  const [access, row] = await Promise.all([
    getPackageFeatureAccess(userId),
    getTenantAIProviderConfiguration(userId),
  ]);
  const eligible = access?.byokAiEnabled === true;
  return {
    eligible,
    packageName: access?.packageName ?? null,
    configured: Boolean(row),
    provider:
      row && isAIProviderId(row.provider)
        ? row.provider
        : null,
    selectedModel: row?.selectedModel ?? null,
    apiKeyConfigured: Boolean(row?.apiKeyEncrypted),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function getStoredTenantAIProviderConfiguration(
  userId: string,
): Promise<{
  provider: AIProviderId;
  selectedModel: string;
  apiKey: string;
} | null> {
  const row = await getTenantAIProviderConfiguration(userId);
  if (!row || !isAIProviderId(row.provider)) return null;
  try {
    const apiKey = decryptSecret(row.apiKeyEncrypted);
    return apiKey
      ? { provider: row.provider, selectedModel: row.selectedModel, apiKey }
      : null;
  } catch {
    return null;
  }
}

export async function saveTenantAIProviderConfiguration(input: {
  userId: string;
  provider: AIProviderId;
  apiKey: string;
  selectedModel: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(tenantAIProviderConfigurationsTable)
    .values({
      userId: input.userId,
      provider: input.provider,
      apiKeyEncrypted: encryptSecret(input.apiKey),
      selectedModel: input.selectedModel,
      lastTestedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantAIProviderConfigurationsTable.userId,
      set: {
        provider: input.provider,
        apiKeyEncrypted: encryptSecret(input.apiKey),
        selectedModel: input.selectedModel,
        lastTestedAt: now,
        updatedAt: now,
      },
    });
}

export async function removeTenantAIProviderConfiguration(
  userId: string,
): Promise<void> {
  await db
    .delete(tenantAIProviderConfigurationsTable)
    .where(eq(tenantAIProviderConfigurationsTable.userId, userId));
}

export type ResolvedAIProviderConfiguration =
  | {
      kind: "ready";
      source: "tenant" | "managed";
      provider: AIProviderId;
      selectedModel: string;
      apiKey: string;
    }
  | {
      kind: "unavailable";
      reason: "not_configured" | "tenant_key_unavailable" | "managed_key_unavailable";
      source: "tenant" | "managed" | null;
    };

export type AIProviderSourceChoice =
  | "tenant"
  | "tenant_unavailable"
  | "managed"
  | "managed_unavailable"
  | "not_configured";

export function chooseAIProviderSource(input: {
  byokEnabled: boolean;
  tenantConfigured: boolean;
  tenantKeyAvailable: boolean;
  managedConfigured: boolean;
  managedKeyAvailable: boolean;
}): AIProviderSourceChoice {
  if (input.byokEnabled && input.tenantConfigured) {
    return input.tenantKeyAvailable ? "tenant" : "tenant_unavailable";
  }
  if (!input.managedConfigured) return "not_configured";
  return input.managedKeyAvailable ? "managed" : "managed_unavailable";
}

export async function resolveAIProviderConfigurationForTenant(
  userId: string,
): Promise<ResolvedAIProviderConfiguration> {
  const [access, tenantConfig] = await Promise.all([
    getPackageFeatureAccess(userId),
    getTenantAIProviderConfiguration(userId),
  ]);

  let tenantApiKey: string | null = null;
  if (access?.byokAiEnabled && tenantConfig && isAIProviderId(tenantConfig.provider)) {
    try {
      tenantApiKey = decryptSecret(tenantConfig.apiKeyEncrypted) || null;
    } catch {
      tenantApiKey = null;
    }
  }

  const useTenant = chooseAIProviderSource({
    byokEnabled: access?.byokAiEnabled === true,
    tenantConfigured: Boolean(tenantConfig),
    tenantKeyAvailable: Boolean(tenantApiKey),
    managedConfigured: false,
    managedKeyAvailable: false,
  });
  if (useTenant === "tenant" && tenantConfig && isAIProviderId(tenantConfig.provider) && tenantApiKey) {
    return {
      kind: "ready",
      source: "tenant",
      provider: tenantConfig.provider,
      selectedModel: tenantConfig.selectedModel,
      apiKey: tenantApiKey,
    };
  }
  if (useTenant === "tenant_unavailable") {
    // Never fall back to managed AI when a tenant key is saved but unusable:
    // that could create unexpected Mailflow provider charges.
    return {
      kind: "unavailable",
      reason: "tenant_key_unavailable",
      source: "tenant",
    };
  }

  const managed = await getAIProviderConfigurationStatus();
  const managedApiKey =
    managed.provider && managed.selectedModel && managed.apiKeyConfigured
      ? await getStoredAIProviderApiKey(managed.provider)
      : null;
  const managedChoice = chooseAIProviderSource({
    byokEnabled: access?.byokAiEnabled === true,
    tenantConfigured: Boolean(tenantConfig),
    tenantKeyAvailable: Boolean(tenantApiKey),
    managedConfigured: Boolean(managed.provider && managed.selectedModel && managed.apiKeyConfigured),
    managedKeyAvailable: Boolean(managedApiKey),
  });
  if (managedChoice === "not_configured") {
    return { kind: "unavailable", reason: "not_configured", source: null };
  }
  if (managedChoice === "managed_unavailable" || !managed.provider || !managed.selectedModel || !managedApiKey) {
    return {
      kind: "unavailable",
      reason: "managed_key_unavailable",
      source: "managed",
    };
  }
  return {
    kind: "ready",
    source: "managed",
    provider: managed.provider,
    selectedModel: managed.selectedModel,
    apiKey: managedApiKey,
  };
}
