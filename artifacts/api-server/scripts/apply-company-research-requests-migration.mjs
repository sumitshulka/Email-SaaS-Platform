import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0017_company_research_requests.sql", import.meta.url),
      "utf8",
    ),
  );
  const requiredIndexes = [
    "company_research_request_one_open_per_user",
    "company_research_request_queue_idx",
    "company_research_request_user_idx",
    "company_research_request_job_idx",
  ];
  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'company_research_requests'",
  );
  for (const name of requiredIndexes) {
    if (!indexes.rows.some((row) => row.indexname === name)) {
      throw new Error(`Required research-request index missing: ${name}`);
    }
  }
  const uniqueIndex = indexes.rows.find(
    (row) => row.indexname === "company_research_request_one_open_per_user",
  );
  if (
    !uniqueIndex.indexdef.includes("UNIQUE") ||
    !uniqueIndex.indexdef.includes("requested") ||
    !uniqueIndex.indexdef.includes("in_progress")
  ) {
    throw new Error("Open research request duplicate guard is invalid");
  }
  await client.query("COMMIT");
  console.log("Company research request migration applied and verified.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    "Company research request migration failed; no migration changes committed.",
    {
      code:
        typeof error === "object" && error && "code" in error
          ? error.code
          : "SCHEMA_VERIFICATION_FAILED",
    },
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
