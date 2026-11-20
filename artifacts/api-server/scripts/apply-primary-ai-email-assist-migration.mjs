import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0032_primary_ai_email_assist_usage.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_email_assist_usages'
      AND column_name IN ('entitlement_id', 'subscription_id')
  `);
  const columns = new Map(rows.map(row => [row.column_name, row.is_nullable]));
  if (columns.get("entitlement_id") !== "YES") {
    throw new Error("AI_EMAIL_ASSIST_ENTITLEMENT_NULLABILITY_MISSING");
  }
  if (columns.get("subscription_id") !== "YES") {
    throw new Error("AI_EMAIL_ASSIST_SUBSCRIPTION_COLUMN_MISSING");
  }
  const { rows: constraints } = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conname = 'ai_email_assist_usage_source_valid'
      AND conrelid = 'public.ai_email_assist_usages'::regclass
  `);
  if (constraints.length !== 1) {
    throw new Error("AI_EMAIL_ASSIST_USAGE_SOURCE_CONSTRAINT_MISSING");
  }
  const { rows: indexes } = await client.query(`
    SELECT to_regclass('public.ai_email_assist_usage_subscription_idx') AS index_name
  `);
  if (indexes[0]?.index_name !== "ai_email_assist_usage_subscription_idx") {
    throw new Error("AI_EMAIL_ASSIST_USAGE_SUBSCRIPTION_INDEX_MISSING");
  }
  await client.query("COMMIT");
  process.stdout.write("Primary AI Email Assist migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Primary AI Email Assist migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
