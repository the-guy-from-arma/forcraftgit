# FairCroft CoreOne Python PWA

FairCroft CoreOne is a fictional roleplay CAD/MDT and civilian-government portal. This deployment path is Python-only: no Node build, no `node_modules`, no npm/pnpm install step.

## What is included

- Installable PWA served from `static/`
- Civilian PDA with profile, records, department applications, and roleplay 911 submission
- Dispatch console with 911 queue, CAD conversion, unit assignment, and unit board
- Department MDT with active calls, unit status, BOLOs, warrants, citation writer, reports, search, chat/radio log, shift clock, and roster
- Admin console with overview metrics, application decisions, users, departments, ranks/permissions, civilian notes, audit logs, and settings
- Dependency-free Python backend using `http.server` and SQLite
- Role-based bearer-token sessions

## Local run

```bash
python app.py
```

Then open:

```text
http://localhost:3000
```

Seed owner:

```text
owner@faircroft.local / ChangeMe123!
```

## Environment

Copy `.env.example` if you want local variables.

- `PORT` defaults to `3000`
- `HOST` defaults to `0.0.0.0`
- `DATABASE_PATH` defaults to `./faircroft.sqlite3`, or `/data/faircroft.sqlite3` when `/data` exists
- `SESSION_EXPIRES_IN` defaults to `7d`
- `OWNER_EMAIL`, `OWNER_PASSWORD`, and `OWNER_NAME` control the seeded owner

## Railway / Docker

Railway uses the `Dockerfile`, which is now:

- `python:3.12-slim`
- copies only `app.py` and `static/`
- starts with `python app.py`

Healthcheck:

```text
GET /api/health
```

## Notes

- This is for fictional roleplay only. It is not a real public-safety, medical, CJIS, NCIC, or emergency system.
- SQLite is built in. For persistent Railway data, attach a volume and set `DATABASE_PATH` to a path inside that volume.
