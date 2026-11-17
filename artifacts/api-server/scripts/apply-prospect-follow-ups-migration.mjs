import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0025_prospect_follow_ups.sql", import.meta.url),
      "utf8",
    ),
  );
  const { rows } = await client.query(
    "SELECT to_regclass('public.prospect_follow_ups') AS table_name",
  );
  if (rows[0]?.table_name !== "prospect_follow_ups") {
    throw new Error("PROSPECT_FOLLOW_UPS_TABLE_MISSING");
  }
  await client.query("COMMIT");
  process.stdout.write("Prospect follow-ups migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Prospect follow-ups migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
