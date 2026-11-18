# Mailflow Report Workarea

This document describes the implemented reporting feature, its data meanings, and its deployment requirements.

## How users access reports

The authenticated user portal has a Report Workarea menu with:

- **Report Gallery** — search and start from predefined report templates.
- **Report Builder** — choose a record source, fields, filters, sort order, grouping, measures, and table/chart presentation.
- **My Reports** — reopen, edit, duplicate, or delete saved definitions.

Templates are code-owned starting points. Saving a template creates a separate user-owned report. Saved reports store a versioned query definition, not a frozen copy of report rows; reopening one queries current data.

## Supported record sources

Each source has a fixed grain. A report returns one row per record at that grain in detail mode; summaries intentionally return one row per group/total.

| Source | Grain | Included relationships or controlled metrics |
| --- | --- | --- |
| Contacts | One contact | Linked company; tag/list summaries; linked prospect and distinct campaign counts |
| Companies | One workspace company | Linked contact, prospect, and distinct campaign counts |
| Campaigns | One campaign | Campaign settings and recipient/SMTP-accepted/bounced record counts |
| Campaign recipients | One stored recipient | Campaign, optional saved contact, and the contact's linked company |
| Prospects | One prospect | Contact, company, product/service, current stage, weighted pipeline, age, days since activity, days to expected closure, current stage duration, activity count, pending follow-up count |
| Prospect actions | One recorded action | Prospect, contact, company, action type, and stage period |
| Prospect stage history | One immutable stage event | Prospect, contact, company, previous/new stage, actor, and days in the stage period |
| Prospect follow-ups | One follow-up | Prospect, contact, company, current stage, and action type |

Only fixed schema-backed fields are exposed; there is no generic custom-field value table in the current application. Sensitive operational fields such as SMTP credentials, raw campaign message bodies, and private object paths are not reportable.

Campaign recipients are not Contacts. Open-campaign recipients may have no saved contact, so their own email/name fields remain reportable. Delivery reporting distinguishes send status, SMTP acceptance, provider-reported outcomes, and replies. SMTP acceptance is not proof of inbox delivery. The schema has no open/click event records, so those metrics are not offered.

## Filters, sorting, and report definitions

- Up to 30 detail columns, with editable labels and drag-free up/down ordering.
- Up to 50 filters, nested to five levels; each group can combine conditions with AND or OR.
- Type-aware filters and values; user values are parameterized.
- Up to four user-selected grouping fields, with day/week/month/quarter/year date intervals.
- Up to eight summary measures: count, count distinct, sum, average, minimum, maximum, and the controlled prospect win-rate calculation.
- Optional subtotals and grand totals.
- Up to four sort rules. Summary reports sort by grouping fields.

The server resolves field IDs, operators, aggregation types, joins, and calculated metrics from a fixed allowlist. User-supplied identifiers are never interpolated into SQL.

### Calculated prospect metrics

- **Weighted pipeline value** = expected deal value × current probability ÷ 100.
- **Win rate** = Won ÷ (Won + Lost) × 100; active/undecided prospects are excluded. It uses the prospect's configured terminal outcome.
- **Prospect age** = whole days since creation.
- **Days since last activity** is blank when no activity is recorded.
- **Days until expected closure** is negative when the target date has passed.
- **Days in current stage** uses the latest history event for the current stage.
- **Days in a stage-history period** runs from that event until the next event, or until now for the current period.
- **Activity, pending follow-up, prospect, and distinct campaign counts** use tenant-scoped scalar summaries so they do not multiply source rows.

### Currency rules

When a summary measure uses a currency field, the server automatically groups the result by its associated currency code. It does not convert currencies or combine different codes into one sum, average, minimum, maximum, KPI, or chart. Currency dimensions are visible in the results; charts include currency in category labels or show separate currency KPI cards.

## Charts and results

Summary reports can be displayed as a table, KPI cards, bar, horizontal bar, line, area, pie, or donut chart. Charts reuse the same validated report definition and query as the table and exports; chart configuration only selects a supported group field and summary measure.

Paginated preview supports up to 100 rows per page. Charts display the current page of grouped results, up to 100 groups at a time; users can page through the remaining groups. Pie/donut charts show up to 12 positive categories on the current page. CSV and XLSX exports use the same report definition and are capped at 5,000 result rows. CSV strings that could be interpreted as spreadsheet formulas are escaped.

## Tenant isolation and data-grain protections

Report routes require an authenticated user session. The tenant ID comes from that session, not from a report definition. The base query is scoped to that user, and all relation paths include tenant-safe identity checks. Saved-report reads, updates, deletes, runs, and exports verify ownership.

Related fields use only safe many-to-one/one-to-one joins. Multi-record domains—campaign recipients, prospect actions, history, and follow-ups—are separate report sources. Counts that need those related records use correlated scalar subqueries. This avoids multiplying prospects, companies, deal values, or campaign recipients when several independent one-to-many collections exist.

Queries run with a 10-second PostgreSQL statement timeout. Definitions reject unknown fields/operators, unsupported aggregations, invalid date/number values, excessive nesting, and invalid chart references. Saved definitions carry a version and are not silently rewritten when metadata changes.

## API and storage

The contract is in `lib/api-spec/openapi.yaml`; Orval generates the React Query client and server validation schemas. The API exposes catalog metadata, report execution, saved-report CRUD, and CSV/XLSX export under `/api/report-workarea`.

Saved definitions use the additive `report_saved_definitions` table. The schema lives in `lib/db/src/schema/saved-report-definitions.ts`, with migration `lib/db/migrations/0028_saved_report_definitions.sql` and the API migration command `pnpm --filter @workspace/api-server run migrate:report-workarea`.

## Verification

Type checks:

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/mailflow-saas run typecheck
```

Report tests, including an isolated temporary tenant that verifies activity counts and currency totals:

```sh
RUN_REPORT_WORKAREA_DB_TESTS=1 pnpm --filter @workspace/api-server exec node --import tsx --test test/report-workarea-validation.test.mjs test/report-workarea-data.test.mjs test/report-workarea-routes.test.mjs
```

The DB tests create and delete records under unique test users. They cover tenant isolation, summary grain, currency-aware values, win-rate calculation, saved-report ownership, and CSV/XLSX endpoints. Run them against a development or disposable test database, not production.

## External production deployment

The development database migration has been applied and verified. This does not modify an independently hosted production database. Before deploying this app version to external production, the production database owner must apply `lib/db/migrations/0028_saved_report_definitions.sql` to the database used by the production API. Confirm the migration completes before deploying code that reads saved reports. Do not point the development migration command at production without first reviewing the target database and deployment procedure.

Scheduling, subscriptions, report sharing, AI-generated reports, and arbitrary formula authoring are not included.
