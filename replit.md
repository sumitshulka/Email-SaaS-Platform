# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

### Delivery evidence

- Campaign dashboards separate SMTP acceptance from reported delivery, bounce, delay, failure, and unconfirmed outcomes. Acceptance never proves inbox placement or reading.
- Import standardized DSN/bounce `.eml` files or delivery-report CSV text/files through **Delivery evidence**. Reports must identify a tracked send and its exact recipient in the current account; older sends without stored IDs cannot be matched safely.
- Microsoft trace CSV variants and normalized Google Workspace/generic CSVs are supported conservatively. Unsupported headers/statuses produce errors or warnings rather than inferred outcomes. Google export headers may need normalization; local timestamps need explicit timezone conversion.
- Imported evidence is user-supplied, not independently authenticated with the provider. Raw report files/content are not persisted.
- SMTP delivery-notification requests are best effort and respect the administrator's **Request SMTP delivery notices** setting (off by default). Capturing transport evidence and importing reports do not require this optional request setting.
- Gmail bounce monitoring requires separate per-tenant Google OAuth consent; SMTP presets do not authorize mailbox access. No automatic Microsoft mailbox/report sync is configured.

### Company intelligence operations

- Superadmins manage research controls and usage at `/admin/company-intelligence`; company research is initiated from the Global Company DB intelligence view. Linked user company details read the same stored global intelligence.
- Research requires the existing admin-managed AI provider/key and a model supporting hosted web search and JSON analysis.
- Before starting this version against an existing database on a new host, run `pnpm --filter @workspace/api-server run migrate:company-intelligence`. This idempotent, transactional migration creates only research job/intelligence tables and verifies required indexes; it does not modify company or contact rows. Fresh development schema setup can use the normal Drizzle schema push.
- The API process executes explicitly queued jobs. Interrupted running jobs time out and require an explicit retry; completed versions stay current if a later job fails.
- Cost estimates require saved pricing rates and do not substitute for provider billing. Backup model analysis has no reliable mixed-model estimate. Gemini's internal grounded query count is provider-controlled; the search cap controls hosted calls for OpenAI/Anthropic, not Gemini's internal queries.
- Unit/provider-fixture checks: `pnpm --filter @workspace/api-server run test`. Optional PostgreSQL invariant tests can run with `RUN_COMPANY_RESEARCH_DB_TESTS=1`; their fixtures are rolled back. `RUN_PUBLIC_SOURCE_TESTS=1` enables the real public-page retrieval check.
## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
