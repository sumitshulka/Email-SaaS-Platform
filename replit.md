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
- SMTP delivery-notification requests are best effort and respect the administrator's **Request SMTP delivery notices** setting (off by default). Capturing transport evidence and importing reports do not require this optional request setting. Automatic Gmail mailbox monitoring and Google/Microsoft tenant reporting authorization are not configured by SMTP presets.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
