#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[startup] DATABASE_URL is required. FairCroft CoreOne only supports PostgreSQL persistence."
  exit 1
fi

case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "[startup] DATABASE_URL must be a PostgreSQL connection string."
    exit 1
    ;;
esac

echo "[startup] Running Prisma migrations against Railway PostgreSQL."
pnpm exec prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[startup] SEED_ON_START=true; seeding FairCroft demo data."
  pnpm exec prisma db seed
fi

echo "[startup] Launching FairCroft CoreOne on port ${PORT:-3000}."
exec node dist/server.js
