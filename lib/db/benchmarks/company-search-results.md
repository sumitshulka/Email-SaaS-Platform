# Company search index cost measurements

Measured October 6, 2026 with the `company-search.mjs` benchmark against the
development PostgreSQL database.

## Setup

- PostgreSQL 16.10, `shared_buffers = 128MB`.
- 500,000 synthetic companies, split evenly between the searched tenant and a
  second tenant.
- Search used the API's `%needle%` pattern against company name and domain,
  tenant filtering, name/creation-time ordering, a 25-row page, and an exact
  count.
- The GIN index has the same two `gin_trgm_ops` columns as
  `companies_name_domain_trgm_idx`.
- Each write result is the median of five single SQL statements affecting
  5,000 rows. Updates change both indexed text columns. The unindexed and
  indexed runs start from the same reloaded 500,000-row fixture.
- The fixture also has a primary key and `(user_id, created_at)` index. Other
  production company columns and indexes are omitted so this measures the
  trigram index's incremental cost, rather than a full API request.
- All work uses a temporary table inside a transaction that is rolled back.
  Nothing is written to persistent company data.

## Results

| Measurement | Without trigram index | With trigram index |
| --- | ---: | ---: |
| Paged partial search, median | 192.18 ms | 1.42 ms |
| Exact matching count, median | 181.22 ms | 1.05 ms |
| Insert 5,000 rows, median | 9.14 ms | 67.24 ms |
| Update 5,000 rows, median | 18.86 ms | 108.84 ms |

At 500,000 rows, the trigram index occupied **37,593,088 bytes (35.85 MiB)**.
The base table heap was 52.08 MiB and the table plus all indexes was 118.08
MiB. The trigram index was therefore about 69% of the heap size and 30% of
total table storage.

The measured insert cost increased by 58.10 ms per 5,000-row batch
(approximately 11.62 microseconds per row); update cost increased by 89.98 ms
per batch (approximately 18.00 microseconds per row). The index grew to 50.02
MiB after the indexed run's 25,000 inserts and 25,000 updates. That final size
was read before vacuuming, so it includes the effects of the update workload
and should not be treated as a steady-state size estimate.

## Decision

Keep the current two-column trigram index; this measurement does not justify
tuning it yet. On this fixture, it reduced the paged search from 192.18 ms to
1.42 ms and the exact count from 181.22 ms to 1.05 ms. The incremental write
cost was measurable but remained below 0.1 seconds for each 5,000-row batch,
and the base index used 35.85 MiB at 500,000 companies.

Revisit index design if production workspaces approach this size and storage
pressure or company-write latency becomes material, or if measured search
frequency is too low to justify the write cost. The benchmark uses generated
company names/domains and batched statements; it isolates database index
maintenance, not end-to-end single-company API latency. Its results are
specific to this PostgreSQL instance, cache state, and fixture distribution.

## Rerun

From the repository root, run:

```sh
pnpm --filter @workspace/db run benchmark:company-search
```

The benchmark defaults to 500,000 fixture rows and 5,000-row write batches.
`COMPANY_SEARCH_BENCHMARK_ROWS` can select another multiple of 20,000 (minimum
400,000); `COMPANY_SEARCH_BENCHMARK_WRITE_ROWS` can change the write batch size.
The batch size times five must not exceed half the fixture row count.
