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


def ensure_schema() -> None:
    with conn() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
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

            CREATE TABLE IF NOT EXISTS panic_alerts (
                id SERIAL PRIMARY KEY,
                officer_id INTEGER NOT NULL,
                location TEXT NOT NULL,
                note TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        ensure_migrations(db)
        seed_owner(db)
        seed_jobs(db)
        seed_charges(db)
        seed_properties(db)


def ensure_migrations(db: Database) -> None:
    db.execute("ALTER TABLE charge_catalog ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'criminal'")
    db.execute("UPDATE charge_catalog SET kind = 'citation' WHERE code LIKE ?", ("TRF-%",))


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
        (name, email, password_hash, verified, roles, primary_agency, bank_balance, cash_balance, last_income_at, created_at)
        VALUES (?, ?, ?, 1, ?, 'Owner Command', 50000, 1000, ?, ?)
        """,
        (OWNER_NAME, OWNER_EMAIL, hash_password(OWNER_PASSWORD), json.dumps(owner_roles), ts, ts),
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


def verified_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not bool(user["verified"]) and not has_any(user, "owner", "admin"):
        return "Civilian verification required"
    return None


def leo_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "leo", "owner", "admin"):
        return "Law enforcement access required"
    return None


def judge_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "judge", "owner", "admin"):
        return "Court access required"
    return None


def app_catalog(user: DbRow | None) -> list[dict[str, Any]]:
    if not user:
        return []
    verified = bool(user["verified"]) or has_any(user, "owner", "admin")
    base = [
        ("dmv", "DMV", "id-card", verified),
        ("jobs", "JOB", "briefcase", verified),
        ("court", "COURT", "gavel", verified),
        ("properties", "PROPERTIES", "home", verified),
        ("cash", "CASH APP", "send", verified),
        ("bank", "BANK", "bank", verified),
        ("messages", "Messages", "message", verified),
    ]
    apps = [{"id": key, "label": label, "icon": icon, "enabled": enabled, "hidden": False} for key, label, icon, enabled in base]
    if has_any(user, "leo", "owner", "admin"):
        apps.append({"id": "mdt", "label": "MDT", "icon": "shield", "enabled": True, "hidden": False})
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
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
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}
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
        self.send_header("Cache-Control", "public, max-age=3600" if resolved.name != "index.html" else "no-cache")
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
                elif path == "/api/presence" and method == "POST":
                    self.api_presence(db, user)
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
        missing = require_fields(payload, "name", "email", "password")
        if missing:
            self.error(400, missing)
            return
        email = str(payload["email"]).strip().lower()
        password = str(payload["password"])
        if len(password) < 6:
            self.error(400, "Password must be at least 6 characters")
            return
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO users (name, email, password_hash, verified, roles, bank_balance, cash_balance, last_income_at, created_at)
            VALUES (?, ?, ?, 0, ?, 0, 250, ?, ?)
            RETURNING id
            """,
            (str(payload["name"]).strip(), email, hash_password(password), json.dumps(["civ"]), ts, ts),
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
        self.send_json(200, {"ok": True, "presence_seconds_today": presence_seconds(db, user["id"])})

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
        missing = require_fields(payload, "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_color", "plate", "vin", "insurance_status")
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
        vin = str(payload["vin"]).strip().upper()[:32]
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
        add_message(db, user["id"], "Vehicle registered", f"{year} {payload['vehicle_make']} {payload['vehicle_model']} was registered with plate {plate}.")
        self.send_json(201, {"ok": True, "vehicle_id": int(created["id"])})

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
        rows = all_rows(
            db,
            """
            SELECT c.*, officer.name AS officer_name
            FROM citations c
            JOIN users officer ON officer.id = c.officer_id
            WHERE c.civ_id = ?
            ORDER BY c.created_at DESC
            """,
            (user["id"],),
        )
        self.send_json(200, {"cases": [dict(row) for row in rows]})

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
        db.execute("UPDATE citations SET status = 'paid', updated_at = ? WHERE id = ?", (now_iso(), case_id))
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
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ?",
            ("%judge%", "%owner%", "%admin%"),
        )
        for judge in judges:
            add_message(db, judge["id"], "Citation contested", f"{user['name']} contested {case['charge_code']} - {case['charge_title']}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_judge_cases(self, db: Database, user: DbRow | None) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT c.*, civ.name AS civ_name, civ.email AS civ_email, officer.name AS officer_name
            FROM citations c
            JOIN users civ ON civ.id = c.civ_id
            JOIN users officer ON officer.id = c.officer_id
            ORDER BY CASE c.status WHEN 'contested' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, c.created_at DESC
            LIMIT 100
            """
        )
        self.send_json(200, {"cases": [dict(row) for row in rows]})

    def api_update_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        status = str(payload.get("status") or "").strip().lower()
        if status not in ("issued", "reviewed", "reduced", "dismissed", "paid", "contested"):
            self.error(400, "Invalid case status")
            return
        amount = payload.get("fine_amount")
        notes = str(payload.get("judgment_notes") or "")[:600]
        if amount is not None:
            db.execute(
                "UPDATE citations SET status = ?, fine_amount = ?, judgment_notes = ?, updated_at = ? WHERE id = ?",
                (status, float(amount), notes, now_iso(), case_id),
            )
        else:
            db.execute(
                "UPDATE citations SET status = ?, judgment_notes = ?, updated_at = ? WHERE id = ?",
                (status, notes, now_iso(), case_id),
            )
        case = one(db, "SELECT * FROM citations WHERE id = ?", (case_id,))
        if case:
            add_message(db, case["civ_id"], "Court case updated", f"Your case {case['charge_code']} is now marked {status}.", user["id"])
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
            SELECT u.id, u.name, u.email, u.verified, u.roles, d.license_status, d.license_class, d.vehicle_make,
                   d.vehicle_model, d.vehicle_color, d.plate, d.registration_status, d.insurance_status
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            WHERE u.name ILIKE ? OR u.email ILIKE ? OR d.plate ILIKE ?
               OR EXISTS (SELECT 1 FROM dmv_vehicles v WHERE v.user_id = u.id AND v.plate ILIKE ?)
            ORDER BY u.name
            LIMIT 25
            """,
            (like, like, like, like),
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
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO citations
            (civ_id, officer_id, charge_id, charge_code, charge_title, category, fine_amount, points, severity, location, narrative, court_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                civ["id"],
                user["id"],
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
        judges = all_rows(
            db,
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ?",
            ("%judge%", "%owner%", "%admin%"),
        )
        for judge in judges:
            add_message(db, judge["id"], "Citation awaiting court review", f"Citation #{citation_id} was issued to {civ['name']} by {user['name']}.", user["id"])
        self.send_json(201, {"ok": True, "citation_id": citation_id, "court_date": court_date})

    def api_panic(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        location = str(payload.get("location") or "Unknown location")[:120]
        note = str(payload.get("note") or "Emergency activation")[:240]
        cur = db.execute(
            "INSERT INTO panic_alerts (officer_id, location, note, created_at) VALUES (?, ?, ?, ?) RETURNING id",
            (user["id"], location, note, now_iso()),
        )
        created = cur.fetchone()
        recipients = all_rows(
            db,
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ? OR roles LIKE ?",
            ("%leo%", "%dispatcher%", "%owner%", "%admin%"),
        )
        for recipient in recipients:
            if recipient["id"] != user["id"]:
                add_message(db, recipient["id"], "PANIC ALERT", f"{user['name']} activated panic at {location}. {note}", user["id"])
        self.send_json(201, {"ok": True, "alert_id": int(created["id"])})

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
            ORDER BY p.created_at DESC
            LIMIT 30
            """
        )
        self.send_json(200, {"alerts": [dict(row) for row in rows]})

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
        verified = 1 if bool(payload.get("verified", target["verified"])) else 0
        agency = str(payload.get("primary_agency") or target["primary_agency"] or "").strip()[:80] or None
        db.execute(
            "UPDATE users SET verified = ?, roles = ?, primary_agency = ? WHERE id = ?",
            (verified, json.dumps(cleaned), agency, target_id),
        )
        dmv = one(db, "SELECT id FROM dmv_records WHERE user_id = ?", (target_id,))
        if not dmv:
            create_default_dmv(db, target_id)
        if verified:
            db.execute(
                "UPDATE dmv_records SET license_status = 'Valid', registration_status = 'Active', insurance_status = 'Active', updated_at = ? WHERE user_id = ?",
                (now_iso(), target_id),
            )
        add_message(db, target_id, "Account updated", "An owner/admin updated your verification or role permissions.", user["id"])
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
