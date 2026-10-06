import assert from "node:assert/strict";
import { Client } from "pg";

const totalRows = Number(process.env.COMPANY_SEARCH_BENCHMARK_ROWS ?? 500_000);
const targetRows = Math.floor(totalRows / 2);
const writeBatchRows = Number(
  process.env.COMPANY_SEARCH_BENCHMARK_WRITE_ROWS ?? 5_000,
);
const writeSamples = 5;
if (
  !Number.isSafeInteger(totalRows) ||
  totalRows < 400_000 ||
  totalRows % 20_000 !== 0
) {
  throw new Error(
    "COMPANY_SEARCH_BENCHMARK_ROWS must be a multiple of 20,000 and at least 400,000.",
  );
}
if (!Number.isSafeInteger(writeBatchRows) || writeBatchRows < 1) {
  throw new Error("COMPANY_SEARCH_BENCHMARK_WRITE_ROWS must be a positive integer.");
}
if (writeBatchRows * writeSamples > targetRows) {
  throw new Error(
    "COMPANY_SEARCH_BENCHMARK_WRITE_ROWS times 5 must not exceed half of COMPANY_SEARCH_BENCHMARK_ROWS.",
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
const insertQuery = `
  INSERT INTO company_search_fixture (
    id, user_id, company_name, company_website_url, company_domain,
    company_domain_key, company_industry, company_size,
    company_revenue_range, company_description, company_phone_number,
    company_linkedin_url, company_location, created_at, updated_at
  )
  SELECT
    md5('company-search-fixture-' || ($1::bigint + generated.n)::text)::uuid,
    $2::uuid,
    'Benchmark inserted ' || ($1::bigint + generated.n)::text,
    'https://benchmark-inserted-' || ($1::bigint + generated.n)::text || '.test',
    'benchmark-inserted-' || ($1::bigint + generated.n)::text || '.test',
    'benchmark-inserted-' || ($1::bigint + generated.n)::text,
    'Technology',
    '11-50',
    '$1M-$10M',
    'Benchmark company profile created for indexed write measurement.',
    '+1-555-0100',
    'https://www.linkedin.com/company/benchmark',
    'New York',
    timestamptz '2020-01-01 00:00:00+00' + ($1::bigint + generated.n) * interval '1 second',
    now()
  FROM generate_series(0, $3::bigint - 1) AS generated(n)
`;
const updateQuery = `
  UPDATE company_search_fixture AS company
  SET
    company_name = 'Benchmark updated ' || generated.n::text || '-' || $3::text,
    company_website_url = 'https://benchmark-updated-' || generated.n::text || '-' || $3::text || '.test',
    company_domain = 'benchmark-updated-' || generated.n::text || '-' || $3::text || '.test',
    company_domain_key = 'benchmark-updated-' || generated.n::text || '-' || $3::text,
    company_industry = 'Technology',
    company_size = '51-200',
    company_revenue_range = '$10M-$50M',
    company_description = 'Benchmark company profile edited for indexed write measurement.',
    company_phone_number = '+1-555-0101',
    company_linkedin_url = 'https://www.linkedin.com/company/benchmark-updated',
    company_location = 'San Francisco',
    updated_at = now()
  FROM generate_series($1::bigint, $2::bigint) AS generated(n)
  WHERE company.id = md5('company-search-fixture-' || generated.n::text)::uuid
`;
const trigramIndexName = "companies_name_domain_trgm_idx";

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

async function assertProductionIndexes(includeTrigram) {
  const result = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = (
      SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()
    )
      AND tablename = 'company_search_fixture'
  `);
  const indexNames = new Set(result.rows.map((row) => row.indexname));
  for (const requiredIndex of [
    "company_search_fixture_pkey",
    "companies_id_user_unique",
    "companies_user_domain_unique",
    "companies_user_created_idx",
  ]) {
    assert.ok(
      indexNames.has(requiredIndex),
      `benchmark fixture is missing production index ${requiredIndex}`,
    );
  }
  assert.equal(
    indexNames.has(trigramIndexName),
    includeTrigram,
    "the comparison should toggle only the trigram index",
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(2)} ${units[unit]}`;
}

async function loadFixture() {
  await client.query(
    `
      INSERT INTO company_search_fixture (
        id, user_id, company_name, company_website_url, company_domain,
        company_domain_key, company_industry, company_size,
        company_revenue_range, company_description, company_phone_number,
        company_linkedin_url, company_location, created_at, updated_at
      )
      SELECT
        md5('company-search-fixture-' || n::text)::uuid,
        CASE WHEN n <= $2 THEN $3::uuid ELSE $4::uuid END,
        CASE
          WHEN n % 2000 = 0 THEN 'Needle company ' || n::text
          ELSE 'Standard company ' || n::text
        END,
        'https://standard-' || n::text || '.test',
        CASE
          WHEN n % 2000 = 1000 OR n % 10000 = 0
            THEN 'needle-domain-' || n::text || '.test'
          ELSE 'standard-' || n::text || '.test'
        END,
        'company-' || n::text,
        'Technology',
        '11-50',
        '$1M-$10M',
        'Synthetic company profile used to measure production-like indexes.',
        '+1-555-0100',
        'https://www.linkedin.com/company/standard',
        'New York',
        timestamptz '2020-01-01 00:00:00+00' + n * interval '1 second',
        timestamptz '2020-01-01 00:00:00+00' + n * interval '1 second'
      FROM generate_series(1, $1::bigint) AS generated(n)
    `,
    [totalRows, targetRows, targetTenant, foreignTenant],
  );
}

async function measureRelationBytes(relationName) {
  const result = await client.query(
    `
      SELECT
        pg_relation_size($1::regclass)::bigint AS relation_bytes,
        pg_relation_size('company_search_fixture'::regclass)::bigint AS table_bytes,
        pg_total_relation_size('company_search_fixture'::regclass)::bigint AS total_bytes
    `,
    [relationName],
  );
  return {
    relationBytes: Number(result.rows[0].relation_bytes),
    tableBytes: Number(result.rows[0].table_bytes),
    totalBytes: Number(result.rows[0].total_bytes),
  };
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

async function runWriteMeasurement(query, paramsForSample, operation) {
  const timings = [];
  for (let sample = 0; sample < writeSamples; sample += 1) {
    const params = paramsForSample(sample);
    const startedAt = performance.now();
    const result = await client.query(query, params);
    timings.push(performance.now() - startedAt);
    assert.equal(
      result.rowCount,
      writeBatchRows,
      `${operation} should affect the expected number of fixture rows`,
    );
  }
  return {
    medianMs: Number(median(timings).toFixed(2)),
    perRowMs: Number(
      (median(timings) / writeBatchRows).toFixed(5),
    ),
    rowsPerSample: writeBatchRows,
    samples: writeSamples,
  };
}

function printWriteMeasurement(label, measurement) {
  console.log(
    `${label}: ${measurement.medianMs} ms median per ${measurement.rowsPerSample.toLocaleString()} rows (${measurement.perRowMs} ms/row; ${measurement.samples} samples)`,
  );
}

try {
  await client.connect();
  await client.query("BEGIN");
  transactionStarted = true;
  const serverInfo = await client.query(`
    SELECT
      current_setting('server_version') AS server_version,
      current_setting('shared_buffers') AS shared_buffers
  `);

  // The transaction rollback removes the extension if this benchmark created it.
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await client.query(`
    CREATE TEMP TABLE company_search_fixture_users (
      id uuid PRIMARY KEY
    ) ON COMMIT DROP
  `);
  await client.query(
    "INSERT INTO company_search_fixture_users (id) VALUES ($1::uuid), ($2::uuid)",
    [targetTenant, foreignTenant],
  );
  await client.query(`
    CREATE TEMP TABLE company_search_fixture (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES company_search_fixture_users(id),
      company_name varchar(200) NOT NULL,
      company_website_url varchar(2048),
      company_domain varchar(255),
      company_domain_key varchar(255),
      company_industry varchar(120),
      company_size varchar(80),
      company_revenue_range varchar(80),
      company_description text,
      company_phone_number varchar(40),
      company_linkedin_url varchar(2048),
      company_location varchar(200),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    ) ON COMMIT DROP
  `);
  await loadFixture();
  await client.query(`
    CREATE UNIQUE INDEX companies_id_user_unique
    ON company_search_fixture (id, user_id)
  `);
  await client.query(`
    CREATE UNIQUE INDEX companies_user_domain_unique
    ON company_search_fixture (user_id, company_domain_key)
    WHERE company_domain_key IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX companies_user_created_idx
    ON company_search_fixture (user_id, created_at)
  `);
  await assertProductionIndexes(false);
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

  const beforeIndexInsert = await runWriteMeasurement(
    insertQuery,
    (sample) => [
      totalRows + sample * writeBatchRows + 1,
      targetTenant,
      writeBatchRows,
    ],
    "unindexed insert",
  );
  const beforeIndexUpdate = await runWriteMeasurement(
    updateQuery,
    (sample) => [
      sample * writeBatchRows + 1,
      (sample + 1) * writeBatchRows,
      sample,
    ],
    "unindexed update",
  );

  // Reload so index size and indexed writes use the same clean base fixture.
  await client.query("TRUNCATE company_search_fixture");
  await loadFixture();
  await client.query("ANALYZE company_search_fixture");
  await client.query(`
    CREATE INDEX companies_name_domain_trgm_idx
    ON company_search_fixture
    USING gin (company_name gin_trgm_ops, company_domain gin_trgm_ops)
  `);
  await assertProductionIndexes(true);
  await client.query("ANALYZE company_search_fixture");
  const indexBytesAtBase = await measureRelationBytes(trigramIndexName);

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
      result.indexNames.includes(trigramIndexName),
      "PostgreSQL should use the trigram index for the selective partial search",
    );
  }

  const afterIndexInsert = await runWriteMeasurement(
    insertQuery,
    (sample) => [
      totalRows + sample * writeBatchRows + 1,
      targetTenant,
      writeBatchRows,
    ],
    "indexed insert",
  );
  const afterIndexUpdate = await runWriteMeasurement(
    updateQuery,
    (sample) => [
      targetRows + sample * writeBatchRows + 1,
      targetRows + (sample + 1) * writeBatchRows,
      sample + writeSamples,
    ],
    "indexed update",
  );
  const indexBytesAfterWrites = await measureRelationBytes(trigramIndexName);

  console.log(
    `Company search benchmark (${totalRows.toLocaleString()} rows total)`,
  );
  console.log(
    `PostgreSQL ${serverInfo.rows[0].server_version}; shared_buffers ${serverInfo.rows[0].shared_buffers}`,
  );
  console.log(`Target tenant fixture: ${targetRows.toLocaleString()} rows`);
  console.log(
    "Production company indexes retained in both cases: primary key, unique id/user, unique tenant/domain, and tenant/created; only trigram is toggled",
  );
  console.log(`Expected exact matching total: ${expectedTotal}`);
  console.log(
    `Trigram index at ${totalRows.toLocaleString()} rows: ${formatBytes(indexBytesAtBase.relationBytes)} (${indexBytesAtBase.relationBytes.toLocaleString()} bytes)`,
  );
  console.log(
    `Base table heap: ${formatBytes(indexBytesAtBase.tableBytes)}; table plus all indexes: ${formatBytes(indexBytesAtBase.totalBytes)}`,
  );
  console.log(
    `Paged search median: ${beforePage.medianMs} ms before index; ${afterPage.medianMs} ms after index`,
  );
  console.log(
    `Exact count median: ${beforeCount.medianMs} ms before index; ${afterCount.medianMs} ms after index`,
  );
  console.log(
    `Indexed query plans: ${afterPage.indexNames.join(", ")} (page), ${afterCount.indexNames.join(", ")} (count)`,
  );
  printWriteMeasurement("Create without trigram index", beforeIndexInsert);
  printWriteMeasurement("Create with trigram index", afterIndexInsert);
  printWriteMeasurement("Edit without trigram index", beforeIndexUpdate);
  printWriteMeasurement("Edit with trigram index", afterIndexUpdate);
  console.log(
    `Trigram index after indexed writes: ${formatBytes(indexBytesAfterWrites.relationBytes)} (${indexBytesAfterWrites.relationBytes.toLocaleString()} bytes)`,
  );
} finally {
  if (transactionStarted) await client.query("ROLLBACK");
  await client.end();
}
