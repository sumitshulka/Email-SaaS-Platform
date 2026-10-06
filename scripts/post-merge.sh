#!/bin/bash
set -euo pipefail

pnpm install --no-frozen-lockfile
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0001_enable_pg_trgm.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0002_preserve_smtp_sender_accounts.sql
pnpm --filter @workspace/db run push
