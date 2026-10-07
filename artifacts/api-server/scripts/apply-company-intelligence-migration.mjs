import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0003_company_intelligence.sql", import.meta.url), "utf8"));
  const indexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('company_research_jobs','company_intelligence')");
  for (const name of ["company_research_one_active_job", "company_research_company_created_idx", "company_research_queue_idx", "company_intelligence_version_unique", "company_intelligence_job_unique", "company_intelligence_latest_idx"]) {
    if (!indexes.rows.some(row => row.indexname === name)) throw new Error("Required research index missing");
  }
  const activeIndex = indexes.rows.find(row => row.indexname === "company_research_one_active_job").indexdef;
  if (!activeIndex.includes("UNIQUE") || !activeIndex.includes("queued") || !activeIndex.includes("running")) throw new Error("Duplicate-job guard is invalid");
  const columns = await client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('company_research_jobs','company_intelligence')");
  if (!columns.rows.some(row => row.table_name === "company_intelligence" && row.column_name === "profile" && row.data_type === "jsonb")) throw new Error("Structured research storage is invalid");
  await client.query("COMMIT");
  console.log("Company intelligence migration applied and indexes verified. Existing company and contact data was not modified.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Company intelligence migration failed; no migration changes committed.", { code: typeof error === "object" && error && "code" in error ? error.code : "SCHEMA_VERIFICATION_FAILED" });
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
