import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0023_prospect_management.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query(`
    SELECT
      (SELECT count(*) FROM prospect_products) AS products,
      (SELECT count(*) FROM prospect_currencies) AS currencies,
      (SELECT count(*) FROM prospect_stages) AS stages,
      (SELECT count(*) FROM prospect_stage_transitions) AS transitions,
      (SELECT count(*) FROM prospect_action_types) AS action_types,
      (SELECT count(*) FROM prospects) AS prospects,
      (SELECT count(*) FROM prospect_stage_history) AS stage_history,
      (SELECT count(*) FROM prospect_actions) AS actions,
      (SELECT count(*) FROM prospect_tag_assignments) AS prospect_tags
  `);
  await client.query("COMMIT");
  process.stdout.write("Prospect Management migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Prospect Management migration failed: ${error?.code ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
