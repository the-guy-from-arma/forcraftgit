"""Faircroft resident issuer portal.

This module is deliberately isolated from the retired license registry and from
the Arma addon.  It only stages ordinary Bank Bridge commands and creates or
links Ravenhood securities through the Railway database.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import secrets
from typing import Any


MAX_CAPITALIZATION = 50_000_000_000.0
MIN_CONFIGURABLE_CAPITALIZATION = 1_000.0
DEFAULT_MIN_IPO_CAPITALIZATION = 3_000_000.0
BRIDGE_CHUNK_LIMIT = 10_000_000.0
MAX_COMPANIES_PER_RESIDENT = 8
MIN_PUBLIC_FLOAT_PERCENT = 5.0
DEFAULT_MAX_PUBLIC_FLOAT_PERCENT = 35.0
IPO_SECTORS = (
    "Technology",
    "Financial",
    "Industrial",
    "Consumer",
    "Energy",
    "Healthcare",
    "Real Estate",
    "Transportation",
    "Media",
    "General",
)
DEFAULT_SECTOR_COMPANY_LIMIT = 5
IPO_REVIEW_SLA_HOURS = 24


def _one(db: Any, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    return db.execute(sql, params).fetchone()


def _all(db: Any, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return list(db.execute(sql, params).fetchall())


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _ticker(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())[:8]


def _float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _utc_datetime(value: Any) -> dt.datetime:
    """Parse an application timestamp as an aware UTC datetime."""
    parsed = dt.datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _revenue_market_repricing(price: Any, issued_shares: Any, revenue: Any) -> dict[str, float]:
    """Return the quote and capitalization audit values for settled issuer revenue.

    Revenue is recognized only after the Bank Bridge debit completes.  The
    issued-share count stays fixed, so the quote moves by revenue per share and
    the resulting market capitalization remains reproducible from FCX data.
    """
    current_price = max(0.01, _float(price, 0.01))
    shares = max(0.0, _float(issued_shares))
    recognized = max(0.0, _float(revenue))
    before = round(current_price * shares, 2)
    if shares <= 0 or recognized <= 0:
        return {
            "price_before": round(current_price, 4),
            "price_after": round(current_price, 4),
            "market_cap_before": before,
            "market_cap_after": before,
            "market_cap_change": 0.0,
        }
    next_price = max(0.01, round(current_price + (recognized / shares), 4))
    after = round(next_price * shares, 2)
    return {
        "price_before": round(current_price, 4),
        "price_after": next_price,
        "market_cap_before": before,
        "market_cap_after": after,
        "market_cap_change": round(after - before, 2),
    }


def _canonical_sector(value: Any) -> str:
    requested = _text(value or "General", 60).casefold()
    return next((sector for sector in IPO_SECTORS if sector.casefold() == requested), "")


def _sector_limits(value: Any) -> dict[str, int]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            value = {}
    source = value if isinstance(value, dict) else {}
    limits: dict[str, int] = {}
    for sector in IPO_SECTORS:
        try:
            raw = int(source.get(sector, DEFAULT_SECTOR_COMPANY_LIMIT))
        except (TypeError, ValueError):
            raw = DEFAULT_SECTOR_COMPANY_LIMIT
        limits[sector] = max(0, min(100, raw))
    return limits


def ipo_guardrails(db: Any) -> dict[str, Any]:
    rows = _all(db, """SELECT setting_key,setting_value FROM system_settings
        WHERE setting_key IN ('business_ipo_min_capitalization','business_ipo_max_public_float_percent','business_ipo_sector_limits')""")
    settings = {str(row["setting_key"]): row.get("setting_value") for row in rows}
    min_capitalization = max(
        MIN_CONFIGURABLE_CAPITALIZATION,
        min(MAX_CAPITALIZATION, _float(settings.get("business_ipo_min_capitalization"), DEFAULT_MIN_IPO_CAPITALIZATION)),
    )
    max_public_float = max(
        MIN_PUBLIC_FLOAT_PERCENT,
        min(100.0, _float(settings.get("business_ipo_max_public_float_percent"), DEFAULT_MAX_PUBLIC_FLOAT_PERCENT)),
    )
    limits = _sector_limits(settings.get("business_ipo_sector_limits"))
    counts = {sector: 0 for sector in IPO_SECTORS}
    for row in _all(db, """SELECT sector,COUNT(*) AS total FROM business_issuer_companies
        WHERE control_source='new_ipo' AND status NOT IN ('bankrupt','bankruptcy_filed','cancelled','rejected')
        GROUP BY sector"""):
        sector = _canonical_sector(row.get("sector"))
        if sector:
            counts[sector] = int(row.get("total") or 0)
    sectors = [
        {
            "sector": sector,
            "limit": limits[sector],
            "count": counts[sector],
            "remaining": max(0, limits[sector] - counts[sector]),
            "closed": counts[sector] >= limits[sector],
        }
        for sector in IPO_SECTORS
    ]
    return {
        "min_capitalization": round(min_capitalization, 2),
        "min_public_float_percent": MIN_PUBLIC_FLOAT_PERCENT,
        "max_public_float_percent": round(max_public_float, 2),
        "sector_limits": limits,
        "sector_counts": counts,
        "sectors": sectors,
    }


def update_ipo_guardrails(db: Any, payload: dict[str, Any], now: str) -> dict[str, Any]:
    current = ipo_guardrails(db)
    min_capitalization = round(_float(payload.get("min_capitalization"), current["min_capitalization"]), 2)
    if not MIN_CONFIGURABLE_CAPITALIZATION <= min_capitalization <= MAX_CAPITALIZATION:
        raise ValueError(
            f"Minimum IPO capitalization must be between ${MIN_CONFIGURABLE_CAPITALIZATION:,.0f} "
            f"and ${MAX_CAPITALIZATION:,.0f}"
        )
    max_public_float = round(_float(payload.get("max_public_float_percent"), DEFAULT_MAX_PUBLIC_FLOAT_PERCENT), 2)
    if not MIN_PUBLIC_FLOAT_PERCENT <= max_public_float <= 100:
        raise ValueError("Maximum IPO public float must be between 5% and 100%")
    requested_limits = payload.get("sector_limits")
    if not isinstance(requested_limits, dict):
        raise ValueError("Provide a company limit for every IPO sector")
    limits = _sector_limits(requested_limits)
    for key, value in (
        ("business_ipo_min_capitalization", f"{min_capitalization:.2f}"),
        ("business_ipo_max_public_float_percent", f"{max_public_float:.2f}"),
        ("business_ipo_sector_limits", json.dumps(limits, separators=(",", ":"))),
    ):
        db.execute("""INSERT INTO system_settings (setting_key,setting_value,updated_at) VALUES (?,?,?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at""",
            (key, value, now))
    return ipo_guardrails(db)


def _public_company(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    for key in (
        "target_market_cap", "opening_share_price", "authorized_shares",
        "public_float_percent", "founder_shares", "issuer_inventory",
        "paid_in_capital", "treasury_balance", "live_price", "issued_shares",
        "live_market_cap", "funding_total", "funding_completed",
    ):
        if key in item and item[key] is not None:
            item[key] = round(float(item[key]), 6 if "shares" in key or key == "authorized_shares" else 2)
    for key in ("security_active",):
        if key in item:
            item[key] = bool(item[key])
    return item


def ensure_schema(db: Any, now: str) -> None:
    """Create the additive issuer schema and snapshot the retired registry."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_companies (
            id SERIAL PRIMARY KEY,
            company_number TEXT NOT NULL UNIQUE,
            security_id INTEGER UNIQUE,
            controlling_user_id INTEGER,
            created_by INTEGER,
            assigned_by INTEGER,
            control_source TEXT NOT NULL DEFAULT 'new_ipo',
            status TEXT NOT NULL DEFAULT 'draft',
            company_name TEXT NOT NULL,
            ticker TEXT NOT NULL UNIQUE,
            sector TEXT NOT NULL DEFAULT 'General',
            headquarters TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            target_market_cap NUMERIC(20,2) NOT NULL DEFAULT 0,
            opening_share_price NUMERIC(20,4) NOT NULL DEFAULT 0,
            authorized_shares NUMERIC(20,6) NOT NULL DEFAULT 0,
            public_float_percent NUMERIC(6,2) NOT NULL DEFAULT 25,
            founder_shares NUMERIC(20,6) NOT NULL DEFAULT 0,
            issuer_inventory NUMERIC(20,6) NOT NULL DEFAULT 0,
            paid_in_capital NUMERIC(20,2) NOT NULL DEFAULT 0,
            treasury_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
            scheduled_at TEXT,
            activated_at TEXT,
            bankruptcy_reason TEXT NOT NULL DEFAULT '',
            bankruptcy_filed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (security_id) REFERENCES market_securities(id) ON DELETE SET NULL,
            FOREIGN KEY (controlling_user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_owner_idx ON business_issuer_companies (controlling_user_id,status,updated_at)")
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_status_idx ON business_issuer_companies (status,scheduled_at)")
    # Existing live issuers predate FEC admission review and remain approved.
    db.execute("ALTER TABLE business_issuer_companies ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'")
    db.execute("ALTER TABLE business_issuer_companies ADD COLUMN IF NOT EXISTS submitted_at TEXT")
    db.execute("ALTER TABLE business_issuer_companies ADD COLUMN IF NOT EXISTS reviewed_at TEXT")
    db.execute("ALTER TABLE business_issuer_companies ADD COLUMN IF NOT EXISTS reviewed_by INTEGER")
    db.execute("ALTER TABLE business_issuer_companies ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''")
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_review_idx ON business_issuer_companies (review_status,submitted_at)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_ipo_reviews (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            applicant_user_id INTEGER,
            status TEXT NOT NULL,
            decision_note TEXT NOT NULL DEFAULT '',
            reviewed_by INTEGER,
            submitted_at TEXT NOT NULL,
            reviewed_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (applicant_user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_ipo_review_status_idx ON business_issuer_ipo_reviews (status,submitted_at DESC)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_funding_batches (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'initial_capitalization',
            total_amount NUMERIC(20,2) NOT NULL,
            completed_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
            current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
            chunk_count INTEGER NOT NULL DEFAULT 1,
            next_sequence INTEGER NOT NULL DEFAULT 1,
            current_command_id TEXT,
            status TEXT NOT NULL DEFAULT 'staged',
            failure_reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_funding_company_idx ON business_issuer_funding_batches (company_id,status,created_at)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS business_funding_command_idx ON business_issuer_funding_batches (current_command_id) WHERE current_command_id IS NOT NULL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_funding_chunks (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER NOT NULL,
            sequence_number INTEGER NOT NULL,
            command_id TEXT NOT NULL UNIQUE,
            amount NUMERIC(14,2) NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (batch_id,sequence_number),
            FOREIGN KEY (batch_id) REFERENCES business_issuer_funding_batches(id) ON DELETE CASCADE
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_ledger (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            user_id INTEGER,
            entry_type TEXT NOT NULL,
            direction TEXT NOT NULL,
            amount NUMERIC(20,2) NOT NULL DEFAULT 0,
            description TEXT NOT NULL DEFAULT '',
            bank_command_id TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_ledger_company_idx ON business_issuer_ledger (company_id,created_at DESC)")
    db.execute("ALTER TABLE business_issuer_ledger ADD COLUMN IF NOT EXISTS funding_batch_id INTEGER")
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_ledger_batch_idx ON business_issuer_ledger (funding_batch_id)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_market_cap_history (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            ledger_id INTEGER,
            event_type TEXT NOT NULL,
            source_reference TEXT NOT NULL DEFAULT '',
            amount NUMERIC(20,2) NOT NULL DEFAULT 0,
            price_before NUMERIC(20,4) NOT NULL DEFAULT 0,
            price_after NUMERIC(20,4) NOT NULL DEFAULT 0,
            market_cap_before NUMERIC(20,2) NOT NULL DEFAULT 0,
            market_cap_after NUMERIC(20,2) NOT NULL DEFAULT 0,
            issued_shares NUMERIC(20,6) NOT NULL DEFAULT 0,
            details_json TEXT NOT NULL DEFAULT '{}',
            occurred_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (ledger_id) REFERENCES business_issuer_ledger(id) ON DELETE SET NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_cap_history_company_idx ON business_issuer_market_cap_history (company_id,occurred_at DESC,id DESC)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_announcements (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            created_by INTEGER,
            announcement_type TEXT NOT NULL DEFAULT 'company_update',
            headline TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'published',
            scheduled_at TEXT,
            published_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS business_issuer_news_idx ON business_issuer_announcements (status,published_at DESC,created_at DESC)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_issuer_assignments (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL,
            security_id INTEGER,
            user_id INTEGER,
            action TEXT NOT NULL,
            actor_id INTEGER,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES business_issuer_companies(id) ON DELETE CASCADE,
            FOREIGN KEY (security_id) REFERENCES market_securities(id) ON DELETE SET NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS business_legacy_archive (
            id SERIAL PRIMARY KEY,
            source_table TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            owner_name TEXT NOT NULL DEFAULT '',
            owner_email TEXT NOT NULL DEFAULT '',
            business_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}',
            archived_at TEXT NOT NULL,
            UNIQUE (source_table,source_id)
        )
    """)
    # A no-FK snapshot preserves history while the old resident licensing UI is retired.
    db.execute("""
        INSERT INTO business_legacy_archive
            (source_table,source_id,owner_name,owner_email,business_name,status,payload_json,archived_at)
        SELECT 'business_applications',a.id,COALESCE(u.name,a.owner_name,''),COALESCE(u.email,''),
               a.business_name,a.status,row_to_json(a)::text,?
        FROM business_applications a LEFT JOIN users u ON u.id=a.applicant_id
        ON CONFLICT(source_table,source_id) DO NOTHING
    """, (now,))
    db.execute("""
        INSERT INTO business_legacy_archive
            (source_table,source_id,owner_name,owner_email,business_name,status,payload_json,archived_at)
        SELECT 'businesses',b.id,COALESCE(u.name,''),COALESCE(u.email,''),b.business_name,b.status,
               row_to_json(b)::text,?
        FROM businesses b LEFT JOIN users u ON u.id=b.owner_id
        ON CONFLICT(source_table,source_id) DO NOTHING
    """, (now,))


def _queue_next_funding_command(db: Any, batch_id: int, now: str) -> dict[str, Any]:
    batch = _one(db, """SELECT b.*,c.ticker,c.company_name,l.identity_id
        FROM business_issuer_funding_batches b
        JOIN business_issuer_companies c ON c.id=b.company_id
        LEFT JOIN arma_account_links l ON l.user_id=b.user_id
        WHERE b.id=? FOR UPDATE OF b""", (batch_id,))
    if not batch:
        raise ValueError("Funding batch was not found")
    if not batch.get("identity_id"):
        raise ValueError("Link an Arma account before capitalizing a company")
    completed = float(batch.get("completed_amount") or 0)
    total = float(batch.get("total_amount") or 0)
    remaining = round(total - completed, 2)
    if remaining <= 0:
        return {"status": "funded"}
    sequence = int(batch.get("next_sequence") or 1)
    amount = min(BRIDGE_CHUNK_LIMIT, remaining)
    command_id = f"fc-issuer-{int(batch_id)}-{sequence}-{secrets.token_urlsafe(8)}"
    purpose_label = "IPO capitalization" if batch["purpose"] == "initial_capitalization" else "issuer treasury contribution"
    reason = f"{purpose_label} {batch['ticker']} {sequence}/{int(batch['chunk_count'])}"
    db.execute("""INSERT INTO bank_bridge_commands
        (command_id,idempotency_key,server_id,operation,target_user_id,identity_id,amount,currency,reason,status,requested_by,created_at)
        VALUES (?,?, 'default','debit_funds',?,?,?,'bank',?,'pending',?,?)""",
        (command_id, f"issuer-{batch_id}-{sequence}", batch["user_id"], batch["identity_id"], amount,
         reason, batch["user_id"], now))
    db.execute("""INSERT INTO business_issuer_funding_chunks
        (batch_id,sequence_number,command_id,amount,status,created_at)
        VALUES (?,?,?,?, 'pending',?)""", (batch_id, sequence, command_id, amount, now))
    db.execute("""UPDATE business_issuer_funding_batches
        SET current_command_id=?,current_amount=?,status='pending',next_sequence=?,failure_reason='',updated_at=? WHERE id=?""",
        (command_id, amount, sequence + 1, now, batch_id))
    return {"status": "pending", "command_id": command_id, "amount": amount, "sequence": sequence}


def _activate_company(db: Any, company_id: int, now: str) -> None:
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? FOR UPDATE", (company_id,))
    if not company or company.get("security_id"):
        return
    scheduled = str(company.get("scheduled_at") or "")
    is_live = not scheduled or scheduled <= now
    security = _one(db, """INSERT INTO market_securities
        (ticker,name,security_type,sector,description,price,previous_price,volatility,active,lifecycle_status,issued_shares,index_eligible,updated_at)
        VALUES (?,?, 'stock',?,?,?, ?,1.25,?,?,?,1,?) RETURNING id""",
        (company["ticker"], company["company_name"], company["sector"], company["description"],
         company["opening_share_price"], company["opening_share_price"], 1 if is_live else 0,
         "active" if is_live else "upcoming", company["authorized_shares"], now))
    security_id = int(security["id"])
    db.execute("INSERT INTO market_price_history (security_id,price,source,recorded_at) VALUES (?,?, 'resident_ipo',?)",
               (security_id, company["opening_share_price"], now))
    db.execute("""INSERT INTO market_events (event_type,title,detail,created_by,created_at)
        VALUES ('resident_ipo',?,?,?,?)""",
        (f"Resident IPO: {company['ticker']}", f"{company['company_name']} completed capitalization and entered the FCX issuer calendar.", company["controlling_user_id"], now))
    founder_shares = float(company.get("founder_shares") or 0)
    if founder_shares > 0 and company.get("controlling_user_id"):
        db.execute("""INSERT INTO market_accounts (user_id,cash_balance,status,created_at,updated_at)
            VALUES (?,0,'active',?,?) ON CONFLICT(user_id) DO NOTHING""", (company["controlling_user_id"], now, now))
        account = _one(db, "SELECT id FROM market_accounts WHERE user_id=?", (company["controlling_user_id"],))
        if account:
            db.execute("""INSERT INTO market_holdings (account_id,security_id,quantity,average_cost)
                VALUES (?,?,?,?) ON CONFLICT(account_id,security_id) DO UPDATE
                SET quantity=market_holdings.quantity+excluded.quantity""",
                (account["id"], security_id, founder_shares, company["opening_share_price"]))
    next_status = "active" if is_live else "scheduled"
    db.execute("""UPDATE business_issuer_companies SET security_id=?,status=?,paid_in_capital=target_market_cap,
        treasury_balance=treasury_balance+target_market_cap,activated_at=?,updated_at=? WHERE id=?""",
        (security_id, next_status, now if is_live else None, now, company_id))
    ledger = _one(db, """UPDATE business_issuer_ledger SET status='completed'
        WHERE company_id=? AND entry_type='initial_capitalization' AND status='pending'
        RETURNING id""", (company_id,))
    opening_cap = round(float(company.get("opening_share_price") or 0) * float(company.get("authorized_shares") or 0), 2)
    db.execute("""INSERT INTO business_issuer_market_cap_history
        (company_id,ledger_id,event_type,source_reference,amount,price_before,price_after,
         market_cap_before,market_cap_after,issued_shares,details_json,occurred_at)
        VALUES (?,?, 'ipo_activation','resident_ipo',?,0,?,?,?,?,'{}',?)""",
        (company_id, (ledger or {}).get("id"), company.get("target_market_cap") or opening_cap,
         company.get("opening_share_price") or 0, 0, opening_cap, company.get("authorized_shares") or 0, now))


def activate_due_ipos(db: Any, now: str) -> int:
    rows = _all(db, """SELECT id,security_id FROM business_issuer_companies
        WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=?""", (now,))
    for row in rows:
        if row.get("security_id"):
            db.execute("UPDATE market_securities SET active=1,lifecycle_status='active',updated_at=? WHERE id=?",
                       (now, row["security_id"]))
            db.execute("UPDATE business_issuer_companies SET status='active',activated_at=?,updated_at=? WHERE id=?",
                       (now, now, row["id"]))
    db.execute("""UPDATE business_issuer_announcements
        SET status='published',published_at=?,updated_at=?
        WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=?""", (now, now, now))
    return len(rows)


def create_ipo(db: Any, user_id: int, payload: dict[str, Any], now: str) -> dict[str, Any]:
    name = _text(payload.get("company_name"), 100)
    ticker = _ticker(payload.get("ticker"))
    sector = _canonical_sector(payload.get("sector") or "General")
    headquarters = _text(payload.get("headquarters"), 140)
    description = _text(payload.get("description"), 1200)
    market_cap = round(_float(payload.get("target_market_cap")), 2)
    share_price = round(_float(payload.get("opening_share_price")), 4)
    public_float = round(_float(payload.get("public_float_percent"), 25), 2)
    scheduled_at = _text(payload.get("scheduled_at"), 40) or None
    try:
        submitted_time = _utc_datetime(now)
    except ValueError:
        submitted_time = dt.datetime.now(dt.timezone.utc)
    if scheduled_at:
        try:
            release_time = _utc_datetime(scheduled_at)
        except ValueError as exc:
            raise ValueError("Choose a valid IPO release date and time") from exc
        earliest_release = submitted_time + dt.timedelta(hours=IPO_REVIEW_SLA_HOURS)
        if release_time < earliest_release:
            raise ValueError("Scheduled IPO releases must be at least 24 hours after the filing is submitted for FEC review")
        scheduled_at = release_time.isoformat()
    if len(name) < 3 or len(description) < 40:
        raise ValueError("Enter a company name and a detailed operating description of at least 40 characters")
    if len(ticker) < 2:
        raise ValueError("Ticker must contain 2 to 8 letters or numbers")
    if not sector:
        raise ValueError("Choose an approved FCX industry sector")
    if not 0.01 <= share_price <= 1_000_000:
        raise ValueError("Opening share price must be between $0.01 and $1,000,000")
    db.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (f"business-ipo-sector:{sector.casefold()}",))
    guardrails = ipo_guardrails(db)
    min_capitalization = float(guardrails["min_capitalization"])
    if not min_capitalization <= market_cap <= MAX_CAPITALIZATION:
        raise ValueError(
            f"Initial market capitalization must be between ${min_capitalization:,.2f} "
            f"and ${MAX_CAPITALIZATION:,.0f}"
        )
    max_public_float = float(guardrails["max_public_float_percent"])
    if not MIN_PUBLIC_FLOAT_PERCENT <= public_float <= max_public_float:
        raise ValueError(f"Public float must be between {MIN_PUBLIC_FLOAT_PERCENT:.0f}% and the FCX limit of {max_public_float:g}%")
    sector_policy = next(item for item in guardrails["sectors"] if item["sector"] == sector)
    if bool(sector_policy["closed"]):
        raise ValueError(
            f"The {sector} IPO sector is at its developer-set limit of {int(sector_policy['limit'])} "
            "active resident issuer files"
        )
    if _one(db, "SELECT id FROM market_securities WHERE ticker=?", (ticker,)) or _one(db, "SELECT id FROM business_issuer_companies WHERE ticker=?", (ticker,)):
        raise ValueError("That FCX ticker is already in use")
    owned = _one(db, "SELECT COUNT(*) AS total FROM business_issuer_companies WHERE controlling_user_id=? AND status NOT IN ('bankrupt','cancelled','rejected')", (user_id,))
    if int((owned or {}).get("total") or 0) >= MAX_COMPANIES_PER_RESIDENT:
        raise ValueError(f"A resident may control up to {MAX_COMPANIES_PER_RESIDENT} active issuer files")
    link = _one(db, """SELECT l.identity_id,b.balance,b.synced_at FROM arma_account_links l
        LEFT JOIN arma_game_bank_balances b ON b.identity_id=l.identity_id WHERE l.user_id=?""", (user_id,))
    if not link or not link.get("identity_id"):
        raise ValueError("Link your Arma account before capitalizing an IPO")
    if link.get("balance") is None:
        raise ValueError("Your in-game bank snapshot has not synchronized yet")
    reserved = _one(db, """SELECT COALESCE(SUM(b.total_amount-b.completed_amount),0) AS total
        FROM business_issuer_funding_batches b
        WHERE b.user_id=? AND b.status IN ('awaiting_approval','staged','pending','failed')""", (user_id,))
    if float(link.get("balance") or 0) - float((reserved or {}).get("total") or 0) + 0.0001 < market_cap:
        raise ValueError("The synchronized in-game balance does not cover this capitalization")
    shares = round(market_cap / share_price, 6)
    founder = round(shares * (100 - public_float) / 100, 6)
    inventory = round(shares - founder, 6)
    company_number = f"FCI-{dt.datetime.fromisoformat(now).strftime('%y%m')}-{secrets.randbelow(900000)+100000}"
    company = _one(db, """INSERT INTO business_issuer_companies
        (company_number,controlling_user_id,created_by,control_source,status,company_name,ticker,sector,headquarters,
         description,target_market_cap,opening_share_price,authorized_shares,public_float_percent,founder_shares,
         issuer_inventory,scheduled_at,review_status,submitted_at,created_at,updated_at)
        VALUES (?,?,?,'new_ipo','pending_fec_review',?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?) RETURNING *""",
        (company_number, user_id, user_id, name, ticker, sector, headquarters, description, market_cap, share_price,
         shares, public_float, founder, inventory, scheduled_at, now, now, now))
    chunks = max(1, int(math.ceil(market_cap / BRIDGE_CHUNK_LIMIT)))
    batch = _one(db, """INSERT INTO business_issuer_funding_batches
        (company_id,user_id,purpose,total_amount,chunk_count,status,created_at,updated_at)
        VALUES (?,?,'initial_capitalization',?,?,'awaiting_approval',?,?) RETURNING id""",
        (company["id"], user_id, market_cap, chunks, now, now))
    db.execute("""INSERT INTO business_issuer_ledger
        (company_id,user_id,funding_batch_id,entry_type,direction,amount,description,status,created_at)
        VALUES (?,?,?,'initial_capitalization','inflow',?,'Founder capitalization pending FEC approval','awaiting_approval',?)""",
        (company["id"], user_id, batch["id"], market_cap, now))
    db.execute("""INSERT INTO business_issuer_ipo_reviews
        (company_id,applicant_user_id,status,submitted_at,created_at)
        VALUES (?,?,'pending',?,?)""", (company["id"], user_id, now, now))
    return {
        "company": _public_company(company),
        "funding": {"status": "awaiting_fec_approval"},
        "chunk_count": chunks,
        "review": {
            "status": "pending",
            "submitted_at": now,
            "review_due_at": (submitted_time + dt.timedelta(hours=IPO_REVIEW_SLA_HOURS)).isoformat(),
            "message": "Your IPO filing was sent to FEC Investigations. An approval decision is expected within 24 hours. No funds will be withdrawn before approval.",
        },
    }


def review_ipo(db: Any, actor_id: int, company_id: int, payload: dict[str, Any], now: str) -> dict[str, Any]:
    """Approve or reject a resident IPO before any Bank Bridge debit is created."""
    action = _text(payload.get("action"), 20).lower()
    note = _text(payload.get("note"), 1000)
    confirmation = _text(payload.get("confirmation"), 20).upper()
    if action not in ("approve", "reject"):
        raise ValueError("Choose approve or reject for this IPO filing")
    if confirmation != action.upper():
        raise ValueError(f"Type {action.upper()} to authorize this FEC decision")
    if len(note) < 10:
        raise ValueError("Document the FEC decision in at least 10 characters")
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? FOR UPDATE", (company_id,))
    if not company:
        raise ValueError("IPO filing was not found")
    if str(company.get("review_status") or "") != "pending" or company.get("status") != "pending_fec_review":
        raise ValueError("This IPO filing no longer awaits an FEC decision")
    batch = _one(db, """SELECT * FROM business_issuer_funding_batches
        WHERE company_id=? AND purpose='initial_capitalization' ORDER BY id DESC LIMIT 1 FOR UPDATE""", (company_id,))
    if not batch or batch.get("status") != "awaiting_approval":
        raise ValueError("The IPO capitalization reservation is unavailable")
    next_status = "approved" if action == "approve" else "rejected"
    db.execute("""UPDATE business_issuer_companies
        SET review_status=?,reviewed_at=?,reviewed_by=?,review_note=?,status=?,updated_at=? WHERE id=?""",
        (next_status, now, actor_id, note, "funding_pending" if action == "approve" else "rejected", now, company_id))
    db.execute("""UPDATE business_issuer_ipo_reviews
        SET status=?,decision_note=?,reviewed_by=?,reviewed_at=?
        WHERE company_id=? AND status='pending'""", (next_status, note, actor_id, now, company_id))
    if action == "reject":
        db.execute("UPDATE business_issuer_funding_batches SET status='cancelled',failure_reason=?,updated_at=? WHERE id=?",
                   (f"FEC rejected IPO filing: {note}", now, batch["id"]))
        db.execute("UPDATE business_issuer_ledger SET status='cancelled',description=? WHERE funding_batch_id=?",
                   (f"IPO filing rejected by FEC: {note}", batch["id"]))
        return {"company_id": company_id, "ticker": company["ticker"], "status": "rejected", "note": note}
    db.execute("UPDATE business_issuer_funding_batches SET status='staged',failure_reason='',updated_at=? WHERE id=?",
               (now, batch["id"]))
    db.execute("UPDATE business_issuer_ledger SET status='pending',description='Founder capitalization through the in-game Bank Bridge' WHERE funding_batch_id=?",
               (batch["id"],))
    funding = _queue_next_funding_command(db, int(batch["id"]), now)
    return {"company_id": company_id, "ticker": company["ticker"], "status": "approved", "note": note, "funding": funding}


def fec_review_payload(db: Any, now: str) -> dict[str, Any]:
    pending = [dict(row) for row in _all(db, """SELECT c.*,u.name AS applicant_name,u.email AS applicant_email,u.civ_number,
            b.total_amount AS reserved_capitalization,b.chunk_count
        FROM business_issuer_companies c
        LEFT JOIN users u ON u.id=c.controlling_user_id
        LEFT JOIN LATERAL (SELECT * FROM business_issuer_funding_batches x WHERE x.company_id=c.id ORDER BY x.id DESC LIMIT 1) b ON TRUE
        WHERE c.review_status='pending' AND c.status='pending_fec_review'
        ORDER BY c.submitted_at,c.id""")]
    history = [dict(row) for row in _all(db, """SELECT r.*,c.ticker,c.company_name,c.target_market_cap,
            applicant.name AS applicant_name,reviewer.name AS reviewer_name
        FROM business_issuer_ipo_reviews r JOIN business_issuer_companies c ON c.id=r.company_id
        LEFT JOIN users applicant ON applicant.id=r.applicant_user_id
        LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by
        WHERE r.status<>'pending' ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 200""")]
    for item in pending:
        try:
            item["review_due_at"] = (_utc_datetime(item.get("submitted_at") or now) + dt.timedelta(hours=IPO_REVIEW_SLA_HOURS)).isoformat()
        except ValueError:
            item["review_due_at"] = None
    return {"pending": pending, "history": history, "sla_hours": IPO_REVIEW_SLA_HOURS}


def contribute(db: Any, user_id: int, company_id: int, payload: dict[str, Any], now: str) -> dict[str, Any]:
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? AND controlling_user_id=? FOR UPDATE", (company_id, user_id))
    if not company or company["status"] not in ("active", "scheduled"):
        raise ValueError("Only an active company controller may add issuer revenue")
    amount = round(_float(payload.get("amount")), 2)
    if amount < 1 or amount > BRIDGE_CHUNK_LIMIT:
        raise ValueError(f"Each treasury contribution must be between $1 and ${BRIDGE_CHUNK_LIMIT:,.0f}")
    batch = _one(db, """INSERT INTO business_issuer_funding_batches
        (company_id,user_id,purpose,total_amount,chunk_count,status,created_at,updated_at)
        VALUES (?,?,'treasury_contribution',?,1,'staged',?,?) RETURNING id""",
        (company_id, user_id, amount, now, now))
    db.execute("""INSERT INTO business_issuer_ledger
        (company_id,user_id,funding_batch_id,entry_type,direction,amount,description,status,created_at)
        VALUES (?,?,?,'treasury_contribution','inflow',?,'Reported controller revenue','pending',?)""",
        (company_id, user_id, batch["id"], amount, now))
    return _queue_next_funding_command(db, int(batch["id"]), now)


def retry_funding(db: Any, user_id: int, company_id: int, now: str, *, developer: bool = False) -> dict[str, Any]:
    clause = "" if developer else " AND user_id=?"
    params: tuple[Any, ...] = (company_id,) if developer else (company_id, user_id)
    batch = _one(db, f"""SELECT * FROM business_issuer_funding_batches WHERE company_id=?{clause}
        AND status='failed' ORDER BY id DESC LIMIT 1 FOR UPDATE""", params)
    if not batch:
        raise ValueError("No failed funding command is available to retry")
    db.execute("UPDATE business_issuer_funding_batches SET status='staged',current_command_id=NULL,current_amount=0,failure_reason='',updated_at=? WHERE id=?", (now, batch["id"]))
    db.execute("UPDATE business_issuer_ledger SET status='pending' WHERE funding_batch_id=? AND status='failed'", (batch["id"],))
    db.execute("UPDATE business_issuer_companies SET status=CASE WHEN status='funding_failed' THEN 'funding_pending' ELSE status END,updated_at=? WHERE id=?", (now, company_id))
    return _queue_next_funding_command(db, int(batch["id"]), now)


def handle_bank_result(db: Any, command_id: str, status: str, result: dict[str, Any], now: str) -> dict[str, Any] | None:
    batch = _one(db, "SELECT * FROM business_issuer_funding_batches WHERE current_command_id=? FOR UPDATE", (command_id,))
    if not batch:
        return None
    chunk_status = "pending" if status == "retry" else status
    db.execute("UPDATE business_issuer_funding_chunks SET status=?,result_json=?,completed_at=? WHERE command_id=?",
               (chunk_status, json.dumps(result, separators=(",", ":"), default=str)[:4000], now if chunk_status in ("completed", "failed") else None, command_id))
    if status == "retry":
        return {"company_id": int(batch["company_id"]), "status": "pending"}
    if status == "failed":
        failure = _text(result.get("message") or result.get("error") or "Bank Bridge rejected this capitalization command", 500)
        db.execute("UPDATE business_issuer_funding_batches SET status='failed',failure_reason=?,updated_at=? WHERE id=?", (failure, now, batch["id"]))
        if batch["purpose"] == "initial_capitalization":
            db.execute("UPDATE business_issuer_companies SET status='funding_failed',updated_at=? WHERE id=?", (now, batch["company_id"]))
        db.execute("UPDATE business_issuer_ledger SET status='failed' WHERE funding_batch_id=? AND status='pending'",
                   (batch["id"],))
        return {"company_id": int(batch["company_id"]), "status": "failed", "reason": failure}
    completed = round(float(batch.get("completed_amount") or 0) + float(batch.get("current_amount") or 0), 2)
    db.execute("UPDATE business_issuer_funding_batches SET completed_amount=?,current_command_id=NULL,current_amount=0,updated_at=? WHERE id=?",
               (completed, now, batch["id"]))
    if completed + 0.001 < float(batch["total_amount"]):
        return {"company_id": int(batch["company_id"]), **_queue_next_funding_command(db, int(batch["id"]), now)}
    db.execute("UPDATE business_issuer_funding_batches SET status='completed',completed_at=?,updated_at=? WHERE id=?", (now, now, batch["id"]))
    if batch["purpose"] == "initial_capitalization":
        _activate_company(db, int(batch["company_id"]), now)
    else:
        company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? FOR UPDATE", (batch["company_id"],))
        security = _one(db, "SELECT * FROM market_securities WHERE id=? FOR UPDATE", ((company or {}).get("security_id"),)) if company and company.get("security_id") else None
        repricing = _revenue_market_repricing(
            (security or {}).get("price"),
            (security or {}).get("issued_shares") or (company or {}).get("authorized_shares"),
            batch["total_amount"],
        )
        if security:
            db.execute("UPDATE market_securities SET previous_price=price,price=?,updated_at=? WHERE id=?",
                       (repricing["price_after"], now, security["id"]))
            db.execute("INSERT INTO market_price_history (security_id,price,source,recorded_at) VALUES (?,?,'issuer_revenue',?)",
                       (security["id"], repricing["price_after"], now))
        db.execute("UPDATE business_issuer_companies SET paid_in_capital=paid_in_capital+?,treasury_balance=treasury_balance+?,updated_at=? WHERE id=?",
                   (batch["total_amount"], batch["total_amount"], now, batch["company_id"]))
        ledger = _one(db, """UPDATE business_issuer_ledger SET status='completed'
            WHERE funding_batch_id=? AND entry_type='treasury_contribution' AND status='pending'
            RETURNING id""", (batch["id"],))
        db.execute("""INSERT INTO business_issuer_market_cap_history
            (company_id,ledger_id,event_type,source_reference,amount,price_before,price_after,
             market_cap_before,market_cap_after,issued_shares,details_json,occurred_at)
            VALUES (?,?, 'reported_revenue',?,?,?,?,?,?,?,?,?)""",
            (batch["company_id"], (ledger or {}).get("id"), command_id, batch["total_amount"],
             repricing["price_before"], repricing["price_after"], repricing["market_cap_before"],
             repricing["market_cap_after"], (security or {}).get("issued_shares") or (company or {}).get("authorized_shares") or 0,
             json.dumps({"market_cap_change": repricing["market_cap_change"], "funding_batch_id": int(batch["id"])}, separators=(",", ":")), now))
    return {"company_id": int(batch["company_id"]), "status": "completed"}


def publish_announcement(db: Any, user_id: int, company_id: int, payload: dict[str, Any], now: str) -> dict[str, Any]:
    company = _one(db, "SELECT id,ticker,status FROM business_issuer_companies WHERE id=? AND controlling_user_id=?", (company_id, user_id))
    if not company or company["status"] not in ("active", "scheduled"):
        raise ValueError("Only the verified controller of an active issuer may publish Company Wire updates")
    headline = _text(payload.get("headline"), 140)
    body = _text(payload.get("body"), 1600)
    announcement_type = _text(payload.get("announcement_type") or "company_update", 40).lower()
    scheduled_at = _text(payload.get("scheduled_at"), 40) or None
    if len(headline) < 5 or len(body) < 20:
        raise ValueError("Add a clear headline and an announcement of at least 20 characters")
    published = not scheduled_at or scheduled_at <= now
    row = _one(db, """INSERT INTO business_issuer_announcements
        (company_id,created_by,announcement_type,headline,body,status,scheduled_at,published_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, ?,?,?) RETURNING *""",
        (company_id, user_id, announcement_type, headline, body, "published" if published else "scheduled",
         scheduled_at, now if published else None, now, now))
    return dict(row)


def file_bankruptcy(db: Any, user_id: int, company_id: int, payload: dict[str, Any], now: str) -> dict[str, Any]:
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? AND controlling_user_id=? FOR UPDATE", (company_id, user_id))
    if not company or company["status"] not in ("active", "scheduled"):
        raise ValueError("Only the current controller may file an active issuer for bankruptcy")
    confirmation = _ticker(payload.get("confirmation"))
    reason = _text(payload.get("reason"), 1000)
    if confirmation != company["ticker"] or len(reason) < 20:
        raise ValueError(f"Type {company['ticker']} and document at least 20 characters to file")
    db.execute("UPDATE business_issuer_companies SET status='bankruptcy_filed',bankruptcy_reason=?,bankruptcy_filed_at=?,updated_at=? WHERE id=?",
               (reason, now, now, company_id))
    if company.get("security_id"):
        db.execute("UPDATE market_securities SET active=0,lifecycle_status='bankruptcy_pending',updated_at=? WHERE id=?", (now, company["security_id"]))
    db.execute("""INSERT INTO business_issuer_assignments (company_id,security_id,user_id,action,actor_id,note,created_at)
        VALUES (?,?,?,'bankruptcy_filed',?,?,?)""", (company_id, company.get("security_id"), user_id, user_id, reason, now))
    return {"company_id": company_id, "ticker": company["ticker"], "status": "bankruptcy_filed"}


def assign_existing_security(db: Any, actor_id: int, security_id: int, user_id: int, note: str, now: str) -> dict[str, Any]:
    security = _one(db, "SELECT * FROM market_securities WHERE id=? FOR UPDATE", (security_id,))
    user = _one(db, "SELECT id,name,email,civ_number FROM users WHERE id=?", (user_id,))
    if not security or str(security.get("security_type") or "") == "fund" or not bool(security.get("active")):
        raise ValueError("Choose an active operating-company stock")
    if not user:
        raise ValueError("Resident account was not found")
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE security_id=? FOR UPDATE", (security_id,))
    if company and company.get("controlling_user_id") and int(company["controlling_user_id"]) != user_id:
        raise ValueError("That FCX security already has a resident controller; transfer it instead")
    market_cap = round(float(security.get("price") or 0) * float(security.get("issued_shares") or 0), 2)
    if company:
        db.execute("UPDATE business_issuer_companies SET controlling_user_id=?,assigned_by=?,status='active',updated_at=? WHERE id=?",
                   (user_id, actor_id, now, company["id"]))
        company_id = int(company["id"])
    else:
        company_number = f"FCA-{dt.datetime.fromisoformat(now).strftime('%y%m')}-{secrets.randbelow(900000)+100000}"
        company = _one(db, """INSERT INTO business_issuer_companies
            (company_number,security_id,controlling_user_id,created_by,assigned_by,control_source,status,company_name,ticker,
             sector,description,target_market_cap,opening_share_price,authorized_shares,public_float_percent,founder_shares,
             issuer_inventory,paid_in_capital,treasury_balance,activated_at,created_at,updated_at)
            VALUES (?,?,?,?,?,'existing_security','active',?,?,?,?,?,?,?,100,0,0,0,0,?,?,?) RETURNING id""",
            (company_number, security_id, user_id, actor_id, actor_id, security["name"], security["ticker"],
             security.get("sector") or "General", security.get("description") or "", market_cap, security["price"],
             security.get("issued_shares") or 0, now, now, now))
        company_id = int(company["id"])
    db.execute("""INSERT INTO business_issuer_assignments (company_id,security_id,user_id,action,actor_id,note,created_at)
        VALUES (?,?,?,'assigned',?,?,?)""", (company_id, security_id, user_id, actor_id, _text(note, 500), now))
    return {"company_id": company_id, "security_id": security_id, "ticker": security["ticker"], "controller": dict(user)}


def change_assignment(db: Any, actor_id: int, company_id: int, user_id: int | None, note: str, now: str) -> dict[str, Any]:
    company = _one(db, "SELECT * FROM business_issuer_companies WHERE id=? FOR UPDATE", (company_id,))
    if not company:
        raise ValueError("Issuer company was not found")
    if user_id is not None and not _one(db, "SELECT id FROM users WHERE id=?", (user_id,)):
        raise ValueError("Resident account was not found")
    action = "transferred" if user_id is not None else "unassigned"
    db.execute("UPDATE business_issuer_companies SET controlling_user_id=?,assigned_by=?,updated_at=? WHERE id=?", (user_id, actor_id, now, company_id))
    db.execute("""INSERT INTO business_issuer_assignments (company_id,security_id,user_id,action,actor_id,note,created_at)
        VALUES (?,?,?,?,?,?,?)""", (company_id, company.get("security_id"), user_id, action, actor_id, _text(note, 500), now))
    return {"company_id": company_id, "ticker": company["ticker"], "action": action, "user_id": user_id}


def _companies_query(where: str = "", order: str = "c.updated_at DESC") -> str:
    return f"""SELECT c.*,s.price AS live_price,s.issued_shares,s.active AS security_active,
        s.lifecycle_status AS security_status,u.name AS controller_name,u.email AS controller_email,u.civ_number,
        COALESCE(s.price*s.issued_shares,c.target_market_cap) AS live_market_cap,
        fb.total_amount AS funding_total,fb.completed_amount AS funding_completed,fb.status AS funding_status,
        fb.failure_reason AS funding_failure,fb.current_command_id,fb.chunk_count,fb.next_sequence
        FROM business_issuer_companies c
        LEFT JOIN market_securities s ON s.id=c.security_id
        LEFT JOIN users u ON u.id=c.controlling_user_id
        LEFT JOIN LATERAL (SELECT * FROM business_issuer_funding_batches x WHERE x.company_id=c.id ORDER BY x.id DESC LIMIT 1) fb ON TRUE
        {where} ORDER BY {order}"""


def _market_maker_firm(source: Any) -> str:
    """Assign a stable, fictional broker identity to non-resident market flow."""
    value = str(source or "automation").strip().lower()
    if "gemini" in value:
        return "Northstar Market Making"
    if "deepseek" in value:
        return "Apex Quantitative Partners"
    if "liquidation" in value:
        return "Civic Prime Brokerage"
    if "scheduled" in value:
        return "Foundry Specialist Desk"
    if "index" in value:
        return "Ravenhood Index Liquidity"
    if "fec" in value:
        return "FEC Resolution Desk"
    return "Faircroft Liquidity Services"


def _company_intelligence(db: Any, company: dict[str, Any], now: str) -> dict[str, Any]:
    security_id = int(company.get("security_id") or 0)
    if not security_id:
        return {
            "metrics": {}, "investors": [], "market_makers": [], "recent_trades": [], "capital_history": [],
            "investor_summary": {"holders": 0, "shares": 0, "market_value": 0},
        }
    current_price = max(0.0, _float(company.get("live_price")))
    issued_shares = max(0.0, _float(company.get("issued_shares") or company.get("authorized_shares")))
    current_cap = round(current_price * issued_shares, 2)
    try:
        cutoff = (dt.datetime.fromisoformat(now.replace("Z", "+00:00")) - dt.timedelta(hours=24)).isoformat()
    except ValueError:
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).isoformat()

    investors = []
    for row in _all(db, """SELECT u.id AS user_id,u.name,u.civ_number,h.quantity,h.average_cost,
            CASE WHEN u.id=? THEN 'Controller / founder' ELSE 'Resident investor' END AS investor_type
        FROM market_holdings h JOIN market_accounts a ON a.id=h.account_id
        JOIN users u ON u.id=a.user_id
        WHERE h.security_id=? AND h.quantity>0
        ORDER BY h.quantity DESC,u.name LIMIT 100""", (company.get("controlling_user_id"), security_id)):
        shares = max(0.0, _float(row.get("quantity")))
        investors.append({
            "user_id": int(row["user_id"]),
            "name": str(row.get("name") or "Resident investor"),
            "civ_number": str(row.get("civ_number") or ""),
            "investor_type": str(row.get("investor_type") or "Resident investor"),
            "shares": round(shares, 6),
            "average_cost": round(_float(row.get("average_cost")), 4),
            "market_value": round(shares * current_price, 2),
            "ownership_percent": round((shares / issued_shares * 100) if issued_shares else 0, 6),
        })
    resident_shares = sum(float(item["shares"]) for item in investors)
    investor_value = sum(float(item["market_value"]) for item in investors)

    resident_orders = _all(db, """SELECT o.id,o.side,o.quantity,o.unit_price,o.gross_amount,o.fee_amount,o.created_at,
            u.name,u.civ_number
        FROM market_orders o JOIN market_accounts a ON a.id=o.account_id
        JOIN users u ON u.id=a.user_id
        WHERE o.security_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 80""", (security_id,))
    system_orders = _all(db, """SELECT id,buy_volume,sell_volume,buy_trade_count,sell_trade_count,
            reference_price,source,rationale,created_at
        FROM market_system_trades WHERE security_id=?
        ORDER BY created_at DESC,id DESC LIMIT 80""", (security_id,))
    recent_trades: list[dict[str, Any]] = []
    for row in resident_orders:
        recent_trades.append({
            "key": f"resident-{row['id']}", "participant_type": "resident",
            "participant": str(row.get("name") or "Resident investor"),
            "participant_detail": f"CIV {row.get('civ_number')}" if row.get("civ_number") else "Verified FCX account",
            "side": "sell" if str(row.get("side") or "").lower() == "sell" else "buy",
            "shares": round(_float(row.get("quantity")), 6), "price": round(_float(row.get("unit_price")), 4),
            "gross_amount": round(_float(row.get("gross_amount")), 2), "execution_count": 1,
            "source": "resident_order", "created_at": row.get("created_at"),
        })
    for row in system_orders:
        firm = _market_maker_firm(row.get("source"))
        for side, volume_key, count_key in (
            ("buy", "buy_volume", "buy_trade_count"), ("sell", "sell_volume", "sell_trade_count"),
        ):
            shares = max(0.0, _float(row.get(volume_key)))
            if shares <= 0:
                continue
            price = max(0.0, _float(row.get("reference_price")))
            recent_trades.append({
                "key": f"system-{row['id']}-{side}", "participant_type": "market_maker",
                "participant": firm, "participant_detail": "Brokerage Account",
                "side": side, "shares": round(shares, 6), "price": round(price, 4),
                "gross_amount": round(shares * price, 2),
                "execution_count": max(1, int(row.get(count_key) or 1)),
                "source": str(row.get("source") or "automation"), "rationale": str(row.get("rationale") or ""),
                "created_at": row.get("created_at"),
            })
    recent_trades.sort(key=lambda item: (str(item.get("created_at") or ""), str(item.get("key") or "")), reverse=True)
    recent_trades = recent_trades[:100]

    # System liquidity does not belong to a resident account, but issuers still need
    # an intelligible view of who is making their market. Aggregate every automated
    # fill under stable, fictional brokerage identities and expose the resulting net
    # inventory separately from the resident shareholder register.
    market_maker_rows = _all(db, """SELECT source,
            COALESCE(SUM(buy_volume),0) AS buy_shares,
            COALESCE(SUM(sell_volume),0) AS sell_shares,
            COALESCE(SUM(buy_trade_count),0) AS buy_fills,
            COALESCE(SUM(sell_trade_count),0) AS sell_fills,
            COALESCE(SUM((buy_volume+sell_volume)*reference_price),0) AS notional,
            MAX(created_at) AS last_trade_at
        FROM market_system_trades WHERE security_id=?
        GROUP BY source ORDER BY MAX(created_at) DESC""", (security_id,))
    broker_rollup: dict[str, dict[str, Any]] = {}
    for row in market_maker_rows:
        source = str(row.get("source") or "automation")
        firm = _market_maker_firm(source)
        broker = broker_rollup.setdefault(firm, {
            "firm": firm, "participant_type": "market_maker",
            "participant_detail": "Brokerage Account",
            "buy_shares": 0.0, "sell_shares": 0.0, "buy_fills": 0,
            "sell_fills": 0, "notional": 0.0, "last_trade_at": None,
            "sources": [],
        })
        broker["buy_shares"] += max(0.0, _float(row.get("buy_shares")))
        broker["sell_shares"] += max(0.0, _float(row.get("sell_shares")))
        broker["buy_fills"] += max(0, int(row.get("buy_fills") or 0))
        broker["sell_fills"] += max(0, int(row.get("sell_fills") or 0))
        broker["notional"] += max(0.0, _float(row.get("notional")))
        if source not in broker["sources"]:
            broker["sources"].append(source)
        last_trade_at = row.get("last_trade_at")
        if last_trade_at and (not broker["last_trade_at"] or str(last_trade_at) > str(broker["last_trade_at"])):
            broker["last_trade_at"] = last_trade_at
    market_makers = []
    for broker in broker_rollup.values():
        net_shares = broker["buy_shares"] - broker["sell_shares"]
        broker.update({
            "buy_shares": round(broker["buy_shares"], 6),
            "sell_shares": round(broker["sell_shares"], 6),
            "net_shares": round(net_shares, 6),
            "inventory_side": "long" if net_shares > 0 else ("short" if net_shares < 0 else "flat"),
            "inventory_value": round(abs(net_shares) * current_price, 2),
            "notional": round(broker["notional"], 2),
            "total_fills": broker["buy_fills"] + broker["sell_fills"],
        })
        market_makers.append(broker)
    market_makers.sort(key=lambda item: (str(item.get("last_trade_at") or ""), float(item.get("notional") or 0)), reverse=True)

    capital_history = []
    for row in _all(db, """SELECT * FROM business_issuer_market_cap_history
        WHERE company_id=? ORDER BY occurred_at DESC,id DESC LIMIT 100""", (company["id"],)):
        item = dict(row)
        for key in ("amount", "price_before", "price_after", "market_cap_before", "market_cap_after", "issued_shares"):
            item[key] = round(_float(item.get(key)), 4 if "price" in key else (6 if key == "issued_shares" else 2))
        item["market_cap_change"] = round(item["market_cap_after"] - item["market_cap_before"], 2)
        capital_history.append(item)

    day_price = _one(db, """SELECT price FROM market_price_history WHERE security_id=? AND recorded_at<=?
        ORDER BY recorded_at DESC,id DESC LIMIT 1""", (security_id, cutoff))
    if not day_price:
        day_price = _one(db, "SELECT price FROM market_price_history WHERE security_id=? ORDER BY recorded_at,id LIMIT 1", (security_id,))
    range_row = _one(db, """SELECT MIN(price) AS low,MAX(price) AS high FROM market_price_history
        WHERE security_id=? AND recorded_at>=?""", (security_id, cutoff)) or {}
    resident_flow = _one(db, """SELECT COUNT(*) AS trades,COALESCE(SUM(quantity),0) AS shares,
        COALESCE(SUM(gross_amount),0) AS volume,COALESCE(SUM(fee_amount),0) AS fees,
        COALESCE(SUM(CASE WHEN side='buy' THEN quantity ELSE 0 END),0) AS buys,
        COALESCE(SUM(CASE WHEN side='sell' THEN quantity ELSE 0 END),0) AS sells
        FROM market_orders WHERE security_id=?""", (security_id,)) or {}
    maker_flow = _one(db, """SELECT COALESCE(SUM(buy_volume),0) AS buys,COALESCE(SUM(sell_volume),0) AS sells,
        COALESCE(SUM(buy_trade_count+sell_trade_count),0) AS trades
        FROM market_system_trades WHERE security_id=?""", (security_id,)) or {}
    revenue = _one(db, """SELECT COUNT(*) AS reports,COALESCE(SUM(amount),0) AS total,MAX(occurred_at) AS last_at
        FROM business_issuer_market_cap_history WHERE company_id=? AND event_type='reported_revenue'""", (company["id"],)) or {}
    announcements = _one(db, "SELECT COUNT(*) AS total FROM business_issuer_announcements WHERE company_id=?", (company["id"],)) or {}
    reference_price = max(0.0, _float((day_price or {}).get("price"), current_price))
    change_24h = ((current_price - reference_price) / reference_price * 100) if reference_price else 0
    resident_buys, resident_sells = _float(resident_flow.get("buys")), _float(resident_flow.get("sells"))
    maker_buys, maker_sells = _float(maker_flow.get("buys")), _float(maker_flow.get("sells"))
    gross_flow = resident_buys + resident_sells + maker_buys + maker_sells
    public_float_shares = issued_shares * max(0.0, min(100.0, _float(company.get("public_float_percent")))) / 100
    maker_notional = sum(_float(item.get("notional")) for item in market_makers)
    maker_inventory = sum(_float(item.get("net_shares")) for item in market_makers)
    valuation_adjustment = sum(_float(item.get("market_cap_change")) for item in capital_history if item.get("event_type") == "reported_revenue")
    total_executions = int(resident_flow.get("trades") or 0) + int(maker_flow.get("trades") or 0)
    return {
        "metrics": {
            "live_market_cap": current_cap, "live_price": round(current_price, 4),
            "change_24h_percent": round(change_24h, 4),
            "low_24h": round(_float(range_row.get("low"), current_price), 4),
            "high_24h": round(_float(range_row.get("high"), current_price), 4),
            "issued_shares": round(issued_shares, 6), "public_float_percent": round(_float(company.get("public_float_percent")), 2),
            "public_float_shares": round(public_float_shares, 6), "public_float_value": round(public_float_shares * current_price, 2),
            "resident_holders": len(investors), "resident_shares": round(resident_shares, 6),
            "resident_market_value": round(investor_value, 2),
            "top_holder_percent": round(max((float(item["ownership_percent"]) for item in investors), default=0.0), 6),
            "reported_revenue": round(_float(revenue.get("total")), 2), "revenue_reports": int(revenue.get("reports") or 0),
            "valuation_adjustment": round(valuation_adjustment, 2),
            "last_revenue_at": revenue.get("last_at"), "resident_trade_count": int(resident_flow.get("trades") or 0),
            "resident_trade_volume": round(_float(resident_flow.get("volume")), 2), "exchange_fees": round(_float(resident_flow.get("fees")), 2),
            "market_maker_trade_count": int(maker_flow.get("trades") or 0),
            "market_maker_firms": len(market_makers), "market_maker_notional": round(maker_notional, 2),
            "market_maker_inventory_shares": round(maker_inventory, 6),
            "market_maker_inventory_value": round(abs(maker_inventory) * current_price, 2),
            "market_maker_buy_shares": round(maker_buys, 6), "market_maker_sell_shares": round(maker_sells, 6),
            "market_maker_net_shares": round(maker_buys - maker_sells, 6),
            "total_execution_count": total_executions,
            "total_executed_shares": round(resident_buys + resident_sells + maker_buys + maker_sells, 6),
            "total_recorded_notional": round(_float(resident_flow.get("volume")) + maker_notional, 2),
            "buy_pressure_percent": round(((resident_buys + maker_buys) / gross_flow * 100) if gross_flow else 0, 2),
            "sell_pressure_percent": round(((resident_sells + maker_sells) / gross_flow * 100) if gross_flow else 0, 2),
            "announcement_count": int(announcements.get("total") or 0),
        },
        "investors": investors,
        "investor_summary": {"holders": len(investors), "shares": round(resident_shares, 6), "market_value": round(investor_value, 2)},
        "market_makers": market_makers,
        "recent_trades": recent_trades,
        "capital_history": capital_history,
    }


def resident_payload(db: Any, user_id: int, now: str) -> dict[str, Any]:
    activate_due_ipos(db, now)
    companies = [_public_company(row) for row in _all(db, _companies_query("WHERE c.controlling_user_id=?"), (user_id,))]
    ids = [int(row["id"]) for row in companies]
    ledgers: dict[str, list[dict[str, Any]]] = {}
    announcements: dict[str, list[dict[str, Any]]] = {}
    intelligence: dict[str, dict[str, Any]] = {}
    for company_id in ids:
        company = next(item for item in companies if int(item["id"]) == company_id)
        ledgers[str(company_id)] = [dict(row) for row in _all(db, "SELECT * FROM business_issuer_ledger WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 80", (company_id,))]
        announcements[str(company_id)] = [dict(row) for row in _all(db, "SELECT * FROM business_issuer_announcements WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 40", (company_id,))]
        intelligence[str(company_id)] = _company_intelligence(db, company, now)
    wire = [dict(row) for row in _all(db, """SELECT a.*,c.ticker,c.company_name FROM business_issuer_announcements a
        JOIN business_issuer_companies c ON c.id=a.company_id
        WHERE a.status='published' AND COALESCE(a.published_at,a.created_at)<=?
        ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 60""", (now,))]
    bank = _one(db, """SELECT l.identity_id,b.balance,b.synced_at FROM arma_account_links l
        LEFT JOIN arma_game_bank_balances b ON b.identity_id=l.identity_id WHERE l.user_id=?""", (user_id,))
    guardrails = ipo_guardrails(db)
    return {
        "issuer_portal": True,
        "companies": companies,
        "ledgers": ledgers,
        "announcements": announcements,
        "company_intelligence": intelligence,
        "company_wire": wire,
        "bank": {"linked": bool(bank and bank.get("identity_id")), "balance": round(float((bank or {}).get("balance") or 0), 2), "synced_at": (bank or {}).get("synced_at")},
        "limits": {
            "max_companies": MAX_COMPANIES_PER_RESIDENT,
            "max_capitalization": MAX_CAPITALIZATION,
            "bridge_chunk": BRIDGE_CHUNK_LIMIT,
            **guardrails,
        },
    }


def dev_payload(db: Any, now: str) -> dict[str, Any]:
    activate_due_ipos(db, now)
    companies = [_public_company(row) for row in _all(db, _companies_query())]
    securities = [dict(row) for row in _all(db, """SELECT s.id,s.ticker,s.name,s.sector,s.price,s.issued_shares,
        ROUND((s.price*s.issued_shares)::numeric,2) AS market_cap
        FROM market_securities s LEFT JOIN business_issuer_companies c ON c.security_id=s.id
        WHERE s.active=1 AND s.security_type<>'fund' AND s.lifecycle_status='active' AND c.id IS NULL
        ORDER BY s.ticker""")]
    residents = [dict(row) for row in _all(db, "SELECT id,name,email,civ_number,verified FROM users ORDER BY name LIMIT 1000")]
    assignments = [dict(row) for row in _all(db, """SELECT a.*,c.ticker,c.company_name,u.name AS resident_name,actor.name AS actor_name
        FROM business_issuer_assignments a JOIN business_issuer_companies c ON c.id=a.company_id
        LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users actor ON actor.id=a.actor_id
        ORDER BY a.created_at DESC LIMIT 150""")]
    archive = _one(db, """SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE source_table='business_applications') AS applications,
        COUNT(*) FILTER (WHERE source_table='businesses') AS licenses
        FROM business_legacy_archive""") or {}
    announcements = [dict(row) for row in _all(db, """SELECT a.*,c.ticker,c.company_name,u.name AS author_name
        FROM business_issuer_announcements a JOIN business_issuer_companies c ON c.id=a.company_id
        LEFT JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 100""")]
    return {
        "companies": companies, "available_securities": securities, "residents": residents,
        "assignments": assignments, "announcements": announcements,
        "legacy_archive": {key: int(value or 0) for key, value in archive.items()},
        "ipo_guardrails": ipo_guardrails(db),
    }


def published_wire(db: Any, now: str, limit: int = 20) -> list[dict[str, Any]]:
    return [dict(row) for row in _all(db, """SELECT a.id,a.announcement_type,a.headline,a.body,a.published_at,
        c.ticker,c.company_name FROM business_issuer_announcements a
        JOIN business_issuer_companies c ON c.id=a.company_id
        WHERE a.status='published' AND COALESCE(a.published_at,a.created_at)<=?
        ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT ?""", (now, limit))]
