# Use Node 24 slim as base
FROM node:24-bullseye-slim

# Set working directory
WORKDIR /app

# Install system dependencies required for native modules (sharp, prisma, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 ca-certificates libvips libvips-dev git curl && \
    rm -rf /var/lib/apt/lists/*

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@9.x --activate

# Copy lockfile and package manifests first for efficient caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies (development dependencies needed for build)
RUN pnpm install --frozen-lockfile --store=./.pnpm-store

# Copy the rest of the application
COPY . .

# Generate Prisma client (if configured) and build app
RUN pnpm run db:generate || true
RUN pnpm run build

# Remove dev dependencies for production image
RUN pnpm prune --prod

# Expose application port (Next default + Express)
EXPOSE 3000

# Start the app (railway release step is run before start if present)
CMD ["sh", "-lc", "pnpm run railway:release && pnpm run start"]
