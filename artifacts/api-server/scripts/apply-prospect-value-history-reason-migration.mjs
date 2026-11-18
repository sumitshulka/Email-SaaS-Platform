import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0027_prospect_value_history_reason.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prospect_value_history'
      AND column_name = 'reason'
  `);
  if (rows.length !== 1) throw new Error("PROSPECT_VALUE_HISTORY_REASON_COLUMN_MISSING");
  const { rows: constraints } = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conname = 'prospect_value_history_reason_valid'
      AND conrelid = 'public.prospect_value_history'::regclass
  `);
  if (constraints.length !== 1) throw new Error("PROSPECT_VALUE_HISTORY_REASON_CONSTRAINT_MISSING");
  await client.query("COMMIT");
  process.stdout.write("Prospect value-history reason migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Prospect value-history reason migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
