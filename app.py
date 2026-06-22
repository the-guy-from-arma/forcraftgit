from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import psycopg
from psycopg.rows import dict_row


APP_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = APP_ROOT / "static"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-before-production")
COOKIE_NAME = "rp_session"
SESSION_DAYS = 7
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "owner@rp.local").strip().lower()
OWNER_PASSWORD = os.environ.get("OWNER_PASSWORD", "owner1234")
OWNER_NAME = os.environ.get("OWNER_NAME", "Server Owner")
ARMA_BRIDGE_API_KEY = os.environ.get("ARMA_BRIDGE_API_KEY", "").strip()
ARMA_LINK_CODE_TTL_MINUTES = int(os.environ.get("ARMA_LINK_CODE_TTL_MINUTES", "30"))


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def today_key() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def parse_iso(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.now(dt.timezone.utc)
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def parse_bridge_datetime(value: str | None) -> dt.datetime:
    if not value:
        return utcnow()
    clean = str(value).strip().replace("Z", "+00:00")
    try:
        return parse_iso(clean)
    except ValueError:
        try:
            parsed = dt.datetime.strptime(clean[:19], "%Y-%m-%d %H:%M:%S")
            return parsed.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return utcnow()


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 160_000)
    return f"pbkdf2_sha256${salt}${base64.urlsafe_b64encode(digest).decode('ascii')}"


