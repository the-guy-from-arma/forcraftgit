#!/bin/sh
set -eu

pnpm exec prisma migrate deploy
