import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0016_microsoft_sender_oauth.sql", import.meta.url), "utf8"));
  const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='tenant_sending_configurations' AND column_name='authentication_method'");
  if (result.rowCount !== 1) throw new Error("Microsoft sender migration verification failed");
  await client.query("COMMIT");
  console.log("Microsoft sender migration applied. Existing sender passwords and campaign data are unchanged.");
} catch {
  await client.query("ROLLBACK");
  console.error("Microsoft sender migration failed; transaction rolled back.");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
