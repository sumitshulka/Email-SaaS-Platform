import assert from "node:assert/strict";
import test from "node:test";
import { chooseAIProviderSource } from "../src/lib/tenant-ai-provider-configuration.ts";
import { decryptSecret, encryptSecret } from "../src/lib/security.ts";

test("an eligible tenant configuration takes precedence over managed AI", () => {
  assert.equal(
    chooseAIProviderSource({
      byokEnabled: true,
      tenantConfigured: true,
      tenantKeyAvailable: true,
      managedConfigured: true,
      managedKeyAvailable: true,
    }),
    "tenant",
  );
});

test("a configured but unusable tenant key never falls back to managed AI", () => {
  assert.equal(
    chooseAIProviderSource({
      byokEnabled: true,
      tenantConfigured: true,
      tenantKeyAvailable: false,
      managedConfigured: true,
      managedKeyAvailable: true,
    }),
    "tenant_unavailable",
  );
});

test("an ineligible tenant's saved key is ignored and managed AI remains available", () => {
  assert.equal(
    chooseAIProviderSource({
      byokEnabled: false,
      tenantConfigured: true,
      tenantKeyAvailable: true,
      managedConfigured: true,
      managedKeyAvailable: true,
    }),
    "managed",
  );
});

test("an eligible tenant without a saved key continues to use managed AI", () => {
  assert.equal(
    chooseAIProviderSource({
      byokEnabled: true,
      tenantConfigured: false,
      tenantKeyAvailable: false,
      managedConfigured: true,
      managedKeyAvailable: true,
    }),
    "managed",
  );
});

test("no provider configuration returns unavailable without choosing a key", () => {
  assert.equal(
    chooseAIProviderSource({
      byokEnabled: true,
      tenantConfigured: false,
      tenantKeyAvailable: false,
      managedConfigured: false,
      managedKeyAvailable: false,
    }),
    "not_configured",
  );
});

test("tenant API keys are encrypted at rest with the application credential key", () => {
  process.env.APP_ENCRYPTION_KEY = "tenant-byok-unit-test-encryption-key-32-bytes";
  const key = "provider-api-key-must-not-be-stored-in-plaintext";
  const encrypted = encryptSecret(key);
  assert.notEqual(encrypted, key);
  assert.equal(encrypted.includes(key), false);
  assert.equal(decryptSecret(encrypted), key);
});
