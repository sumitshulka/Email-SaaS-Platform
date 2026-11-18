import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0028_saved_report_definitions.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(
    "SELECT to_regclass('public.saved_report_definitions') AS table_name",
  );
  if (rows[0]?.table_name !== "saved_report_definitions") {
    throw new Error("SAVED_REPORT_DEFINITIONS_TABLE_MISSING");
  }
  await client.query("COMMIT");
  process.stdout.write("Report workarea migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Report workarea migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
