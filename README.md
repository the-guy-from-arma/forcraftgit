# RP Command PWA

A mobile-first Python PWA for roleplay servers: civilian verification, phone-style app dashboard, jobs with passive income, banking, cash transfers, DMV, court/citation review, admin controls, and an MDT/CAD module for assigned law enforcement roles.

The app uses PostgreSQL through `DATABASE_URL`.

## Run locally

```bash
docker compose up --build
```

Open `http://localhost:8080`.

Default owner account for first login:

- Email: `owner@rp.local`
- Password: `owner1234`

If you run Python directly instead of Docker Compose, install dependencies and set `DATABASE_URL` first:

```bash
pip install -r requirements.txt
set DATABASE_URL=postgresql://roleplay:roleplay@localhost:5432/roleplay
python app.py
```

Set `OWNER_EMAIL`, `OWNER_PASSWORD`, `SECRET_KEY`, and `DATABASE_URL` before deploying.

## Deploy

This repo includes a `Dockerfile` and `railway.toml`. Railway can build it as a Dockerfile app. Add a Railway PostgreSQL database to the project and pass its `DATABASE_URL` to this service. The server listens on the `PORT` environment variable Railway provides.

Useful environment variables:

- `SECRET_KEY`: required for production session signing.
- `DATABASE_URL`: required PostgreSQL connection string.
- `OWNER_EMAIL`: owner bootstrap email.
- `OWNER_PASSWORD`: owner bootstrap password.
- `OWNER_NAME`: owner display name.
- `COOKIE_SECURE=1`: use once deployed behind HTTPS.