def verify_password(password: str, stored: str) -> bool:
    try:
        method, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    if method != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def sign_session(user_id: int) -> str:
    payload = {
        "uid": user_id,
        "exp": int((utcnow() + dt.timedelta(days=SESSION_DAYS)).timestamp()),
    }
    body = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(SECRET_KEY.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{b64url(signature)}"


def read_session(token: str | None) -> int | None:
    if not token or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    expected = b64url(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(b64url_decode(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(utcnow().timestamp()):
        return None
    return int(payload.get("uid", 0)) or None


DbRow = dict[str, Any]


class CursorAdapter:
    def __init__(self, cursor: psycopg.Cursor[DbRow]):
        self.cursor = cursor

    def fetchone(self) -> DbRow | None:
        return self.cursor.fetchone()

    def fetchall(self) -> list[DbRow]:
        return list(self.cursor.fetchall())


class Database:
    def __init__(self) -> None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is required. Attach a PostgreSQL database and set DATABASE_URL.")
        self.raw = psycopg.connect(DATABASE_URL, row_factory=dict_row)

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if exc_type:
            self.raw.rollback()
        else:
            self.raw.commit()
        self.raw.close()

    def sql(self, query: str) -> str:
        return query.replace("?", "%s")

    def execute(self, query: str, params: tuple[Any, ...] | list[Any] = ()) -> CursorAdapter:
        cursor = self.raw.cursor()
        cursor.execute(self.sql(query), tuple(params))
        return CursorAdapter(cursor)

    def executemany(self, query: str, params: list[tuple[Any, ...]]) -> CursorAdapter:
        cursor = self.raw.cursor()
        cursor.executemany(self.sql(query), params)
        return CursorAdapter(cursor)

    def executescript(self, script: str) -> None:
        cursor = self.raw.cursor()
        for statement in [part.strip() for part in script.split(";") if part.strip()]:
            cursor.execute(statement)


def conn() -> Database:
    return Database()


def one(db: Database, sql: str, params: tuple[Any, ...] = ()) -> DbRow | None:
    return db.execute(sql, params).fetchone()


def all_rows(db: Database, sql: str, params: tuple[Any, ...] = ()) -> list[DbRow]:
    return db.execute(sql, params).fetchall()


def roles_for(user: DbRow) -> list[str]:
    raw = user.get("roles", "[]")
    try:
        roles = json.loads(raw or "[]")
    except json.JSONDecodeError:
        roles = []
    return sorted(set(["civ", *roles]))


def has_any(user: DbRow, *roles: str) -> bool:
    owned = set(roles_for(user))
    return bool(owned.intersection(roles))


def public_user(user: DbRow) -> dict[str, Any]:
    return {
        "id": user["id"],
        "civ_number": user.get("civ_number"),
        "name": user["name"],
        "email": user["email"],
        "verified": bool(user["verified"]),
        "roles": roles_for(user),
        "primary_agency": user["primary_agency"],
        "bank_balance": round(float(user["bank_balance"] or 0), 2),
        "cash_balance": round(float(user["cash_balance"] or 0), 2),
        "created_at": user["created_at"],
    }


def require_fields(payload: dict[str, Any], *fields: str) -> str | None:
    missing = [field for field in fields if payload.get(field) in (None, "")]
    if missing:
        return f"Missing required field: {missing[0]}"
    return None


def generate_civ_number(db: Database) -> str:
    for _ in range(50):
        number = f"{secrets.randbelow(900000) + 100000}"
        if not one(db, "SELECT id FROM users WHERE civ_number = ?", (number,)):
            return number
    raise RuntimeError("Unable to generate unique civilian ID")


def generate_vehicle_vin(db: Database) -> str:
    alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
    for _ in range(50):
        vin = "".join(secrets.choice(alphabet) for _ in range(17))
        if not one(db, "SELECT id FROM dmv_vehicles WHERE vin = ?", (vin,)):
            return vin
    raise RuntimeError("Unable to generate unique vehicle VIN")


def generate_record_number(db: Database, table: str, column: str, prefix: str) -> str:
    allowed = {
        ("cid_investigations", "case_number"),
        ("cid_warrants", "warrant_number"),
        ("cid_internal_affairs", "ia_number"),
        ("rp_contracts", "contract_number"),
        ("business_applications", "application_number"),
        ("businesses", "license_number"),
    }
    if (table, column) not in allowed:
        raise ValueError("Invalid record number target")
    for _ in range(50):
        number = f"{prefix}-{secrets.randbelow(900000) + 100000}"
        if not one(db, f"SELECT id FROM {table} WHERE {column} = ?", (number,)):
            return number
    raise RuntimeError("Unable to generate unique record number")


BUSINESS_APPLICATION_STATUSES = ("submitted", "under_review", "interview_requested", "approved", "denied")
BUSINESS_LICENSE_STATUSES = ("active", "suspended", "revoked", "expired")
BUSINESS_LICENSE_CATEGORIES = ("basic", "commercial", "restricted", "government_contract")
BUSINESS_MAX_ACTIVE_PER_OWNER = 2
SYSTEM_SETTING_DEFAULTS = {
    "autopilot_verify_enabled": "0",
    "autopilot_verify_minutes": "120",
}


def business_staff_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "business_registrar", "city_hall", "economy_manager"):
        return "Business registry access required"
    return None


def is_business_staff(user: DbRow | None) -> bool:
    return bool(user and business_staff_required(user) is None)


def business_tax_default(category: str, startup_budget: float) -> float:
    base = {
        "basic": 250,
        "commercial": 750,
        "restricted": 1500,
        "government_contract": 0,
    }.get(category, 250)
    return round(max(base, min(startup_budget * 0.015, 5000)), 2)


def ensure_schema() -> None:
    with conn() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                civ_number TEXT UNIQUE,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                arma_id TEXT,
                password_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                roles TEXT NOT NULL DEFAULT '["civ"]',
                primary_agency TEXT,
                bank_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
                cash_balance NUMERIC(12,2) NOT NULL DEFAULT 250,
                last_income_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_presence (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                seconds INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT,
                PRIMARY KEY (user_id, day),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS system_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS arma_account_links (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE,
                server_id TEXT NOT NULL,
                identity_id TEXT NOT NULL UNIQUE,
                uid TEXT NOT NULL DEFAULT '',
                rpl_identity TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                player_name TEXT NOT NULL DEFAULT '',
                linked_at TEXT NOT NULL,
                last_seen_at TEXT,
                last_sync_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS arma_link_codes (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL,
                request_id TEXT NOT NULL DEFAULT '',
                server_id TEXT NOT NULL,
                identity_id TEXT NOT NULL,
                uid TEXT NOT NULL DEFAULT '',
                rpl_identity TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                player_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                claimed_by INTEGER,
                claimed_at TEXT,
                raw_payload TEXT NOT NULL DEFAULT '',
                UNIQUE (server_id, code),
                FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS arma_activity_logs (
                id SERIAL PRIMARY KEY,
                event_id TEXT NOT NULL UNIQUE,
                user_id INTEGER,
                server_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                action TEXT NOT NULL DEFAULT '',
                source_system TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '',
                balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
                identity_id TEXT NOT NULL DEFAULT '',
                uid TEXT NOT NULL DEFAULT '',
                rpl_identity TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                player_name TEXT NOT NULL DEFAULT '',
                raw_payload TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                received_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                market TEXT NOT NULL,
                requirement TEXT NOT NULL,
                required_minutes_daily INTEGER NOT NULL DEFAULT 60,
                rate_per_hour NUMERIC(12,2) NOT NULL,
                max_positions INTEGER NOT NULL DEFAULT 5,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS market_caps (
                market TEXT PRIMARY KEY,
                max_slots INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_jobs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                job_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                started_at TEXT NOT NULL,
                ended_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER,
                recipient_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read_at TEXT,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dmv_records (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE,
                license_status TEXT NOT NULL DEFAULT 'Pending verification',
                license_class TEXT NOT NULL DEFAULT 'Class D',
                vehicle_make TEXT NOT NULL DEFAULT 'Unregistered',
                vehicle_model TEXT NOT NULL DEFAULT 'Vehicle',
                vehicle_color TEXT NOT NULL DEFAULT 'Gray',
                plate TEXT NOT NULL UNIQUE,
                registration_status TEXT NOT NULL DEFAULT 'Pending',
                insurance_status TEXT NOT NULL DEFAULT 'Pending',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dmv_vehicles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                vehicle_year INTEGER NOT NULL,
                vehicle_make TEXT NOT NULL,
                vehicle_model TEXT NOT NULL,
                vehicle_color TEXT NOT NULL,
                plate TEXT NOT NULL UNIQUE,
                vin TEXT NOT NULL,
                registration_status TEXT NOT NULL DEFAULT 'Active',
                insurance_status TEXT NOT NULL DEFAULT 'Active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dmv_license_applications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                application_type TEXT NOT NULL,
                license_class TEXT NOT NULL,
                legal_name TEXT NOT NULL,
                date_of_birth TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'submitted',
                reviewer_notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS charge_catalog (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                fine_amount NUMERIC(12,2) NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                severity TEXT NOT NULL DEFAULT 'Infraction',
                kind TEXT NOT NULL DEFAULT 'criminal'
            );

            CREATE TABLE IF NOT EXISTS citations (
                id SERIAL PRIMARY KEY,
                civ_id INTEGER NOT NULL,
                officer_id INTEGER NOT NULL,
                judge_id INTEGER,
                charge_id INTEGER NOT NULL,
                charge_code TEXT NOT NULL,
                charge_title TEXT NOT NULL,
                category TEXT NOT NULL,
                fine_amount NUMERIC(12,2) NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                severity TEXT NOT NULL,
                location TEXT NOT NULL,
                narrative TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'issued',
                court_date TEXT,
                judgment_notes TEXT,
                final_result TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (charge_id) REFERENCES charge_catalog(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount NUMERIC(12,2) NOT NULL,
                description TEXT NOT NULL,
                counterparty_id INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (counterparty_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS properties (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                price NUMERIC(12,2) NOT NULL,
                rent_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'available',
                owner_id INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS business_applications (
                id SERIAL PRIMARY KEY,
                application_number TEXT NOT NULL UNIQUE,
                applicant_id INTEGER NOT NULL,
                business_name TEXT NOT NULL,
                business_type TEXT NOT NULL,
                owner_name TEXT NOT NULL,
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                startup_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
                planned_employees INTEGER NOT NULL DEFAULT 1,
                funding_source TEXT NOT NULL DEFAULT '',
                license_category TEXT NOT NULL DEFAULT 'basic',
                status TEXT NOT NULL DEFAULT 'submitted',
                reviewer_id INTEGER,
                reviewer_notes TEXT NOT NULL DEFAULT '',
                interview_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                decided_at TEXT,
                FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS businesses (
                id SERIAL PRIMARY KEY,
                license_number TEXT NOT NULL UNIQUE,
                application_id INTEGER UNIQUE,
                owner_id INTEGER NOT NULL,
                business_name TEXT NOT NULL,
                business_type TEXT NOT NULL,
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                license_category TEXT NOT NULL DEFAULT 'basic',
                status TEXT NOT NULL DEFAULT 'active',
                startup_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
                planned_employees INTEGER NOT NULL DEFAULT 1,
                weekly_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
                activity_requirement_minutes INTEGER NOT NULL DEFAULT 120,
                reputation_score INTEGER NOT NULL DEFAULT 50,
                insurance_required INTEGER NOT NULL DEFAULT 0,
                compliance_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                expires_at TEXT,
                FOREIGN KEY (application_id) REFERENCES business_applications(id) ON DELETE SET NULL,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS business_reviews (
                id SERIAL PRIMARY KEY,
                application_id INTEGER NOT NULL,
                reviewer_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (application_id) REFERENCES business_applications(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS business_inspections (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL,
                inspector_id INTEGER NOT NULL,
                inspection_type TEXT NOT NULL,
                result TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
                FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS business_violations (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL,
                issued_by INTEGER NOT NULL,
                severity TEXT NOT NULL,
                violation TEXT NOT NULL,
                penalty TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
                FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rp_contracts (
                id SERIAL PRIMARY KEY,
                contract_number TEXT NOT NULL UNIQUE,
                poster_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                accepted_by INTEGER,
                price NUMERIC(12,2) NOT NULL,
                target_context TEXT NOT NULL DEFAULT '',
                last_known TEXT NOT NULL DEFAULT '',
                details TEXT NOT NULL,
                requirements TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                clip_url TEXT,
                proof_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                accepted_at TEXT,
                submitted_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (poster_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS panic_alerts (
                id SERIAL PRIMARY KEY,
                officer_id INTEGER NOT NULL,
                department TEXT NOT NULL DEFAULT 'police',
                location TEXT NOT NULL,
                note TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cid_investigations (
                id SERIAL PRIMARY KEY,
                case_number TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                case_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                priority TEXT NOT NULL DEFAULT 'standard',
                lead_id INTEGER NOT NULL,
                target_civ_id INTEGER,
                target_name TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL,
                location TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (target_civ_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS cid_investigation_notes (
                id SERIAL PRIMARY KEY,
                investigation_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                note_type TEXT NOT NULL DEFAULT 'case note',
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (investigation_id) REFERENCES cid_investigations(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cid_warrants (
                id SERIAL PRIMARY KEY,
                warrant_number TEXT NOT NULL UNIQUE,
                investigation_id INTEGER,
                subject_civ_id INTEGER,
                subject_name TEXT NOT NULL,
                warrant_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                priority TEXT NOT NULL DEFAULT 'standard',
                probable_cause TEXT NOT NULL,
                operation_plan TEXT NOT NULL DEFAULT '',
                authorized_by TEXT NOT NULL DEFAULT '',
                created_by INTEGER NOT NULL,
                issued_at TEXT NOT NULL,
                expires_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (investigation_id) REFERENCES cid_investigations(id) ON DELETE SET NULL,
                FOREIGN KEY (subject_civ_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cid_internal_affairs (
                id SERIAL PRIMARY KEY,
                ia_number TEXT NOT NULL UNIQUE,
                subject_officer_id INTEGER,
                subject_name TEXT NOT NULL,
                allegation_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'intake',
                priority TEXT NOT NULL DEFAULT 'standard',
                summary TEXT NOT NULL,
                assigned_to INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (subject_officer_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        ensure_migrations(db)
        seed_owner(db)
        seed_jobs(db)
        seed_charges(db)
        seed_properties(db)


def ensure_migrations(db: Database) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    for key, value in SYSTEM_SETTING_DEFAULTS.items():
        db.execute(
            "INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO NOTHING",
            (key, value, now_iso()),
        )
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS civ_number TEXT")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS arma_id TEXT")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_civ_number_unique ON users (civ_number)")
    for user in all_rows(db, "SELECT id FROM users WHERE civ_number IS NULL"):
        db.execute("UPDATE users SET civ_number = ? WHERE id = ?", (generate_civ_number(db), user["id"]))
    db.execute("ALTER TABLE charge_catalog ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'criminal'")
    db.execute("UPDATE charge_catalog SET kind = 'citation' WHERE code LIKE ?", ("TRF-%",))
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS judge_id INTEGER")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS final_result TEXT NOT NULL DEFAULT ''")
    db.execute("UPDATE citations SET final_result = status WHERE final_result = '' AND status NOT IN ('issued','contested','reviewed','reduced')")
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS target_context TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS last_known TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS requirements TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'police'")
    db.execute("CREATE INDEX IF NOT EXISTS arma_link_codes_code_idx ON arma_link_codes (code)")
    db.execute("CREATE INDEX IF NOT EXISTS arma_link_codes_status_idx ON arma_link_codes (status)")
    db.execute("CREATE INDEX IF NOT EXISTS arma_activity_logs_user_idx ON arma_activity_logs (user_id)")
    db.execute("CREATE INDEX IF NOT EXISTS panic_alerts_department_idx ON panic_alerts (department)")


def get_system_settings(db: Database) -> dict[str, Any]:
    rows = all_rows(db, "SELECT setting_key, setting_value FROM system_settings")
    raw = {row["setting_key"]: row["setting_value"] for row in rows}
    raw = {**SYSTEM_SETTING_DEFAULTS, **raw}
    try:
        minutes = int(raw.get("autopilot_verify_minutes") or SYSTEM_SETTING_DEFAULTS["autopilot_verify_minutes"])
    except (TypeError, ValueError):
        minutes = int(SYSTEM_SETTING_DEFAULTS["autopilot_verify_minutes"])
    minutes = max(1, min(minutes, 10080))
    return {
        "autopilot_verify_enabled": str(raw.get("autopilot_verify_enabled") or "0") in ("1", "true", "True", "yes", "on"),
        "autopilot_verify_minutes": minutes,
    }


def set_system_setting(db: Database, key: str, value: str) -> None:
    if key not in SYSTEM_SETTING_DEFAULTS:
        raise ValueError("Unsupported system setting")
    db.execute(
        """
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
        """,
        (key, value, now_iso()),
    )


def auto_verify_stats(db: Database, settings: dict[str, Any] | None = None) -> dict[str, int]:
    settings = settings or get_system_settings(db)
    cutoff = (utcnow() - dt.timedelta(minutes=int(settings["autopilot_verify_minutes"]))).isoformat()
    pending = one(db, "SELECT COUNT(*) AS count FROM users WHERE verified = 0")
    eligible = one(
        db,
        "SELECT COUNT(*) AS count FROM users WHERE verified = 0 AND created_at <= ? AND roles NOT LIKE ? AND roles NOT LIKE ?",
        (cutoff, "%owner%", "%admin%"),
    )
    return {
        "pending_accounts": int(pending["count"] if pending else 0),
        "eligible_accounts": int(eligible["count"] if eligible else 0),
    }


def apply_auto_verification(db: Database) -> int:
    settings = get_system_settings(db)
    if not settings["autopilot_verify_enabled"]:
        return 0
    cutoff = (utcnow() - dt.timedelta(minutes=int(settings["autopilot_verify_minutes"]))).isoformat()
    rows = all_rows(
        db,
        """
        SELECT id, name
        FROM users
        WHERE verified = 0
          AND created_at <= ?
          AND roles NOT LIKE ?
          AND roles NOT LIKE ?
        ORDER BY created_at ASC
        LIMIT 100
        """,
        (cutoff, "%owner%", "%admin%"),
    )
    ts = now_iso()
    for row in rows:
        user_id = int(row["id"])
        db.execute("UPDATE users SET verified = 1 WHERE id = ?", (user_id,))
        create_default_dmv(db, user_id)
        db.execute(
            "UPDATE dmv_records SET license_status = 'Valid', registration_status = 'Active', insurance_status = 'Active', updated_at = ? WHERE user_id = ?",
            (ts, user_id),
        )
        add_message(
            db,
            user_id,
            "Account auto-verified",
            f"System autopilot verified your civilian profile after {settings['autopilot_verify_minutes']} minutes.",
        )
    return len(rows)


def seed_owner(db: Database) -> None:
    existing = one(db, "SELECT * FROM users WHERE email = ?", (OWNER_EMAIL,))
    owner_roles = sorted(set([*roles_for(existing), "owner", "admin", "civ"])) if existing else ["admin", "civ", "owner"]
    if existing:
        db.execute(
            """
            UPDATE users
            SET name = ?,
                password_hash = ?,
                verified = 1,
                roles = ?,
                primary_agency = COALESCE(primary_agency, 'Owner Command')
            WHERE id = ?
            """,
            (OWNER_NAME, hash_password(OWNER_PASSWORD), json.dumps(owner_roles), existing["id"]),
        )
        return
    ts = now_iso()
    db.execute(
        """
        INSERT INTO users
        (civ_number, name, email, arma_id, password_hash, verified, roles, primary_agency, bank_balance, cash_balance, last_income_at, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, 'Owner Command', 50000, 1000, ?, ?)
        """,
        (generate_civ_number(db), OWNER_NAME, OWNER_EMAIL, os.environ.get("OWNER_ARMA_ID", "OWNER"), hash_password(OWNER_PASSWORD), json.dumps(owner_roles), ts, ts),
    )


def seed_jobs(db: Database) -> None:
    if one(db, "SELECT id FROM jobs LIMIT 1"):
        return
    jobs = [
        ("Tow Operator", "transport", "Be on server 1 hour per day", 60, 34, 4),
        ("Courier Driver", "transport", "Be on server 1 hour per day", 60, 28, 8),
        ("Commercial Trucker", "transport", "Be on server 2 hours per day", 120, 54, 5),
        ("Auto Mechanic", "service", "Be on server 1 hour per day", 60, 38, 5),
        ("Security Guard", "service", "Be on server 2 hours per day", 120, 46, 4),
        ("Restaurant Manager", "service", "Be on server 1 hour per day", 60, 32, 6),
        ("News Reporter", "media", "Be on server 1 hour per day", 60, 36, 3),
        ("Field Producer", "media", "Be on server 2 hours per day", 120, 48, 2),
        ("Real Estate Agent", "property", "Be on server 2 hours per day", 120, 62, 3),
        ("Property Inspector", "property", "Be on server 1 hour per day", 60, 35, 4),
        ("Paralegal Assistant", "legal", "Be on server 1 hour per day", 60, 42, 4),
        ("Private Investigator", "legal", "Be on server 2 hours per day", 120, 58, 2),
        ("Clinic Receptionist", "medical", "Be on server 1 hour per day", 60, 30, 5),
        ("EMT Cadet", "medical", "Be on server 2 hours per day", 120, 45, 4),
    ]
    db.executemany(
        """
        INSERT INTO jobs (title, market, requirement, required_minutes_daily, rate_per_hour, max_positions)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        jobs,
    )
    caps = [("transport", 12), ("service", 10), ("media", 4), ("property", 5), ("legal", 6), ("medical", 7)]
    db.executemany("INSERT INTO market_caps (market, max_slots) VALUES (?, ?) ON CONFLICT (market) DO NOTHING", caps)


def seed_charges(db: Database) -> None:
    charges = [
        ("TRF-101", "Speeding 1-15 Over", "Moving Citation", "Operating a vehicle above the posted speed limit by 1 to 15 mph.", 150, 2, "Infraction", "citation"),
        ("TRF-102", "Speeding 16-30 Over", "Moving Citation", "Operating a vehicle above the posted speed limit by 16 to 30 mph.", 300, 4, "Citation", "citation"),
        ("TRF-201", "Reckless Driving", "Moving Citation", "Driving with willful disregard for public safety.", 750, 6, "Major Citation", "citation"),
        ("TRF-301", "Expired Registration", "Equipment Citation", "Operating a motor vehicle with expired or invalid registration.", 125, 1, "Infraction", "citation"),
        ("TRF-302", "No Proof of Insurance", "Equipment Citation", "Failure to present valid proof of financial responsibility.", 250, 2, "Infraction", "citation"),
        ("TRF-401", "Failure to Stop", "Moving Citation", "Failure to stop at a posted stop sign or steady red signal.", 180, 2, "Infraction", "citation"),
        ("TRF-402", "Improper Lane Change", "Moving Citation", "Unsafe or unsignaled lane movement creating a traffic hazard.", 160, 2, "Infraction", "citation"),
        ("TRF-501", "Illegal Parking", "Parking Citation", "Parking in a restricted, fire lane, or no-parking zone.", 90, 0, "Parking Citation", "citation"),
        ("TRF-601", "Vehicle Equipment Violation", "Equipment Citation", "Operating a vehicle with unlawful lighting, tint, or unsafe equipment.", 110, 0, "Fix-It Citation", "citation"),
        ("PEN-110", "Failure to Identify", "Public Order", "Refusing lawful identification during an investigation.", 350, 0, "Misdemeanor", "criminal"),
        ("PEN-210", "Disorderly Conduct", "Public Order", "Creating a public disturbance or hazardous condition.", 400, 0, "Misdemeanor", "criminal"),
        ("PEN-330", "Trespassing", "Property", "Knowingly entering or remaining on property without permission.", 450, 0, "Misdemeanor", "criminal"),
        ("PEN-410", "Petty Theft", "Property", "Unlawfully taking property below the felony threshold.", 600, 0, "Misdemeanor", "criminal"),
        ("PEN-520", "Assault", "Violent Crime", "Attempting or causing unlawful physical harm to another person.", 1200, 0, "Felony", "criminal"),
        ("WPN-101", "Unlawful Weapon Possession", "Weapons", "Possessing a weapon without a valid permit or exemption.", 1500, 0, "Felony", "criminal"),
        ("NAR-101", "Controlled Substance Possession", "Narcotics", "Possessing a controlled substance without authorization.", 900, 0, "Misdemeanor", "criminal"),
    ]
    ny_penal_law_charges = [
        ("NYPL-100.00", "Criminal Solicitation in the 5th Degree", "Solicitation", "Soliciting another person to engage in conduct constituting a crime.", 150, 0, "Violation", "criminal"),
        ("NYPL-100.05", "Criminal Solicitation in the 4th Degree", "Solicitation", "Soliciting felony conduct, or soliciting a crime from a person under 16 when the actor is over 18.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-100.08", "Criminal Solicitation in the 3rd Degree", "Solicitation", "Soliciting felony conduct from a person under 16 when the actor is over 18.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-100.10", "Criminal Solicitation in the 2nd Degree", "Solicitation", "Soliciting another person to engage in conduct constituting a Class A felony.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-100.13", "Criminal Solicitation in the 1st Degree", "Solicitation", "Soliciting Class A felony conduct from a person under 16 when the actor is over 18.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-105.00", "Conspiracy in the 6th Degree", "Conspiracy", "Agreeing with one or more persons to engage in or cause conduct constituting a crime.", 250, 0, "Class B Misdemeanor", "criminal"),
        ("NYPL-105.05", "Conspiracy in the 5th Degree", "Conspiracy", "Agreeing to commit a felony, or agreeing to commit a crime with a participant under 16 when the actor is over 18.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-105.10", "Conspiracy in the 4th Degree", "Conspiracy", "Agreeing to commit a Class B or Class C felony, or a felony with a participant under 16 when the actor is over 18.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-105.13", "Conspiracy in the 3rd Degree", "Conspiracy", "Agreeing to commit a Class B or Class C felony with a participant under 16 when the actor is over 18.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-105.15", "Conspiracy in the 2nd Degree", "Conspiracy", "Agreeing with one or more persons to engage in or cause conduct constituting a Class A felony.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-105.17", "Conspiracy in the 1st Degree", "Conspiracy", "Agreeing to commit a Class A felony with a participant under 16 when the actor is over 18.", 10000, 0, "Class A-I Felony", "criminal"),
        ("NYPL-110.00", "Criminal Attempt", "Inchoate Offenses", "With intent to commit a crime, engaging in conduct tending to effect commission of that crime.", 0, 0, "Offense Class Varies", "criminal"),
        ("NYPL-115.00", "Criminal Facilitation in the 4th Degree", "Criminal Facilitation", "Providing means or opportunity that aids another person's commission of a felony or certain crimes involving a person under 16.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-115.01", "Criminal Facilitation in the 3rd Degree", "Criminal Facilitation", "Providing aid for felony conduct involving a person under 16 when the actor is over 18.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-115.05", "Criminal Facilitation in the 2nd Degree", "Criminal Facilitation", "Providing means or opportunity that aids another person's commission of a Class A felony.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-115.08", "Criminal Facilitation in the 1st Degree", "Criminal Facilitation", "Providing aid for Class A felony conduct involving a person under 16 when the actor is over 18.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-120.00", "Assault in the 3rd Degree", "Assault", "Causing physical injury intentionally, recklessly, or through criminal negligence with a deadly weapon or dangerous instrument.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-120.05", "Assault in the 2nd Degree", "Assault", "Causing serious physical injury, injury with a deadly weapon or dangerous instrument, injury to protected responders, or injury during certain felonies.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-120.10", "Assault in the 1st Degree", "Assault", "Causing serious physical injury by deadly weapon or dangerous instrument, permanent disfigurement, depraved-risk conduct, or felony assault conduct.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-120.11", "Aggravated Assault Upon a Police or Peace Officer", "Assault", "Intentionally causing serious physical injury to a known police or peace officer performing official duties by deadly weapon or dangerous instrument.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-120.20", "Reckless Endangerment in the 2nd Degree", "Reckless Endangerment", "Recklessly engaging in conduct that creates a substantial risk of serious physical injury to another person.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-120.25", "Reckless Endangerment in the 1st Degree", "Reckless Endangerment", "Under circumstances showing depraved indifference to human life, recklessly creating a grave risk of death.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-125.10", "Criminally Negligent Homicide", "Homicide", "Causing the death of another person through criminal negligence.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-125.15", "Manslaughter in the 2nd Degree", "Homicide", "Recklessly causing the death of another person, or intentionally causing or aiding another person to die by suicide.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-125.20", "Manslaughter in the 1st Degree", "Homicide", "Causing death while intending serious physical injury, or causing death under extreme emotional disturbance.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-125.25", "Murder in the 2nd Degree", "Homicide", "Causing death intentionally, by depraved-risk conduct, or during listed felony conduct or immediate flight.", 10000, 0, "Class A-I Felony", "criminal"),
        ("NYPL-125.27", "Murder in the 1st Degree", "Homicide", "Intentional murder involving listed aggravating circumstances, including protected official victims and actor age requirements.", 10000, 0, "Class A-I Felony", "criminal"),
        ("NYPL-130.20", "Sexual Misconduct", "Sex Offenses", "Engaging in prohibited sexual conduct without consent or with prohibited circumstances under the source outline.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-130.25", "Rape in the 3rd Degree", "Sex Offenses", "Engaging in prohibited intercourse involving incapacity to consent or age-based prohibited conduct under the source outline.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-130.30", "Rape in the 2nd Degree", "Sex Offenses", "Engaging in prohibited intercourse involving age-based prohibited conduct under the source outline.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-130.35", "Rape in the 1st Degree", "Sex Offenses", "Engaging in prohibited intercourse by forcible compulsion, physical helplessness, or listed age-based circumstances.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-130.38", "Consensual Sodomy", "Sex Offenses", "Legacy source-outline offense for consensual sodomy.", 250, 0, "Class B Misdemeanor", "criminal"),
        ("NYPL-130.40", "Sodomy in the 3rd Degree", "Sex Offenses", "Comparable source-outline sodomy offense in the 3rd degree.", 1000, 0, "Class E Felony", "criminal"),
        ("NYPL-130.45", "Sodomy in the 2nd Degree", "Sex Offenses", "Comparable source-outline sodomy offense in the 2nd degree.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-130.50", "Sodomy in the 1st Degree", "Sex Offenses", "Comparable source-outline sodomy offense in the 1st degree.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-135.60", "Coercion in the 2nd Degree", "Coercion", "Compelling or inducing another person to act or abstain from lawful action by instilling listed fears.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-135.65", "Coercion in the 1st Degree", "Coercion", "Coercion involving fear of physical injury or property damage, or compelling felony conduct, physical injury, or public-duty violations.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-140.10", "Trespass in the 3rd Degree", "Burglary and Trespass", "Knowingly entering or remaining unlawfully in a building or enclosed real property.", 250, 0, "Class B Misdemeanor", "criminal"),
        ("NYPL-140.15", "Trespass in the 2nd Degree", "Burglary and Trespass", "Knowingly entering or remaining unlawfully in a dwelling.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-140.17", "Trespass in the 1st Degree", "Burglary and Trespass", "Knowingly entering or remaining unlawfully in a dwelling while possessing, or knowing another participant possesses, a deadly weapon.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-140.20", "Burglary in the 3rd Degree", "Burglary and Trespass", "Knowingly entering or remaining unlawfully in a building with intent to commit a crime inside.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-140.25", "Burglary in the 2nd Degree", "Burglary and Trespass", "Burglary involving weapons, injury, dangerous instruments, firearm display, or a dwelling.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-140.30", "Burglary in the 1st Degree", "Burglary and Trespass", "Burglary of a dwelling involving a deadly weapon, injury, dangerous instrument, or displayed firearm.", 5000, 0, "Class B Felony", "criminal"),
        ("NYPL-140.35", "Possession of Burglar's Tools", "Burglary and Trespass", "Possessing tools or instruments for unlawful entry or burglary under the source outline.", 500, 0, "Class A Misdemeanor", "criminal"),
        ("NYPL-160.05", "Robbery in the 3rd Degree", "Robbery", "Forcibly stealing property.", 1500, 0, "Class D Felony", "criminal"),
        ("NYPL-160.10", "Robbery in the 2nd Degree", "Robbery", "Forcible stealing aided by another present, causing injury, or displaying what appears to be a firearm.", 2500, 0, "Class C Felony", "criminal"),
        ("NYPL-160.15", "Robbery in the 1st Degree", "Robbery", "Forcible stealing involving a deadly weapon, injury, dangerous instrument, or displayed firearm.", 5000, 0, "Class B Felony", "criminal"),
    ]
    charges.extend(ny_penal_law_charges)
    db.executemany(
        """
        INSERT INTO charge_catalog (code, title, category, description, fine_amount, points, severity, kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (code) DO UPDATE SET
            title = excluded.title,
            category = excluded.category,
            description = excluded.description,
            fine_amount = excluded.fine_amount,
            points = excluded.points,
            severity = excluded.severity,
            kind = excluded.kind
        """,
        charges,
    )


def seed_properties(db: Database) -> None:
    if one(db, "SELECT id FROM properties LIMIT 1"):
        return
    ts = now_iso()
    properties = [
        ("Vespucci Studio", "210 Bay Ave", 4500, 22, "available", None, ts),
        ("Harmony Ranch House", "78 Joshua Rd", 12500, 65, "available", None, ts),
        ("Downtown Loft", "602 Alta St", 18000, 95, "available", None, ts),
        ("Sandy Shores Garage", "14 Marina Dr", 9500, 40, "available", None, ts),
        ("Paleto Cabin", "9 Procopio Promenade", 7200, 35, "available", None, ts),
    ]
    db.executemany(
        "INSERT INTO properties (name, address, price, rent_rate, status, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        properties,
    )


def create_default_dmv(db: Database, user_id: int) -> None:
    plate = f"RP{user_id:04d}{secrets.randbelow(90) + 10}"
    db.execute(
        """
        INSERT INTO dmv_records
        (user_id, license_status, license_class, vehicle_make, vehicle_model, vehicle_color, plate, registration_status, insurance_status, updated_at)
        VALUES (?, 'Pending verification', 'Class D', 'Unregistered', 'Vehicle', 'Gray', ?, 'Pending', 'Pending', ?)
        ON CONFLICT (user_id) DO NOTHING
        """,
        (user_id, plate, now_iso()),
    )


def admin_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "admin"):
        return "Owner or admin access required"
    return None


def owner_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner"):
        return "Owner access required"
    return None


def verified_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not bool(user["verified"]) and not has_any(user, "owner", "admin"):
        return "Civilian verification required"
    return None


def contracts_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if has_any(user, "owner"):
        return None
    if not bool(user["verified"]):
        return "Civilian verification required"
    if set(roles_for(user)) != {"civ"}:
        return "Civilian contract access required"
    return None


def leo_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "leo", "cid", "owner"):
        return "Law enforcement access required"
    return None


def fire_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "fireman", "ems", "owner"):
        return "Fire department access required"
    return None


def emergency_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "leo", "cid", "fireman", "ems", "dispatcher", "owner"):
        return "Emergency services access required"
    return None


def emergency_departments_for(user: DbRow) -> list[str]:
    if has_any(user, "owner", "dispatcher"):
        return ["police", "fire", "ems"]
    departments: list[str] = []
    if has_any(user, "leo", "cid"):
        departments.append("police")
    if has_any(user, "fireman"):
        departments.append("fire")
    if has_any(user, "ems"):
        departments.append("ems")
    return departments or ["police"]


def cid_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "cid", "owner"):
        return "CID access required"
    return None


def judge_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "judge", "owner"):
        return "Court access required"
    return None


def app_catalog(user: DbRow | None) -> list[dict[str, Any]]:
    if not user:
        return []
    verified = bool(user["verified"]) or has_any(user, "owner", "admin")
    contracts_enabled = contracts_required(user) is None
    business_enabled = verified or is_business_staff(user)
    base = [
        ("profile", "Profile", "user", True, False),
        ("dmv", "DMV", "id-card", verified, False),
        ("jobs", "JOB", "briefcase", False, True),
        ("court", "COURT", "gavel", verified, False),
        ("business", "Business", "store", business_enabled, False),
        ("properties", "PROPERTIES", "home", False, True),
        ("cash", "CASH APP", "send", False, True),
        ("bank", "BANK", "bank", False, True),
        ("messages", "Messages", "message", verified, False),
        ("changelog", "Changelog", "scroll", True, False),
    ]
    apps = [
        {"id": key, "label": label, "icon": icon, "enabled": enabled, "coming_soon": coming_soon, "hidden": False}
        for key, label, icon, enabled, coming_soon in base
    ]
    if contracts_enabled:
        apps.append({"id": "contracts", "label": "Contracts", "icon": "target", "enabled": True, "coming_soon": False, "hidden": False})
    if has_any(user, "leo", "cid", "owner"):
        apps.append({"id": "mdt", "label": "MDT", "icon": "shield", "enabled": True, "hidden": False})
    if has_any(user, "fireman", "ems", "owner"):
        apps.append({"id": "fire", "label": "Fire MDT", "icon": "flame", "enabled": True, "hidden": False})
    if has_any(user, "owner"):
        apps.append({"id": "system", "label": "System", "icon": "settings", "enabled": True, "hidden": False})
    if has_any(user, "owner", "admin"):
        apps.append({"id": "admin", "label": "Admin", "icon": "settings", "enabled": True, "hidden": False})
    return apps


def add_message(db: Database, recipient_id: int, subject: str, body: str, sender_id: int | None = None) -> None:
    db.execute(
        "INSERT INTO messages (sender_id, recipient_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
        (sender_id, recipient_id, subject, body, now_iso()),
    )


def add_transaction(
    db: Database,
    user_id: int,
    kind: str,
    amount: float,
    description: str,
    counterparty_id: int | None = None,
) -> None:
    db.execute(
        "INSERT INTO transactions (user_id, type, amount, description, counterparty_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, kind, amount, description, counterparty_id, now_iso()),
    )


ACTIVE_CASE_STATUSES = ("issued", "contested", "reviewed", "reduced")
CLOSED_CASE_STATUSES = ("paid", "dismissed", "closed")


def case_status_clause(active: bool) -> str:
    if active:
        return "c.status IN ('issued','contested','reviewed','reduced')"
    return "c.status NOT IN ('issued','contested','reviewed','reduced')"


def final_result_for(status: str, notes: str | None = None, fine_amount: float | None = None) -> str:
    clean = status.strip().title()
    if status == "paid" and fine_amount is not None:
        clean = f"Paid - fine satisfied at ${fine_amount:,.2f}"
    elif status == "dismissed":
        clean = "Dismissed by court"
    elif status == "reduced" and fine_amount is not None:
        clean = f"Reduced - fine set to ${fine_amount:,.2f}"
    if notes:
        clean = f"{clean}: {notes}"
    return clean


def pick_presiding_judge(db: Database) -> DbRow | None:
    judge = one(db, "SELECT id, name FROM users WHERE roles LIKE ? ORDER BY id LIMIT 1", ("%judge%",))
    if judge:
        return judge
    return one(
        db,
        "SELECT id, name FROM users WHERE roles LIKE ? ORDER BY id LIMIT 1",
        ("%owner%",),
    )


def presence_seconds(db: Database, user_id: int) -> int:
    row = one(db, "SELECT seconds FROM user_presence WHERE user_id = ? AND day = ?", (user_id, today_key()))
    return int(row["seconds"]) if row else 0


def active_jobs(db: Database, user_id: int) -> list[dict[str, Any]]:
    rows = all_rows(
        db,
        """
        SELECT uj.id AS assignment_id, uj.started_at, j.*
        FROM user_jobs uj
        JOIN jobs j ON j.id = uj.job_id
        WHERE uj.user_id = ? AND uj.status = 'active'
        ORDER BY uj.started_at DESC
        """,
        (user_id,),
    )
    return [dict(row) for row in rows]


def income_snapshot(db: Database, user: DbRow) -> dict[str, Any]:
    jobs = active_jobs(db, user["id"])
    seconds = presence_seconds(db, user["id"])
    minutes = seconds / 60
    eligible = [job for job in jobs if minutes >= int(job["required_minutes_daily"])]
    total_rate = sum(float(job["rate_per_hour"]) for job in eligible)
    last = parse_iso(user["last_income_at"])
    elapsed_hours = max((utcnow() - last).total_seconds(), 0) / 3600
    pending = round(total_rate * elapsed_hours, 2)
    next_requirements = [
        {
            "job_id": job["id"],
            "title": job["title"],
            "required_minutes_daily": job["required_minutes_daily"],
            "met": minutes >= int(job["required_minutes_daily"]),
        }
        for job in jobs
    ]
    return {
        "pending_income": pending,
        "eligible_rate_per_hour": round(total_rate, 2),
        "active_jobs": jobs,
        "presence_seconds_today": seconds,
        "requirements": next_requirements,
        "last_income_at": user["last_income_at"],
    }


class RoleplayHandler(BaseHTTPRequestHandler):
    server_version = "RoleplayPWA/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("QUIET_LOGS") != "1":
            super().log_message(format, *args)

    def do_GET(self) -> None:
        self.route()

    def do_POST(self) -> None:
        self.route()

    def do_PATCH(self) -> None:
        self.route()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()

    def route(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            self.route_api(path, parse_qs(parsed.query))
            return
        self.serve_static(path)

    def send_json(self, status: int, payload: dict[str, Any] | list[Any], extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Credentials", "true")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        text = raw.decode("utf-8", errors="replace").strip()
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            form_payload = parse_qs(text)
            if form_payload:
                return {key: values[-1] for key, values in form_payload.items() if values}
            return {"code": text} if text else {}
        return payload if isinstance(payload, dict) else {}

    def cookie_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw)
        except cookies.CookieError:
            return None
        morsel = jar.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def current_user(self, db: Database) -> DbRow | None:
        user_id = read_session(self.cookie_token())
        if not user_id:
            return None
        return one(db, "SELECT * FROM users WHERE id = ?", (user_id,))

    def bridge_error(self) -> str | None:
        if not ARMA_BRIDGE_API_KEY:
            return "ARMA_BRIDGE_API_KEY is not configured on Railway"
        supplied = self.headers.get("X-API-Key", "").strip()
        auth = self.headers.get("Authorization", "").strip()
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
        if not supplied or not hmac.compare_digest(supplied, ARMA_BRIDGE_API_KEY):
            return "Invalid Arma bridge API key"
        return None

    def session_header(self, user_id: int) -> str:
        secure = "; Secure" if os.environ.get("COOKIE_SECURE", "0").lower() in ("1", "true", "yes") else ""
        return f"{COOKIE_NAME}={sign_session(user_id)}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax{secure}"

    def clear_session_header(self) -> str:
        return f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"

    def serve_static(self, path: str) -> None:
        if path == "/":
            target = STATIC_ROOT / "index.html"
        elif path == "/manifest.webmanifest":
            target = STATIC_ROOT / "manifest.webmanifest"
        elif path == "/service-worker.js":
            target = STATIC_ROOT / "service-worker.js"
        elif path.startswith("/static/"):
            target = STATIC_ROOT / path.removeprefix("/static/")
        else:
            target = STATIC_ROOT / "index.html"

        try:
            resolved = target.resolve()
            if STATIC_ROOT.resolve() not in resolved.parents and resolved != STATIC_ROOT.resolve():
                self.error(403, "Forbidden")
                return
            if not resolved.exists() or not resolved.is_file():
                self.error(404, "Not found")
                return
            body = resolved.read_bytes()
        except OSError:
            self.error(500, "Unable to read static asset")
            return

        content_type, _ = mimetypes.guess_type(str(resolved))
        if resolved.name == "manifest.webmanifest":
            content_type = "application/manifest+json"
        elif resolved.suffix == ".js":
            content_type = "application/javascript"
        elif resolved.suffix == ".css":
            content_type = "text/css"
        elif resolved.suffix == ".svg":
            content_type = "image/svg+xml"

        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        if resolved.name == "index.html" or resolved.name == "service-worker.js" or resolved.suffix in (".js", ".css"):
            cache_control = "no-cache"
        else:
            cache_control = "public, max-age=3600"
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def route_api(self, path: str, query: dict[str, list[str]]) -> None:
        method = self.command
        try:
            with conn() as db:
                user = self.current_user(db)
                if path == "/api/health" and method == "GET":
                    self.send_json(200, {"ok": True, "time": now_iso()})
                elif path == "/api/auth/register" and method == "POST":
                    self.api_register(db)
                elif path == "/api/auth/login" and method == "POST":
                    self.api_login(db)
                elif path == "/api/auth/logout" and method == "POST":
                    self.send_json(200, {"ok": True}, {"Set-Cookie": self.clear_session_header()})
                elif path == "/api/session" and method == "GET":
                    self.api_session(db, user)
                elif path == "/api/changelog" and method == "GET":
                    self.api_changelog(user)
                elif path == "/api/presence" and method == "POST":
                    self.api_presence(db, user)
                elif path == "/api/profile" and method == "GET":
                    self.api_profile(db, user)
                elif path == "/api/profile/link-arma" and method == "POST":
                    self.api_claim_arma_link(db, user)
                elif path == "/api/arma/link-requests" and method == "POST":
                    self.api_arma_link_requests(db)
                elif path == "/api/arma/snapshot" and method == "GET":
                    self.api_arma_snapshot(db)
                elif path == "/api/arma/events" and method == "POST":
                    self.api_arma_events(db)
                elif path == "/api/jobs" and method == "GET":
                    self.api_jobs(db, user)
                elif path.startswith("/api/jobs/") and path.endswith("/apply") and method == "POST":
                    self.api_apply_job(db, user, self.path_int(path, 2))
                elif path == "/api/bank" and method == "GET":
                    self.api_bank(db, user)
                elif path == "/api/bank/collect" and method == "POST":
                    self.api_collect_bank(db, user)
                elif path == "/api/cash/transfer" and method == "POST":
                    self.api_cash_transfer(db, user)
                elif path == "/api/dmv/me" and method == "GET":
                    self.api_dmv_me(db, user)
                elif path == "/api/dmv/me" and method == "PATCH":
                    self.api_dmv_update(db, user)
                elif path == "/api/dmv/license-applications" and method == "POST":
                    self.api_dmv_apply_license(db, user)
                elif path == "/api/dmv/vehicles" and method == "POST":
                    self.api_dmv_register_vehicle(db, user)
                elif path == "/api/messages" and method == "GET":
                    self.api_messages(db, user)
                elif path == "/api/messages" and method == "POST":
                    self.api_send_message(db, user)
                elif path == "/api/contracts" and method == "GET":
                    self.api_contracts(db, user)
                elif path == "/api/contracts" and method == "POST":
                    self.api_create_contract(db, user)
                elif path.startswith("/api/contracts/") and path.endswith("/accept") and method == "POST":
                    self.api_accept_contract(db, user, self.path_int(path, 2))
                elif path.startswith("/api/contracts/") and path.endswith("/proof") and method == "POST":
                    self.api_submit_contract_proof(db, user, self.path_int(path, 2))
                elif path == "/api/business" and method == "GET":
                    self.api_business(db, user)
                elif path == "/api/business/applications" and method == "POST":
                    self.api_create_business_application(db, user)
                elif path.startswith("/api/business/applications/") and method == "PATCH":
                    self.api_review_business_application(db, user, self.path_int(path, 3))
                elif path.startswith("/api/business/licenses/") and path.endswith("/inspections") and method == "POST":
                    self.api_create_business_inspection(db, user, self.path_int(path, 3))
                elif path.startswith("/api/business/licenses/") and path.endswith("/violations") and method == "POST":
                    self.api_create_business_violation(db, user, self.path_int(path, 3))
                elif path.startswith("/api/business/licenses/") and method == "PATCH":
                    self.api_update_business_license(db, user, self.path_int(path, 3))
                elif path == "/api/properties" and method == "GET":
                    self.api_properties(db, user)
                elif path.startswith("/api/properties/") and path.endswith("/buy") and method == "POST":
                    self.api_buy_property(db, user, self.path_int(path, 2))
                elif path == "/api/court/my-cases" and method == "GET":
                    self.api_my_cases(db, user)
                elif path.startswith("/api/court/my-cases/") and path.endswith("/pay") and method == "POST":
                    self.api_pay_case(db, user, self.path_int(path, 3))
                elif path.startswith("/api/court/my-cases/") and path.endswith("/contest") and method == "POST":
                    self.api_contest_case(db, user, self.path_int(path, 3))
                elif path == "/api/court/cases" and method == "GET":
                    self.api_judge_cases(db, user)
                elif path.startswith("/api/court/cases/") and method == "PATCH":
                    self.api_update_case(db, user, self.path_int(path, 3))
                elif path == "/api/mdt/search" and method == "GET":
                    self.api_mdt_search(db, user, query)
                elif path == "/api/mdt/charges" and method == "GET":
                    self.api_mdt_charges(db, user)
                elif path == "/api/mdt/citations" and method == "POST":
                    self.api_issue_citation(db, user)
                elif path == "/api/mdt/panic" and method == "POST":
                    self.api_panic(db, user)
                elif path == "/api/mdt/alerts" and method == "GET":
                    self.api_alerts(db, user)
                elif path.startswith("/api/mdt/alerts/") and method == "PATCH":
                    self.api_clear_alert(db, user, self.path_int(path, 3))
                elif path == "/api/fire/overview" and method == "GET":
                    self.api_fire_overview(db, user)
                elif path.startswith("/api/fire/alerts/") and method == "PATCH":
                    self.api_update_fire_alert(db, user, self.path_int(path, 3))
                elif path == "/api/cid/overview" and method == "GET":
                    self.api_cid_overview(db, user)
                elif path == "/api/cid/investigations" and method == "POST":
                    self.api_cid_create_investigation(db, user)
                elif path.startswith("/api/cid/investigations/") and path.endswith("/notes") and method == "POST":
                    self.api_cid_add_note(db, user, self.path_int(path, 3))
                elif path.startswith("/api/cid/investigations/") and method == "PATCH":
                    self.api_cid_update_investigation(db, user, self.path_int(path, 3))
                elif path == "/api/cid/warrants" and method == "POST":
                    self.api_cid_create_warrant(db, user)
                elif path.startswith("/api/cid/warrants/") and method == "PATCH":
                    self.api_cid_update_warrant(db, user, self.path_int(path, 3))
                elif path == "/api/cid/internal-affairs" and method == "POST":
                    self.api_cid_create_ia(db, user)
                elif path.startswith("/api/cid/internal-affairs/") and method == "PATCH":
                    self.api_cid_update_ia(db, user, self.path_int(path, 3))
                elif path == "/api/system/settings" and method == "GET":
                    self.api_system_settings(db, user)
                elif path == "/api/system/settings" and method == "PATCH":
                    self.api_update_system_settings(db, user)
                elif path == "/api/admin/overview" and method == "GET":
                    self.api_admin_overview(db, user)
                elif path == "/api/admin/users" and method == "GET":
                    self.api_admin_users(db, user)
                elif path.startswith("/api/admin/users/") and method == "PATCH":
                    self.api_admin_update_user(db, user, self.path_int(path, 3))
                elif path == "/api/admin/jobs" and method == "GET":
                    self.api_admin_jobs(db, user)
                elif path.startswith("/api/admin/jobs/") and method == "PATCH":
                    self.api_admin_update_job(db, user, self.path_int(path, 3))
                elif path.startswith("/api/admin/markets/") and method == "PATCH":
                    market = path.split("/")[-1]
                    self.api_admin_update_market(db, user, market)
                else:
                    self.error(404, "Route not found")
        except psycopg.IntegrityError as exc:
            self.error(409, f"Database conflict: {exc}")
        except ValueError as exc:
            self.error(400, str(exc))
        except Exception as exc:
            if os.environ.get("DEBUG_ERRORS") == "1":
                raise
            self.error(500, f"Server error: {exc}")

    def path_int(self, path: str, index: int) -> int:
        parts = [part for part in path.split("/") if part]
        return int(parts[index])

    def api_register(self, db: Database) -> None:
        payload = self.read_json()
        missing = require_fields(payload, "name", "email", "arma_id", "password")
        if missing:
            self.error(400, missing)
            return
        email = str(payload["email"]).strip().lower()
        arma_id = str(payload["arma_id"]).strip()
        password = str(payload["password"])
        if len(password) < 6:
            self.error(400, "Password must be at least 6 characters")
            return
        if len(arma_id) < 4:
            self.error(400, "Arma ID must be at least 4 characters")
            return
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO users (civ_number, name, email, arma_id, password_hash, verified, roles, bank_balance, cash_balance, last_income_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, 0, 250, ?, ?)
            RETURNING id
            """,
            (generate_civ_number(db), str(payload["name"]).strip(), email, arma_id, hash_password(password), json.dumps(["civ"]), ts, ts),
        )
        created = cur.fetchone()
        user_id = int(created["id"])
        create_default_dmv(db, user_id)
        owner = one(db, "SELECT id FROM users WHERE email = ?", (OWNER_EMAIL,))
        add_message(
            db,
            user_id,
            "Civilian profile received",
            "Your account is queued for owner/admin verification. Once approved, the phone apps will unlock.",
            owner["id"] if owner else None,
        )
        self.send_json(201, {"ok": True}, {"Set-Cookie": self.session_header(user_id)})

    def api_login(self, db: Database) -> None:
        payload = self.read_json()
        missing = require_fields(payload, "email", "password")
        if missing:
            self.error(400, missing)
            return
        email = str(payload["email"]).strip().lower()
        user = one(db, "SELECT * FROM users WHERE email = ?", (email,))
        if not user or not verify_password(str(payload["password"]), user["password_hash"]):
            self.error(401, "Invalid email or password")
            return
        self.send_json(200, {"ok": True, "user": public_user(user)}, {"Set-Cookie": self.session_header(user["id"])})

    def api_session(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.send_json(200, {"user": None, "apps": []})
            return
        apply_auto_verification(db)
        user = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],)) or user
        unread = one(db, "SELECT COUNT(*) AS count FROM messages WHERE recipient_id = ? AND read_at IS NULL", (user["id"],))
        self.send_json(
            200,
            {
                "user": public_user(user),
                "apps": app_catalog(user),
                "unread_messages": int(unread["count"] if unread else 0),
                "income": income_snapshot(db, user),
            },
        )

    def api_changelog(self, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        path = STATIC_ROOT / "changelog.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {"version": "unavailable", "entries": []}
        self.send_json(200, payload)

    def api_presence(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        day = today_key()
        row = one(db, "SELECT * FROM user_presence WHERE user_id = ? AND day = ?", (user["id"], day))
        ts = now_iso()
        increment = 60
        if row and row["last_seen"]:
            delta = (utcnow() - parse_iso(row["last_seen"])).total_seconds()
            increment = int(max(0, min(delta, 120)))
        if row:
            db.execute(
                "UPDATE user_presence SET seconds = seconds + ?, last_seen = ? WHERE user_id = ? AND day = ?",
                (increment, ts, user["id"], day),
            )
        else:
            db.execute(
                "INSERT INTO user_presence (user_id, day, seconds, last_seen) VALUES (?, ?, ?, ?)",
                (user["id"], day, increment, ts),
            )
        apply_auto_verification(db)
        self.send_json(200, {"ok": True, "presence_seconds_today": presence_seconds(db, user["id"])})

    def api_profile(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        link = one(db, "SELECT * FROM arma_account_links WHERE user_id = ?", (user["id"],))
        activity = all_rows(
            db,
            """
            SELECT * FROM arma_activity_logs
            WHERE user_id = ?
            ORDER BY received_at DESC
            LIMIT 20
            """,
            (user["id"],),
        )
        pending_codes = all_rows(
            db,
            """
            SELECT code, server_id, player_name, platform, created_at, expires_at
            FROM arma_link_codes
            WHERE claimed_by = ? AND status = 'claimed'
            ORDER BY claimed_at DESC
            LIMIT 3
            """,
            (user["id"],),
        )
        self.send_json(
            200,
            {
                "user": {**public_user(user), "registered_arma_id": user.get("arma_id") or ""},
                "arma_link": dict(link) if link else None,
                "recent_activity": [dict(row) for row in activity],
                "claimed_codes": [dict(row) for row in pending_codes],
            },
        )

    def api_claim_arma_link(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        payload = self.read_json()
        query = parse_qs(urlparse(self.path).query)
        code_value = (
            payload.get("code")
            or payload.get("LinkCode")
            or payload.get("linkCode")
            or payload.get("link_code")
            or (query.get("code") or [""])[0]
        )
        if not str(code_value or "").strip():
            self.error(400, "No link code was sent. Type the in-game code shown by TBS RP LINKING SYSTEM, for example 1-145595.")
            return
        code = str(code_value).strip().upper()
        request = one(
            db,
            """
            SELECT * FROM arma_link_codes
            WHERE UPPER(code) = UPPER(?) AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (code,),
        )
        if not request:
            self.error(404, "Link code was not found in Railway yet. Wait for the TBS bridge to sync the in-game code, then try again.")
            return
        if parse_iso(request["expires_at"]) < utcnow():
            db.execute("UPDATE arma_link_codes SET status = 'expired' WHERE id = ?", (request["id"],))
            self.error(410, "Link code expired. Generate a fresh code in-game.")
            return
        identity_id = str(request["identity_id"] or "").strip()
        if not identity_id:
            self.error(409, "Link code is missing Arma identity data")
            return
        other = one(db, "SELECT * FROM arma_account_links WHERE identity_id = ? AND user_id <> ?", (identity_id, user["id"]))
        if other:
            self.error(409, "That Arma account is already linked to another PWA profile")
            return
        ts = now_iso()
        db.execute(
            """
            INSERT INTO arma_account_links
            (user_id, server_id, identity_id, uid, rpl_identity, platform, player_name, linked_at, last_seen_at, last_sync_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                server_id = excluded.server_id,
                identity_id = excluded.identity_id,
                uid = excluded.uid,
                rpl_identity = excluded.rpl_identity,
                platform = excluded.platform,
                player_name = excluded.player_name,
                last_seen_at = excluded.last_seen_at,
                last_sync_at = excluded.last_sync_at
            """,
            (
                user["id"],
                request["server_id"],
                identity_id,
                request.get("uid") or "",
                request.get("rpl_identity") or "",
                request.get("platform") or "",
                request.get("player_name") or "",
                ts,
                request["created_at"],
                ts,
            ),
        )
        db.execute("UPDATE users SET arma_id = ? WHERE id = ?", (identity_id, user["id"]))
        db.execute("UPDATE arma_link_codes SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?", (user["id"], ts, request["id"]))
        add_message(db, user["id"], "Arma account linked", f"Linked Arma player {request.get('player_name') or identity_id} from {request['server_id']}.")
        self.send_json(200, {"ok": True})

    def bridge_payload_data(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("Data")
        return data if isinstance(data, dict) else payload

    def bridge_value(self, source: dict[str, Any], *keys: str, default: Any = "") -> Any:
        for key in keys:
            value = source.get(key)
            if value not in (None, ""):
                return value
        return default

    def api_arma_link_requests(self, db: Database) -> None:
        err = self.bridge_error()
        if err:
            self.error(403, err)
            return
        payload = self.read_json()
        data = self.bridge_payload_data(payload)
        requests = data.get("Requests")
        if not isinstance(requests, list):
            requests = [data] if data.get("LinkCode") else []
        accepted: list[str] = []
        rejected: list[dict[str, str]] = []
        for index, request in enumerate(requests):
            if not isinstance(request, dict):
                rejected.append({"index": str(index), "reason": "Request was not an object"})
                continue
            code = str(self.bridge_value(request, "LinkCode", "code", "linkCode", "link_code")).strip().upper()
            identity_id = str(self.bridge_value(request, "IdentityId", "Uid", "identityId", "uid")).strip()
            rpl_identity = str(self.bridge_value(request, "RplIdentityValue", "RplIdentity"))[:160]
            request_id = str(request.get("RequestId") or "")[:120]
            player_name = str(request.get("PlayerName") or "")[:120]
            if not code:
                rejected.append({"index": str(index), "request_id": request_id, "player_name": player_name, "reason": "Missing LinkCode"})
                continue
            if not identity_id:
                rejected.append({"index": str(index), "code": code, "request_id": request_id, "player_name": player_name, "reason": "Missing IdentityId/Uid"})
                continue
            request_server_id = str(request.get("ServerId") or "").strip()
            data_server_id = str(data.get("ServerId") or "").strip()
            if request_server_id and request_server_id.lower() != "default":
                server_id = request_server_id
            elif data_server_id:
                server_id = data_server_id
            else:
                server_id = request_server_id or "default"
            existing = one(db, "SELECT * FROM arma_link_codes WHERE server_id = ? AND UPPER(code) = UPPER(?)", (server_id, code))
            if existing and existing["status"] == "claimed":
                accepted.append(code)
                continue
            created_at_dt = parse_bridge_datetime(str(request.get("CreatedAtUtc") or ""))
            created_at = created_at_dt.isoformat()
            expires_at = (created_at_dt + dt.timedelta(minutes=max(5, ARMA_LINK_CODE_TTL_MINUTES))).isoformat()
            raw_payload = json.dumps(request, separators=(",", ":"), default=str)[:4000]
            if existing:
                db.execute(
                    """
                    UPDATE arma_link_codes
                    SET request_id = ?, identity_id = ?, uid = ?, rpl_identity = ?, platform = ?, player_name = ?,
                        status = 'pending', created_at = ?, expires_at = ?, raw_payload = ?
                    WHERE id = ?
                    """,
                    (
                        request_id,
                        identity_id,
                        str(request.get("Uid") or "")[:160],
                        rpl_identity,
                        str(request.get("Platform") or "")[:60],
                        str(request.get("PlayerName") or "")[:120],
                        created_at,
                        expires_at,
                        raw_payload,
                        existing["id"],
                    ),
                )
            else:
                db.execute(
                    """
                    INSERT INTO arma_link_codes
                    (code, request_id, server_id, identity_id, uid, rpl_identity, platform, player_name, status, created_at, expires_at, raw_payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                    """,
                    (
                        code,
                        request_id,
                        server_id,
                        identity_id,
                        str(request.get("Uid") or "")[:160],
                        rpl_identity,
                        str(request.get("Platform") or "")[:60],
                        str(request.get("PlayerName") or "")[:120],
                        created_at,
                        expires_at,
                        raw_payload,
                    ),
                )
            accepted.append(code)
        self.send_json(200, {"ok": True, "accepted": accepted, "rejected": rejected, "count": len(accepted), "rejected_count": len(rejected)})

    def api_arma_snapshot(self, db: Database) -> None:
        err = self.bridge_error()
        if err:
            self.error(403, err)
            return
        rows = all_rows(
            db,
            """
            SELECT l.*, u.id AS website_user_id, u.name AS website_username, u.civ_number, u.verified, u.roles,
                   u.primary_agency, u.cash_balance, u.bank_balance
            FROM arma_account_links l
            JOIN users u ON u.id = l.user_id
            ORDER BY l.linked_at DESC
            """,
        )
        players = []
        ts = now_iso()
        for row in rows:
            user_roles = roles_for(row)
            metadata = [
                {"Key": "civ_number", "Value": row.get("civ_number") or ""},
                {"Key": "primary_agency", "Value": row.get("primary_agency") or ""},
            ]
            players.append(
                {
                    "IdentityId": row["identity_id"],
                    "Uid": row.get("uid") or row["identity_id"],
                    "RplIdentityValue": row.get("rpl_identity") or "",
                    "Platform": row.get("platform") or "",
                    "Name": row.get("player_name") or row["website_username"],
                    "DiscordId": "",
                    "WebsiteUserId": str(row["website_user_id"]),
                    "WebsiteUsername": row["website_username"],
                    "SteamId": "",
                    "XboxId": "",
                    "Linked": 1,
                    "Whitelisted": 1 if bool(row["verified"]) or "owner" in user_roles or "admin" in user_roles else 0,
                    "Banned": 0,
                    "KickReason": "",
                    "Cash": int(float(row["cash_balance"] or 0)),
                    "Bank": int(float(row["bank_balance"] or 0)),
                    "RoleIds": user_roles,
                    "PermissionIds": [],
                    "Metadata": metadata,
                }
            )
        db.execute("UPDATE arma_account_links SET last_sync_at = ? WHERE id IN (SELECT id FROM arma_account_links)", (ts,))
        self.send_json(
            200,
            {
                "Data": {
                    "SchemaVersion": 1,
                    "FileName": "TBS RP Linking Server Snapshot",
                    "Description": "Written by the Railway PWA API for TBS RP LINKING SYSTEM.",
                    "ServerId": rows[0]["server_id"] if rows else "default",
                    "SnapshotRevision": int(utcnow().timestamp()),
                    "UpdatedAtUtc": ts,
                    "Players": players,
                }
            },
        )

    def find_arma_link_for_event(self, db: Database, event: dict[str, Any]) -> DbRow | None:
        identity_id = str(event.get("IdentityId") or "").strip()
        uid = str(event.get("Uid") or "").strip()
        rpl_identity = str(self.bridge_value(event, "RplIdentityValue", "RplIdentity")).strip()
        return one(
            db,
            """
            SELECT * FROM arma_account_links
            WHERE (? <> '' AND identity_id = ?)
               OR (? <> '' AND uid = ?)
               OR (? <> '' AND rpl_identity = ?)
            ORDER BY linked_at DESC
            LIMIT 1
            """,
            (identity_id, identity_id, uid, uid, rpl_identity, rpl_identity),
        )

    def api_arma_events(self, db: Database) -> None:
        err = self.bridge_error()
        if err:
            self.error(403, err)
            return
        payload = self.read_json()
        data = self.bridge_payload_data(payload)
        events = data.get("PendingEvents") or data.get("Events")
        if not isinstance(events, list):
            events = [data] if self.bridge_value(data, "EventTypeName", "EventType") else []
        accepted: list[str] = []
        skipped: list[str] = []
        for event in events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("EventId") or "").strip()
            if not event_id:
                sequence = self.bridge_value(event, "EventSequence", "Sequence", default=secrets.token_hex(4))
                event_id = f"{event.get('ServerId') or data.get('ServerId') or 'default'}-{sequence}"
            if one(db, "SELECT id FROM arma_activity_logs WHERE event_id = ?", (event_id,)):
                skipped.append(event_id)
                continue
            link = self.find_arma_link_for_event(db, event)
            user_id = link["user_id"] if link else None
            amount = round(float(event.get("Amount") or 0), 2)
            currency = str(event.get("Currency") or "").strip().lower()
            event_type = str(self.bridge_value(event, "EventTypeName", "EventType", default="player.action")).strip()[:80]
            action = str(event.get("Action") or "").strip()[:80]
            reason = str(event.get("Reason") or "").strip()[:240]
            source_system = str(event.get("SourceSystem") or "TBS_RP_LINKING_SYSTEM").strip()[:120]
            created_at = parse_bridge_datetime(str(event.get("CreatedAtUtc") or "")).isoformat()
            received_at = now_iso()
            db.execute(
                """
                INSERT INTO arma_activity_logs
                (event_id, user_id, server_id, event_type, action, source_system, reason, amount, currency, balance_after,
                 identity_id, uid, rpl_identity, platform, player_name, raw_payload, created_at, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    user_id,
                    str(event.get("ServerId") or data.get("ServerId") or "default")[:80],
                    event_type,
                    action,
                    source_system,
                    reason,
                    amount,
                    currency,
                    round(float(event.get("BalanceAfter") or 0), 2),
                    str(event.get("IdentityId") or "")[:160],
                    str(event.get("Uid") or "")[:160],
                    str(self.bridge_value(event, "RplIdentityValue", "RplIdentity"))[:160],
                    str(event.get("Platform") or "")[:60],
                    str(event.get("PlayerName") or "")[:120],
                    json.dumps(event, separators=(",", ":"), default=str)[:4000],
                    created_at,
                    received_at,
                ),
            )
            if user_id and event_type.startswith("money.") and amount:
                if currency == "bank":
                    db.execute("UPDATE users SET bank_balance = bank_balance + ? WHERE id = ?", (amount, user_id))
                else:
                    db.execute("UPDATE users SET cash_balance = cash_balance + ? WHERE id = ?", (amount, user_id))
                add_transaction(db, user_id, f"arma_{action or 'money'}", amount, reason or source_system)
            if link:
                db.execute("UPDATE arma_account_links SET last_seen_at = ?, last_sync_at = ? WHERE id = ?", (created_at, received_at, link["id"]))
            accepted.append(event_id)
        self.send_json(200, {"ok": True, "accepted_event_ids": accepted, "skipped_event_ids": skipped})

    def api_jobs(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT j.*,
                   (SELECT COUNT(*) FROM user_jobs uj WHERE uj.job_id = j.id AND uj.status = 'active') AS filled,
                   COALESCE(mc.max_slots, 0) AS market_cap,
                   (SELECT COUNT(*) FROM user_jobs uj JOIN jobs jj ON jj.id = uj.job_id WHERE jj.market = j.market AND uj.status = 'active') AS market_filled
            FROM jobs j
            LEFT JOIN market_caps mc ON mc.market = j.market
            WHERE j.active = 1
            ORDER BY j.market, j.rate_per_hour DESC
            """
        )
        assignments = active_jobs(db, user["id"])
        self.send_json(200, {"jobs": [dict(row) for row in rows], "active_jobs": assignments, "income": income_snapshot(db, user)})

    def api_apply_job(self, db: Database, user: DbRow | None, job_id: int) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        job = one(db, "SELECT * FROM jobs WHERE id = ? AND active = 1", (job_id,))
        if not job:
            self.error(404, "Job not found")
            return
        existing = one(db, "SELECT id FROM user_jobs WHERE user_id = ? AND job_id = ? AND status = 'active'", (user["id"], job_id))
        if existing:
            self.error(409, "You already hold this job")
            return
        filled = one(db, "SELECT COUNT(*) AS count FROM user_jobs WHERE job_id = ? AND status = 'active'", (job_id,))
        if int(filled["count"]) >= int(job["max_positions"]):
            self.error(409, "This job has no open positions")
            return
        market_filled = one(
            db,
            "SELECT COUNT(*) AS count FROM user_jobs uj JOIN jobs j ON j.id = uj.job_id WHERE j.market = ? AND uj.status = 'active'",
            (job["market"],),
        )
        market_cap = one(db, "SELECT max_slots FROM market_caps WHERE market = ?", (job["market"],))
        if market_cap and int(market_filled["count"]) >= int(market_cap["max_slots"]):
            self.error(409, "This market is capped by owner settings")
            return
        db.execute(
            "INSERT INTO user_jobs (user_id, job_id, status, started_at) VALUES (?, ?, 'active', ?)",
            (user["id"], job_id, now_iso()),
        )
        add_message(db, user["id"], "Job added", f"You are now employed as {job['title']}. Income unlocks after the daily server-time requirement is met.")
        self.send_json(201, {"ok": True})

    def api_bank(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        transactions = all_rows(
            db,
            "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
            (user["id"],),
        )
        self.send_json(
            200,
            {
                "balance": round(float(user["bank_balance"] or 0), 2),
                "cash": round(float(user["cash_balance"] or 0), 2),
                "income": income_snapshot(db, user),
                "transactions": [dict(row) for row in transactions],
            },
        )

    def api_collect_bank(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        snapshot = income_snapshot(db, user)
        pending = float(snapshot["pending_income"])
        ts = now_iso()
        if pending > 0:
            db.execute("UPDATE users SET bank_balance = bank_balance + ?, last_income_at = ? WHERE id = ?", (pending, ts, user["id"]))
            add_transaction(db, user["id"], "income", pending, "Collected passive job income")
        else:
            db.execute("UPDATE users SET last_income_at = ? WHERE id = ?", (ts, user["id"]))
        updated = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],))
        self.send_json(200, {"ok": True, "collected": round(pending, 2), "balance": round(float(updated["bank_balance"]), 2)})

    def api_cash_transfer(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "recipient_email", "amount")
        if missing:
            self.error(400, missing)
            return
        amount = round(float(payload["amount"]), 2)
        if amount <= 0:
            self.error(400, "Amount must be positive")
            return
        if amount > float(user["bank_balance"] or 0):
            self.error(409, "Insufficient bank balance")
            return
        recipient = one(db, "SELECT * FROM users WHERE email = ?", (str(payload["recipient_email"]).strip().lower(),))
        if not recipient:
            self.error(404, "Recipient not found")
            return
        if recipient["id"] == user["id"]:
            self.error(400, "Cannot transfer to yourself")
            return
        note = str(payload.get("note") or "Cash App transfer").strip()[:120]
        db.execute("UPDATE users SET bank_balance = bank_balance - ? WHERE id = ?", (amount, user["id"]))
        db.execute("UPDATE users SET bank_balance = bank_balance + ? WHERE id = ?", (amount, recipient["id"]))
        add_transaction(db, user["id"], "transfer_out", -amount, f"Sent to {recipient['name']}: {note}", recipient["id"])
        add_transaction(db, recipient["id"], "transfer_in", amount, f"Received from {user['name']}: {note}", user["id"])
        add_message(db, recipient["id"], "Cash App payment received", f"{user['name']} sent you ${amount:,.2f}. Note: {note}", user["id"])
        self.send_json(200, {"ok": True})

    def api_dmv_me(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        record = one(db, "SELECT * FROM dmv_records WHERE user_id = ?", (user["id"],))
        if not record:
            create_default_dmv(db, user["id"])
            record = one(db, "SELECT * FROM dmv_records WHERE user_id = ?", (user["id"],))
        vehicles = all_rows(db, "SELECT * FROM dmv_vehicles WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
        applications = all_rows(
            db,
            "SELECT * FROM dmv_license_applications WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        )
        self.send_json(200, {"record": dict(record), "vehicles": vehicles, "license_applications": applications})

    def api_dmv_update(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        allowed = ["vehicle_make", "vehicle_model", "vehicle_color", "plate", "insurance_status"]
        updates = {key: str(payload[key]).strip()[:40] for key in allowed if key in payload and str(payload[key]).strip()}
        if not updates:
            self.error(400, "No DMV fields provided")
            return
        keys = ", ".join([f"{key} = ?" for key in updates])
        values = list(updates.values()) + [now_iso(), user["id"]]
        db.execute(f"UPDATE dmv_records SET {keys}, registration_status = 'Active', license_status = 'Valid', updated_at = ? WHERE user_id = ?", values)
        self.send_json(200, {"ok": True})

    def api_dmv_apply_license(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "application_type", "license_class", "legal_name", "date_of_birth")
        if missing:
            self.error(400, missing)
            return
        application_type = str(payload["application_type"]).strip()[:80]
        license_class = str(payload["license_class"]).strip()[:30]
        legal_name = str(payload["legal_name"]).strip()[:120]
        date_of_birth = str(payload["date_of_birth"]).strip()[:20]
        notes = str(payload.get("notes") or "").strip()[:800]
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO dmv_license_applications
            (user_id, application_type, license_class, legal_name, date_of_birth, notes, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
            RETURNING id
            """,
            (user["id"], application_type, license_class, legal_name, date_of_birth, notes, ts, ts),
        ).fetchone()
        add_message(db, user["id"], "DMV application submitted", f"Your {application_type} application is pending DMV review.")
        admins = all_rows(db, "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?", ("%owner%", "%admin%"))
        for admin in admins:
            add_message(db, admin["id"], "DMV application pending", f"{user['name']} submitted a {application_type} application.", user["id"])
        self.send_json(201, {"ok": True, "application_id": int(created["id"])})

    def api_dmv_register_vehicle(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_color", "plate", "insurance_status")
        if missing:
            self.error(400, missing)
            return
        year = int(payload["vehicle_year"])
        current_year = utcnow().year + 1
        if year < 1900 or year > current_year:
            self.error(400, "Vehicle year is outside the accepted range")
            return
        if not one(db, "SELECT id FROM dmv_records WHERE user_id = ?", (user["id"],)):
            create_default_dmv(db, user["id"])
        plate = str(payload["plate"]).strip().upper()[:12]
        vin = generate_vehicle_vin(db)
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO dmv_vehicles
            (user_id, vehicle_year, vehicle_make, vehicle_model, vehicle_color, plate, vin, registration_status, insurance_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
            RETURNING id
            """,
            (
                user["id"],
                year,
                str(payload["vehicle_make"]).strip()[:40],
                str(payload["vehicle_model"]).strip()[:40],
                str(payload["vehicle_color"]).strip()[:30],
                plate,
                vin,
                str(payload["insurance_status"]).strip()[:30],
                ts,
                ts,
            ),
        ).fetchone()
        db.execute(
            """
            UPDATE dmv_records
            SET vehicle_make = ?, vehicle_model = ?, vehicle_color = ?, plate = ?, registration_status = 'Active', insurance_status = ?, updated_at = ?
            WHERE user_id = ?
            """,
            (
                str(payload["vehicle_make"]).strip()[:40],
                str(payload["vehicle_model"]).strip()[:40],
                str(payload["vehicle_color"]).strip()[:30],
                plate,
                str(payload["insurance_status"]).strip()[:30],
                ts,
                user["id"],
            ),
        )
        add_message(db, user["id"], "Vehicle registered", f"{year} {payload['vehicle_make']} {payload['vehicle_model']} was registered with plate {plate} and VIN {vin}.")
        self.send_json(201, {"ok": True, "vehicle_id": int(created["id"]), "vin": vin})

    def api_messages(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT m.*, COALESCE(s.name, 'System') AS sender_name
            FROM messages m
            LEFT JOIN users s ON s.id = m.sender_id
            WHERE m.recipient_id = ?
            ORDER BY m.created_at DESC
            LIMIT 50
            """,
            (user["id"],),
        )
        db.execute("UPDATE messages SET read_at = COALESCE(read_at, ?) WHERE recipient_id = ?", (now_iso(), user["id"]))
        self.send_json(200, {"messages": [dict(row) for row in rows]})

    def api_send_message(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "recipient_email", "subject", "body")
        if missing:
            self.error(400, missing)
            return
        recipient = one(db, "SELECT id FROM users WHERE email = ?", (str(payload["recipient_email"]).strip().lower(),))
        if not recipient:
            self.error(404, "Recipient not found")
            return
        add_message(db, recipient["id"], str(payload["subject"])[:80], str(payload["body"])[:800], user["id"])
        self.send_json(201, {"ok": True})

    def contract_select_sql(self) -> str:
        return """
            SELECT c.*,
                   poster.name AS poster_name, poster.civ_number AS poster_civ_number,
                   target.name AS target_name, target.civ_number AS target_civ_number,
                   accepter.name AS accepter_name, accepter.civ_number AS accepter_civ_number
            FROM rp_contracts c
            JOIN users poster ON poster.id = c.poster_id
            JOIN users target ON target.id = c.target_id
            LEFT JOIN users accepter ON accepter.id = c.accepted_by
        """

    def contract_payload(self, row: DbRow, user: DbRow) -> dict[str, Any]:
        owner_view = has_any(user, "owner")
        involved = row["poster_id"] == user["id"] or row.get("accepted_by") == user["id"]
        poster_visible = owner_view or involved
        accepter_visible = owner_view or involved
        proof_visible = owner_view or involved
        status = str(row["status"])
        return {
            "id": row["id"],
            "contract_number": row["contract_number"],
            "target_name": row["target_name"],
            "target_civ_number": row["target_civ_number"],
            "poster_name": row["poster_name"] if poster_visible else "Anonymous",
            "poster_civ_number": row["poster_civ_number"] if poster_visible else None,
            "accepter_name": row.get("accepter_name") if accepter_visible else ("Accepted" if row.get("accepted_by") else None),
            "accepter_civ_number": row.get("accepter_civ_number") if accepter_visible else None,
            "price": round(float(row["price"] or 0), 2),
            "target_context": row.get("target_context") or "",
            "last_known": row.get("last_known") or "",
            "details": row["details"],
            "requirements": row.get("requirements") or "",
            "status": status,
            "clip_url": row.get("clip_url") if proof_visible else None,
            "proof_note": row.get("proof_note") if proof_visible else "",
            "created_at": row["created_at"],
            "accepted_at": row.get("accepted_at"),
            "submitted_at": row.get("submitted_at"),
            "updated_at": row["updated_at"],
            "can_accept": not owner_view and status == "open" and row["poster_id"] != user["id"] and row["target_id"] != user["id"],
            "can_submit_proof": not owner_view and row.get("accepted_by") == user["id"] and status in ("accepted", "submitted"),
        }

    def api_contracts(self, db: Database, user: DbRow | None) -> None:
        err = contracts_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        base = self.contract_select_sql()
        if has_any(user, "owner"):
            all_contracts = all_rows(
                db,
                f"{base} ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'accepted' THEN 1 WHEN 'submitted' THEN 2 ELSE 3 END, c.created_at DESC LIMIT 150",
            )
            self.send_json(
                200,
                {
                    "owner_view": True,
                    "open": [self.contract_payload(row, user) for row in all_contracts if row["status"] == "open"],
                    "posted": [],
                    "accepted": [],
                    "all": [self.contract_payload(row, user) for row in all_contracts],
                },
            )
            return
        open_rows = all_rows(
            db,
            f"{base} WHERE c.status = 'open' AND c.poster_id <> ? AND c.target_id <> ? ORDER BY c.created_at DESC LIMIT 60",
            (user["id"], user["id"]),
        )
        posted_rows = all_rows(
            db,
            f"{base} WHERE c.poster_id = ? ORDER BY c.created_at DESC LIMIT 60",
            (user["id"],),
        )
        accepted_rows = all_rows(
            db,
            f"{base} WHERE c.accepted_by = ? ORDER BY CASE c.status WHEN 'accepted' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, c.updated_at DESC LIMIT 60",
            (user["id"],),
        )
        self.send_json(
            200,
            {
                "owner_view": False,
                "open": [self.contract_payload(row, user) for row in open_rows],
                "posted": [self.contract_payload(row, user) for row in posted_rows],
                "accepted": [self.contract_payload(row, user) for row in accepted_rows],
                "all": [],
            },
        )

    def api_create_contract(self, db: Database, user: DbRow | None) -> None:
        err = contracts_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        if has_any(user, "owner"):
            self.error(403, "Owner contract view is read-only")
            return
        payload = self.read_json()
        missing = require_fields(payload, "target_name", "price", "details")
        if missing:
            self.error(400, missing)
            return
        price = round(float(payload["price"]), 2)
        if price <= 0:
            self.error(400, "Price must be positive")
            return
        target_text = str(payload["target_name"]).strip()
        target_key = target_text.lower()
        target = one(
            db,
            """
            SELECT * FROM users
            WHERE lower(name) = ? OR lower(name) LIKE ?
            ORDER BY CASE WHEN lower(name) = ? THEN 0 ELSE 1 END, id
            LIMIT 1
            """,
            (target_key, f"%{target_key}%", target_key),
        )
        if not target:
            self.error(404, "Target player not found")
            return
        if target["id"] == user["id"]:
            self.error(400, "Cannot create a contract on yourself")
            return
        if not bool(target["verified"]) and not has_any(target, "owner", "admin"):
            self.error(409, "Target player is not verified")
            return
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO rp_contracts
            (contract_number, poster_id, target_id, price, target_context, last_known, details, requirements, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
            RETURNING id
            """,
            (
                generate_record_number(db, "rp_contracts", "contract_number", "CON"),
                user["id"],
                target["id"],
                price,
                str(payload.get("target_context") or "").strip()[:160],
                str(payload.get("last_known") or "").strip()[:180],
                str(payload["details"]).strip()[:900],
                str(payload.get("requirements") or "").strip()[:700],
                ts,
                ts,
            ),
        ).fetchone()
        self.send_json(201, {"ok": True, "contract_id": int(created["id"])})

    def api_accept_contract(self, db: Database, user: DbRow | None, contract_id: int) -> None:
        err = contracts_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        if has_any(user, "owner"):
            self.error(403, "Owner contract view is read-only")
            return
        contract = one(db, "SELECT * FROM rp_contracts WHERE id = ?", (contract_id,))
        if not contract:
            self.error(404, "Contract not found")
            return
        if contract["status"] != "open":
            self.error(409, "Contract is not open")
            return
        if contract["poster_id"] == user["id"] or contract["target_id"] == user["id"]:
            self.error(400, "You cannot accept this contract")
            return
        ts = now_iso()
        db.execute(
            "UPDATE rp_contracts SET accepted_by = ?, status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?",
            (user["id"], ts, ts, contract_id),
        )
        add_message(db, contract["poster_id"], "Contract accepted", f"{user['name']} accepted contract {contract['contract_number']}.", user["id"])
        self.send_json(200, {"ok": True, "contract_id": contract_id})

    def api_submit_contract_proof(self, db: Database, user: DbRow | None, contract_id: int) -> None:
        err = contracts_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        if has_any(user, "owner"):
            self.error(403, "Owner contract view is read-only")
            return
        contract = one(db, "SELECT * FROM rp_contracts WHERE id = ?", (contract_id,))
        if not contract:
            self.error(404, "Contract not found")
            return
        if contract.get("accepted_by") != user["id"]:
            self.error(403, "Only the accepted contractor can submit proof")
            return
        if contract["status"] not in ("accepted", "submitted"):
            self.error(409, "Contract is not accepting proof")
            return
        payload = self.read_json()
        missing = require_fields(payload, "clip_url")
        if missing:
            self.error(400, missing)
            return
        clip_url = str(payload["clip_url"]).strip()[:500]
        if not (clip_url.startswith("http://") or clip_url.startswith("https://")):
            self.error(400, "Clip URL must start with http:// or https://")
            return
        ts = now_iso()
        db.execute(
            "UPDATE rp_contracts SET clip_url = ?, proof_note = ?, status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?",
            (clip_url, str(payload.get("proof_note") or "").strip()[:600], ts, ts, contract_id),
        )
        add_message(db, contract["poster_id"], "Contract proof submitted", f"Proof clip was submitted for contract {contract['contract_number']}.", user["id"])
        self.send_json(200, {"ok": True})

    def business_application_select_sql(self) -> str:
        return """
            SELECT a.*,
                   applicant.name AS applicant_name, applicant.email AS applicant_email, applicant.civ_number AS applicant_civ_number,
                   reviewer.name AS reviewer_name
            FROM business_applications a
            JOIN users applicant ON applicant.id = a.applicant_id
            LEFT JOIN users reviewer ON reviewer.id = a.reviewer_id
        """

    def business_license_select_sql(self) -> str:
        return """
            SELECT b.*,
                   owner.name AS owner_name, owner.email AS owner_email, owner.civ_number AS owner_civ_number,
                   app.application_number,
                   (SELECT COUNT(*) FROM business_violations v WHERE v.business_id = b.id AND v.status = 'open') AS open_violations,
                   (SELECT COUNT(*) FROM business_inspections i WHERE i.business_id = b.id) AS inspection_count
            FROM businesses b
            JOIN users owner ON owner.id = b.owner_id
            LEFT JOIN business_applications app ON app.id = b.application_id
        """

    def business_application_payload(self, row: DbRow) -> dict[str, Any]:
        return {
            **dict(row),
            "startup_budget": round(float(row["startup_budget"] or 0), 2),
            "planned_employees": int(row["planned_employees"] or 0),
        }

    def business_license_payload(self, row: DbRow) -> dict[str, Any]:
        return {
            **dict(row),
            "startup_budget": round(float(row["startup_budget"] or 0), 2),
            "weekly_tax": round(float(row["weekly_tax"] or 0), 2),
            "planned_employees": int(row["planned_employees"] or 0),
            "activity_requirement_minutes": int(row["activity_requirement_minutes"] or 0),
            "reputation_score": int(row["reputation_score"] or 0),
            "insurance_required": bool(row["insurance_required"]),
            "open_violations": int(row.get("open_violations") or 0),
            "inspection_count": int(row.get("inspection_count") or 0),
        }

    def business_staff_rows(self, db: Database) -> list[DbRow]:
        return all_rows(
            db,
            """
            SELECT id FROM users
            WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ? OR roles LIKE ?
            """,
            ("%owner%", "%business_registrar%", "%city_hall%", "%economy_manager%"),
        )

    def api_business(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        staff_view = is_business_staff(user)
        if not bool(user["verified"]) and not has_any(user, "owner", "admin") and not staff_view:
            self.error(403, "Civilian verification required")
            return

        app_sql = self.business_application_select_sql()
        license_sql = self.business_license_select_sql()
        my_applications = all_rows(db, f"{app_sql} WHERE a.applicant_id = ? ORDER BY a.created_at DESC", (user["id"],))
        my_businesses = all_rows(db, f"{license_sql} WHERE b.owner_id = ? ORDER BY b.updated_at DESC", (user["id"],))
        inspections = all_rows(
            db,
            """
            SELECT i.*, b.license_number, b.business_name, inspector.name AS inspector_name
            FROM business_inspections i
            JOIN businesses b ON b.id = i.business_id
            JOIN users inspector ON inspector.id = i.inspector_id
            WHERE b.owner_id = ?
            ORDER BY i.created_at DESC
            LIMIT 40
            """,
            (user["id"],),
        )
        violations = all_rows(
            db,
            """
            SELECT v.*, b.license_number, b.business_name, issuer.name AS issuer_name
            FROM business_violations v
            JOIN businesses b ON b.id = v.business_id
            JOIN users issuer ON issuer.id = v.issued_by
            WHERE b.owner_id = ?
            ORDER BY v.created_at DESC
            LIMIT 40
            """,
            (user["id"],),
        )

        payload: dict[str, Any] = {
            "staff_view": staff_view,
            "categories": list(BUSINESS_LICENSE_CATEGORIES),
            "application_statuses": list(BUSINESS_APPLICATION_STATUSES),
            "license_statuses": list(BUSINESS_LICENSE_STATUSES),
            "max_active_per_owner": BUSINESS_MAX_ACTIVE_PER_OWNER,
            "applications": [self.business_application_payload(row) for row in my_applications],
            "businesses": [self.business_license_payload(row) for row in my_businesses],
            "inspections": [dict(row) for row in inspections],
            "violations": [dict(row) for row in violations],
        }

        if staff_view:
            review_queue = all_rows(
                db,
                f"""
                {app_sql}
                WHERE a.status IN ('submitted','under_review','interview_requested')
                ORDER BY CASE a.status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, a.created_at ASC
                LIMIT 120
                """,
            )
            all_businesses = all_rows(
                db,
                f"{license_sql} ORDER BY CASE b.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 WHEN 'revoked' THEN 2 ELSE 3 END, b.updated_at DESC LIMIT 160",
            )
            recent_reviews = all_rows(
                db,
                """
                SELECT r.*, a.application_number, a.business_name, reviewer.name AS reviewer_name
                FROM business_reviews r
                JOIN business_applications a ON a.id = r.application_id
                JOIN users reviewer ON reviewer.id = r.reviewer_id
                ORDER BY r.created_at DESC
                LIMIT 40
                """,
            )
            staff_inspections = all_rows(
                db,
                """
                SELECT i.*, b.license_number, b.business_name, inspector.name AS inspector_name
                FROM business_inspections i
                JOIN businesses b ON b.id = i.business_id
                JOIN users inspector ON inspector.id = i.inspector_id
                ORDER BY i.created_at DESC
                LIMIT 50
                """,
            )
            staff_violations = all_rows(
                db,
                """
                SELECT v.*, b.license_number, b.business_name, issuer.name AS issuer_name
                FROM business_violations v
                JOIN businesses b ON b.id = v.business_id
                JOIN users issuer ON issuer.id = v.issued_by
                ORDER BY v.created_at DESC
                LIMIT 50
                """,
            )
            stats = {
                "pending": one(db, "SELECT COUNT(*) AS count FROM business_applications WHERE status IN ('submitted','under_review','interview_requested')")["count"],
                "active": one(db, "SELECT COUNT(*) AS count FROM businesses WHERE status = 'active'")["count"],
                "suspended": one(db, "SELECT COUNT(*) AS count FROM businesses WHERE status = 'suspended'")["count"],
                "restricted": one(db, "SELECT COUNT(*) AS count FROM businesses WHERE license_category = 'restricted'")["count"],
            }
            payload.update(
                {
                    "review_queue": [self.business_application_payload(row) for row in review_queue],
                    "all_businesses": [self.business_license_payload(row) for row in all_businesses],
                    "recent_reviews": [dict(row) for row in recent_reviews],
                    "staff_inspections": [dict(row) for row in staff_inspections],
                    "staff_violations": [dict(row) for row in staff_violations],
                    "stats": stats,
                }
            )

        self.send_json(200, payload)

    def api_create_business_application(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        if not bool(user["verified"]) and not has_any(user, "owner", "admin") and not is_business_staff(user):
            self.error(403, "Civilian verification required")
            return
        payload = self.read_json()
        missing = require_fields(payload, "business_name", "business_type", "owner_name", "location", "description", "startup_budget", "planned_employees", "funding_source", "license_category")
        if missing:
            self.error(400, missing)
            return
        category = str(payload["license_category"]).strip().lower()
        if category not in BUSINESS_LICENSE_CATEGORIES:
            self.error(400, "Invalid license category")
            return
        startup_budget = round(float(payload["startup_budget"]), 2)
        planned_employees = int(payload["planned_employees"])
        if startup_budget < 0:
            self.error(400, "Startup budget cannot be negative")
            return
        if planned_employees < 1 or planned_employees > 250:
            self.error(400, "Planned employee count must be between 1 and 250")
            return
        active_count = one(
            db,
            "SELECT COUNT(*) AS count FROM businesses WHERE owner_id = ? AND status IN ('active','suspended')",
            (user["id"],),
        )
        pending_count = one(
            db,
            "SELECT COUNT(*) AS count FROM business_applications WHERE applicant_id = ? AND status IN ('submitted','under_review','interview_requested')",
            (user["id"],),
        )
        if int(active_count["count"]) + int(pending_count["count"]) >= BUSINESS_MAX_ACTIVE_PER_OWNER:
            self.error(409, f"Ownership limit reached. Max active or pending businesses: {BUSINESS_MAX_ACTIVE_PER_OWNER}")
            return
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO business_applications
            (application_number, applicant_id, business_name, business_type, owner_name, location, description, startup_budget, planned_employees, funding_source, license_category, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
            RETURNING id, application_number
            """,
            (
                generate_record_number(db, "business_applications", "application_number", "BIZ"),
                user["id"],
                str(payload["business_name"]).strip()[:120],
                str(payload["business_type"]).strip()[:80],
                str(payload["owner_name"]).strip()[:120],
                str(payload["location"]).strip()[:160],
                str(payload["description"]).strip()[:1200],
                startup_budget,
                planned_employees,
                str(payload["funding_source"]).strip()[:700],
                category,
                ts,
                ts,
            ),
        ).fetchone()
        add_message(db, user["id"], "Business application submitted", f"Application {created['application_number']} is pending Business Registry review.")
        for staff in self.business_staff_rows(db):
            if staff["id"] != user["id"]:
                add_message(db, staff["id"], "Business application pending", f"{user['name']} submitted {payload['business_name']} for review.", user["id"])
        self.send_json(201, {"ok": True, "application_id": int(created["id"]), "application_number": created["application_number"]})

    def api_review_business_application(self, db: Database, user: DbRow | None, application_id: int) -> None:
        err = business_staff_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        application = one(db, "SELECT * FROM business_applications WHERE id = ?", (application_id,))
        if not application:
            self.error(404, "Business application not found")
            return
        payload = self.read_json()
        status = str(payload.get("status") or payload.get("action") or application["status"]).strip().lower()
        if status not in BUSINESS_APPLICATION_STATUSES:
            self.error(400, "Invalid application status")
            return
        category = str(payload.get("license_category") or application["license_category"]).strip().lower()
        if category not in BUSINESS_LICENSE_CATEGORIES:
            self.error(400, "Invalid license category")
            return
        reviewer_notes = str(payload.get("reviewer_notes") or application.get("reviewer_notes") or "").strip()[:1200]
        interview_notes = str(payload.get("interview_notes") or application.get("interview_notes") or "").strip()[:1000]
        if status == "approved" and not one(db, "SELECT id FROM businesses WHERE application_id = ?", (application_id,)):
            active_count = one(
                db,
                "SELECT COUNT(*) AS count FROM businesses WHERE owner_id = ? AND status IN ('active','suspended')",
                (application["applicant_id"],),
            )
            if int(active_count["count"]) >= BUSINESS_MAX_ACTIVE_PER_OWNER:
                self.error(409, f"Ownership limit reached. Max active or suspended businesses: {BUSINESS_MAX_ACTIVE_PER_OWNER}")
                return
        ts = now_iso()
        decided_at = ts if status in ("approved", "denied") else application.get("decided_at")
        db.execute(
            """
            UPDATE business_applications
            SET status = ?, reviewer_id = ?, reviewer_notes = ?, interview_notes = ?, license_category = ?, updated_at = ?, decided_at = ?
            WHERE id = ?
            """,
            (status, user["id"], reviewer_notes, interview_notes, category, ts, decided_at, application_id),
        )
        db.execute(
            "INSERT INTO business_reviews (application_id, reviewer_id, action, notes, created_at) VALUES (?, ?, ?, ?, ?)",
            (application_id, user["id"], status, reviewer_notes or interview_notes, ts),
        )

        if status == "approved":
            existing = one(db, "SELECT id FROM businesses WHERE application_id = ?", (application_id,))
            if not existing:
                weekly_tax = round(float(payload.get("weekly_tax") or business_tax_default(category, float(application["startup_budget"] or 0))), 2)
                activity_requirement = int(payload.get("activity_requirement_minutes") or 120)
                expires_at = (utcnow() + dt.timedelta(days=365)).date().isoformat()
                created_license = db.execute(
                    """
                    INSERT INTO businesses
                    (license_number, application_id, owner_id, business_name, business_type, location, description, license_category, status, startup_budget, planned_employees, weekly_tax, activity_requirement_minutes, reputation_score, insurance_required, compliance_notes, created_at, updated_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 50, ?, ?, ?, ?, ?)
                    RETURNING license_number
                    """,
                    (
                        generate_record_number(db, "businesses", "license_number", "BUS"),
                        application_id,
                        application["applicant_id"],
                        application["business_name"],
                        application["business_type"],
                        application["location"],
                        application["description"],
                        category,
                        float(application["startup_budget"] or 0),
                        int(application["planned_employees"] or 1),
                        weekly_tax,
                        max(0, activity_requirement),
                        1 if category == "restricted" else 0,
                        reviewer_notes,
                        ts,
                        ts,
                        expires_at,
                    ),
                ).fetchone()
                applicant = one(db, "SELECT * FROM users WHERE id = ?", (application["applicant_id"],))
                if applicant:
                    updated_roles = sorted(set([*roles_for(applicant), "business_owner"]))
                    db.execute("UPDATE users SET roles = ? WHERE id = ?", (json.dumps(updated_roles), applicant["id"]))
                    add_message(
                        db,
                        applicant["id"],
                        "Business license approved",
                        f"{application['business_name']} was approved. License {created_license['license_number']} is active.",
                        user["id"],
                    )
        elif status == "denied":
            add_message(db, application["applicant_id"], "Business application denied", reviewer_notes or "Your business application was denied by the registry.", user["id"])
        elif status == "interview_requested":
            add_message(db, application["applicant_id"], "Business interview requested", interview_notes or "Business Registry requested an interview before final approval.", user["id"])
        else:
            add_message(db, application["applicant_id"], "Business application under review", reviewer_notes or "Business Registry is reviewing your application.", user["id"])

        self.send_json(200, {"ok": True})

    def api_update_business_license(self, db: Database, user: DbRow | None, business_id: int) -> None:
        err = business_staff_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        business = one(db, "SELECT * FROM businesses WHERE id = ?", (business_id,))
        if not business:
            self.error(404, "Business license not found")
            return
        payload = self.read_json()
        status = str(payload.get("status") or business["status"]).strip().lower()
        if status not in BUSINESS_LICENSE_STATUSES:
            self.error(400, "Invalid license status")
            return
        category = str(payload.get("license_category") or business["license_category"]).strip().lower()
        if category not in BUSINESS_LICENSE_CATEGORIES:
            self.error(400, "Invalid license category")
            return
        weekly_tax_raw = payload.get("weekly_tax", business["weekly_tax"])
        activity_raw = payload.get("activity_requirement_minutes", business["activity_requirement_minutes"])
        reputation_raw = payload.get("reputation_score", business["reputation_score"])
        insurance_raw = payload.get("insurance_required", bool(business["insurance_required"]))
        weekly_tax = round(float(weekly_tax_raw if weekly_tax_raw not in (None, "") else business["weekly_tax"]), 2)
        activity_requirement = int(activity_raw if activity_raw not in (None, "") else business["activity_requirement_minutes"])
        reputation = max(0, min(100, int(reputation_raw if reputation_raw not in (None, "") else business["reputation_score"])))
        if weekly_tax < 0 or activity_requirement < 0:
            self.error(400, "Tax and activity requirements cannot be negative")
            return
        notes = str(payload.get("compliance_notes") or business.get("compliance_notes") or "").strip()[:1200]
        db.execute(
            """
            UPDATE businesses
            SET status = ?, license_category = ?, weekly_tax = ?, activity_requirement_minutes = ?, reputation_score = ?, insurance_required = ?, compliance_notes = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                category,
                weekly_tax,
                activity_requirement,
                reputation,
                1 if bool(insurance_raw) else 0,
                notes,
                now_iso(),
                business_id,
            ),
        )
        add_message(db, business["owner_id"], "Business license updated", f"{business['business_name']} license status is now {status}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_create_business_inspection(self, db: Database, user: DbRow | None, business_id: int) -> None:
        err = business_staff_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        business = one(db, "SELECT * FROM businesses WHERE id = ?", (business_id,))
        if not business:
            self.error(404, "Business license not found")
            return
        payload = self.read_json()
        missing = require_fields(payload, "inspection_type", "result", "notes")
        if missing:
            self.error(400, missing)
            return
        db.execute(
            """
            INSERT INTO business_inspections (business_id, inspector_id, inspection_type, result, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                business_id,
                user["id"],
                str(payload["inspection_type"]).strip()[:80],
                str(payload["result"]).strip()[:80],
                str(payload["notes"]).strip()[:1000],
                now_iso(),
            ),
        )
        add_message(db, business["owner_id"], "Business inspection logged", f"Inspection added for {business['business_name']}. Result: {payload['result']}.", user["id"])
        self.send_json(201, {"ok": True})

    def api_create_business_violation(self, db: Database, user: DbRow | None, business_id: int) -> None:
        err = business_staff_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        business = one(db, "SELECT * FROM businesses WHERE id = ?", (business_id,))
        if not business:
            self.error(404, "Business license not found")
            return
        payload = self.read_json()
        missing = require_fields(payload, "severity", "violation")
        if missing:
            self.error(400, missing)
            return
        db.execute(
            """
            INSERT INTO business_violations (business_id, issued_by, severity, violation, penalty, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                business_id,
                user["id"],
                str(payload["severity"]).strip()[:40],
                str(payload["violation"]).strip()[:1000],
                str(payload.get("penalty") or "").strip()[:500],
                str(payload.get("status") or "open").strip()[:40],
                now_iso(),
            ),
        )
        add_message(db, business["owner_id"], "Business violation issued", f"A {payload['severity']} violation was issued for {business['business_name']}.", user["id"])
        self.send_json(201, {"ok": True})

    def api_properties(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT p.*, u.name AS owner_name
            FROM properties p
            LEFT JOIN users u ON u.id = p.owner_id
            ORDER BY CASE p.status WHEN 'available' THEN 0 ELSE 1 END, p.price ASC
            """
        )
        self.send_json(200, {"properties": [dict(row) for row in rows]})

    def api_buy_property(self, db: Database, user: DbRow | None, property_id: int) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        prop = one(db, "SELECT * FROM properties WHERE id = ?", (property_id,))
        if not prop:
            self.error(404, "Property not found")
            return
        if prop["status"] != "available":
            self.error(409, "Property is not available")
            return
        if float(user["bank_balance"] or 0) < float(prop["price"]):
            self.error(409, "Insufficient bank balance")
            return
        db.execute("UPDATE users SET bank_balance = bank_balance - ? WHERE id = ?", (prop["price"], user["id"]))
        db.execute("UPDATE properties SET owner_id = ?, status = 'owned' WHERE id = ?", (user["id"], property_id))
        add_transaction(db, user["id"], "property_purchase", -float(prop["price"]), f"Purchased {prop['name']}")
        self.send_json(200, {"ok": True})

    def api_my_cases(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        base_select = """
            SELECT c.*, civ.name AS civ_name, civ.email AS civ_email,
                   officer.name AS officer_name, judge.name AS judge_name
            FROM citations c
            JOIN users civ ON civ.id = c.civ_id
            JOIN users officer ON officer.id = c.officer_id
            LEFT JOIN users judge ON judge.id = c.judge_id
        """

        defendant_active = all_rows(
            db,
            f"{base_select} WHERE c.civ_id = ? AND {case_status_clause(True)} ORDER BY c.created_at DESC",
            (user["id"],),
        )
        defendant_previous = all_rows(
            db,
            f"{base_select} WHERE c.civ_id = ? AND {case_status_clause(False)} ORDER BY c.updated_at DESC",
            (user["id"],),
        )
        officer_active: list[DbRow] = []
        officer_previous: list[DbRow] = []
        if has_any(user, "leo", "cid", "owner"):
            officer_active = all_rows(
                db,
                f"{base_select} WHERE c.officer_id = ? AND {case_status_clause(True)} ORDER BY c.created_at DESC",
                (user["id"],),
            )
            officer_previous = all_rows(
                db,
                f"{base_select} WHERE c.officer_id = ? AND {case_status_clause(False)} ORDER BY c.updated_at DESC",
                (user["id"],),
            )
        judge_active = None
        judge_previous = None
        if has_any(user, "judge", "owner"):
            judge_active = all_rows(
                db,
                f"{base_select} WHERE (c.judge_id = ? OR c.judge_id IS NULL) AND {case_status_clause(True)} ORDER BY CASE c.status WHEN 'contested' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, c.created_at DESC",
                (user["id"],),
            )
            judge_previous = all_rows(
                db,
                f"{base_select} WHERE (c.judge_id = ? OR c.judge_id IS NULL) AND {case_status_clause(False)} ORDER BY c.updated_at DESC",
                (user["id"],),
            )
        self.send_json(
            200,
            {
                "cases": [dict(row) for row in defendant_active],
                "defendant": {"active": defendant_active, "previous": defendant_previous},
                "officer": {"active": officer_active, "previous": officer_previous},
                "judge": {"active": judge_active, "previous": judge_previous} if judge_active is not None else None,
            },
        )

    def api_pay_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        case = one(db, "SELECT * FROM citations WHERE id = ? AND civ_id = ?", (case_id, user["id"]))
        if not case:
            self.error(404, "Case not found")
            return
        if case["status"] in ("paid", "dismissed"):
            self.error(409, "Case is already closed")
            return
        amount = float(case["fine_amount"])
        if float(user["bank_balance"] or 0) < amount:
            self.error(409, "Insufficient bank balance")
            return
        db.execute("UPDATE users SET bank_balance = bank_balance - ? WHERE id = ?", (amount, user["id"]))
        db.execute(
            "UPDATE citations SET status = 'paid', final_result = ?, updated_at = ? WHERE id = ?",
            (final_result_for("paid", case.get("judgment_notes"), amount), now_iso(), case_id),
        )
        add_transaction(db, user["id"], "fine_payment", -amount, f"Paid citation {case['charge_code']} - {case['charge_title']}")
        self.send_json(200, {"ok": True})

    def api_contest_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        case = one(db, "SELECT * FROM citations WHERE id = ? AND civ_id = ?", (case_id, user["id"]))
        if not case:
            self.error(404, "Case not found")
            return
        db.execute("UPDATE citations SET status = 'contested', updated_at = ? WHERE id = ?", (now_iso(), case_id))
        judges = all_rows(
            db,
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?",
            ("%judge%", "%owner%"),
        )
        for judge in judges:
            add_message(db, judge["id"], "Citation contested", f"{user['name']} contested {case['charge_code']} - {case['charge_title']}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_judge_cases(self, db: Database, user: DbRow | None) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        base_query = """
            SELECT c.*, civ.name AS civ_name, civ.email AS civ_email, officer.name AS officer_name, judge.name AS judge_name
            FROM citations c
            JOIN users civ ON civ.id = c.civ_id
            JOIN users officer ON officer.id = c.officer_id
            LEFT JOIN users judge ON judge.id = c.judge_id
        """
        if has_any(user, "owner"):
            rows = all_rows(
                db,
                f"{base_query} ORDER BY CASE c.status WHEN 'contested' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 100",
            )
        else:
            rows = all_rows(
                db,
                f"{base_query} WHERE c.judge_id = ? OR c.judge_id IS NULL ORDER BY CASE c.status WHEN 'contested' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 100",
                (user["id"],),
            )
        self.send_json(200, {"cases": [dict(row) for row in rows]})

    def api_update_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        status = str(payload.get("status") or "").strip().lower()
        if status not in ("issued", "reviewed", "reduced", "dismissed", "paid", "contested", "closed"):
            self.error(400, "Invalid case status")
            return
        amount = payload.get("fine_amount")
        notes = str(payload.get("judgment_notes") or "")[:600]
        final_result = final_result_for(status, notes, float(amount)) if status in CLOSED_CASE_STATUSES and amount is not None else final_result_for(status, notes)
        if amount is not None:
            db.execute(
                "UPDATE citations SET status = ?, fine_amount = ?, judgment_notes = ?, judge_id = ?, final_result = ?, updated_at = ? WHERE id = ?",
                (status, float(amount), notes, user["id"], final_result if status in CLOSED_CASE_STATUSES else "", now_iso(), case_id),
            )
        else:
            db.execute(
                "UPDATE citations SET status = ?, judgment_notes = ?, judge_id = ?, final_result = ?, updated_at = ? WHERE id = ?",
                (status, notes, user["id"], final_result if status in CLOSED_CASE_STATUSES else "", now_iso(), case_id),
            )
        case = one(db, "SELECT * FROM citations WHERE id = ?", (case_id,))
        if case:
            add_message(db, case["civ_id"], "Court case updated", f"Your case {case['charge_code']} is now marked {status}.", user["id"])
            add_message(db, case["officer_id"], "Officer case updated", f"Case #{case_id} for {case['charge_code']} is now marked {status}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_mdt_search(self, db: Database, user: DbRow | None, query: dict[str, list[str]]) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        term = (query.get("q") or [""])[0].strip()
        if len(term) < 2:
            self.send_json(200, {"results": []})
            return
        like = f"%{term}%"
        rows = all_rows(
            db,
            """
            SELECT u.id, u.civ_number, u.name, u.email, u.verified, u.roles, d.license_status, d.license_class, d.vehicle_make,
                   d.vehicle_model, d.vehicle_color, d.plate, d.registration_status, d.insurance_status
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            WHERE u.name ILIKE ? OR u.email ILIKE ? OR u.civ_number ILIKE ? OR d.plate ILIKE ?
               OR EXISTS (SELECT 1 FROM dmv_vehicles v WHERE v.user_id = u.id AND v.plate ILIKE ?)
            ORDER BY u.name
            LIMIT 25
            """,
            (like, like, like, like, like),
        )
        results = []
        for row in rows:
            warrants = all_rows(
                db,
                "SELECT id, charge_code, charge_title, status, fine_amount FROM citations WHERE civ_id = ? AND status IN ('issued', 'contested', 'reviewed', 'reduced') ORDER BY created_at DESC LIMIT 10",
                (row["id"],),
            )
            vehicles = all_rows(
                db,
                "SELECT vehicle_year, vehicle_make, vehicle_model, vehicle_color, plate, registration_status, insurance_status FROM dmv_vehicles WHERE user_id = ? ORDER BY created_at DESC LIMIT 6",
                (row["id"],),
            )
            applications = all_rows(
                db,
                "SELECT application_type, license_class, status, created_at FROM dmv_license_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 4",
                (row["id"],),
            )
            item = dict(row)
            item["roles"] = roles_for(row)
            item["open_cases"] = [dict(w) for w in warrants]
            item["vehicles"] = vehicles
            item["license_applications"] = applications
            results.append(item)
        self.send_json(200, {"results": results})

    def api_mdt_charges(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(db, "SELECT * FROM charge_catalog ORDER BY kind DESC, category, code")
        catalog = [dict(row) for row in rows]
        self.send_json(
            200,
            {
                "charges": catalog,
                "citations": [row for row in catalog if row.get("kind") == "citation"],
                "criminal_charges": [row for row in catalog if row.get("kind") == "criminal"],
            },
        )

    def api_issue_citation(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "civ_id", "charge_id", "location", "narrative")
        if missing:
            self.error(400, missing)
            return
        civ = one(db, "SELECT * FROM users WHERE id = ?", (int(payload["civ_id"]),))
        charge = one(db, "SELECT * FROM charge_catalog WHERE id = ?", (int(payload["charge_id"]),))
        if not civ or not charge:
            self.error(404, "Civilian or charge not found")
            return
        default_court_date = (utcnow() + dt.timedelta(days=3)).date().isoformat()
        court_date = str(payload.get("court_date") or "").strip() or default_court_date
        presiding_judge = pick_presiding_judge(db)
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO citations
            (civ_id, officer_id, judge_id, charge_id, charge_code, charge_title, category, fine_amount, points, severity, location, narrative, court_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                civ["id"],
                user["id"],
                presiding_judge["id"] if presiding_judge else None,
                charge["id"],
                charge["code"],
                charge["title"],
                charge["category"],
                charge["fine_amount"],
                charge["points"],
                charge["severity"],
                str(payload["location"])[:120],
                str(payload["narrative"])[:1000],
                court_date,
                ts,
                ts,
            ),
        )
        created = cur.fetchone()
        citation_id = int(created["id"])
        add_message(
            db,
            civ["id"],
            f"New citation {charge['code']}",
            f"{user['name']} issued {charge['title']} for ${float(charge['fine_amount']):,.2f}. Open COURT to pay or contest.",
            user["id"],
        )
        add_message(db, user["id"], "Officer case filed", f"Case #{citation_id} was filed against {civ['name']} and is now in your COURT officer docket.", user["id"])
        if presiding_judge:
            add_message(
                db,
                presiding_judge["id"],
                "Presiding case assigned",
                f"Case #{citation_id} was assigned to you. Defendant: {civ['name']}. Officer: {user['name']}.",
                user["id"],
            )
        self.send_json(201, {"ok": True, "citation_id": citation_id, "court_date": court_date, "judge_id": presiding_judge["id"] if presiding_judge else None})

    def api_panic(self, db: Database, user: DbRow | None) -> None:
        err = emergency_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        department = str(payload.get("department") or "police").strip().lower()
        if department not in ("police", "fire", "ems"):
            self.error(400, "Invalid emergency department")
            return
        location = str(payload.get("location") or "Unknown location")[:120]
        note = str(payload.get("note") or "Emergency activation")[:240]
        cur = db.execute(
            "INSERT INTO panic_alerts (officer_id, department, location, note, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
            (user["id"], department, location, note, now_iso()),
        )
        created = cur.fetchone()
        recipient_patterns = {
            "police": ("%leo%", "%cid%", "%dispatcher%", "%owner%"),
            "fire": ("%fireman%", "%dispatcher%", "%owner%", "%admin%"),
            "ems": ("%ems%", "%dispatcher%", "%owner%", "%admin%"),
        }[department]
        recipients = all_rows(
            db,
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ? OR roles LIKE ?",
            recipient_patterns,
        )
        subject = f"911 {department.upper()} ALERT"
        for recipient in recipients:
            if recipient["id"] != user["id"]:
                add_message(db, recipient["id"], subject, f"{user['name']} activated a {department} emergency at {location}. {note}", user["id"])
        self.send_json(201, {"ok": True, "alert_id": int(created["id"]), "department": department})

    def api_alerts(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT p.*, u.name AS officer_name, u.primary_agency
            FROM panic_alerts p
            JOIN users u ON u.id = p.officer_id
            ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.created_at DESC
            LIMIT 30
            """
        )
        self.send_json(200, {"alerts": [dict(row) for row in rows]})

    def api_clear_alert(self, db: Database, user: DbRow | None, alert_id: int) -> None:
        err = owner_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        alert = one(db, "SELECT p.*, u.name AS officer_name FROM panic_alerts p JOIN users u ON u.id = p.officer_id WHERE p.id = ?", (alert_id,))
        if not alert:
            self.error(404, "Panic alert not found")
            return
        db.execute(
            "UPDATE panic_alerts SET status = 'cleared', resolved_at = ? WHERE id = ?",
            (now_iso(), alert_id),
        )
        add_message(db, alert["officer_id"], "Panic alert cleared", f"{user['name']} cleared your panic activation at {alert['location']}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_fire_overview(self, db: Database, user: DbRow | None) -> None:
        err = fire_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        departments = emergency_departments_for(user)
        visible = [department for department in departments if department in ("fire", "ems")]
        if has_any(user, "owner"):
            visible = ["fire", "ems"]
        if not visible:
            visible = ["fire"]
        placeholders = ",".join(["?"] * len(visible))
        rows = all_rows(
            db,
            f"""
            SELECT p.*, u.name AS officer_name, u.primary_agency
            FROM panic_alerts p
            JOIN users u ON u.id = p.officer_id
            WHERE p.department IN ({placeholders})
            ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'responding' THEN 1 ELSE 2 END, p.created_at DESC
            LIMIT 80
            """,
            tuple(visible),
        )
        stats = {
            "active": sum(1 for row in rows if row.get("status") == "active"),
            "responding": sum(1 for row in rows if row.get("status") == "responding"),
            "cleared": sum(1 for row in rows if row.get("status") == "cleared"),
        }
        self.send_json(200, {"departments": visible, "stats": stats, "alerts": [dict(row) for row in rows]})

    def api_update_fire_alert(self, db: Database, user: DbRow | None, alert_id: int) -> None:
        err = fire_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        status = str(payload.get("status") or "responding").strip().lower()
        if status not in ("active", "responding", "cleared"):
            self.error(400, "Invalid incident status")
            return
        alert = one(db, "SELECT * FROM panic_alerts WHERE id = ? AND department IN ('fire','ems')", (alert_id,))
        if not alert:
            self.error(404, "Fire incident not found")
            return
        departments = emergency_departments_for(user)
        if not has_any(user, "owner") and alert["department"] not in departments:
            self.error(403, "You cannot update that department incident")
            return
        resolved_at = now_iso() if status == "cleared" else None
        db.execute(
            "UPDATE panic_alerts SET status = ?, resolved_at = ? WHERE id = ?",
            (status, resolved_at, alert_id),
        )
        add_message(db, alert["officer_id"], "Fire MDT incident updated", f"Incident #{alert_id} is now {status}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_cid_overview(self, db: Database, user: DbRow | None) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        investigations = all_rows(
            db,
            """
            SELECT i.*, lead.name AS lead_name, target.name AS target_civ_name
            FROM cid_investigations i
            JOIN users lead ON lead.id = i.lead_id
            LEFT JOIN users target ON target.id = i.target_civ_id
            ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, i.updated_at DESC
            LIMIT 80
            """
        )
        warrants = all_rows(
            db,
            """
            SELECT w.*, creator.name AS creator_name, target.name AS subject_civ_name, i.case_number
            FROM cid_warrants w
            JOIN users creator ON creator.id = w.created_by
            LEFT JOIN users target ON target.id = w.subject_civ_id
            LEFT JOIN cid_investigations i ON i.id = w.investigation_id
            ORDER BY CASE w.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, w.updated_at DESC
            LIMIT 80
            """
        )
        ia_cases = all_rows(
            db,
            """
            SELECT ia.*, assigned.name AS assigned_name, subject.name AS subject_officer_name
            FROM cid_internal_affairs ia
            JOIN users assigned ON assigned.id = ia.assigned_to
            LEFT JOIN users subject ON subject.id = ia.subject_officer_id
            ORDER BY CASE ia.status WHEN 'intake' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, ia.updated_at DESC
            LIMIT 80
            """
        )
        notes = all_rows(
            db,
            """
            SELECT n.*, i.case_number, author.name AS author_name
            FROM cid_investigation_notes n
            JOIN cid_investigations i ON i.id = n.investigation_id
            JOIN users author ON author.id = n.author_id
            ORDER BY n.created_at DESC
            LIMIT 30
            """
        )
        stats = {
            "open_investigations": one(db, "SELECT COUNT(*) AS count FROM cid_investigations WHERE status NOT IN ('closed','archived')")["count"],
            "active_warrants": one(db, "SELECT COUNT(*) AS count FROM cid_warrants WHERE status = 'active'")["count"],
            "ia_open": one(db, "SELECT COUNT(*) AS count FROM cid_internal_affairs WHERE status NOT IN ('closed','sustained','unfounded')")["count"],
        }
        self.send_json(200, {"stats": stats, "investigations": investigations, "warrants": warrants, "ia_cases": ia_cases, "notes": notes})

    def api_cid_create_investigation(self, db: Database, user: DbRow | None) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "title", "case_type", "summary")
        if missing:
            self.error(400, missing)
            return
        ts = now_iso()
        target_civ_id = int(payload["target_civ_id"]) if str(payload.get("target_civ_id") or "").strip() else None
        created = db.execute(
            """
            INSERT INTO cid_investigations
            (case_number, title, case_type, status, priority, lead_id, target_civ_id, target_name, summary, location, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, case_number
            """,
            (
                generate_record_number(db, "cid_investigations", "case_number", "CID"),
                str(payload["title"]).strip()[:140],
                str(payload["case_type"]).strip()[:60],
                str(payload.get("status") or "open").strip()[:30],
                str(payload.get("priority") or "standard").strip()[:30],
                user["id"],
                target_civ_id,
                str(payload.get("target_name") or "").strip()[:120],
                str(payload["summary"]).strip()[:1400],
                str(payload.get("location") or "").strip()[:140],
                ts,
                ts,
            ),
        ).fetchone()
        self.send_json(201, {"ok": True, "id": int(created["id"]), "case_number": created["case_number"]})

    def api_cid_update_investigation(self, db: Database, user: DbRow | None, investigation_id: int) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        status = str(payload.get("status") or "open").strip()[:30]
        priority = str(payload.get("priority") or "standard").strip()[:30]
        db.execute(
            "UPDATE cid_investigations SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
            (status, priority, now_iso(), investigation_id),
        )
        self.send_json(200, {"ok": True})

    def api_cid_add_note(self, db: Database, user: DbRow | None, investigation_id: int) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "body")
        if missing:
            self.error(400, missing)
            return
        if not one(db, "SELECT id FROM cid_investigations WHERE id = ?", (investigation_id,)):
            self.error(404, "Investigation not found")
            return
        db.execute(
            "INSERT INTO cid_investigation_notes (investigation_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (investigation_id, user["id"], str(payload.get("note_type") or "case note").strip()[:50], str(payload["body"]).strip()[:1800], now_iso()),
        )
        db.execute("UPDATE cid_investigations SET updated_at = ? WHERE id = ?", (now_iso(), investigation_id))
        self.send_json(201, {"ok": True})

    def api_cid_create_warrant(self, db: Database, user: DbRow | None) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "subject_name", "warrant_type", "probable_cause")
        if missing:
            self.error(400, missing)
            return
        investigation_id = int(payload["investigation_id"]) if str(payload.get("investigation_id") or "").strip() else None
        subject_civ_id = int(payload["subject_civ_id"]) if str(payload.get("subject_civ_id") or "").strip() else None
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO cid_warrants
            (warrant_number, investigation_id, subject_civ_id, subject_name, warrant_type, status, priority, probable_cause, operation_plan, authorized_by, created_by, issued_at, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, warrant_number
            """,
            (
                generate_record_number(db, "cid_warrants", "warrant_number", "WAR"),
                investigation_id,
                subject_civ_id,
                str(payload["subject_name"]).strip()[:120],
                str(payload["warrant_type"]).strip()[:70],
                str(payload.get("status") or "active").strip()[:30],
                str(payload.get("priority") or "standard").strip()[:30],
                str(payload["probable_cause"]).strip()[:1600],
                str(payload.get("operation_plan") or "").strip()[:1600],
                str(payload.get("authorized_by") or "").strip()[:120],
                user["id"],
                ts,
                str(payload.get("expires_at") or "").strip()[:20] or None,
                ts,
            ),
        ).fetchone()
        self.send_json(201, {"ok": True, "id": int(created["id"]), "warrant_number": created["warrant_number"]})

    def api_cid_update_warrant(self, db: Database, user: DbRow | None, warrant_id: int) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        db.execute(
            "UPDATE cid_warrants SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
            (str(payload.get("status") or "active").strip()[:30], str(payload.get("priority") or "standard").strip()[:30], now_iso(), warrant_id),
        )
        self.send_json(200, {"ok": True})

    def api_cid_create_ia(self, db: Database, user: DbRow | None) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "subject_name", "allegation_type", "summary")
        if missing:
            self.error(400, missing)
            return
        subject_officer_id = int(payload["subject_officer_id"]) if str(payload.get("subject_officer_id") or "").strip() else None
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO cid_internal_affairs
            (ia_number, subject_officer_id, subject_name, allegation_type, status, priority, summary, assigned_to, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, ia_number
            """,
            (
                generate_record_number(db, "cid_internal_affairs", "ia_number", "IA"),
                subject_officer_id,
                str(payload["subject_name"]).strip()[:120],
                str(payload["allegation_type"]).strip()[:90],
                str(payload.get("status") or "intake").strip()[:30],
                str(payload.get("priority") or "standard").strip()[:30],
                str(payload["summary"]).strip()[:1600],
                user["id"],
                user["id"],
                ts,
                ts,
            ),
        ).fetchone()
        self.send_json(201, {"ok": True, "id": int(created["id"]), "ia_number": created["ia_number"]})

    def api_cid_update_ia(self, db: Database, user: DbRow | None, ia_id: int) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        db.execute(
            "UPDATE cid_internal_affairs SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
            (str(payload.get("status") or "active").strip()[:30], str(payload.get("priority") or "standard").strip()[:30], now_iso(), ia_id),
        )
        self.send_json(200, {"ok": True})

    def api_system_settings(self, db: Database, user: DbRow | None) -> None:
        err = owner_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        auto_verified = apply_auto_verification(db)
        settings = get_system_settings(db)
        self.send_json(200, {"settings": settings, "stats": auto_verify_stats(db, settings), "auto_verified_now": auto_verified})

    def api_update_system_settings(self, db: Database, user: DbRow | None) -> None:
        err = owner_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        if "autopilot_verify_enabled" in payload:
            enabled = payload.get("autopilot_verify_enabled")
        else:
            enabled = payload.get("enabled")
        current_settings = get_system_settings(db)
        if enabled is None:
            enabled = current_settings["autopilot_verify_enabled"]
        try:
            minutes = int(payload.get("autopilot_verify_minutes") or payload.get("minutes") or SYSTEM_SETTING_DEFAULTS["autopilot_verify_minutes"])
        except (TypeError, ValueError):
            self.error(400, "Autopilot time must be a number of minutes")
            return
        minutes = max(1, min(minutes, 10080))
        enabled_value = "1" if str(enabled).lower() in ("1", "true", "yes", "on") else "0"
        set_system_setting(db, "autopilot_verify_enabled", enabled_value)
        set_system_setting(db, "autopilot_verify_minutes", str(minutes))
        auto_verified = apply_auto_verification(db)
        settings = get_system_settings(db)
        self.send_json(200, {"ok": True, "settings": settings, "stats": auto_verify_stats(db, settings), "auto_verified_now": auto_verified})

    def api_admin_overview(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        stats = {
            "users": one(db, "SELECT COUNT(*) AS count FROM users")["count"],
            "unverified": one(db, "SELECT COUNT(*) AS count FROM users WHERE verified = 0")["count"],
            "active_jobs": one(db, "SELECT COUNT(*) AS count FROM user_jobs WHERE status = 'active'")["count"],
            "open_cases": one(db, "SELECT COUNT(*) AS count FROM citations WHERE status NOT IN ('paid','dismissed')")["count"],
            "panic_alerts": one(db, "SELECT COUNT(*) AS count FROM panic_alerts WHERE status = 'active'")["count"],
        }
        self.send_json(200, {"stats": stats})

    def api_admin_users(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(db, "SELECT * FROM users ORDER BY verified ASC, created_at DESC")
        users = []
        for row in rows:
            item = public_user(row)
            item["arma_id"] = row.get("arma_id")
            item["presence_seconds_today"] = presence_seconds(db, row["id"])
            users.append(item)
        self.send_json(200, {"users": users})

    def api_admin_update_user(self, db: Database, user: DbRow | None, target_id: int) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        target = one(db, "SELECT * FROM users WHERE id = ?", (target_id,))
        if not target:
            self.error(404, "User not found")
            return
        payload = self.read_json()
        next_roles = payload.get("roles", roles_for(target))
        if not isinstance(next_roles, list):
            self.error(400, "Roles must be a list")
            return
        cleaned = sorted(set(["civ", *[str(role).strip().lower() for role in next_roles if str(role).strip()]]))
        if "owner" in cleaned and not has_any(user, "owner"):
            self.error(403, "Only owners can assign owner access")
            return
        if "owner" in roles_for(target) and target_id == user["id"] and "owner" not in cleaned:
            cleaned.append("owner")
        if "owner" in roles_for(target) and not has_any(user, "owner"):
            self.error(403, "Only owners can edit another owner")
            return
        next_password = str(payload.get("password") or "").strip()
        if next_password:
            if len(next_password) < 6:
                self.error(400, "Password must be at least 6 characters")
                return
            if "owner" in roles_for(target) and not has_any(user, "owner"):
                self.error(403, "Only owners can reset another owner's password")
                return
        verified = 1 if bool(payload.get("verified", target["verified"])) else 0
        agency = str(payload.get("primary_agency") or target["primary_agency"] or "").strip()[:80] or None
        db.execute(
            "UPDATE users SET verified = ?, roles = ?, primary_agency = ? WHERE id = ?",
            (verified, json.dumps(cleaned), agency, target_id),
        )
        if next_password:
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(next_password), target_id))
        dmv = one(db, "SELECT id FROM dmv_records WHERE user_id = ?", (target_id,))
        if not dmv:
            create_default_dmv(db, target_id)
        if verified:
            db.execute(
                "UPDATE dmv_records SET license_status = 'Valid', registration_status = 'Active', insurance_status = 'Active', updated_at = ? WHERE user_id = ?",
                (now_iso(), target_id),
            )
        add_message(db, target_id, "Account updated", "An owner/admin updated your account settings.", user["id"])
        self.send_json(200, {"ok": True})

    def api_admin_jobs(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT j.*,
                   (SELECT COUNT(*) FROM user_jobs uj WHERE uj.job_id = j.id AND uj.status = 'active') AS filled,
                   COALESCE(mc.max_slots, 0) AS market_cap,
                   (SELECT COUNT(*) FROM user_jobs uj JOIN jobs jj ON jj.id = uj.job_id WHERE jj.market = j.market AND uj.status = 'active') AS market_filled
            FROM jobs j
            LEFT JOIN market_caps mc ON mc.market = j.market
            ORDER BY j.market, j.title
            """
        )
        markets = all_rows(db, "SELECT * FROM market_caps ORDER BY market")
        self.send_json(200, {"jobs": [dict(row) for row in rows], "markets": [dict(row) for row in markets]})

    def api_admin_update_job(self, db: Database, user: DbRow | None, job_id: int) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        job = one(db, "SELECT * FROM jobs WHERE id = ?", (job_id,))
        if not job:
            self.error(404, "Job not found")
            return
        rate = float(payload.get("rate_per_hour", job["rate_per_hour"]))
        max_positions = int(payload.get("max_positions", job["max_positions"]))
        active = 1 if bool(payload.get("active", job["active"])) else 0
        required_minutes = int(payload.get("required_minutes_daily", job["required_minutes_daily"]))
        requirement = str(payload.get("requirement") or job["requirement"])[:120]
        db.execute(
            "UPDATE jobs SET rate_per_hour = ?, max_positions = ?, active = ?, required_minutes_daily = ?, requirement = ? WHERE id = ?",
            (rate, max_positions, active, required_minutes, requirement, job_id),
        )
        self.send_json(200, {"ok": True})

    def api_admin_update_market(self, db: Database, user: DbRow | None, market: str) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        max_slots = int(payload.get("max_slots", 0))
        if max_slots < 0:
            self.error(400, "Market cap cannot be negative")
            return
        db.execute("INSERT INTO market_caps (market, max_slots) VALUES (?, ?) ON CONFLICT(market) DO UPDATE SET max_slots = excluded.max_slots", (market, max_slots))
        self.send_json(200, {"ok": True})


def main() -> None:
    ensure_schema()
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), RoleplayHandler)
    print(f"Roleplay PWA running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
