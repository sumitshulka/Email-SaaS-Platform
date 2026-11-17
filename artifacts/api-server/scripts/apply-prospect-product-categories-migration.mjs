import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0024_prospect_product_categories.sql", import.meta.url),
      "utf8",
    ),
  );
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM prospect_product_categories) AS categories,
      (SELECT count(*) FROM prospect_products WHERE item_type NOT IN ('product', 'service')) AS invalid_item_types
  `);
  if (Number(result.rows[0]?.invalid_item_types ?? 0) !== 0) {
    throw new Error("Invalid product/service types found after migration.");
  }
  await client.query("COMMIT");
  process.stdout.write("Prospect product/service category migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Prospect product/service category migration failed: ${error?.code ?? error?.message ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
