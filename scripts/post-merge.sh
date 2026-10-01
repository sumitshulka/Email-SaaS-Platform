#!/bin/bash
set -euo pipefail

pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push
