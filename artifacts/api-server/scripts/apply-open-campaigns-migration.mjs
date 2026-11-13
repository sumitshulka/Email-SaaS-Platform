import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0019_open_campaigns.sql", import.meta.url), "utf8"));
  await client.query("SELECT audience_type, open_campaign_subscription_id, open_campaign_counted_at FROM email_campaigns LIMIT 0");
  await client.query("SELECT open_campaign_allowance, open_campaign_recipient_limit FROM subscription_packages LIMIT 0");
  await client.query("SELECT * FROM open_campaign_audience LIMIT 0");
  await client.query("SELECT * FROM campaign_email_suppressions LIMIT 0");
  await client.query("COMMIT");
  process.stdout.write("Open campaign migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(`Open campaign migration failed: ${error?.code ?? "SCHEMA_VERIFICATION_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
