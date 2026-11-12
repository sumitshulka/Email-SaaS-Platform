import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0018_contact_tags.sql", import.meta.url), "utf8"));
  const result = await client.query("SELECT indexname FROM pg_indexes WHERE tablename IN ('contact_tags', 'contact_tag_assignments')");
  for (const name of ["contact_tags_id_user_unique", "contact_tags_user_name_unique", "contact_tag_slot_unique", "contact_tag_assignment_unique", "contact_tag_filter_idx"]) {
    if (!result.rows.some(row => row.indexname === name)) throw new Error("Required tag index missing");
  }
  await client.query("COMMIT");
  process.stdout.write("Contact tag migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(`Contact tag migration failed: ${error?.code ?? "SCHEMA_VERIFICATION_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
