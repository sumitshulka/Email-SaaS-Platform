# Company search index cost measurements

Measured October 6, 2026 with the `company-search.mjs` benchmark against the
development PostgreSQL database. The first section preserves the original
isolated-index result; the second records the expanded full-schema run.

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

## Full company schema and production indexes

The expanded run used the same PostgreSQL 16.10 instance and 500,000-row
fixture (250,000 rows per tenant), but retained every company-table column and
all production company indexes in both comparison cases:

- Primary key on `id`.
- Unique `(id, user_id)` index.
- Partial unique `(user_id, company_domain_key)` index.
- `(user_id, created_at)` index.
- The two-column GIN trigram index, present only in the indexed case.

The fixture also includes the company `user_id` foreign key. Search still uses
the API's tenant-scoped `%needle%` name/domain pattern, a 25-row ordered page,
and an exact count. Create and edit each run as five single SQL statements
affecting 5,000 rows per sample. Creates populate all company profile fields;
edits change the full profile, including name, domain, and domain key. The
without-trigram and with-trigram cases start from the same reloaded fixture.
All fixture work is inside a transaction that is rolled back.

| Measurement | Without trigram index | With trigram index |
| --- | ---: | ---: |
| Paged partial search, median | 205.84 ms | 1.21 ms |
| Exact matching count, median | 201.71 ms | 0.83 ms |
| Create 5,000 rows, median | 96.31 ms | 165.33 ms |
| Edit 5,000 rows, median | 122.69 ms | 213.76 ms |

At the base fixture size, the trigram index occupied **38,256,640 bytes
(36.48 MiB)**. The full company table heap was 156.25 MiB and table plus all
indexes was 295.58 MiB. After the indexed write samples (25,000 creates and
25,000 edits), the trigram index measured 53.63 MiB before vacuuming.

With the full set of other indexes enabled, the trigram index added 69.02 ms
per 5,000-row create batch (about **13.80 microseconds per row**) and 91.07 ms
per edit batch (about **18.21 microseconds per row**). The indexed 5,000-row
batches completed in 165.33 ms for creates and 213.76 ms for edits.

## Recommendation

The expanded result confirms the isolated benchmark's recommendation: keep the
two-column trigram index. It reduced paged-search time by about 99% and exact
count time by about 99.5% on this fixture. The extra write cost remained below
0.22 seconds per 5,000-row batch with all the other production indexes enabled,
and the base trigram index occupied 36.48 MiB at 500,000 companies.

These are batched SQL timings, not end-to-end single-company API timings. They
exclude the route's transaction setup, tenant lock, duplicate-domain lookup,
validation, and response handling. They establish index-maintenance cost for
representative full-profile create/edit statements; the actual latency of an
individual API save also depends on those route and database costs.

## Sparse-domain search

Measured October 6, 2026 on the same PostgreSQL 16.10 instance, with 500,000
rows and all production company indexes retained. Each run used a 250,000-row
searched tenant and a 250,000-row second tenant. The fixture kept
`company_domain` and `company_domain_key` either populated together or `NULL`
together. Requested rates are deterministic; the measured rate can differ by a
few hundredths of a percentage point.

| Requested domains populated | Measured target-tenant domains | GIN size | Paged search, without → with GIN | Exact count, without → with GIN | GIN used for page/count |
| ---: | ---: | ---: | ---: | ---: | :---: |
| 100% | 250,000 / 250,000 (100%) | 36.48 MiB | 196.58 → 1.16 ms | 185.21 → 0.91 ms | Yes / yes |
| 50% | 125,129 / 250,000 (50.05%) | 27.62 MiB | 167.63 → 1.17 ms | 163.58 → 0.93 ms | Yes / yes |
| 10% | 25,025 / 250,000 (10.01%) | 20.87 MiB | 140.92 → 1.03 ms | 133.19 → 0.81 ms | Yes / yes |
| 0% | 0 / 250,000 (0%) | 18.91 MiB | 135.35 → 0.99 ms | 122.93 → 0.71 ms | Yes / yes |

At each rate the indexed plan used a `BitmapOr` with trigram bitmap scans for
both search columns, followed by a bitmap heap scan. At 0%, the domain branch
has no matching values, but PostgreSQL still uses the index for the
company-name branch. Page contents and counts matched between indexed and
unindexed runs at all four rates.

The two-column index remains effective even when most or all domains are
missing: it reduced paged-search time by about 99.3–99.4% and exact-count time
by about 99.4–99.5% in these runs. Sparse domains reduce storage rather than
break the search plan. The all-null case still uses 18.91 MiB for the name
trigrams; the fully populated case uses 17.57 MiB more. The measured results
support keeping the current index rather than splitting or removing its domain
column. This is a synthetic distribution and a single PostgreSQL instance, so
it does not replace production workload monitoring.

## Rerun

From the repository root, run:

```sh
pnpm --filter @workspace/db run benchmark:company-search
```

The benchmark defaults to 500,000 fixture rows and 5,000-row write batches.
`COMPANY_SEARCH_BENCHMARK_ROWS` can select another multiple of 20,000 (minimum
400,000); `COMPANY_SEARCH_BENCHMARK_WRITE_ROWS` can change the write batch size.
The batch size times five must not exceed half the fixture row count.
`COMPANY_SEARCH_BENCHMARK_DOMAIN_PERCENT` sets the fixture's domain-population
rate as an integer from 0 to 100 and defaults to 100. For example, rerun with
`COMPANY_SEARCH_BENCHMARK_DOMAIN_PERCENT=10` to measure a sparse-domain case.
