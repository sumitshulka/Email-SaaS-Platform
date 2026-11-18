import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0026_prospect_value_history.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prospect_value_history'
  `);
  const columns = new Set(rows.map(row => row.column_name));
  for (const column of [
    "id",
    "user_id",
    "prospect_id",
    "previous_deal_value",
    "previous_currency_code",
    "new_deal_value",
    "new_currency_code",
    "changed_by",
    "created_at",
  ]) {
    if (!columns.has(column)) throw new Error(`PROSPECT_VALUE_HISTORY_COLUMN_MISSING:${column}`);
  }
  const { rows: indexes } = await client.query(`
    SELECT to_regclass('public.prospect_value_history_prospect_time_idx') AS index_name
  `);
  if (indexes[0]?.index_name !== "prospect_value_history_prospect_time_idx") {
    throw new Error("PROSPECT_VALUE_HISTORY_INDEX_MISSING");
  }
  await client.query("COMMIT");
  process.stdout.write("Prospect value history migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Prospect value history migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
