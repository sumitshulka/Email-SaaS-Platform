import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0029_package_feature_entitlements.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscription_packages'
          AND column_name = 'prospect_management_enabled'
      ) AS prospect_management_enabled,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscription_packages'
          AND column_name = 'reports_enabled'
      ) AS reports_enabled,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscription_packages'
          AND column_name = 'personal_report_limit'
      ) AS personal_report_limit
  `);
  const verified = rows[0];
  if (
    !verified?.prospect_management_enabled ||
    !verified?.reports_enabled ||
    !verified?.personal_report_limit
  ) {
    throw new Error("PACKAGE_FEATURE_ENTITLEMENT_COLUMNS_MISSING");
  }
  await client.query("COMMIT");
  process.stdout.write("Package feature entitlement migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Package feature entitlement migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
