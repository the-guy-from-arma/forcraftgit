# ThunderLink Three-Service Extraction Audit

Status: pre-cutover architecture baseline  
Canonical source: `forcraftgit` (CAD 1 / Faircroft)  
Production data action: **none**

## Executive finding

The current application is a single Python HTTP service and PWA that combines five authority domains:

1. Faircroft CAD and resident records.
2. Faircroft Arma identity linking, SFTP synchronization, and Bank Bridge commands.
3. Player-facing Ravenhood brokerage access.
4. FCX exchange state, pricing, orders, holdings, margin, and autonomous-market data.
5. FEC and global exchange administration.

`app.py` currently exposes 285 literal `/api/*` paths through one `RoleplayHandler`, defines 151 application tables, and contains 358 request-handler methods. The static PWA is also a single bundle. A direct file deletion or database switch would therefore break working cross-domain behavior. The extraction must use explicit service contracts before administrative code is removed from CAD 1.

## Existing runtime

| Concern | Current implementation |
|---|---|
| HTTP runtime | `http.server.ThreadingHTTPServer` in `app.py` |
| CAD database | `DATABASE_URL`, PostgreSQL through `psycopg` |
| FCX database boundary | `FCX_DATABASE_URL` is configured/probed, but most live Ravenhood/FEC operations still use the CAD process connection |
| Session authentication | Signed HttpOnly cookie plus PBKDF2 password hashes |
| Role authorization | Server-side role and Admin Tools section checks |
| CAD 2 runtime | `cad2_service.py` connection-boundary health service only; not yet the full CAD |
| FCX engine | `fcx_engine/` package and FastAPI service plus additional live exchange logic embedded in `app.py` |
| Arma bridge | API-key protected routes in CAD 1 plus `bank_bridge_commands` |
| Static client | One PWA bundle under `static/` |

## Authority boundaries

### CAD-owned

- `users`, sessions/legal acceptance, profiles, characters, presence, messages, jobs, referrals.
- CAD/MDT, ICE, CID, fire, court, citations, bookings, warrants, reports, BOLOs, panic alerts.
- DMV, properties/realty, community business records, taxes, insurance, lottery, casino, sportsbook, treasury, contracts.
- Community staff configuration and non-exchange Admin Tools.
- Community-specific Arma identity links, game bank snapshots, reputation, SFTP-derived records, server activity, and Bank Bridge command execution.

### FCX-owned

- Ravenhood brokerage accounts and cross-community identity mappings.
- Securities, companies/issuers as traded entities, index funds/members, prices, history, orders, executions, holdings, transfers, margin, leverage, market programs, system trades, promotions, and exchange settings.
- Autonomous engine state, investors, fundamentals, sectors, liquidity, events, risk flags, cycle logs, news, corporate actions, deployments, and engine audit records.
- FEC investigations, regulatory restrictions, halts, delistings, asset custody, IPO review, market-wide administration, connected-community controls, credentials, settlements, and FCX audit logs.

### Community-to-FCX contract

CAD 1 and CAD 2 may call FCX only with their own community credential. They never receive `FCX_DATABASE_URL`. FCX may request a bank authorization/debit/credit only through the selected community's authenticated settlement API. CAD 1 and CAD 2 never call one another.

## Protected Arma surface

These existing CAD routes remain community-owned and must retain backward-compatible payloads:

- `POST/GET /api/arma/link-requests`
- `GET /api/arma/snapshot`
- `POST /api/arma/events`
- `POST /api/arma/game-database/banks`
- `GET /api/arma/bank-commands`
- `POST /api/arma/bank-commands/{command_id}`
- Existing profile claim/unlink routes.

Each CAD deployment requires unique values for at least:

- `COMMUNITY_ID`
- `ARMA_SERVER_ID`
- `ARMA_BRIDGE_API_KEY`
- RCON host/port/password
- A2S host/port
- SFTP host/port/user/password/key and all server-specific paths
- `DATABASE_URL`
- `FCX_API_URL`, `FCX_COMMUNITY_ID`, `FCX_API_KEY`

No CAD 2 setting may inherit a CAD 1 server value as a silent fallback.

## Bank settlement contract

The authoritative game balance remains in the selected community. FCX records orchestration and brokerage state, not a replacement game-bank source of truth.

Required state machine:

`created -> bank_authorized -> bank_debited/credited -> order_executed -> settled`

Terminal/error states:

`rejected`, `bank_failed`, `execution_failed`, `compensation_pending`, `compensated`, `cancelled`.

Every operation requires:

- globally unique `fcx_transaction_id`;
- caller-supplied idempotency key;
- immutable community ID;
- immutable Bohemia/Ravenhood identity reference;
- amount, currency, operation, and reason;
- request and callback authentication;
- replay-safe response persistence;
- an audit entry for every state transition.

The community settlement service translates an accepted FCX request into the existing Bank Bridge command format. A repeated FCX transaction must return the original result and never enqueue a second debit or credit.

## Repository target

### Repository 1 — CAD 1 / Faircroft

Source: this repository. It retains all Faircroft and Arma behavior plus the player Ravenhood client adapter. FEC and global FCX administration are removed only after the standalone control service passes contract/regression tests.

### Repository 2 — CAD 2

Starts from the CAD core but has a new repository, database, community identity, Arma configuration, and FCX credential. It contains no FCX/FEC administrative server routes or UI.

### Repository 3 — FCX Control

Owns the FCX API/database and a standalone installable FEC/commissioner PWA. It supports an unbounded community registry rather than hardcoding two CADs.

## Duplication risk

Two independently deployable CAD repositories will initially duplicate the stable CAD core. That is the safest short-term extraction because it avoids a coordinated package release during cutover. The duplicated core should later be replaced by a versioned private `thunderlink-cad-core` package, but that packaging change is deliberately outside the initial production split.

## Cutover gates

No live cutover is authorized until all gates pass:

1. CAD 1 regression suite and Arma contract fixtures pass unchanged.
2. CAD 2 runs against only its own Postgres and Arma server.
3. FCX Control starts against only `FCX_DATABASE_URL`.
4. Player Ravenhood reads and mutations work through authenticated adapters from both CADs.
5. Community disable/buy/sell/account-creation controls affect only the target community.
6. Cross-community bank-settlement isolation and idempotency tests pass.
7. Existing FCX/FEC data migration is rehearsed and reconciled without changing production.
8. Rollback tags, database snapshots, environment-variable manifests, and exact Railway service references are recorded.

## Current verification baseline

- Python database library: `psycopg`.
- Automated baseline: `python -m unittest discover -s tests -q` — 130 tests passing.
- CAD 1 is the existing `forcraftgit` repository and remains the rollback source.
- No database rows, balances, holdings, prices, Arma links, or Railway deployments were changed by this audit.
