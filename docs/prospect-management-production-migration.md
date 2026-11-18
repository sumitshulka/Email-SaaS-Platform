# Prospect Management production migration

Prospect Management adds nine tenant-scoped PostgreSQL tables. The migration is
not run automatically and has not been applied to the external production
database.

## Before applying

1. Back up the production database and confirm the backup can be restored.
2. Deploy the application code and migration file together, but do not route
   production traffic to the new feature until the migration succeeds.
3. Run the migration against the same PostgreSQL database used by the
   production API. Do not use the Replit development database URL.

## Apply with the API package

From the deployed source checkout, provide the production database connection
through the deployment's normal environment configuration and run:

```sh
pnpm --filter @workspace/api-server run migrate:prospect-management
```

The command runs `lib/db/migrations/0023_prospect_management.sql` in a
transaction and verifies that the new tables can be queried. It prints a
success message only after those checks pass. It does not copy or modify
existing contact, campaign, or billing data.

If the production host does not use pnpm, apply the SQL file directly using the
host's PostgreSQL migration tooling:

```text
lib/db/migrations/0023_prospect_management.sql
```

Apply that file once, as a database role with permission to create tables,
indexes, constraints, and the required triggers. Do not run both methods.

## After applying

- Confirm the nine tables exist: `prospect_products`, `prospect_currencies`,
  `prospect_stages`, `prospect_stage_transitions`, `prospect_action_types`,
  `prospects`, `prospect_stage_history`, `prospect_actions`, and
  `prospect_tag_assignments`.
- Restart the API service if its deployment process requires restarts to load
  the newly deployed code.
- Sign in as a regular user and verify that their Prospect Management pages
  load before enabling the feature for all users.

## Add deal-value history to an existing installation

The deal-value history upgrade adds one tenant-scoped table and does not alter
existing prospect values. Deploy the application code and migration together,
then run this command against the same PostgreSQL database used by the
production API:

```sh
pnpm --filter @workspace/api-server run migrate:prospect-value-history
```

The migration is also available as
`lib/db/migrations/0026_prospect_value_history.sql` for hosts that apply SQL
through their own migration tooling. Do not use the Replit development
database URL for an external production install.
