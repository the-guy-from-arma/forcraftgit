#!/usr/bin/env python3
"""FairCroft CoreOne Python PWA.

This is a dependency-free Python deployment path for Railway/Docker.  It serves
the static PWA and implements the CAD/MDT/civilian/admin JSON API with the
Python standard library only: http.server + sqlite3 + hmac/pbkdf2 sessions.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

DATABASE_PATH = Path(
    os.environ.get("DATABASE_PATH")
    or os.environ.get("SQLITE_PATH")
    or ("/data/faircroft.sqlite3" if Path("/data").exists() else str(ROOT / "faircroft.sqlite3"))
)

APP_NAME = "FairCroft CoreOne"
TOKEN_EXPIRES = os.environ.get("SESSION_EXPIRES_IN") or os.environ.get("JWT_EXPIRES_IN") or "7d"

DEPARTMENT_ROLES = {"police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor", "site_admin", "owner"}
DISPATCHER_ROLES = {"dispatcher", "site_admin", "owner"}
ADMIN_ROLES = {"site_admin", "owner"}
VALID_ROLES = {
    "civilian",
    "pending_department",
    "police",
    "sheriff",
    "fire",
    "ems",
    "dispatcher",
    "department_supervisor",
    "site_admin",
    "owner",
}
UNIT_STATUS_LABELS = {
    "TEN_8_AVAILABLE": "10-8 Available",
    "TEN_6_BUSY": "10-6 Busy",
    "TEN_7_OUT_OF_SERVICE": "10-7 Out of Service",
    "TEN_23_ON_SCENE": "10-23 On Scene",
    "TEN_97_EN_ROUTE": "10-97 En Route",
    "TEN_15_TRANSPORTING": "10-15 Transporting",
    "CODE_4_CLEAR": "Code 4 Clear",
    "PRIORITY_RESPONSE": "Priority Response",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str, issues: list[dict[str, str]] | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.issues = issues


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_duration(value: str) -> timedelta:
    text = (value or "7d").strip().lower()
    if text.isdigit():
        return timedelta(seconds=int(text))
    match = re.fullmatch(r"(\d+)(ms|s|m|h|d|w|y)", text)
    if not match:
        if os.environ.get("NODE_ENV") == "production":
            raise RuntimeError("SESSION_EXPIRES_IN/JWT_EXPIRES_IN must look like 7d, 12h, 30m, or seconds.")
        return timedelta(days=7)
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "ms":
        return timedelta(milliseconds=amount)
    if unit == "s":
        return timedelta(seconds=amount)
    if unit == "m":
        return timedelta(minutes=amount)
    if unit == "h":
        return timedelta(hours=amount)
    if unit == "d":
        return timedelta(days=amount)
    if unit == "w":
        return timedelta(weeks=amount)
    return timedelta(days=amount * 365)


def now_plus_session() -> str:
    return iso(utcnow() + parse_duration(TOKEN_EXPIRES))


def new_id() -> str:
    return uuid.uuid4().hex


def clean_text(value: Any, max_length: int = 1000) -> str:
    if value is None:
        return ""
    text = str(value).replace("\x00", "")
    text = re.sub(r"<[^>]*>", "", text)
    return html.unescape(text).strip()[:max_length]


def normalize_email(value: Any) -> str:
    return clean_text(value, 254).lower()


def role_label(role: str | None) -> str:
    if not role:
        return "Unauthenticated"
    return " ".join(part.capitalize() for part in role.split("_"))


def role_for_department_type(kind: str) -> str:
    return {
        "dispatch": "dispatcher",
        "police": "police",
        "sheriff": "sheriff",
        "fire": "fire",
        "ems": "ems",
    }.get(kind, "civilian")


def make_call_number(prefix: str = "FC") -> str:
    stamp = utcnow().strftime("%Y%m%d")
    return f"{prefix}-{stamp}-{secrets.randbelow(9000) + 1000}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    rounds = 240_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return "pbkdf2_sha256${}${}${}".format(
        rounds,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, rounds_text, salt_text, digest_text = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds_text))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def db() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
              collection TEXT NOT NULL,
              id TEXT NOT NULL,
              data TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (collection, id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection)")
    seed_database()


def put_record(collection: str, record: dict[str, Any]) -> dict[str, Any]:
    if not record.get("id"):
        record["id"] = new_id()
    if not record.get("createdAt"):
        record["createdAt"] = iso()
    record["updatedAt"] = iso()
    encoded = json.dumps(record, separators=(",", ":"), ensure_ascii=False)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO records(collection, id, data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(collection, id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
            """,
            (collection, record["id"], encoded, record["updatedAt"]),
        )
    return record


def get_record(collection: str, record_id: str | None) -> dict[str, Any] | None:
    if not record_id:
        return None
    with db() as conn:
        row = conn.execute("SELECT data FROM records WHERE collection=? AND id=?", (collection, record_id)).fetchone()
    return json.loads(row["data"]) if row else None


def list_records(collection: str, *, order_key: str | None = "createdAt", reverse: bool = True) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT data FROM records WHERE collection=?", (collection,)).fetchall()
    records = [json.loads(row["data"]) for row in rows]
    if order_key:
        records.sort(key=lambda item: str(item.get(order_key) or ""), reverse=reverse)
    return records


def delete_record(collection: str, record_id: str) -> bool:
    with db() as conn:
        cursor = conn.execute("DELETE FROM records WHERE collection=? AND id=?", (collection, record_id))
    return cursor.rowcount > 0


def find_one(collection: str, predicate) -> dict[str, Any] | None:
    for record in list_records(collection, order_key=None):
        if predicate(record):
            return record
    return None


