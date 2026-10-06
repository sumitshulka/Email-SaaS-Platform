import assert from "node:assert/strict";
import { Client } from "pg";

const totalRows = Number(process.env.COMPANY_SEARCH_BENCHMARK_ROWS ?? 500_000);
const targetRows = Math.floor(totalRows / 2);
if (
  !Number.isSafeInteger(totalRows) ||
  totalRows < 400_000 ||
  totalRows % 20_000 !== 0
) {
  throw new Error(
    "COMPANY_SEARCH_BENCHMARK_ROWS must be a multiple of 20,000 and at least 400,000.",
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to the development PostgreSQL database.");
}

const targetTenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignTenant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pattern = "%needle%";
const pageSize = 25;
const expectedTotal = targetRows / 1_000;
const pageQuery = `
  SELECT id, company_name, company_domain
  FROM company_search_fixture
  WHERE user_id = $1::uuid
    AND (company_name ILIKE $2 OR company_domain ILIKE $2)
  ORDER BY company_name ASC, created_at DESC
  LIMIT $3 OFFSET $4
`;
const countQuery = `
  SELECT count(*)::bigint AS total
  FROM company_search_fixture
  WHERE user_id = $1::uuid
    AND (company_name ILIKE $2 OR company_domain ILIKE $2)
`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
let transactionStarted = false;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function collectIndexNames(plan, names = []) {
  if (plan["Index Name"]) names.push(plan["Index Name"]);
  for (const child of plan.Plans ?? []) collectIndexNames(child, names);
  return names;
}

async function runMeasurement(query, params, expectedRows, expectedCount) {
  const explain = await client.query({
    text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
    values: params,
  });
  const plan = explain.rows[0]["QUERY PLAN"][0].Plan;
  const timings = [];
  let pageIds = null;

  for (let run = 0; run < 5; run += 1) {
    const startedAt = performance.now();
    const result = await client.query(query, params);
    timings.push(performance.now() - startedAt);

    if (expectedRows !== null) {
      assert.equal(
        result.rows.length,
        expectedRows,
        "paged search should return the expected number of rows",
      );
      if (run === 0) pageIds = result.rows.map((row) => row.id);
    } else {
      assert.equal(
        Number(result.rows[0].total),
        expectedCount,
        "exact count should include matching rows once and exclude other tenants",
      );
    }
  }

  return {
    medianMs: Number(median(timings).toFixed(2)),
    plan,
    indexNames: collectIndexNames(plan),
    pageIds,
  };
}

try {
  await client.connect();
  await client.query("BEGIN");
  transactionStarted = true;

  // The transaction rollback removes the extension if this benchmark created it.
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await client.query(`
    CREATE TEMP TABLE company_search_fixture (
      id bigint PRIMARY KEY,
      user_id uuid NOT NULL,
      company_name varchar(200) NOT NULL,
      company_domain varchar(255),
      created_at timestamptz NOT NULL
    ) ON COMMIT DROP
  `);
  await client.query(
    `
      INSERT INTO company_search_fixture (
        id, user_id, company_name, company_domain, created_at
      )
      SELECT
        n,
        CASE WHEN n <= $2 THEN $3::uuid ELSE $4::uuid END,
        CASE
          WHEN n % 2000 = 0 THEN 'Needle company ' || n::text
          ELSE 'Standard company ' || n::text
        END,
        CASE
          WHEN n % 2000 = 1000 OR n % 10000 = 0
            THEN 'needle-domain-' || n::text || '.test'
          ELSE 'standard-' || n::text || '.test'
        END,
        timestamptz '2020-01-01 00:00:00+00' + n * interval '1 second'
      FROM generate_series(1, $1::bigint) AS generated(n)
    `,
    [totalRows, targetRows, targetTenant, foreignTenant],
  );
  await client.query(`
    CREATE INDEX company_search_fixture_user_created_idx
    ON company_search_fixture (user_id, created_at)
  `);
  await client.query("ANALYZE company_search_fixture");

  const pageParams = [targetTenant, pattern, pageSize, 0];
  const countParams = [targetTenant, pattern];
  const beforePage = await runMeasurement(
    pageQuery,
    pageParams,
    pageSize,
    null,
  );
  const beforeCount = await runMeasurement(
    countQuery,
    countParams,
    null,
    expectedTotal,
  );

  await client.query(`
    CREATE INDEX company_search_fixture_name_domain_trgm_idx
    ON company_search_fixture
    USING gin (company_name gin_trgm_ops, company_domain gin_trgm_ops)
  `);
  await client.query("ANALYZE company_search_fixture");

  const afterPage = await runMeasurement(pageQuery, pageParams, pageSize, null);
  const afterCount = await runMeasurement(
    countQuery,
    countParams,
    null,
    expectedTotal,
  );
  assert.deepEqual(
    afterPage.pageIds,
    beforePage.pageIds,
    "the index should not change the ordered page results",
  );
  for (const result of [afterPage, afterCount]) {
    assert.ok(
      result.indexNames.includes("company_search_fixture_name_domain_trgm_idx"),
      "PostgreSQL should use the trigram index for the selective partial search",
    );
  }

  console.log(
    `Company search benchmark (${totalRows.toLocaleString()} rows total)`,
  );
  console.log(`Target tenant fixture: ${targetRows.toLocaleString()} rows`);
  console.log(`Expected exact matching total: ${expectedTotal}`);
  console.log(
    `Paged search median: ${beforePage.medianMs} ms before index; ${afterPage.medianMs} ms after index`,
  );
  console.log(
    `Exact count median: ${beforeCount.medianMs} ms before index; ${afterCount.medianMs} ms after index`,
  );
  console.log(
    `Indexed query plans: ${afterPage.indexNames.join(", ")} (page), ${afterCount.indexNames.join(", ")} (count)`,
  );
} finally {
  if (transactionStarted) await client.query("ROLLBACK");
  await client.end();
}
