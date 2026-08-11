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

The bootstrap owner is synced from `OWNER_EMAIL` and `OWNER_PASSWORD` on startup, so changing those Railway variables and redeploying updates the owner login.

## Deploy

This repo includes a `Dockerfile` and `railway.toml`. Railway can build it as a Dockerfile app. Add a Railway PostgreSQL database to the project and pass its `DATABASE_URL` to this service. The server listens on the `PORT` environment variable Railway provides.

Useful environment variables:

- `SECRET_KEY`: required for production session signing.
- `DATABASE_URL`: required PostgreSQL connection string.
- `DATABASE_MAX_CONNECTIONS`: maximum concurrent app database connections, default `5`.
- `DATABASE_CONNECT_TIMEOUT_SECONDS`: wait time for a database connection, default `10`.
- `GEMINI_API_KEY`: optional Gemini credential for Ravenhood AI market automation and analyst briefings.
- `DEEPSEEK_API_KEY`: optional DeepSeek credential for Ravenhood AI market automation and provider failover.
- `DEEPSEEK_BASE_URL`: optional DeepSeek-compatible API base URL, default `https://api.deepseek.com`.
- `DEEPSEEK_MODEL`: optional DeepSeek market-automation model, default `deepseek-v4-flash`.
- `DESKTOP_INSTALLER_URL`: official Faircroft Windows installer URL returned only after an authenticated Beta Program access check.
- `OWNER_EMAIL`: owner bootstrap email.
- `OWNER_PASSWORD`: owner bootstrap password.
- `OWNER_NAME`: owner display name.
- `COOKIE_SECURE=1`: use once deployed behind HTTPS.
- `ARMA_BRIDGE_API_KEY`: shared secret used by the external `TBS RP LINKING SYSTEM` bridge when posting link requests/events and pulling snapshots.
- `ARMA_LINK_CODE_TTL_MINUTES`: optional expiration window for in-game link codes, default `30`.
- `ARMA_RCON_HOST`: public hostname or IPv4 address of the Arma Reforger server.
- `ARMA_RCON_PORT`: UDP RCON port, default `19999`.
- `ARMA_RCON_PASSWORD`: RCON password; configure only in Railway variables.
- `ARMA_RCON_TIMEOUT_SECONDS`: optional RCON response timeout, default `5`.
The Reforger server's `rcon.permission` must be `admin` for ban and unban
controls. If a command whitelist is configured, include the ban commands used
by the staff tools. The RCON UDP port must also be reachable from the deployed
website service.
- `SHADOWHAVEN_SFTP_HOST`: Shadowhaven SFTP hostname.
- `SHADOWHAVEN_SFTP_PORT`: Shadowhaven SFTP port, default `2022`.
- `SHADOWHAVEN_SFTP_USERNAME`: server-specific SFTP username.
- `SHADOWHAVEN_SFTP_PASSWORD`: SFTP password; configure only in Railway variables.
- `SHADOWHAVEN_BANK_FILE`: remote FCRPMUSSALO bank JSON path.
- `SHADOWHAVEN_BANK_SYNC_SECONDS`: polling interval, default `15` seconds.
- `SHADOWHAVEN_REPUTATION_FILE`: remote MedicalHud reputation JSON path.
- `SHADOWHAVEN_REPUTATION_SYNC_SECONDS`: reputation polling interval, default `30` seconds.
- `SHADOWHAVEN_CAMERA_EVENTS_FILE`: remote FLUCK Camera event JSON path.
- `SHADOWHAVEN_CAMERA_EVENTS_SYNC_SECONDS`: FLUCK polling interval, default `20` seconds.
- `SHADOWHAVEN_PERSISTENCE_ROOT`: remote FCRPMUSSALO database directory.
- `SHADOWHAVEN_PERSISTENCE_SYNC_SECONDS`: full persistence polling interval, default `120` seconds.
- `SHADOWHAVEN_PERSISTENCE_MAX_FILES`: maximum files indexed in one persistence pass, default `5000`.
- `SHADOWHAVEN_PERSISTENCE_MAX_FILE_BYTES`: maximum bytes read from one persistence file, default `524288`.
- `SHADOWHAVEN_PROPERTY_FILES`: comma-separated TBS Property Mod JSON paths. Existing files are merged; missing optional paths are skipped.
- `SHADOWHAVEN_PROPERTY_SYNC_SECONDS`: property polling interval, default `60` seconds.
- `SHADOWHAVEN_ANTICHEAT_DATABASE_FILE`: Thunder Buddies player database JSON path.
- `SHADOWHAVEN_ANTICHEAT_ALT_FILE`: Thunder Buddies alternate-account JSON path.
- `SHADOWHAVEN_ANTICHEAT_SYNC_SECONDS`: anti-cheat polling interval, default `30` seconds.
- `ARMA_A2S_HOST`: externally reachable A2S hostname or IP. Never use the server-side bind value `0.0.0.0` here.
- `ARMA_A2S_PORT`: external A2S query port, currently `17777`.
- `ARMA_GAME_HOST`: externally reachable game-server hostname or IP.
- `ARMA_GAME_PORT`: external game port, currently `27015`.

For the current Shadow Haven server, the public game address is
`216.219.91.158:27015`, A2S is `216.219.91.158:17777`, and RCON is
`216.219.91.158:19999`. Values such as `rcon.address=0.0.0.0` and
`a2s.address=0.0.0.0` are bind addresses inside the game server and must not be
used as Railway connection hosts. RCON also requires a non-empty password in
the server JSON that exactly matches `ARMA_RCON_PASSWORD` in Railway.

The Shadow Haven integration uses password-authenticated SFTP when
`SHADOWHAVEN_SFTP_PASSWORD` is configured. Do not set the private-key variables
unless the hosting account has explicitly been configured for SSH-key
authentication. The former `LOAFHOSTS_*` names are no longer read.