def public_user(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    safe = dict(user)
    safe.pop("passwordHash", None)
    safe.pop("sessions", None)
    return safe


def enrich_department(department: dict[str, Any] | None, *, include_memberships: bool = False) -> dict[str, Any] | None:
    if not department:
        return None
    result = dict(department)
    ranks = [rank for rank in list_records("ranks", order_key="level", reverse=False) if rank.get("departmentId") == department["id"]]
    result["ranks"] = ranks
    if include_memberships:
        memberships = []
        for membership in list_records("memberships", order_key="joinedAt", reverse=False):
            if membership.get("departmentId") == department["id"] and membership.get("active", True):
                item = dict(membership)
                item["user"] = public_user(get_user_full(membership.get("userId"), include_memberships=False))
                item["rank"] = get_record("ranks", membership.get("rankId"))
                item["department"] = dict(department)
                memberships.append(item)
        result["memberships"] = memberships
    return result


def get_user_full(user_id: str | None, *, include_memberships: bool = True) -> dict[str, Any] | None:
    user = get_record("users", user_id)
    if not user:
        return None
    result = dict(user)
    profile = find_one("profiles", lambda item: item.get("userId") == user_id)
    result["profile"] = profile
    if include_memberships:
        memberships = []
        for membership in list_records("memberships", order_key="joinedAt", reverse=False):
            if membership.get("userId") == user_id and membership.get("active", True):
                item = dict(membership)
                item["department"] = enrich_department(get_record("departments", membership.get("departmentId")))
                item["rank"] = get_record("ranks", membership.get("rankId"))
                memberships.append(item)
        result["memberships"] = memberships
    return result


def enrich_application(application: dict[str, Any]) -> dict[str, Any]:
    item = dict(application)
    item["user"] = public_user(get_user_full(item.get("userId")))
    item["department"] = enrich_department(get_record("departments", item.get("departmentId")))
    item["reviewedBy"] = public_user(get_user_full(item.get("reviewedById"), include_memberships=False))
    return item


def enrich_unit(unit: dict[str, Any]) -> dict[str, Any]:
    item = dict(unit)
    item["department"] = enrich_department(get_record("departments", unit.get("departmentId")))
    item["user"] = public_user(get_user_full(unit.get("userId"), include_memberships=False))
    return item


def assignments_for_call(call_id: str) -> list[dict[str, Any]]:
    assignments = []
    for assignment in list_records("assignments", order_key="assignedAt", reverse=False):
        if assignment.get("cadCallId") == call_id:
            item = dict(assignment)
            item["cadUnit"] = enrich_unit(get_record("units", assignment.get("cadUnitId")) or {})
            item["cadCall"] = get_record("cad_calls", call_id)
            assignments.append(item)
    return assignments


def enrich_cad_call(call: dict[str, Any]) -> dict[str, Any]:
    item = dict(call)
    item["assignments"] = assignments_for_call(call["id"])
    return item


def enrich_message(message: dict[str, Any]) -> dict[str, Any]:
    item = dict(message)
    item["user"] = public_user(get_user_full(message.get("userId"), include_memberships=False))
    return item


def add_notification(user_id: str, title: str, body: str, kind: str = "system", payload: dict[str, Any] | None = None) -> None:
    put_record(
        "notifications",
        {
            "id": new_id(),
            "userId": user_id,
            "title": clean_text(title, 180),
            "body": clean_text(body, 1200),
            "type": clean_text(kind, 80) or "system",
            "read": False,
            "payload": payload or {},
            "createdAt": iso(),
        },
    )


def audit_action(actor_id: str | None, action: str, entity: str, entity_id: str | None = None, metadata: dict[str, Any] | None = None, handler: BaseHTTPRequestHandler | None = None) -> None:
    put_record(
        "audit_logs",
        {
            "id": new_id(),
            "actorId": actor_id,
            "actor": public_user(get_user_full(actor_id, include_memberships=False)),
            "action": action,
            "entity": entity,
            "entityId": entity_id,
            "metadata": metadata or {},
            "ipAddress": handler.client_address[0] if handler else None,
            "userAgent": handler.headers.get("user-agent") if handler else None,
            "createdAt": iso(),
        },
    )


def seed_database() -> None:
    if list_records("departments", order_key=None):
        ensure_owner()
        return

    departments = [
        ("FairCroft Police Department", "FCPD", "police", "Municipal patrol, investigations, traffic, and records."),
        ("FairCroft Sheriff's Office", "FCSO", "sheriff", "County law enforcement and court services."),
        ("FairCroft Fire Rescue", "FCFR", "fire", "Fire suppression, rescue, and prevention."),
        ("FairCroft EMS Authority", "FCEMS", "ems", "Roleplay emergency medical response."),
        ("FairCroft Communications", "FCCD", "dispatch", "911 call-taking and CAD dispatch operations."),
    ]
    dept_ids: dict[str, str] = {}
    for name, code, kind, description in departments:
        department = put_record(
            "departments",
            {
                "id": new_id(),
                "name": name,
                "code": code,
                "type": kind,
                "description": description,
                "isActive": True,
                "createdAt": iso(),
            },
        )
        dept_ids[code] = department["id"]
        for level, rank_name in enumerate(["Cadet", "Officer", "Supervisor", "Command"], start=1):
            put_record(
                "ranks",
                {
                    "id": new_id(),
                    "departmentId": department["id"],
                    "name": rank_name if kind != "dispatch" else ["Trainee", "Dispatcher", "Lead Dispatcher", "Communications Director"][level - 1],
                    "level": level * 10,
                    "permissions": {"cad": True, "records": level >= 2, "roster": level >= 3, "unitManagement": level >= 3},
                    "createdAt": iso(),
                },
            )

    for unit_number, dept_code in [
        ("1A-01", "FCPD"),
        ("1A-02", "FCPD"),
        ("2S-12", "FCSO"),
        ("E-1", "FCFR"),
        ("M-3", "FCEMS"),
        ("D-1", "FCCD"),
    ]:
        put_record(
            "units",
            {
                "id": new_id(),
                "departmentId": dept_ids[dept_code],
                "userId": None,
                "unitNumber": unit_number,
                "status": "TEN_8_AVAILABLE",
                "currentLocation": "FairCroft",
                "isPrimary": False,
                "active": True,
                "createdAt": iso(),
            },
        )

    ensure_owner()
    put_record(
        "server_settings",
        {
            "id": new_id(),
            "key": "roleplay_notice",
            "value": {"enabled": True, "message": "Fictional roleplay system. Not for real emergency use."},
            "createdAt": iso(),
        },
    )


def ensure_owner() -> None:
    email = normalize_email(os.environ.get("OWNER_EMAIL") or "owner@faircroft.local")
    password = os.environ.get("OWNER_PASSWORD") or "ChangeMe123!"
    name = clean_text(os.environ.get("OWNER_NAME") or "FairCroft Owner", 120)
    existing = find_one("users", lambda user: user.get("email") == email)
    if existing:
        changed = False
        if existing.get("role") != "owner":
            existing["role"] = "owner"
            changed = True
        if changed:
            put_record("users", existing)
        return

    user = put_record(
        "users",
        {
            "id": new_id(),
            "email": email,
            "passwordHash": hash_password(password),
            "name": name,
            "phone": "555-0100",
            "role": "owner",
            "suspended": False,
            "createdAt": iso(),
        },
    )
    first, _, last = name.partition(" ")
    put_record(
        "profiles",
        {
            "id": new_id(),
            "userId": user["id"],
            "firstName": first or "FairCroft",
            "lastName": last or "Owner",
            "phone": "555-0100",
            "dateOfBirth": None,
            "address": "1 Government Plaza",
            "city": "FairCroft",
            "state": "FC",
            "postalCode": "00001",
            "notes": "",
            "recordFlags": [],
            "createdAt": iso(),
        },
    )
    dispatch = find_one("departments", lambda item: item.get("type") == "dispatch")
    if dispatch:
        rank = find_one("ranks", lambda item: item.get("departmentId") == dispatch["id"] and item.get("level") == 40)
        put_record(
            "memberships",
            {
                "id": new_id(),
                "userId": user["id"],
                "departmentId": dispatch["id"],
                "rankId": rank["id"] if rank else None,
                "role": "owner",
                "badgeNumber": "OWNER",
                "active": True,
                "joinedAt": iso(),
                "createdAt": iso(),
            },
        )
    audit_action(user["id"], "system.seed_owner", "User", user["id"])


def validate_required(body: dict[str, Any], fields: list[str]) -> None:
    issues = []
    for field in fields:
        value = body.get(field)
        if value is None or str(value).strip() == "":
            issues.append({"path": field, "message": "Required."})
    if issues:
        raise ApiError(422, "Validation failed.", issues)


class FairCroftHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self.dispatch()

    def do_POST(self) -> None:
        self.dispatch()

    def do_PATCH(self) -> None:
        self.dispatch()

    def do_DELETE(self) -> None:
        self.dispatch()

    def common_headers(self, content_type: str = "application/json; charset=utf-8", length: int | None = None) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", os.environ.get("CORS_ORIGIN") or "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Connection", "close")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "public, max-age=3600")
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.close_connection = True

    def send_json(self, status: int, payload: dict[str, Any] | list[Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.common_headers(length=len(data))
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status: int, message: str, issues: list[dict[str, str]] | None = None) -> None:
        payload: dict[str, Any] = {"error": message}
        if issues:
            payload["issues"] = issues
        self.send_json(status, payload)

    def read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length)
        content_type = self.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
                if isinstance(payload, dict):
                    return payload
            except json.JSONDecodeError:
                raise ApiError(400, "Invalid JSON body.")
        parsed = parse_qs(raw.decode("utf-8"), keep_blank_values=True)
        return {key: values[-1] if values else "" for key, values in parsed.items()}

    def dispatch(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path.startswith("/api/"):
                self.handle_api(path, parse_qs(parsed.query))
                return
            self.serve_static_or_app(path)
        except ApiError as error:
            self.send_error_json(error.status, error.message, error.issues)
        except Exception as error:
            print("Unhandled service fault:", repr(error), file=sys.stderr)
            self.send_error_json(500, "CoreOne service fault. Check server logs.")

    def serve_static_or_app(self, path: str) -> None:
        if path in {"/manifest.webmanifest", "/sw.js"}:
            target = STATIC_DIR / path.lstrip("/")
        elif path.startswith("/static/"):
            target = STATIC_DIR / path.removeprefix("/static/")
        else:
            target = STATIC_DIR / "index.html"

        try:
            resolved = target.resolve()
            if not str(resolved).startswith(str(STATIC_DIR.resolve())) or not resolved.is_file():
                raise FileNotFoundError
            data = resolved.read_bytes()
            ctype = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
            if resolved.name.endswith(".webmanifest"):
                ctype = "application/manifest+json"
            self.send_response(200)
            self.common_headers(ctype, len(data))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error_json(404, "Static asset not found.")

    def auth(self) -> tuple[dict[str, Any], dict[str, Any]]:
        header = self.headers.get("authorization") or ""
        if not header.startswith("Bearer "):
            raise ApiError(401, "Authentication required.")
        token = header.removeprefix("Bearer ").strip()
        session = find_one("sessions", lambda item: item.get("tokenId") == token)
        if not session or session.get("revokedAt"):
            raise ApiError(401, "Authentication required.")
        expires = parse_iso(session.get("expiresAt"))
        if expires and expires < utcnow():
            raise ApiError(401, "Authentication required.")
        user = get_user_full(session.get("userId"))
        if not user or user.get("suspended"):
            raise ApiError(401, "Authentication required.")
        session["lastSeenAt"] = iso()
        put_record("sessions", session)
        return user, session

    def require_role(self, allowed: set[str], message: str) -> tuple[dict[str, Any], dict[str, Any]]:
        user, session = self.auth()
        if user.get("role") not in allowed:
            raise ApiError(403, message)
        return user, session

    def handle_api(self, path: str, query: dict[str, list[str]]) -> None:
        method = self.command.upper()
        segments = [unquote(part) for part in path.strip("/").split("/") if part]

        if method == "GET" and segments == ["api", "health"]:
            self.send_json(200, {"ok": True, "name": APP_NAME, "roleplayOnly": True, "pythonPwa": True, "timestamp": iso()})
            return

        if segments[:2] == ["api", "auth"]:
            self.handle_auth(method, segments)
            return
        if segments[:2] == ["api", "civilian"]:
            self.handle_civilian(method, segments)
            return
        if segments == ["api", "departments"] and method == "GET":
            self.auth()
            departments = [enrich_department(dept) for dept in list_records("departments", order_key="name", reverse=False) if dept.get("isActive", True)]
            self.send_json(200, {"departments": departments})
            return
        if segments[:2] == ["api", "dispatch"]:
            self.handle_dispatch(method, segments)
            return
        if segments[:2] == ["api", "cad"]:
            self.handle_cad(method, segments, query)
            return
        if segments[:2] == ["api", "admin"]:
            self.handle_admin(method, segments)
            return

        raise ApiError(404, "FairCroft CoreOne API route not found.")

    def issue_session(self, user: dict[str, Any]) -> dict[str, Any]:
        token = secrets.token_urlsafe(36)
        expires_at = now_plus_session()
        put_record(
            "sessions",
            {
                "id": new_id(),
                "userId": user["id"],
                "tokenId": token,
                "userAgent": self.headers.get("user-agent"),
                "ipAddress": self.client_address[0],
                "createdAt": iso(),
                "lastSeenAt": iso(),
                "expiresAt": expires_at,
                "revokedAt": None,
            },
        )
        return {"token": token, "expiresAt": expires_at}

    def handle_auth(self, method: str, segments: list[str]) -> None:
        if method == "POST" and segments == ["api", "auth", "register"]:
            body = self.read_body()
            validate_required(body, ["email", "password", "firstName", "lastName"])
            email = normalize_email(body.get("email"))
            password = str(body.get("password") or "")
            if "@" not in email:
                raise ApiError(422, "Validation failed.", [{"path": "email", "message": "Valid email required."}])
            if len(password) < 8:
                raise ApiError(422, "Validation failed.", [{"path": "password", "message": "Minimum length is 8."}])
            if find_one("users", lambda item: item.get("email") == email):
                raise ApiError(409, "An account already exists for that email.")
            first = clean_text(body.get("firstName"), 80)
            last = clean_text(body.get("lastName"), 80)
            user = put_record(
                "users",
                {
                    "id": new_id(),
                    "email": email,
                    "passwordHash": hash_password(password),
                    "name": f"{first} {last}".strip(),
                    "phone": clean_text(body.get("phone"), 40),
                    "role": "civilian",
                    "suspended": False,
                    "createdAt": iso(),
                },
            )
            put_record(
                "profiles",
                {
                    "id": new_id(),
                    "userId": user["id"],
                    "firstName": first,
                    "lastName": last,
                    "phone": clean_text(body.get("phone"), 40),
                    "dateOfBirth": clean_text(body.get("dateOfBirth"), 40) or None,
                    "address": clean_text(body.get("address"), 160),
                    "city": clean_text(body.get("city"), 80) or "FairCroft",
                    "state": clean_text(body.get("state"), 12) or "FC",
                    "postalCode": clean_text(body.get("postalCode"), 20),
                    "notes": "",
                    "recordFlags": [],
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "auth.register", "User", user["id"], handler=self)
            session = self.issue_session(user)
            self.send_json(201, {**session, "user": public_user(get_user_full(user["id"]))})
            return

        if method == "POST" and segments == ["api", "auth", "login"]:
            body = self.read_body()
            validate_required(body, ["email", "password"])
            email = normalize_email(body.get("email"))
            user = find_one("users", lambda item: item.get("email") == email)
            if not user or not verify_password(str(body.get("password") or ""), user.get("passwordHash", "")):
                raise ApiError(401, "Invalid email or password.")
            if user.get("suspended"):
                raise ApiError(403, "This account is suspended.")
            audit_action(user["id"], "auth.login", "User", user["id"], handler=self)
            session = self.issue_session(user)
            self.send_json(200, {**session, "user": public_user(get_user_full(user["id"]))})
            return

        if method == "POST" and segments == ["api", "auth", "logout"]:
            _user, session = self.auth()
            session["revokedAt"] = iso()
            put_record("sessions", session)
            self.send_json(200, {"ok": True})
            return

        if method == "GET" and segments == ["api", "auth", "me"]:
            user, _session = self.auth()
            self.send_json(200, {"user": public_user(user)})
            return

        raise ApiError(404, "Authentication route not found.")

    def handle_civilian(self, method: str, segments: list[str]) -> None:
        user, _session = self.auth()
        if method == "GET" and segments == ["api", "civilian", "overview"]:
            name = (user.get("name") or "").lower()
            vehicles = [item for item in list_records("vehicles") if item.get("ownerId") == user["id"]]
            licenses = [item for item in list_records("licenses") if item.get("userId") == user["id"]]
            permits = [item for item in list_records("permits") if item.get("userId") == user["id"]]
            warrants = [
                item
                for item in list_records("warrants")
                if item.get("subjectId") == user["id"] or (name and name in str(item.get("subjectName") or "").lower())
            ]
            citations = [
                item
                for item in list_records("citations")
                if item.get("userId") == user["id"] or (name and name in str(item.get("subjectName") or "").lower())
            ]
            applications = [enrich_application(item) for item in list_records("applications") if item.get("userId") == user["id"]]
            notifications = [item for item in list_records("notifications") if item.get("userId") == user["id"]][:20]
            self.send_json(
                200,
                {
                    "user": public_user(get_user_full(user["id"])),
                    "vehicles": vehicles,
                    "licenses": licenses,
                    "permits": permits,
                    "warrants": warrants,
                    "citations": citations,
                    "applications": applications,
                    "notifications": notifications,
                },
            )
            return

        if method == "PATCH" and segments == ["api", "civilian", "profile"]:
            body = self.read_body()
            profile = find_one("profiles", lambda item: item.get("userId") == user["id"])
            if not profile:
                raise ApiError(404, "Civilian profile not found.")
            for key, limit in {"phone": 40, "address": 160, "city": 80, "state": 12, "postalCode": 20, "notes": 500}.items():
                if key in body:
                    profile[key] = clean_text(body.get(key), limit)
            put_record("profiles", profile)
            audit_action(user["id"], "civilian.profile.update", "CivilianProfile", profile["id"], handler=self)
            self.send_json(200, {"profile": profile})
            return

        if method == "POST" and segments == ["api", "civilian", "applications"]:
            body = self.read_body()
            validate_required(body, ["departmentId", "statement"])
            department = get_record("departments", clean_text(body.get("departmentId"), 80))
            if not department or not department.get("isActive", True):
                raise ApiError(404, "Department not found.")
            existing = find_one(
                "applications",
                lambda item: item.get("userId") == user["id"] and item.get("departmentId") == department["id"] and item.get("status") == "pending",
            )
            if existing:
                raise ApiError(409, "You already have a pending application for this department.")
            application = put_record(
                "applications",
                {
                    "id": new_id(),
                    "userId": user["id"],
                    "departmentId": department["id"],
                    "desiredRole": role_for_department_type(department.get("type", "")),
                    "statement": clean_text(body.get("statement"), 1200),
                    "experience": clean_text(body.get("experience"), 1200),
                    "status": "pending",
                    "decisionReason": None,
                    "reviewedById": None,
                    "submittedAt": iso(),
                    "reviewedAt": None,
                    "createdAt": iso(),
                },
            )
            if user.get("role") == "civilian":
                user_record = get_record("users", user["id"])
                if user_record:
                    user_record["role"] = "pending_department"
                    put_record("users", user_record)
            audit_action(user["id"], "department.application.submit", "DepartmentApplication", application["id"], {"department": department.get("code")}, self)
            self.send_json(201, {"application": enrich_application(application)})
            return

        if method == "POST" and segments == ["api", "civilian", "911"]:
            body = self.read_body()
            validate_required(body, ["emergencyType", "location", "description", "callerName", "callbackNumber"])
            call = put_record(
                "call911",
                {
                    "id": new_id(),
                    "callerId": user["id"],
                    "emergencyType": clean_text(body.get("emergencyType"), 80),
                    "location": clean_text(body.get("location"), 180),
                    "description": clean_text(body.get("description"), 1400),
                    "callerName": clean_text(body.get("callerName"), 120),
                    "callbackNumber": clean_text(body.get("callbackNumber"), 40),
                    "status": "queued",
                    "priority": "emergency",
                    "acceptedById": None,
                    "acceptedAt": None,
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "911.submit", "Call911", call["id"], {"emergencyType": call["emergencyType"], "location": call["location"]}, self)
            self.send_json(201, {"call": call})
            return

        raise ApiError(404, "Civilian route not found.")

    def handle_dispatch(self, method: str, segments: list[str]) -> None:
        user, _session = self.require_role(DISPATCHER_ROLES, "Dispatch access required.")
        if method == "GET" and segments == ["api", "dispatch", "queue"]:
            calls = [item for item in list_records("call911", order_key="createdAt", reverse=False) if item.get("status") == "queued"]
            self.send_json(200, {"calls": calls})
            return

        if method == "POST" and len(segments) == 5 and segments[:3] == ["api", "dispatch", "911"] and segments[4] == "accept":
            self.read_body()
            call = get_record("call911", segments[3])
            if not call or call.get("status") != "queued":
                raise ApiError(409, "911 call is no longer queued.")
            call["status"] = "converted"
            call["acceptedById"] = user["id"]
            call["acceptedAt"] = iso()
            put_record("call911", call)
            cad_call = put_record(
                "cad_calls",
                {
                    "id": new_id(),
                    "call911Id": call["id"],
                    "callNumber": make_call_number("FC-CAD"),
                    "type": call["emergencyType"],
                    "location": call["location"],
                    "description": call["description"],
                    "priority": call.get("priority") or "emergency",
                    "status": "active",
                    "acceptedById": user["id"],
                    "createdById": user["id"],
                    "createdAt": iso(),
                    "closedAt": None,
                },
            )
            audit_action(user["id"], "dispatch.911.accept", "CadCall", cad_call["id"], {"source911": call["id"]}, self)
            self.send_json(200, {"cadCall": enrich_cad_call(cad_call)})
            return

        if method == "POST" and segments == ["api", "dispatch", "messages"]:
            body = self.read_body()
            validate_required(body, ["body"])
            message = put_record(
                "dispatch_messages",
                {
                    "id": new_id(),
                    "userId": user["id"],
                    "channel": clean_text(body.get("channel"), 80) or "dispatch",
                    "body": clean_text(body.get("body"), 1000),
                    "createdAt": iso(),
                },
            )
            self.send_json(201, {"message": enrich_message(message)})
            return

        raise ApiError(404, "Dispatch route not found.")

    def handle_cad(self, method: str, segments: list[str], query: dict[str, list[str]]) -> None:
        user, _session = self.require_role(DEPARTMENT_ROLES, "Department access required.")

        if method == "GET" and segments == ["api", "cad", "dashboard"]:
            calls = [
                enrich_cad_call(item)
                for item in list_records("cad_calls")
                if item.get("status") in {"active", "assigned", "on_scene", "pending"}
            ][:50]
            units = [enrich_unit(item) for item in list_records("units", order_key="unitNumber", reverse=False) if item.get("active", True)]
            bolos = [item for item in list_records("bolos") if item.get("status", "active") == "active"][:20]
            warrants = [item for item in list_records("warrants") if item.get("status", "active") == "active"][:20]
            messages = [enrich_message(item) for item in list_records("dispatch_messages")][:40]
            messages.reverse()
            notifications = [item for item in list_records("notifications") if item.get("userId") == user["id"]][:20]
            self.send_json(
                200,
                {
                    "calls": calls,
                    "units": units,
                    "bolos": bolos,
                    "warrants": warrants,
                    "messages": messages,
                    "notifications": notifications,
                    "unitStatusLabels": UNIT_STATUS_LABELS,
                },
            )
            return

        if method == "GET" and segments == ["api", "cad", "calls"]:
            self.send_json(200, {"calls": [enrich_cad_call(item) for item in list_records("cad_calls")[:100]]})
            return

        if method == "POST" and segments == ["api", "cad", "calls"]:
            body = self.read_body()
            validate_required(body, ["type", "location", "description"])
            cad_call = put_record(
                "cad_calls",
                {
                    "id": new_id(),
                    "call911Id": None,
                    "callNumber": make_call_number("FC-CAD"),
                    "type": clean_text(body.get("type"), 100),
                    "location": clean_text(body.get("location"), 180),
                    "description": clean_text(body.get("description"), 1400),
                    "priority": clean_text(body.get("priority"), 40) or "routine",
                    "status": "active",
                    "createdById": user["id"],
                    "acceptedById": None,
                    "closedAt": None,
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "cad.call.create", "CadCall", cad_call["id"], handler=self)
            self.send_json(201, {"cadCall": enrich_cad_call(cad_call)})
            return

        if method == "POST" and len(segments) == 5 and segments[:3] == ["api", "cad", "calls"] and segments[4] == "assign":
            self.require_role(DISPATCHER_ROLES, "Dispatch access required.")
            body = self.read_body()
            validate_required(body, ["unitId"])
            cad_call = get_record("cad_calls", segments[3])
            unit = get_record("units", clean_text(body.get("unitId"), 80))
            if not cad_call or not unit:
                raise ApiError(404, "CAD call or unit not found.")
            existing = find_one("assignments", lambda item: item.get("cadCallId") == cad_call["id"] and item.get("cadUnitId") == unit["id"])
            assignment = existing or {"id": new_id(), "createdAt": iso()}
            assignment.update(
                {
                    "cadCallId": cad_call["id"],
                    "cadUnitId": unit["id"],
                    "assignedById": user["id"],
                    "status": "assigned",
                    "assignedAt": iso(),
                    "clearedAt": None,
                }
            )
            put_record("assignments", assignment)
            cad_call["status"] = "assigned"
            put_record("cad_calls", cad_call)
            unit["status"] = "TEN_97_EN_ROUTE"
            put_record("units", unit)
            if unit.get("userId"):
                add_notification(unit["userId"], "CAD Assignment", f"{cad_call['callNumber']}: {cad_call['type']} at {cad_call['location']}", "cad_assignment", {"cadCallId": cad_call["id"], "assignmentId": assignment["id"]})
            audit_action(user["id"], "cad.unit.assign", "UnitAssignment", assignment["id"], {"cadCallId": cad_call["id"], "unitId": unit["id"]}, self)
            enriched = dict(assignment)
            enriched["cadCall"] = cad_call
            enriched["cadUnit"] = enrich_unit(unit)
            self.send_json(201, {"assignment": enriched})
            return

        if method == "POST" and segments == ["api", "cad", "units"]:
            self.require_role(DISPATCHER_ROLES, "Dispatch access required.")
            body = self.read_body()
            validate_required(body, ["departmentId", "unitNumber"])
            unit = put_record(
                "units",
                {
                    "id": new_id(),
                    "departmentId": clean_text(body.get("departmentId"), 80),
                    "userId": clean_text(body.get("userId"), 80) or None,
                    "unitNumber": clean_text(body.get("unitNumber"), 40),
                    "status": "TEN_8_AVAILABLE",
                    "currentLocation": clean_text(body.get("currentLocation"), 140),
                    "isPrimary": False,
                    "active": True,
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "cad.unit.create", "CadUnit", unit["id"], handler=self)
            self.send_json(201, {"unit": enrich_unit(unit)})
            return

        if method == "PATCH" and len(segments) == 5 and segments[:3] == ["api", "cad", "units"] and segments[4] == "status":
            body = self.read_body()
            unit = get_record("units", segments[3])
            if not unit:
                raise ApiError(404, "Unit not found.")
            status = clean_text(body.get("status"), 80)
            if status not in UNIT_STATUS_LABELS:
                raise ApiError(422, "Unknown unit status.")
            unit["status"] = status
            if "currentLocation" in body:
                unit["currentLocation"] = clean_text(body.get("currentLocation"), 140)
            put_record("units", unit)
            audit_action(user["id"], "cad.unit.status", "CadUnit", unit["id"], {"status": status}, self)
            self.send_json(200, {"unit": enrich_unit(unit)})
            return

        if method == "GET" and segments == ["api", "cad", "records"]:
            self.send_json(
                200,
                {
                    "warrants": list_records("warrants")[:50],
                    "citations": list_records("citations")[:50],
                    "bolos": list_records("bolos")[:50],
                    "vehicles": [self.enrich_vehicle(item) for item in list_records("vehicles")[:50]],
                    "licenses": [self.enrich_user_record(item) for item in list_records("licenses")[:50]],
                    "incidentReports": list_records("incident_reports")[:25],
                    "arrestReports": list_records("arrest_reports")[:25],
                    "fireReports": list_records("fire_reports")[:25],
                    "emsReports": list_records("ems_reports")[:25],
                },
            )
            return

        if method == "POST" and segments == ["api", "cad", "bolos"]:
            body = self.read_body()
            validate_required(body, ["title", "description"])
            bolo = put_record(
                "bolos",
                {
                    "id": new_id(),
                    "title": clean_text(body.get("title"), 140),
                    "description": clean_text(body.get("description"), 1200),
                    "plate": clean_text(body.get("plate"), 20),
                    "personName": clean_text(body.get("personName"), 120),
                    "vehicleDescription": clean_text(body.get("vehicleDescription"), 240),
                    "status": "active",
                    "createdById": user["id"],
                    "expiresAt": None,
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "records.bolo.create", "Bolo", bolo["id"], handler=self)
            self.send_json(201, {"bolo": bolo})
            return

        if method == "POST" and segments == ["api", "cad", "warrants"]:
            body = self.read_body()
            validate_required(body, ["subjectName", "charges"])
            warrant = put_record(
                "warrants",
                {
                    "id": new_id(),
                    "subjectId": clean_text(body.get("subjectId"), 80) or None,
                    "subjectName": clean_text(body.get("subjectName"), 140),
                    "charges": clean_text(body.get("charges"), 1000),
                    "issuingCourt": clean_text(body.get("issuingCourt"), 140) or "FairCroft Municipal Court",
                    "status": "active",
                    "severity": clean_text(body.get("severity"), 40) or "routine",
                    "issuedAt": iso(),
                    "createdById": user["id"],
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "records.warrant.create", "Warrant", warrant["id"], handler=self)
            self.send_json(201, {"warrant": warrant})
            return

        if method == "POST" and segments == ["api", "cad", "citations"]:
            body = self.read_body()
            validate_required(body, ["subjectName", "statute", "description"])
            citation = put_record(
                "citations",
                {
                    "id": new_id(),
                    "userId": clean_text(body.get("userId"), 80) or None,
                    "subjectName": clean_text(body.get("subjectName"), 140),
                    "officerId": user["id"],
                    "statute": clean_text(body.get("statute"), 80),
                    "description": clean_text(body.get("description"), 1000),
                    "fineCents": int(body.get("fineCents") or 0),
                    "status": "active",
                    "issuedAt": iso(),
                    "location": clean_text(body.get("location"), 160),
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "records.citation.create", "Citation", citation["id"], handler=self)
            self.send_json(201, {"citation": citation})
            return

        if method == "POST" and len(segments) == 4 and segments[:3] == ["api", "cad", "reports"]:
            self.create_report(user, segments[3])
            return

        if method == "GET" and len(segments) == 4 and segments[:3] == ["api", "cad", "search"]:
            q = clean_text((query.get("q") or [""])[0], 120).lower()
            if segments[3] == "people":
                people = [public_user(get_user_full(item["id"])) for item in list_records("users") if q and q in f"{item.get('name','')} {item.get('email','')} {item.get('id','')}".lower()]
                self.send_json(200, {"people": people})
                return
            if segments[3] == "vehicles":
                vehicles = [self.enrich_vehicle(item) for item in list_records("vehicles") if q and q in f"{item.get('plate','')} {item.get('vin','')} {item.get('make','')} {item.get('model','')}".lower()]
                self.send_json(200, {"vehicles": vehicles})
                return

        raise ApiError(404, "CAD route not found.")

    def enrich_vehicle(self, vehicle: dict[str, Any]) -> dict[str, Any]:
        item = dict(vehicle)
        item["owner"] = public_user(get_user_full(vehicle.get("ownerId"), include_memberships=False))
        return item

    def enrich_user_record(self, record: dict[str, Any]) -> dict[str, Any]:
        item = dict(record)
        item["user"] = public_user(get_user_full(record.get("userId"), include_memberships=False))
        return item

    def create_report(self, user: dict[str, Any], report_type: str) -> None:
        body = self.read_body()
        validate_required(body, ["narrative"])
        report: dict[str, Any]
        collection: str
        if report_type == "incident":
            collection = "incident_reports"
            report = {
                "id": new_id(),
                "cadCallId": clean_text(body.get("cadCallId"), 80) or None,
                "authorId": user["id"],
                "departmentId": (user.get("memberships") or [{}])[0].get("departmentId"),
                "reportNumber": make_call_number("FC-IR"),
                "title": clean_text(body.get("title"), 160) or "Incident Report",
                "narrative": clean_text(body.get("narrative"), 1800),
                "status": "submitted",
                "createdAt": iso(),
            }
        elif report_type == "arrest":
            collection = "arrest_reports"
            report = {
                "id": new_id(),
                "cadCallId": clean_text(body.get("cadCallId"), 80) or None,
                "arrestingOfficerId": user["id"],
                "subjectName": clean_text(body.get("subjectName"), 140) or "Unknown Subject",
                "charges": clean_text(body.get("charges"), 1000) or "Pending review",
                "narrative": clean_text(body.get("narrative"), 1800),
                "bookingNumber": make_call_number("FC-BOOK"),
                "status": "submitted",
                "createdAt": iso(),
            }
        elif report_type == "fire":
            collection = "fire_reports"
            report = {
                "id": new_id(),
                "cadCallId": clean_text(body.get("cadCallId"), 80) or None,
                "authorId": user["id"],
                "incidentType": clean_text(body.get("incidentType"), 120) or "Fire Service Call",
                "cause": clean_text(body.get("cause"), 160),
                "actions": clean_text(body.get("actions"), 1000) or clean_text(body.get("narrative"), 1800),
                "narrative": clean_text(body.get("narrative"), 1800),
                "status": "submitted",
                "createdAt": iso(),
            }
        elif report_type == "ems":
            collection = "ems_reports"
            report = {
                "id": new_id(),
                "cadCallId": clean_text(body.get("cadCallId"), 80) or None,
                "authorId": user["id"],
                "patientName": clean_text(body.get("patientName"), 140) or "Roleplay Patient",
                "patientAge": int(body.get("patientAge") or 0) or None,
                "chiefComplaint": clean_text(body.get("chiefComplaint"), 500) or "Roleplay only",
                "careProvided": clean_text(body.get("careProvided"), 1200) or clean_text(body.get("narrative"), 1800),
                "disposition": clean_text(body.get("disposition"), 500) or "Roleplay disposition",
                "narrative": clean_text(body.get("narrative"), 1800),
                "roleplayOnly": True,
                "status": "submitted",
                "createdAt": iso(),
            }
        else:
            raise ApiError(404, "Unknown report type.")
        put_record(collection, report)
        audit_action(user["id"], f"reports.{report_type}.create", f"{report_type}Report", report["id"], handler=self)
        self.send_json(201, {"report": report})

    def handle_admin(self, method: str, segments: list[str]) -> None:
        user, _session = self.require_role(ADMIN_ROLES, "Administrator access required.")

        if method == "GET" and segments == ["api", "admin", "overview"]:
            active_calls = [item for item in list_records("cad_calls") if item.get("status") in {"active", "assigned", "on_scene"}]
            pending = [item for item in list_records("applications") if item.get("status") == "pending"]
            audit_logs = [self.enrich_audit(item) for item in list_records("audit_logs")[:20]]
            self.send_json(
                200,
                {
                    "metrics": {
                        "users": len(list_records("users", order_key=None)),
                        "pendingApplications": len(pending),
                        "departments": len(list_records("departments", order_key=None)),
                        "activeCalls": len(active_calls),
                    },
                    "auditLogs": audit_logs,
                },
            )
            return

        if method == "GET" and segments == ["api", "admin", "applications"]:
            apps = [enrich_application(item) for item in list_records("applications")]
            self.send_json(200, {"applications": apps})
            return

        if method == "POST" and len(segments) == 5 and segments[:3] == ["api", "admin", "applications"] and segments[4] == "decision":
            body = self.read_body()
            decision = clean_text(body.get("decision"), 20)
            if decision not in {"approved", "denied"}:
                raise ApiError(422, "Decision must be approved or denied.")
            application = get_record("applications", segments[3])
            if not application or application.get("status") != "pending":
                raise ApiError(404, "Pending application not found.")
            department = get_record("departments", application.get("departmentId"))
            role = clean_text(body.get("role"), 80) or application.get("desiredRole") or role_for_department_type(department.get("type", "") if department else "")
            if role not in VALID_ROLES:
                role = "civilian"
            application["status"] = decision
            application["decisionReason"] = clean_text(body.get("reason"), 500)
            application["reviewedAt"] = iso()
            application["reviewedById"] = user["id"]
            put_record("applications", application)

            applicant = get_record("users", application.get("userId"))
            if applicant and decision == "approved":
                existing = find_one("memberships", lambda item: item.get("userId") == applicant["id"] and item.get("departmentId") == application["departmentId"])
                membership = existing or {"id": new_id(), "joinedAt": iso(), "createdAt": iso()}
                membership.update(
                    {
                        "userId": applicant["id"],
                        "departmentId": application["departmentId"],
                        "rankId": clean_text(body.get("rankId"), 80) or None,
                        "role": role,
                        "badgeNumber": clean_text(body.get("badgeNumber"), 40),
                        "active": True,
                    }
                )
                put_record("memberships", membership)
                applicant["role"] = role
                put_record("users", applicant)
                add_notification(applicant["id"], "Department Application Approved", f"Approved for {department.get('name') if department else 'department'}. MDT access is now enabled.", "application", {"applicationId": application["id"], "departmentId": application["departmentId"]})
            elif applicant:
                active_memberships = [item for item in list_records("memberships", order_key=None) if item.get("userId") == applicant["id"] and item.get("active", True)]
                if not active_memberships:
                    applicant["role"] = "civilian"
                    put_record("users", applicant)
                add_notification(applicant["id"], "Department Application Decision", f"Application for {department.get('name') if department else 'department'} was denied.", "application", {"applicationId": application["id"], "departmentId": application["departmentId"]})

            audit_action(user["id"], f"admin.application.{decision}", "DepartmentApplication", application["id"], {"role": role, "rankId": body.get("rankId")}, self)
            self.send_json(200, {"application": enrich_application(application)})
            return

        if method == "GET" and segments == ["api", "admin", "users"]:
            users = [public_user(get_user_full(item["id"])) for item in list_records("users")[:250]]
            self.send_json(200, {"users": users})
            return

        if method == "PATCH" and len(segments) == 4 and segments[:3] == ["api", "admin", "users"]:
            body = self.read_body()
            target = get_record("users", segments[3])
            if not target:
                raise ApiError(404, "User not found.")
            if clean_text(body.get("role"), 80) in VALID_ROLES:
                target["role"] = clean_text(body.get("role"), 80)
            if "suspended" in body:
                target["suspended"] = bool(body.get("suspended"))
            if body.get("name"):
                target["name"] = clean_text(body.get("name"), 120)
            if "phone" in body:
                target["phone"] = clean_text(body.get("phone"), 40)
            put_record("users", target)
            audit_action(user["id"], "admin.user.update", "User", target["id"], {"role": target.get("role"), "suspended": target.get("suspended")}, self)
            self.send_json(200, {"user": public_user(get_user_full(target["id"]))})
            return

        if method == "GET" and segments == ["api", "admin", "departments"]:
            departments = [enrich_department(item, include_memberships=True) for item in list_records("departments", order_key="name", reverse=False)]
            self.send_json(200, {"departments": departments})
            return

        if method == "POST" and segments == ["api", "admin", "departments"]:
            body = self.read_body()
            validate_required(body, ["name", "code", "type"])
            department = put_record(
                "departments",
                {
                    "id": new_id(),
                    "name": clean_text(body.get("name"), 140),
                    "code": clean_text(body.get("code"), 20).upper(),
                    "type": clean_text(body.get("type"), 40),
                    "description": clean_text(body.get("description"), 500),
                    "isActive": True,
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "admin.department.create", "Department", department["id"], handler=self)
            self.send_json(201, {"department": department})
            return

        if method == "POST" and segments == ["api", "admin", "ranks"]:
            body = self.read_body()
            validate_required(body, ["departmentId", "name"])
            rank = put_record(
                "ranks",
                {
                    "id": new_id(),
                    "departmentId": clean_text(body.get("departmentId"), 80),
                    "name": clean_text(body.get("name"), 120),
                    "level": int(body.get("level") or 1),
                    "permissions": body.get("permissions") if isinstance(body.get("permissions"), dict) else {},
                    "createdAt": iso(),
                },
            )
            audit_action(user["id"], "admin.rank.create", "Rank", rank["id"], handler=self)
            self.send_json(201, {"rank": rank})
            return

        if method == "GET" and segments == ["api", "admin", "audit-logs"]:
            self.send_json(200, {"auditLogs": [self.enrich_audit(item) for item in list_records("audit_logs")[:200]]})
            return

        if method == "DELETE" and len(segments) == 5 and segments[:3] == ["api", "admin", "records"]:
            mapping = {
                "vehicle": "vehicles",
                "license": "licenses",
                "permit": "permits",
                "warrant": "warrants",
                "citation": "citations",
                "bolo": "bolos",
                "incidentReport": "incident_reports",
                "arrestReport": "arrest_reports",
                "fireReport": "fire_reports",
                "emsReport": "ems_reports",
            }
            collection = mapping.get(segments[3])
            if not collection:
                raise ApiError(404, "Unsupported fake record type.")
            delete_record(collection, segments[4])
            audit_action(user["id"], "admin.record.delete", segments[3], segments[4], handler=self)
            self.send_json(200, {"ok": True})
            return

        if method == "PATCH" and len(segments) == 4 and segments[:3] == ["api", "admin", "civilian-records"]:
            body = self.read_body()
            profile = find_one("profiles", lambda item: item.get("userId") == segments[3])
            if not profile:
                raise ApiError(404, "Civilian profile not found.")
            profile["notes"] = clean_text(body.get("notes"), 1000)
            flags = body.get("recordFlags")
            if isinstance(flags, list):
                profile["recordFlags"] = [clean_text(flag, 80) for flag in flags if clean_text(flag, 80)]
            put_record("profiles", profile)
            audit_action(user["id"], "admin.civilian-record.update", "CivilianProfile", profile["id"], handler=self)
            self.send_json(200, {"profile": profile})
            return

        if method == "GET" and segments == ["api", "admin", "settings"]:
            self.send_json(200, {"settings": list_records("server_settings", order_key="key", reverse=False)})
            return

        if method == "PATCH" and segments == ["api", "admin", "settings"]:
            body = self.read_body()
            validate_required(body, ["key"])
            key = clean_text(body.get("key"), 80)
            setting = find_one("server_settings", lambda item: item.get("key") == key) or {"id": new_id(), "key": key, "createdAt": iso()}
            setting["value"] = body.get("value") if isinstance(body.get("value"), dict) else {}
            put_record("server_settings", setting)
            audit_action(user["id"], "admin.setting.update", "ServerSetting", setting["id"], {"key": key}, self)
            self.send_json(200, {"setting": setting})
            return

        raise ApiError(404, "Admin route not found.")

    def enrich_audit(self, log: dict[str, Any]) -> dict[str, Any]:
        item = dict(log)
        item["actor"] = public_user(get_user_full(log.get("actorId"), include_memberships=False))
        return item


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT") or "3000")
    host = os.environ.get("HOST") or "0.0.0.0"
    server = ThreadingHTTPServer((host, port), FairCroftHandler)
    print(f"{APP_NAME} Python PWA ready on {host}:{port}")
    print(f"SQLite database: {DATABASE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
