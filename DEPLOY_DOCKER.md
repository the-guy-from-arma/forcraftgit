# Python-only Docker deployment

This project now deploys as a Python PWA. Docker does not install Node, npm, pnpm, or `node_modules`.

## Build locally

```bash
docker build -t faircroft-coreone-python:local .
```

## Run locally

```bash
docker run --rm -it -p 3000:3000 \
  -e OWNER_EMAIL="owner@faircroft.local" \
  -e OWNER_PASSWORD="ChangeMe123!" \
  faircroft-coreone-python:local
```

Open:

```text
http://localhost:3000
```

## Railway

`railway.json` uses the Dockerfile builder and starts:

```bash
python app.py
```

The healthcheck is:

```text
/api/health
```

## Persistence

By default the app uses SQLite at `./faircroft.sqlite3`. On Railway, attach a persistent volume and set:

```text
DATABASE_PATH=/data/faircroft.sqlite3
```

Without a volume, Railway may reset SQLite data when the container is replaced.
