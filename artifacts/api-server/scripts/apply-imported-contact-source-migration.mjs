import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(
      new URL("../../../lib/db/migrations/0022_imported_contact_source.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query("SELECT imported_contact FROM contacts LIMIT 0");
  await client.query("COMMIT");
  process.stdout.write("Imported contact source migration applied and verified.\n");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Imported contact source migration failed: ${error?.code ?? "SCHEMA_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
