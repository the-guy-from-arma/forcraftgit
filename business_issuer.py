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
BRIDGE_CHUNK_LIMIT = 10_000_000.0
MAX_COMPANIES_PER_RESIDENT = 8


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
        WHERE b.id=? FOR UPDATE""", (batch_id,))
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
    db.execute("""UPDATE business_issuer_ledger SET status='completed'
        WHERE company_id=? AND entry_type='initial_capitalization' AND status='pending'""", (company_id,))


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
    sector = _text(payload.get("sector") or "General", 60)
    headquarters = _text(payload.get("headquarters"), 140)
    description = _text(payload.get("description"), 1200)
    market_cap = round(_float(payload.get("target_market_cap")), 2)
    share_price = round(_float(payload.get("opening_share_price")), 4)
    public_float = round(_float(payload.get("public_float_percent"), 25), 2)
    scheduled_at = _text(payload.get("scheduled_at"), 40) or None
    if len(name) < 3 or len(description) < 40:
        raise ValueError("Enter a company name and a detailed operating description of at least 40 characters")
    if len(ticker) < 2:
        raise ValueError("Ticker must contain 2 to 8 letters or numbers")
    if not 1_000 <= market_cap <= MAX_CAPITALIZATION:
        raise ValueError(f"Initial market capitalization must be between $1,000 and ${MAX_CAPITALIZATION:,.0f}")
    if not 0.01 <= share_price <= 1_000_000:
        raise ValueError("Opening share price must be between $0.01 and $1,000,000")
    if not 5 <= public_float <= 100:
        raise ValueError("Public float must be between 5% and 100%")
    if _one(db, "SELECT id FROM market_securities WHERE ticker=?", (ticker,)) or _one(db, "SELECT id FROM business_issuer_companies WHERE ticker=?", (ticker,)):
        raise ValueError("That FCX ticker is already in use")
    owned = _one(db, "SELECT COUNT(*) AS total FROM business_issuer_companies WHERE controlling_user_id=? AND status NOT IN ('bankrupt','cancelled')", (user_id,))
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
        WHERE b.user_id=? AND b.status IN ('staged','pending','failed')""", (user_id,))
    if float(link.get("balance") or 0) - float((reserved or {}).get("total") or 0) + 0.0001 < market_cap:
        raise ValueError("The synchronized in-game balance does not cover this capitalization")
    shares = round(market_cap / share_price, 6)
    founder = round(shares * (100 - public_float) / 100, 6)
    inventory = round(shares - founder, 6)
    company_number = f"FCI-{dt.datetime.fromisoformat(now).strftime('%y%m')}-{secrets.randbelow(900000)+100000}"
    company = _one(db, """INSERT INTO business_issuer_companies
        (company_number,controlling_user_id,created_by,control_source,status,company_name,ticker,sector,headquarters,
         description,target_market_cap,opening_share_price,authorized_shares,public_float_percent,founder_shares,
         issuer_inventory,scheduled_at,created_at,updated_at)
        VALUES (?,?,?,'new_ipo','funding_pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *""",
        (company_number, user_id, user_id, name, ticker, sector, headquarters, description, market_cap, share_price,
         shares, public_float, founder, inventory, scheduled_at, now, now))
    chunks = max(1, int(math.ceil(market_cap / BRIDGE_CHUNK_LIMIT)))
    batch = _one(db, """INSERT INTO business_issuer_funding_batches
        (company_id,user_id,purpose,total_amount,chunk_count,status,created_at,updated_at)
        VALUES (?,?,'initial_capitalization',?,?,'staged',?,?) RETURNING id""",
        (company["id"], user_id, market_cap, chunks, now, now))
    db.execute("""INSERT INTO business_issuer_ledger
        (company_id,user_id,entry_type,direction,amount,description,status,created_at)
        VALUES (?,?,'initial_capitalization','inflow',?,'Founder capitalization through the in-game Bank Bridge','pending',?)""",
        (company["id"], user_id, market_cap, now))
    command = _queue_next_funding_command(db, int(batch["id"]), now)
    return {"company": _public_company(company), "funding": command, "chunk_count": chunks}


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
        (company_id,user_id,entry_type,direction,amount,description,status,created_at)
        VALUES (?,?,'treasury_contribution','inflow',?,'Controller treasury contribution','pending',?)""",
        (company_id, user_id, amount, now))
    return _queue_next_funding_command(db, int(batch["id"]), now)


def retry_funding(db: Any, user_id: int, company_id: int, now: str, *, developer: bool = False) -> dict[str, Any]:
    clause = "" if developer else " AND user_id=?"
    params: tuple[Any, ...] = (company_id,) if developer else (company_id, user_id)
    batch = _one(db, f"""SELECT * FROM business_issuer_funding_batches WHERE company_id=?{clause}
        AND status='failed' ORDER BY id DESC LIMIT 1 FOR UPDATE""", params)
    if not batch:
        raise ValueError("No failed funding command is available to retry")
    db.execute("UPDATE business_issuer_funding_batches SET status='staged',current_command_id=NULL,current_amount=0,failure_reason='',updated_at=? WHERE id=?", (now, batch["id"]))
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
        db.execute("UPDATE business_issuer_ledger SET status='failed' WHERE company_id=? AND entry_type=? AND status='pending'",
                   (batch["company_id"], batch["purpose"]))
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
        db.execute("UPDATE business_issuer_companies SET paid_in_capital=paid_in_capital+?,treasury_balance=treasury_balance+?,updated_at=? WHERE id=?",
                   (batch["total_amount"], batch["total_amount"], now, batch["company_id"]))
        db.execute("UPDATE business_issuer_ledger SET status='completed' WHERE company_id=? AND entry_type='treasury_contribution' AND status='pending'", (batch["company_id"],))
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


def resident_payload(db: Any, user_id: int, now: str) -> dict[str, Any]:
    activate_due_ipos(db, now)
    companies = [_public_company(row) for row in _all(db, _companies_query("WHERE c.controlling_user_id=?"), (user_id,))]
    ids = [int(row["id"]) for row in companies]
    ledgers: dict[str, list[dict[str, Any]]] = {}
    announcements: dict[str, list[dict[str, Any]]] = {}
    for company_id in ids:
        ledgers[str(company_id)] = [dict(row) for row in _all(db, "SELECT * FROM business_issuer_ledger WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 80", (company_id,))]
        announcements[str(company_id)] = [dict(row) for row in _all(db, "SELECT * FROM business_issuer_announcements WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 40", (company_id,))]
    wire = [dict(row) for row in _all(db, """SELECT a.*,c.ticker,c.company_name FROM business_issuer_announcements a
        JOIN business_issuer_companies c ON c.id=a.company_id
        WHERE a.status='published' AND COALESCE(a.published_at,a.created_at)<=?
        ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 60""", (now,))]
    bank = _one(db, """SELECT l.identity_id,b.balance,b.synced_at FROM arma_account_links l
        LEFT JOIN arma_game_bank_balances b ON b.identity_id=l.identity_id WHERE l.user_id=?""", (user_id,))
    return {
        "issuer_portal": True,
        "companies": companies,
        "ledgers": ledgers,
        "announcements": announcements,
        "company_wire": wire,
        "bank": {"linked": bool(bank and bank.get("identity_id")), "balance": round(float((bank or {}).get("balance") or 0), 2), "synced_at": (bank or {}).get("synced_at")},
        "limits": {"max_companies": MAX_COMPANIES_PER_RESIDENT, "max_capitalization": MAX_CAPITALIZATION, "bridge_chunk": BRIDGE_CHUNK_LIMIT},
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
    }


def published_wire(db: Any, now: str, limit: int = 20) -> list[dict[str, Any]]:
    return [dict(row) for row in _all(db, """SELECT a.id,a.announcement_type,a.headline,a.body,a.published_at,
        c.ticker,c.company_name FROM business_issuer_announcements a
        JOIN business_issuer_companies c ON c.id=a.company_id
        WHERE a.status='published' AND COALESCE(a.published_at,a.created_at)<=?
        ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT ?""", (now, limit))]
