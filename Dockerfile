# Build stage
FROM node:24-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 ca-certificates libvips libvips-dev git curl && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.x --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --store=./.pnpm-store

COPY . .
RUN pnpm run db:generate || true
RUN pnpm run build

# Runtime stage
FROM node:24-bullseye-slim AS runner

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.x --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --store=./.pnpm-store

COPY --from=builder /app/.next .next
COPY --from=builder /app/next.config.mjs next.config.mjs
COPY --from=builder /app/server.ts server.ts
COPY --from=builder /app/src src
COPY --from=builder /app/prisma prisma

EXPOSE 3000

CMD ["pnpm", "run", "start"]
