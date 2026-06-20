Docker build and run (local)

# Build the Docker image
```bash
docker build -t faircroft-coreone:local .
```

# Run the container (exposes port 3000)
```bash
docker run --rm -it -p 3000:3000 \
  -e DATABASE_URL="your_database_url" \
  -e JWT_SECRET="your_jwt_secret" \
  faircroft-coreone:local
```

Notes:
- The image runs `pnpm run railway:release && pnpm run start` which will attempt migrations; ensure `DATABASE_URL` and secrets are set when running locally.
- To build faster, you can use a local pnpm store by adjusting the Dockerfile caching lines.

Railway

- With the provided `Dockerfile` and updated `railway.json` Railway will detect the Docker builder and use the Dockerfile to build the image.
- Push your repo to your Git remote and trigger a Railway deploy via the Railway UI or connect GitHub.

Troubleshooting

- If you see native build failures for `sharp` or `prisma` during `pnpm install`, ensure the Docker image has the required system libraries (the Dockerfile installs `libvips` and build-essential). If further native deps fail, add the specific system packages to the Dockerfile.
- Keep secrets out of the Dockerfile; pass them via Railway environment variables or `docker run -e`.
