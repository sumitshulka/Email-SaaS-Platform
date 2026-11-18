# Mailflow Report Workarea: Phase 0 Architecture

## Existing application

Mailflow is a React/Vite single-page application backed by one Express API and PostgreSQL through Drizzle ORM. The API is described in `lib/api-spec/openapi.yaml`; Orval generates both server-side Zod schemas and React Query client hooks. User-only endpoints use the session middleware and `requireUserRole`; tenant-owned records carry `userId`.

The Report Workarea is being added to the existing user portal, not as a separate product or data store. Predefined templates will be immutable code metadata. A user's saved report stores a versioned definition, not a snapshot of rows.

## Supported data and report grains

| Report base | One row represents | Supported related data |
| --- | --- | --- |
| Contacts | One contact | Its linked company; tags and list names as tenant-scoped text summaries |
| Companies | One workspace company | Its own profile and a tenant-scoped contact count |
| Campaigns | One campaign | Its stored campaign settings and recipient counts from recipient rows |
| Campaign recipients | One stored recipient record | Its campaign, optional saved contact, and that contact's linked company |
| Prospects | One prospect | Contact, linked company, product/service, and current stage |
| Prospect actions | One recorded action | Prospect, contact, action type, and stage period |
| Prospect stage history | One immutable stage event | Prospect, contact, previous/new stage, and recorded actor |
| Prospect follow-ups | One follow-up | Prospect, contact, current stage, and action type |

Contacts, companies, prospects, campaigns, recipients, actions, stage events, and follow-ups have tenant ownership in their current schema. Relations exposed as report columns must join on both record identity and the same `userId`; user-controlled relation names are never translated directly into SQL.

Campaign recipients are a separate base from contacts. Open-campaign recipients can have no `contactId`, so recipient reports must retain the email/name stored on the recipient itself and show the contact relation as optional. Available delivery data distinguishes queue/send status, SMTP acceptance, provider-reported outcomes, and replies. The current schema has no open or click events, so those are not report metrics.

The contact schema contains fixed columns and tenant-specific value lists for a few fields; there is no generic custom-field value table. The initial field catalogue therefore exposes only actual schema-backed values.

## Field catalogue and query strategy

Expose an explicit allowlist of business fields with stable identifiers, display labels, types, descriptions, filter operators, and required relation paths. Exclude SMTP credentials, raw message bodies, attachment object paths, and other operational secrets. Multi-value tags and lists are returned through tenant-scoped correlated summaries, not joins that duplicate a contact.

For the initial table builder, each report uses a declared base entity and grain. Related fields are restricted to one-to-one or many-to-one paths; multi-record domains such as recipients, actions, and stage history are selected as their own report base. This keeps ordinary tabular reports at one row per base record and avoids cross-joining independent collections. Any later aggregation work must continue to pre-aggregate or isolate one-to-many relations before combining values.

Every field, relation, filter, order, and aggregation comes from server-owned metadata. Input values are parameterized. The API rejects unknown field IDs, unsupported operators, excessive nesting/condition counts, invalid date/number values, and unsupported definitions. Pagination, preview sizes, export row limits, and statement timeouts bound execution.

## Tenant isolation and saved report storage

The authenticated user ID is supplied only by the server session, never by the report definition. The API applies it to the base query and every relation path. Saved definitions are keyed by `userId`, and read/update/delete/run/export paths verify ownership. Built-in templates are not editable in place; customization saves a separate user-owned copy.

Saved definitions carry a version number. If a future schema or catalogue revision makes a saved field invalid, execution reports the invalid field and leaves the saved configuration unchanged for repair.

## API and UI

The API exposes catalogue metadata, paginated report execution, saved-report CRUD, and CSV/XLSX export. Export uses the same validated definition and query service as the on-screen results. The UI adds a dedicated Report Workarea navigation group containing Report Gallery, Report Builder, and My Reports; all pages remain inside the existing authenticated user shell.

## Risks and verification

- One-to-many relationships can multiply rows and financial values if joined naively; the initial builder avoids them as direct columns.
- SMTP acceptance is not inbox delivery; the UI and templates preserve that distinction.
- Multi-currency deal values must remain separated by currency in all totals and visualizations.
- Saved reports can outlive metadata changes; version validation must not silently rewrite them.
- Tests cover tenant boundaries, invalid fields/operators, nested filter logic, query grain, join fan-out, money by currency, saved-report ownership/versioning, exports, and existing CRM/campaign behavior.

## Phased rollout

Phase 1 delivers the real-data metadata catalogue, predefined tabular reports, dynamic table builder, account-owned saved reports, pagination, and CSV/XLSX export. Grouping and aggregates, calculated metrics, and chart visualizations are implemented only after the previous phase passes its acceptance checks. Scheduling, subscriptions, sharing, and formula authoring remain future work.

## External production migration

The development schema is represented by `lib/db/src/schema/saved-report-definitions.ts`. External production owners should review and apply `lib/db/migrations/0028_saved_report_definitions.sql` to the database used by the production API before deploying the version that uses saved reports. No production database is changed by this implementation.
