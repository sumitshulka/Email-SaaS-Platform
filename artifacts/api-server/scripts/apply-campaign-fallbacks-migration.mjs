import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0020_campaign_placeholder_fallbacks.sql", import.meta.url), "utf8"));
  await client.query("SELECT placeholder_fallbacks FROM email_campaigns LIMIT 0");
  await client.query("COMMIT");
  process.stdout.write("Campaign placeholder fallback migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(`Campaign fallback migration failed: ${error?.code ?? "SCHEMA_VERIFICATION_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
