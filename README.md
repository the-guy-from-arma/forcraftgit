# FairCroft CoreOne

A roleplay CAD/MDT web platform with a civilian portal and department MDT for law enforcement, fire, EMS, and dispatch.

## Features
- JWT authentication with bcrypt password hashing
- Role-based access control
- Civilian PDA-style portal
- Department MDT with live dispatch
- Postgres database on Railway
- Docker and Railway deployment ready

## Setup
1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL` to your PostgreSQL connection
3. Set `JWT_SECRET` to a long random value
4. Install dependencies:
   - `pnpm install`
5. Run migrations and seed:
   - `pnpm run db:migrate`
   - `pnpm run db:seed`
6. Start locally:
   - `pnpm run dev`

## Railway
Railway uses `Dockerfile`.

- `railway.json` is configured for Docker deployment
- `DATABASE_URL` is provided by Railway PostgreSQL
- `PORT` is automatically set by Railway

## Healthcheck
- `GET /api/health`

## Notes
- Roleplay only; no real CJIS/NCIC claims
- Protect admin and department routes
- Sanitize all user input
