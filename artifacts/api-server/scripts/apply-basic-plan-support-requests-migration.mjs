import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0030_basic_plan_support_requests.sql", import.meta.url),
      "utf8",
    ),
  );
  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'basic_plan_support_requests'",
  );
  const required = [
    "basic_plan_support_request_user_milestone_unique",
    "basic_plan_support_request_one_pending_per_user",
    "basic_plan_support_request_queue_idx",
    "basic_plan_support_request_user_idx",
  ];
  for (const name of required) {
    if (!indexes.rows.some((row) => row.indexname === name)) {
      throw new Error(`Required subscription-request index missing: ${name}`);
    }
  }
  const pendingGuard = indexes.rows.find(
    (row) => row.indexname === "basic_plan_support_request_one_pending_per_user",
  );
  if (!pendingGuard.indexdef.includes("UNIQUE") || !pendingGuard.indexdef.includes("pending")) {
    throw new Error("The one-pending-request-per-user guard is invalid.");
  }
  await client.query("COMMIT");
  process.stdout.write("Basic plan support request migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Basic plan support request migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
