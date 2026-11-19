import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0031_tenant_ai_provider_byok.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows: columns } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'subscription_packages' AND column_name = 'byok_ai_enabled')
        OR (table_name = 'tenant_ai_provider_configurations' AND column_name IN (
          'user_id', 'provider', 'api_key_encrypted', 'selected_model',
          'last_tested_at', 'created_at', 'updated_at'
        ))
      )
  `);
  const required = [
    "subscription_packages.byok_ai_enabled",
    "tenant_ai_provider_configurations.user_id",
    "tenant_ai_provider_configurations.provider",
    "tenant_ai_provider_configurations.api_key_encrypted",
    "tenant_ai_provider_configurations.selected_model",
    "tenant_ai_provider_configurations.last_tested_at",
    "tenant_ai_provider_configurations.created_at",
    "tenant_ai_provider_configurations.updated_at",
  ];
  const present = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  if (required.some(name => !present.has(name))) {
    throw new Error("Required BYOK schema columns are missing.");
  }

  const { rows: constraints } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'subscription_packages'::regclass
      AND conname = 'subscription_packages_byok_ai_primary_only'
  `);
  if (
    !constraints[0]?.definition.includes("package_type") ||
    !constraints[0]?.definition.includes("byok_ai_enabled")
  ) {
    throw new Error("Package BYOK type constraint is missing or invalid.");
  }

  const { rows: providerConstraints } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'tenant_ai_provider_configurations'::regclass
      AND contype = 'c'
  `);
  if (!providerConstraints.some(row =>
    row.definition.includes("openai") &&
    row.definition.includes("anthropic") &&
    row.definition.includes("gemini")
  )) {
    throw new Error("Tenant provider allowlist constraint is missing or invalid.");
  }
  await client.query("COMMIT");
  process.stdout.write(
    "Tenant BYOK migration applied and verified. Existing package features and usage allowances were unchanged.\n",
  );
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Tenant BYOK migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
