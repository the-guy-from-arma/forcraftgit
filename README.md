# FairCroft CoreOne

FairCroft CoreOne is a fictional roleplay government operating system with a civilian phone/PDA portal, government employee DMV/passport OS, department CAD/MDT, dispatch console, live 911 queue, admin job assignment workflow, and PostgreSQL-backed records.

It is not a real emergency system, law-enforcement system, medical system, NCIC system, CJIS system, or government integration.

## Stack

- Next.js App Router frontend
- Custom Node/Express server
- Socket.IO live dispatch and MDT notifications
- PostgreSQL only for persistent data
- Prisma ORM and Prisma migrations
- JWT sessions stored in PostgreSQL
- bcrypt password hashing
- Role-based access control
- Railway/Docker deployment ready

## Database policy

FairCroft CoreOne uses PostgreSQL as the only production persistence layer.

No SQLite. No local JSON database. No file-based records. `DATABASE_URL` is required at startup.

The project uses Prisma because the requested application stack is Node/Express + Prisma. SQLAlchemy and Alembic are Python tools, so their equivalents here are:

- `prisma migrate dev --name <name>` instead of `alembic revision --autogenerate`
- `prisma migrate deploy` instead of `alembic upgrade head`
- `prisma migrate reset` / generated migration rollback workflows instead of `alembic downgrade`

## Required environment variables

Copy `.env.example` and set:

```bash
DATABASE_URL="postgresql://username:password@host:5432/faircroft"
PORT=3000
NODE_ENV=development
JWT_SECRET="replace-with-a-long-random-secret"
SECRET_KEY="replace-with-another-long-random-secret"
JWT_EXPIRES_IN="7d"
CORS_ORIGIN="http://localhost:3000"
```

Railway will provide `DATABASE_URL` when you attach Railway PostgreSQL. In production, do not use the example secrets.

## Docker-first local run

No host `node_modules` are required. Docker builds dependencies inside the image.

The Dockerfile pins `pnpm@10.17.1` so Railway/Corepack does not download a pnpm release that requires a newer Node runtime.

Railway build logs may mention `/app/node_modules` because dependencies exist inside the Docker image. The repository and Docker build context still exclude host `node_modules` through `.dockerignore` and `.railwayignore`.

The final Railway image prunes dev dependencies after building and removes the Next build cache, which keeps the website image smaller for deploy downloads.

Run everything in Docker:

```bash
docker compose up --build
```

That starts:

- `postgres` using PostgreSQL 16
- `app` using the project `Dockerfile`
- Prisma migrations during container startup
- Seed data because `SEED_ON_START=true` in `docker-compose.yml`

Open:

```text
http://localhost:3000
```

To stop containers:

```bash
docker compose down
```

To remove the local Docker Postgres volume and reset data:

```bash
docker compose down -v
```

## Owner login

The owner account is bootstrapped on startup from environment variables:

- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_NAME`

`OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`, `JWT_SECRET`, `SECRET_KEY`, and `JWT_EXPIRES_IN` are trimmed and de-quoted at startup, which protects against accidentally pasting quoted values into Railway.

Supported owner aliases are also accepted:

- `OWNER_PASS`
- `COREONE_OWNER_EMAIL`
- `COREONE_OWNER_PASSWORD`
- `COREONE_OWNER_NAME`
- `FAIRCROFT_OWNER_EMAIL`
- `FAIRCROFT_OWNER_PASSWORD`
- `FAIRCROFT_OWNER_NAME`

If `OWNER_PASSWORD` changes in Railway, redeploy/restart and CoreOne will update the owner password in PostgreSQL. Demo seed passwords are intentionally not shown in the app UI.

Owner login also has a safe recovery path: if the stored owner password hash is stale but the submitted login exactly matches the configured owner environment email/password, CoreOne refreshes the owner account from the environment and continues the login.

Temporary auth diagnostics:

1. Set `AUTH_DIAGNOSTICS_ENABLED=true` in Railway.
2. Redeploy/restart the web service.
3. Visit `/api/health/auth`.
4. Confirm `owner.userExists=true`, `owner.passwordMatchesConfigured=true`, and `jwt.secretAvailable=true`.
5. Set `AUTH_DIAGNOSTICS_ENABLED=false` again after debugging.

## Railway deployment

1. Create a Railway project from this repository.
2. Add a Railway PostgreSQL service.
3. Ensure the web service has these variables:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `SECRET_KEY`
   - `OWNER_EMAIL`
   - `OWNER_PASSWORD`
   - `OWNER_NAME`
   - Optional debugging only: `AUTH_DIAGNOSTICS_ENABLED=false`
   - `NODE_ENV=production`
   - `PORT` is managed by Railway.
   - Optional first deploy: `SEED_ON_START=true`
4. Railway uses `Dockerfile` and `railway.json`.
5. Startup runs:

```bash
pnpm exec prisma migrate deploy
node dist/server.js
```

Health endpoint:

```text
GET /api/health
GET /api/health/db
GET /api/health/auth  # only when AUTH_DIAGNOSTICS_ENABLED=true
```

## Useful commands

Run commands inside the Docker app container. The Docker/Railway path does not require host `node_modules`.

```bash
docker compose exec app pnpm run build
docker compose exec app pnpm run typecheck
docker compose exec app pnpm run lint
docker compose exec app pnpm run db:generate
docker compose exec app pnpm run db:deploy
docker compose exec app pnpm run db:seed
```

## Core experiences

Civilian users boot into a phone/PDA-style government portal with:

- Profile
- Passport / civilian ID intake
- Driver license
- Vehicle registration
- Firearm permit
- Business license
- Warrants
- Tickets/citations
- 911 call form
- Emergency contacts
- Civilian records
- Court notices
- Department applications
- My jobs / enabled OS apps

Newly registered users start as `unverified_civ`. They can open the DMV/passport apps to request fictional verification, driver licenses, and vehicle registrations. Profile photos include the reminder that images must be game-character photos, not real photos.

Government employees get a separate Government OS for:

- DMV/passport/identity application queue
- Driver license, passport, vehicle, firearm permit, and business license decisions
- Civilian/vehicle/license/permit record search
- Live Socket.IO government queue updates

## iPhone website PWA support

FairCroft CoreOne is a website PWA. It is not a native iOS app and is not packaged for the App Store. On iPhone, open it in Safari and use Share -> Add to Home Screen.

- `/manifest.webmanifest` generated by Next.js
- standalone display mode with mobile viewport metadata
- iPhone Apple web app metadata
- Apple touch icon at `/icons/apple-touch-icon.png`
- PNG and SVG app icons in `public/icons`
- add-to-home-screen prompt hook for browsers that support `beforeinstallprompt`
- iPhone website-PWA hint for Safari: Share -> Add to Home Screen

The website intentionally does not use offline-first service-worker caching for app screens, because CoreOne requires network access for live CAD, 911, DMV approvals, auth, and PostgreSQL-backed records. If Safari cached an older build, clear Safari website data or reload after the new deploy.

Approved department users get the dark CAD/MDT:

- Dashboard
- Active calls
- Create call
- Assign units
- Unit status
- BOLOs and warrants
- People, vehicle, and plate search
- Citation writer
- Incident, arrest, fire, and roleplay-only EMS reports
- Dispatch chat
- Radio log
- Call history
- Shift clock
- Department roster

Dispatchers receive live 911 alerts over Socket.IO, accept calls into CAD incidents, assign units, and trigger live MDT notifications.

## Security notes

- Passwords are hashed with bcrypt.
- JWT sessions are backed by PostgreSQL `Session` records.
- Department/admin APIs are guarded server-side.
- Failed logins, permission denials, and admin actions write `AuditLog` rows.
- Form input is validated with Zod and sanitized.
- The app never exposes password hashes, JWT secrets, or database connection strings.

## Roleplay disclaimer

FairCroft CoreOne is fictional software for roleplay communities. It must not be used for real emergency response, criminal justice data, medical care, public records, or government operations.
