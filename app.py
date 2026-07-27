from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import socket
import stat
import struct
import threading
import time
import zlib
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import psycopg
import paramiko
from psycopg.rows import dict_row


APP_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = APP_ROOT / "static"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DATABASE_MAX_CONNECTIONS = max(2, int(os.environ.get("DATABASE_MAX_CONNECTIONS", "5")))
DATABASE_CONNECT_TIMEOUT_SECONDS = max(3, int(os.environ.get("DATABASE_CONNECT_TIMEOUT_SECONDS", "10")))
DATABASE_CONNECTION_SEMAPHORE = threading.BoundedSemaphore(DATABASE_MAX_CONNECTIONS)
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-before-production")
COOKIE_NAME = "rp_session"
SESSION_DAYS = 7
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "owner@rp.local").strip().lower()
OWNER_PASSWORD = os.environ.get("OWNER_PASSWORD", "owner1234")
OWNER_NAME = os.environ.get("OWNER_NAME", "Server Owner")
ARMA_BRIDGE_API_KEY = os.environ.get("ARMA_BRIDGE_API_KEY", "").strip()
ARMA_LINK_CODE_TTL_MINUTES = int(os.environ.get("ARMA_LINK_CODE_TTL_MINUTES", "30"))
SHADOWHAVEN_SFTP_HOST = os.environ.get("SHADOWHAVEN_SFTP_HOST", "").strip()
SHADOWHAVEN_SFTP_PORT = int(os.environ.get("SHADOWHAVEN_SFTP_PORT", "2022"))
SHADOWHAVEN_SFTP_USERNAME = os.environ.get("SHADOWHAVEN_SFTP_USERNAME", "").strip()
SHADOWHAVEN_SFTP_PASSWORD = os.environ.get("SHADOWHAVEN_SFTP_PASSWORD", "")
SHADOWHAVEN_BANK_FILE = os.environ.get(
    "SHADOWHAVEN_BANK_FILE",
    "profile/profile/.db/FCRPMUSSALO/Banks/00bb0001-1e42-6138-7e90-c04752d4fab6.json",
).strip()
SHADOWHAVEN_BANK_SYNC_SECONDS = max(5, int(os.environ.get("SHADOWHAVEN_BANK_SYNC_SECONDS", "15")))
SHADOWHAVEN_PERSISTENCE_ROOT = os.environ.get(
    "SHADOWHAVEN_PERSISTENCE_ROOT",
    "profile/profile/.db/FCRPMUSSALO",
).strip().rstrip("/")
SHADOWHAVEN_PERSISTENCE_SYNC_SECONDS = max(
    60, int(os.environ.get("SHADOWHAVEN_PERSISTENCE_SYNC_SECONDS", "120"))
)
SHADOWHAVEN_PERSISTENCE_MAX_FILES = max(
    100, int(os.environ.get("SHADOWHAVEN_PERSISTENCE_MAX_FILES", "5000"))
)
SHADOWHAVEN_PERSISTENCE_MAX_FILE_BYTES = max(
    65536, int(os.environ.get("SHADOWHAVEN_PERSISTENCE_MAX_FILE_BYTES", "524288"))
)
SHADOWHAVEN_ANTICHEAT_DATABASE_FILE = os.environ.get(
    "SHADOWHAVEN_ANTICHEAT_DATABASE_FILE",
    "profile/profile/TB/tb_player_database.json",
).strip()
SHADOWHAVEN_ANTICHEAT_ALT_FILE = os.environ.get(
    "SHADOWHAVEN_ANTICHEAT_ALT_FILE",
    "profile/profile/TB/tb_alt_accounts.json",
).strip()
SHADOWHAVEN_ANTICHEAT_SYNC_SECONDS = max(
    15, int(os.environ.get("SHADOWHAVEN_ANTICHEAT_SYNC_SECONDS", "30"))
)
ANTICHEAT_LIVE_TTL_SECONDS = max(90, int(os.environ.get("ANTICHEAT_LIVE_TTL_SECONDS", "900")))
ARMA_RCON_HOST = os.environ.get("ARMA_RCON_HOST", os.environ.get("RCON_HOST", "")).strip()
ARMA_RCON_PORT = int(os.environ.get("ARMA_RCON_PORT", os.environ.get("RCON_PORT", "19999")))
ARMA_RCON_PASSWORD = os.environ.get("ARMA_RCON_PASSWORD", os.environ.get("RCON_PASSWORD", ""))
ARMA_RCON_TIMEOUT_SECONDS = max(1.0, min(float(os.environ.get("ARMA_RCON_TIMEOUT_SECONDS", "5")), 15.0))
NAME_CHANGE_LIMIT = 3
NAME_CHANGE_WINDOW_DAYS = 3
TREASURY_STIMULUS_AMOUNT = 75000.00
TREASURY_MAX_REQUEST_AMOUNT = 10_000_000.00
TREASURY_MAX_PROOFS = 4
TREASURY_MAX_PROOF_CHARS = 1_800_000
REFERRAL_BONUS_AMOUNT = 50000.00


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


def arma_rcon_configured() -> bool:
    return bool(ARMA_RCON_HOST and ARMA_RCON_PASSWORD and 1 <= ARMA_RCON_PORT <= 65535)


def arma_rcon_packet(payload: bytes) -> bytes:
    checksum = zlib.crc32(payload) & 0xFFFFFFFF
    return b"BE" + struct.pack("<I", checksum) + b"\xff" + payload


def arma_rcon_payload(packet: bytes) -> bytes:
    if len(packet) < 8 or packet[:2] != b"BE" or packet[6:7] != b"\xff":
        raise RuntimeError("RCON returned an invalid packet")
    expected = struct.unpack("<I", packet[2:6])[0]
    payload = packet[7:]
    if (zlib.crc32(payload) & 0xFFFFFFFF) != expected:
        raise RuntimeError("RCON returned a packet with an invalid checksum")
    return payload


def execute_arma_rcon(command: str, *, accept_timeout_after_send: bool = False) -> dict[str, str]:
    """Execute one command using Arma Reforger's UDP RCON protocol."""
    if not arma_rcon_configured():
        return {"status": "rcon_not_configured", "response": ""}
    clean_command = " ".join(str(command).replace("\x00", " ").split())
    if not clean_command:
        raise RuntimeError("RCON command cannot be empty")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
        client.settimeout(ARMA_RCON_TIMEOUT_SECONDS)
        client.connect((ARMA_RCON_HOST, ARMA_RCON_PORT))
        client.send(arma_rcon_packet(b"\x00" + ARMA_RCON_PASSWORD.encode("utf-8")))
        login = arma_rcon_payload(client.recv(65535))
        if len(login) < 2 or login[0] != 0 or login[1] != 1:
            raise RuntimeError("RCON authentication failed")
        client.send(arma_rcon_packet(b"\x01\x00" + clean_command.encode("utf-8")))
        try:
            reply = arma_rcon_payload(client.recv(65535))
        except TimeoutError:
            if accept_timeout_after_send:
                return {
                    "status": "dispatched",
                    "response": "Command was dispatched; the server stopped responding while the restart began.",
                }
            raise RuntimeError("RCON command timed out waiting for the server response")
        if len(reply) < 2 or reply[0] != 1 or reply[1] != 0:
            raise RuntimeError("RCON returned an unexpected command response")
        response = reply[2:].decode("utf-8", errors="replace").strip()
        lowered = response.lower()
        if any(
            marker in lowered
            for marker in (
                "error",
                "failed",
                "unknown command",
                "not found",
                "permission denied",
                "not permitted",
                "not allowed",
                "forbidden",
                "insufficient permission",
            )
        ):
            raise RuntimeError(f"RCON rejected the command: {response[:300]}")
        try:
            client.send(arma_rcon_packet(b"\x01\x01@logout"))
        except OSError:
            pass
    return {"status": "applied", "response": response[:1000]}


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


ROLE_ALIASES = {
    "chief": "fire_chief",
    "cheif": "fire_chief",
    "fire chief": "fire_chief",
    "fire-chief": "fire_chief",
    "firechief": "fire_chief",
    "fire_cheif": "fire_chief",
    "fd chief": "fire_chief",
    "fd_chief": "fire_chief",
    "deputy chief": "deputy_chief",
    "deputy-chief": "deputy_chief",
    "deputy fire chief": "deputy_chief",
    "fire marshal": "fire_marshal",
    "fire-marshall": "fire_marshal",
    "fire marshall": "fire_marshal",
    "metro police chief": "metro_police_chief",
    "metro-police-chief": "metro_police_chief",
    "police chief": "metro_police_chief",
    "state police commander": "state_police_commander",
    "state-police-commander": "state_police_commander",
    "interrogation unit": "iu",
    "interrogation_unit": "iu",
    "interrogationunit": "iu",
    "iu": "iu",
    "cid director": "cid_director",
    "cid-director": "cid_director",
    "iu director": "iu_director",
    "iu_director": "iu_director",
    "iu-director": "iu_director",
    "interrogation_unit_director": "iu_director",
    "interrogation-unit-director": "iu_director",
    "interrogation unit director": "iu_director",
}


def normalize_role(role: Any) -> str:
    clean = str(role or "").strip().lower().replace("-", "_")
    clean = " ".join(clean.split())
    clean = clean.replace(" ", "_") if clean not in ROLE_ALIASES else clean
    return ROLE_ALIASES.get(clean, clean)


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
        self._slot_acquired = DATABASE_CONNECTION_SEMAPHORE.acquire(timeout=DATABASE_CONNECT_TIMEOUT_SECONDS)
        if not self._slot_acquired:
            raise RuntimeError("Database is busy; no application connection slot became available")
        try:
            self.raw = psycopg.connect(
                DATABASE_URL,
                row_factory=dict_row,
                connect_timeout=DATABASE_CONNECT_TIMEOUT_SECONDS,
                application_name="faircroft-rp-os",
            )
        except Exception:
            DATABASE_CONNECTION_SEMAPHORE.release()
            self._slot_acquired = False
            raise

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        try:
            if exc_type:
                self.raw.rollback()
            else:
                self.raw.commit()
        finally:
            self.raw.close()
            if self._slot_acquired:
                DATABASE_CONNECTION_SEMAPHORE.release()
                self._slot_acquired = False

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


def extract_shadowhaven_bank_data(payload: Any) -> tuple[dict[str, Any], str]:
    if not isinstance(payload, dict):
        return {}, ""
    source_saved_at = str(payload.get("m_iLastSaved") or "")
    components = payload.get("m_aComponents")
    if not isinstance(components, list):
        return {}, source_saved_at
    for component in components:
        if not isinstance(component, dict) or component.get("_type") != "BankManagerComponent":
            continue
        data = component.get("m_pData")
        if isinstance(data, dict) and isinstance(data.get("m_Banks"), dict):
            return data["m_Banks"], source_saved_at
    return {}, source_saved_at


def sync_shadowhaven_bank_once() -> int:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        return 0
    transport = paramiko.Transport((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_PORT))
    try:
        transport.connect(username=SHADOWHAVEN_SFTP_USERNAME, password=SHADOWHAVEN_SFTP_PASSWORD)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            with sftp.open(SHADOWHAVEN_BANK_FILE, "r") as remote_file:
                payload = json.loads(remote_file.read().decode("utf-8-sig"))
        finally:
            sftp.close()
    finally:
        transport.close()

    balances, source_saved_at = extract_shadowhaven_bank_data(payload)
    if not balances:
        raise RuntimeError("BankManagerComponent contained no balances")
    synced_at = now_iso()
    accepted = 0
    with conn() as db:
        for identity_id, raw_balance in balances.items():
            identity = str(identity_id or "").strip()[:160]
            if not identity:
                continue
            try:
                balance = round(float(raw_balance or 0), 2)
            except (TypeError, ValueError):
                continue
            db.execute(
                """
                INSERT INTO arma_game_bank_balances
                (identity_id, balance, source_file, source_saved_at, raw_payload, synced_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (identity_id) DO UPDATE SET
                    balance = EXCLUDED.balance,
                    source_file = EXCLUDED.source_file,
                    source_saved_at = EXCLUDED.source_saved_at,
                    raw_payload = EXCLUDED.raw_payload,
                    synced_at = EXCLUDED.synced_at
                """,
                (
                    identity,
                    balance,
                    SHADOWHAVEN_BANK_FILE[:255],
                    source_saved_at[:80],
                    json.dumps({"balance": balance}),
                    synced_at,
                ),
            )
            accepted += 1
    return accepted


def shadowhaven_bank_sync_worker() -> None:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        print("Shadowhaven SFTP bank sync disabled: credentials are not configured")
        return
    while True:
        try:
            accepted = sync_shadowhaven_bank_once()
            print(f"Shadowhaven SFTP bank sync updated {accepted} balance(s)")
        except Exception as exc:
            print(f"Shadowhaven SFTP bank sync failed: {type(exc).__name__}: {exc}")
        time.sleep(SHADOWHAVEN_BANK_SYNC_SECONDS)


def sync_shadowhaven_anticheat_once() -> tuple[int, int]:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        return 0, 0
    transport = paramiko.Transport((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_PORT))
    try:
        transport.connect(username=SHADOWHAVEN_SFTP_USERNAME, password=SHADOWHAVEN_SFTP_PASSWORD)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            with sftp.open(SHADOWHAVEN_ANTICHEAT_DATABASE_FILE, "r") as remote_file:
                player_payload = json.loads(remote_file.read().decode("utf-8-sig"))
            with sftp.open(SHADOWHAVEN_ANTICHEAT_ALT_FILE, "r") as remote_file:
                alt_payload = json.loads(remote_file.read().decode("utf-8-sig"))
        finally:
            sftp.close()
    finally:
        transport.close()

    players = player_payload.get("players", []) if isinstance(player_payload, dict) else []
    groups = alt_payload.get("groups", []) if isinstance(alt_payload, dict) else []
    if not isinstance(players, list) or not isinstance(groups, list):
        raise RuntimeError("Thunder Buddies Anti-Cheat JSON has an invalid structure")

    synced_at = now_iso()
    accepted_players = 0
    accepted_groups = 0
    with conn() as db:
        for player in players:
            if not isinstance(player, dict):
                continue
            uid = str(player.get("playerUID") or "").strip()[:160]
            if not uid:
                continue
            db.execute(
                """
                INSERT INTO anticheat_players
                (uid, player_name, reported_system, teleport_flags, aim_flags, ticket_count, raw_payload,
                 source_file, first_synced_at, last_synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (uid) DO UPDATE SET
                    player_name = EXCLUDED.player_name,
                    reported_system = CASE
                        WHEN EXCLUDED.reported_system <> '' THEN EXCLUDED.reported_system
                        ELSE anticheat_players.reported_system
                    END,
                    teleport_flags = EXCLUDED.teleport_flags,
                    aim_flags = EXCLUDED.aim_flags,
                    ticket_count = EXCLUDED.ticket_count,
                    raw_payload = EXCLUDED.raw_payload,
                    source_file = EXCLUDED.source_file,
                    last_synced_at = EXCLUDED.last_synced_at
                """,
                (
                    uid,
                    str(player.get("playerName") or "Unknown")[:120],
                    str(
                        player.get("platform")
                        or player.get("playerPlatform")
                        or player.get("platformName")
                        or player.get("system")
                        or player.get("deviceType")
                        or ""
                    ).strip()[:80],
                    int(player.get("teleportFlags") or 0),
                    int(player.get("aimFlags") or 0),
                    int(player.get("ticketCount") or 0),
                    json.dumps(player, separators=(",", ":"), default=str)[:20000],
                    SHADOWHAVEN_ANTICHEAT_DATABASE_FILE[:255],
                    synced_at,
                    synced_at,
                ),
            )
            for event in player.get("events", []) if isinstance(player.get("events"), list) else []:
                if not isinstance(event, dict):
                    continue
                event_type = str(event.get("type") or "unknown")[:80]
                event_time = str(event.get("time") or "")[:100]
                details = str(event.get("details") or "")[:4000]
                fingerprint = hashlib.sha256(
                    f"{uid}\x1f{event_type}\x1f{event_time}\x1f{details}".encode("utf-8")
                ).hexdigest()
                db.execute(
                    """
                    INSERT INTO anticheat_events
                    (event_fingerprint, player_uid, event_type, event_time, details,
                     source_file, first_synced_at, last_synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (event_fingerprint) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at
                    """,
                    (fingerprint, uid, event_type, event_time, details,
                     SHADOWHAVEN_ANTICHEAT_DATABASE_FILE[:255], synced_at, synced_at),
                )
            accepted_players += 1

        for group in groups:
            if not isinstance(group, dict):
                continue
            group_key = str(group.get("groupKey") or "").strip()[:180]
            if not group_key:
                continue
            db.execute(
                """
                INSERT INTO anticheat_alt_groups
                (group_key, note, first_seen, last_seen, raw_payload, last_synced_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (group_key) DO UPDATE SET
                    note = EXCLUDED.note, first_seen = EXCLUDED.first_seen,
                    last_seen = EXCLUDED.last_seen, raw_payload = EXCLUDED.raw_payload,
                    last_synced_at = EXCLUDED.last_synced_at
                """,
                (
                    group_key, str(group.get("note") or "")[:2000],
                    str(group.get("firstSeen") or "")[:100], str(group.get("lastSeen") or "")[:100],
                    json.dumps(group, separators=(",", ":"), default=str)[:20000], synced_at,
                ),
            )
            uids = group.get("uids") if isinstance(group.get("uids"), list) else []
            names = group.get("names") if isinstance(group.get("names"), list) else []
            for index, raw_uid in enumerate(uids):
                member_uid = str(raw_uid or "").strip()[:160]
                if not member_uid:
                    continue
                observed_name = str(names[index] if index < len(names) else "")[:120]
                db.execute(
                    """
                    INSERT INTO anticheat_alt_members (group_key, uid, observed_name, last_synced_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (group_key, uid) DO UPDATE SET
                        observed_name = EXCLUDED.observed_name,
                        last_synced_at = EXCLUDED.last_synced_at
                    """,
                    (group_key, member_uid, observed_name, synced_at),
                )
            accepted_groups += 1

        for source_key, source_path, records in (
            ("players", SHADOWHAVEN_ANTICHEAT_DATABASE_FILE, accepted_players),
            ("alt_accounts", SHADOWHAVEN_ANTICHEAT_ALT_FILE, accepted_groups),
        ):
            db.execute(
                """
                INSERT INTO anticheat_sync_status
                (source_key, source_path, status, records, last_success_at, last_error, updated_at)
                VALUES (?, ?, 'synced', ?, ?, '', ?)
                ON CONFLICT (source_key) DO UPDATE SET
                    source_path = EXCLUDED.source_path, status = EXCLUDED.status,
                    records = EXCLUDED.records, last_success_at = EXCLUDED.last_success_at,
                    last_error = '', updated_at = EXCLUDED.updated_at
                """,
                (source_key, source_path[:255], records, synced_at, synced_at),
            )
    return accepted_players, accepted_groups


def shadowhaven_anticheat_sync_worker() -> None:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        print("Shadowhaven SFTP anti-cheat sync disabled: credentials are not configured")
        return
    while True:
        try:
            players, groups = sync_shadowhaven_anticheat_once()
            print(f"Shadowhaven SFTP anti-cheat sync updated {players} player(s), {groups} alt group(s)")
        except Exception as exc:
            print(f"Shadowhaven SFTP anti-cheat sync failed: {type(exc).__name__}: {exc}")
        time.sleep(SHADOWHAVEN_ANTICHEAT_SYNC_SECONDS)


PERSISTENCE_CATEGORIES = {
    "Characters", "CopChats", "Criminals", "Items", "PoliceReports",
    "RootEntityCollections", "Turrets", "Vehicles",
}


def persistence_scalar_fields(payload: Any, limit: int = 2000) -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = []

    def walk(value: Any, path: str, depth: int) -> None:
        if len(fields) >= limit or depth > 16:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, f"{path}.{key}" if path else str(key), depth + 1)
        elif isinstance(value, list):
            for index, child in enumerate(value[:500]):
                walk(child, f"{path}[{index}]", depth + 1)
        elif value is not None and not isinstance(value, bool):
            text = str(value).strip()
            if text:
                fields.append((path, text[:1000]))

    walk(payload, "", 0)
    return fields


def summarize_persistence_record(category: str, record_id: str, payload: Any) -> dict[str, Any]:
    fields = persistence_scalar_fields(payload)
    lowered = [(path.lower(), value) for path, value in fields]

    def first_value(*needles: str) -> str:
        for path, value in lowered:
            leaf = path.rsplit(".", 1)[-1]
            if any(needle in leaf for needle in needles):
                return value
        return ""

    identity_values: list[str] = []
    for path, value in lowered:
        leaf = path.rsplit(".", 1)[-1]
        if any(key in leaf for key in (
            "identity", "playeruid", "player_uid", "playerid", "player_id",
            "owneruid", "owner_uid", "ownerid", "owner_id", "bohemia",
            "characterid", "character_id", "persistentid", "persistent_id", "pid",
        )):
            if value not in identity_values:
                identity_values.append(value[:180])

    component_types: list[str] = []
    for path, value in fields:
        if path.lower().endswith("._type") and value not in component_types:
            component_types.append(value[:120])

    prefab = first_value("prefab", "resourcename", "template")
    display_name = first_value("displayname", "itemname", "vehiclename", "charactername", "name", "title")
    owner_id = first_value(
        "owneruid", "owner_uid", "ownerid", "owner_id", "playeruid",
        "player_uid", "playerid", "player_id", "identityid", "identity_id",
        "bohemia", "persistentid", "persistent_id", "pid",
    )
    status = first_value("status", "state")
    amount = first_value("balance", "amount", "value", "price")
    title = display_name or (prefab.rsplit("/", 1)[-1].replace(".et", "") if prefab else "") or f"{category} record"
    return {
        "title": title[:180],
        "prefab": prefab[:500],
        "owner_id": owner_id[:180],
        "status": status[:100],
        "amount": amount[:100],
        "identity_values": identity_values[:40],
        "component_types": component_types[:80],
        "field_count": len(fields),
    }


def upsert_persistence_record_batch(records: list[tuple[Any, ...]]) -> None:
    if not records:
        return
    with conn() as db:
        for record in records:
            db.execute(
                """
                INSERT INTO game_persistence_records
                (source_path, category, record_id, title, owner_identity, identity_values,
                 component_types, prefab, record_status, amount_text, summary_payload,
                 raw_payload, source_modified_at, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (source_path) DO UPDATE SET
                    category = EXCLUDED.category, record_id = EXCLUDED.record_id,
                    title = EXCLUDED.title, owner_identity = EXCLUDED.owner_identity,
                    identity_values = EXCLUDED.identity_values,
                    component_types = EXCLUDED.component_types, prefab = EXCLUDED.prefab,
                    record_status = EXCLUDED.record_status, amount_text = EXCLUDED.amount_text,
                    summary_payload = EXCLUDED.summary_payload, raw_payload = EXCLUDED.raw_payload,
                    source_modified_at = EXCLUDED.source_modified_at, synced_at = EXCLUDED.synced_at
                """,
                record,
            )


def sync_shadowhaven_persistence_once() -> tuple[int, dict[str, int]]:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        return 0, {}
    transport = paramiko.Transport((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_PORT))
    processed = 0
    category_counts: dict[str, int] = {}
    synced_at = now_iso()
    try:
        transport.connect(username=SHADOWHAVEN_SFTP_USERNAME, password=SHADOWHAVEN_SFTP_PASSWORD)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            # The list is reversed because this scanner consumes it with pop().
            # Player-facing collections are deliberately processed before large
            # world/item collections so linked-account data appears immediately.
            category_priority = [
                "Characters", "Vehicles", "Criminals", "PoliceReports",
                "CopChats", "Turrets", "RootEntityCollections", "Items",
            ]
            pending = [
                (f"{SHADOWHAVEN_PERSISTENCE_ROOT}/{category}", category)
                for category in reversed(category_priority)
            ]
            records: list[tuple[Any, ...]] = []
            while pending and processed < SHADOWHAVEN_PERSISTENCE_MAX_FILES:
                remote_path, category = pending.pop()
                try:
                    entries = sftp.listdir_attr(remote_path)
                except OSError:
                    continue
                for entry in entries:
                    if processed >= SHADOWHAVEN_PERSISTENCE_MAX_FILES:
                        break
                    child_path = f"{remote_path}/{entry.filename}"
                    if stat.S_ISDIR(entry.st_mode):
                        pending.append((child_path, category))
                        continue
                    if not entry.filename.lower().endswith(".json"):
                        continue
                    if entry.st_size > SHADOWHAVEN_PERSISTENCE_MAX_FILE_BYTES:
                        continue
                    try:
                        with sftp.open(child_path, "r") as remote_file:
                            payload = json.loads(remote_file.read().decode("utf-8-sig"))
                    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                        continue
                    record_id = entry.filename[:-5][:180]
                    summary = summarize_persistence_record(category, record_id, payload)
                    raw_payload = json.dumps(payload, separators=(",", ":"), default=str)
                    records.append((
                        child_path[:500], category[:80], record_id,
                        summary["title"], summary["owner_id"],
                        json.dumps(summary["identity_values"], separators=(",", ":")),
                        json.dumps(summary["component_types"], separators=(",", ":")),
                        summary["prefab"], summary["status"], summary["amount"],
                        json.dumps(summary, separators=(",", ":")),
                        raw_payload[:250000], str(int(entry.st_mtime or 0)), synced_at,
                    ))
                    processed += 1
                    category_counts[category] = category_counts.get(category, 0) + 1
                    if len(records) >= 100:
                        upsert_persistence_record_batch(records)
                        records.clear()
                        print(
                            f"Shadowhaven FCRPMUSSALO sync progress: "
                            f"{processed} record(s), current category {category}"
                        )
        finally:
            sftp.close()
    finally:
        transport.close()

    upsert_persistence_record_batch(records)
    with conn() as db:
        db.execute(
            """
            INSERT INTO game_persistence_sync_status
            (source_root, status, records, category_counts, last_success_at, last_error, updated_at)
            VALUES (?, 'synced', ?, ?, ?, '', ?)
            ON CONFLICT (source_root) DO UPDATE SET
                status = 'synced', records = EXCLUDED.records,
                category_counts = EXCLUDED.category_counts,
                last_success_at = EXCLUDED.last_success_at, last_error = '',
                updated_at = EXCLUDED.updated_at
            """,
            (
                SHADOWHAVEN_PERSISTENCE_ROOT[:500], processed,
                json.dumps(category_counts, separators=(",", ":"), sort_keys=True),
                synced_at, synced_at,
            ),
        )
    return processed, category_counts


def shadowhaven_persistence_sync_worker() -> None:
    if not all((SHADOWHAVEN_SFTP_HOST, SHADOWHAVEN_SFTP_USERNAME, SHADOWHAVEN_SFTP_PASSWORD)):
        print("Shadowhaven FCRPMUSSALO sync disabled: credentials are not configured")
        return
    print(
        f"Shadowhaven FCRPMUSSALO sync starting from "
        f"{SHADOWHAVEN_PERSISTENCE_ROOT}"
    )
    while True:
        try:
            records, categories = sync_shadowhaven_persistence_once()
            print(f"Shadowhaven FCRPMUSSALO sync updated {records} record(s): {categories}")
        except Exception as exc:
            print(f"Shadowhaven FCRPMUSSALO sync failed: {type(exc).__name__}: {exc}")
        time.sleep(SHADOWHAVEN_PERSISTENCE_SYNC_SECONDS)


def roles_for(user: DbRow) -> list[str]:
    raw = user.get("roles", "[]")
    try:
        roles = json.loads(raw or "[]")
    except json.JSONDecodeError:
        roles = []
    normalized = [normalize_role(role) for role in roles]
    return sorted(set(["civ", *[role for role in normalized if role]]))


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
        "car_entry_code": user.get("car_entry_code") or "",
        "car_entry_code_required": not bool(str(user.get("car_entry_code") or "").strip()),
        "callsign": user.get("callsign") or "",
        "callsign_required": not bool(str(user.get("callsign") or "").strip()),
        # The legacy users.bank_balance column is intentionally not exposed.
        # FCRPMUSSALO is the authoritative bank and is applied by
        # public_user_with_game_bank where a database context is available.
        "bank_balance": 0,
        "bank_balance_source": "FCRPMUSSALO",
        "bank_balance_synced": False,
        "cash_balance": 0,
        "active_character_id": user.get("active_character_id"),
        "name_change_locked": bool(user.get("name_change_locked", 0)),
        "referral_code": user.get("referral_code") or "",
        "referred_by_user_id": user.get("referred_by_user_id"),
        "created_at": user["created_at"],
    }


def public_user_with_game_bank(db: Database, user: DbRow) -> dict[str, Any]:
    payload = public_user(user)
    game_bank = one(
        db,
        """
        SELECT b.balance, b.synced_at
        FROM arma_account_links l
        JOIN arma_game_bank_balances b ON b.identity_id = l.identity_id
        WHERE l.user_id = ?
        """,
        (user["id"],),
    )
    payload["bank_balance"] = round(float(game_bank["balance"] or 0), 2) if game_bank else 0
    payload["bank_balance_source"] = "FCRPMUSSALO"
    payload["bank_balance_synced"] = bool(game_bank)
    payload["bank_balance_synced_at"] = game_bank.get("synced_at") if game_bank else None
    return payload


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


def generate_referral_code(db: Database) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(80):
        code = "FC" + "".join(secrets.choice(alphabet) for _ in range(6))
        if not one(db, "SELECT id FROM users WHERE referral_code = ?", (code,)):
            return code
    raise RuntimeError("Unable to generate unique referral code")


def clean_referral_code(value: Any) -> str:
    code = str(value or "").strip().upper().replace(" ", "").replace("-", "")
    if not code:
        return ""
    if len(code) < 4 or len(code) > 16:
        raise ValueError("Referral code is not valid")
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    if any(character not in allowed for character in code):
        raise ValueError("Referral code can only use letters and numbers")
    return code


def clean_car_entry_code(value: Any) -> str:
    code = str(value or "").strip().upper()
    if not code:
        raise ValueError("Car entry code is required")
    if len(code) < 2 or len(code) > 32:
        raise ValueError("Car entry code must be 2-32 characters")
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    if any(character not in allowed for character in code):
        raise ValueError("Car entry code can only use letters, numbers, dashes, or underscores")
    return code


def clean_callsign(value: Any) -> str:
    callsign = str(value or "").strip().upper()
    if not callsign:
        raise ValueError("Callsign is required")
    if len(callsign) < 2 or len(callsign) > 24:
        raise ValueError("Callsign must be 2-24 characters")
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    if any(character not in allowed for character in callsign):
        raise ValueError("Callsign can only use letters, numbers, dashes, or underscores")
    return callsign


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
        ("cad_after_call_reports", "report_number"),
        ("mdt_bolos", "bolo_number"),
        ("mdt_bookings", "booking_number"),
        ("rp_contracts", "contract_number"),
        ("business_applications", "application_number"),
        ("businesses", "license_number"),
        ("department_applications", "application_number"),
        ("treasury_requests", "request_number"),
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
ROADMAP_STATUSES = ("shipped", "building", "next", "planned", "exploring", "paused")
ROADMAP_ACCENTS = ("mint", "gold", "coral", "cyan", "violet")
ROADMAP_ICONS = ("route", "shield", "link", "bank", "home", "rocket", "settings")
FIRE_COMMAND_ROLES = ("fire_chief", "deputy_chief", "fire_marshal")
FIRE_SERVICE_ROLES = ("fireman", "ems", *FIRE_COMMAND_ROLES)
FIRE_RIG_NAMES = ("Engine 1", "Ladder 1", "Truck 1", "Rescue 1", "Battalion 1", "Battalion 2", "Battalion 3", "Battalion 4", "Battalion 5")
LAW_SERVICE_ROLES = ("leo", "sheriff", "police", "metro_police_chief", "state_police", "state_police_commander", "cid", "cid_director", "iu", "iu_director")
INDEED_ADMIN_ROLE = "indeed_admin"
LAW_ENFORCEMENT_DEPARTMENT_KEYS = ("state_police", "metro_police", "sheriff", "cid", "iu")
LAW_ENFORCEMENT_DEPARTMENT_CHOICES = ("Faircroft Sheriff's Office",)
LAW_ENFORCEMENT_COMMAND_ROLES = {
    "metro_police": ("metro_police_chief",),
    "state_police": ("state_police_commander",),
    "cid": ("cid_director",),
    "iu": ("iu_director",),
}


def roadmap_payload_values(payload: dict[str, Any], current: DbRow | None = None) -> dict[str, Any]:
    current = current or {}

    def value(key: str, default: Any) -> Any:
        return payload[key] if key in payload else current.get(key, default)

    title = " ".join(str(value("title", "") or "").strip().split())[:120]
    category = " ".join(str(value("category", "Platform") or "Platform").strip().split())[:60]
    summary = str(value("summary", "") or "").strip()[:500]
    details = str(value("details", "") or "").strip()[:5000]
    status = str(value("status", "planned") or "planned").strip().lower()
    accent = str(value("accent", "mint") or "mint").strip().lower()
    icon = str(value("icon", "route") or "route").strip().lower()
    if not title:
        raise ValueError("Roadmap title is required")
    if not summary:
        raise ValueError("Roadmap summary is required")
    if status not in ROADMAP_STATUSES:
        raise ValueError("Invalid roadmap status")
    if accent not in ROADMAP_ACCENTS:
        raise ValueError("Invalid roadmap accent")
    if icon not in ROADMAP_ICONS:
        raise ValueError("Invalid roadmap icon")
    try:
        progress = max(0, min(100, int(value("progress", 0))))
        sort_order = max(0, min(9999, int(value("sort_order", 0))))
    except (TypeError, ValueError) as exc:
        raise ValueError("Progress and route order must be whole numbers") from exc
    target_date = str(value("target_date", "") or "").strip()
    if target_date:
        try:
            dt.date.fromisoformat(target_date)
        except ValueError as exc:
            raise ValueError("Target date must use YYYY-MM-DD") from exc
    visible_raw = value("is_visible", 1)
    is_visible = 1 if str(visible_raw).lower() in ("1", "true", "yes", "on") else 0
    return {
        "title": title,
        "category": category,
        "summary": summary,
        "details": details,
        "status": status,
        "progress": progress,
        "target_date": target_date or None,
        "sort_order": sort_order,
        "accent": accent,
        "icon": icon,
        "is_visible": is_visible,
    }
LAW_ENFORCEMENT_APPLICATION_FIELDS = (
    {"key": "in_game_name", "label": "What is your in-game name?", "kind": "text", "min": 2, "max": 120},
    {"key": "discord_name", "label": "Discord Name", "kind": "text", "min": 2, "max": 120},
    {"key": "age", "label": "Whats your Age", "kind": "age", "min": 1, "max": 3},
    {"key": "why_law_enforcement", "label": "Why do you want to join Law Enforcement", "kind": "long", "min": 20, "max": 4000},
    {"key": "department_choice", "label": "Which department do you want to apply for", "kind": "choice", "choices": LAW_ENFORCEMENT_DEPARTMENT_CHOICES},
    {"key": "prior_experience", "label": "Do you have any prior experience with Law Enforcement on any Rp servers", "kind": "long", "min": 2, "max": 3000},
    {"key": "position_fit", "label": "Explain why you would be Good for this position", "kind": "long", "min": 20, "max": 4000},
    {"key": "robbery_scenario", "label": "While on duty, you're dispatched to a Gas Station Robbery. Upon arrival, you notice an individual running out the side door towards their vehicle with a knife in their hand. How would you handle this situation?", "kind": "long", "min": 20, "max": 5000},
    {"key": "off_duty_corruption_scenario", "label": "While off duty, you are driving around Faircroft, and notice one of your friends, who is a Deputy, in the parking lot with a Citizen. You notice that the Deputy is pulling items out of his Patrol Belt and handing them to the individual. How would you handle this situation?", "kind": "long", "min": 20, "max": 5000},
    {"key": "drug_trafficking_process", "label": "While on duty, you detain a suspect for suspected drug trafficking, once you search them you discover the suspect does indeed have Cocaine. How would you process the suspect?", "kind": "long", "min": 20, "max": 5000},
    {"key": "corruption_acknowledgement", "label": "Do you understand that any proven corruption within the Faircroft Sheriff Offce may result in termination", "kind": "yesno"},
    {"key": "procedure_commitment", "label": "Do you commit to following the Global Operating Procedures, Division Standard Operating Procedures, and all announcements?", "kind": "yesno"},
    {"key": "english_communication", "label": "Can you communicate clearly using the English language, which is crucial for clear and concise communication across the Sheriff's Office?", "kind": "yesno"},
    {"key": "chain_of_command", "label": "Do you agree to follow chain of command", "kind": "yesno"},
    {"key": "truth_acknowledgement", "label": "Do you acknowledge that falsifying any information on this application will result in an automatic denial and could result in blacklisting", "kind": "yesno"},
)
BAR_EXAM_QUESTIONS = (
    ("Which offense is labeled Assault - Violent Crime with a $1,200 penalty?", ("Criminally negligent homicide", "Assault - Violent Crime", "Robbery in the 3rd degree", "Possession of burglar's tools"), "B"),
    ("Which offense involves physical injury with a deadly weapon or dangerous instrument and carries a $500 penalty?", ("Assault with a deadly weapon (lower degree)", "Murder in the 2nd degree", "Unlawful weapon possession", "Reckless endangerment"), "A"),
    ("Which serious assault carries a $2,500 penalty for serious physical injury by a deadly weapon or depraved-risk conduct?", ("Simple assault", "Aggravated assault on an officer", "Serious assault by deadly weapon", "Criminal facilitation"), "C"),
    ("Which offense is aggravated assault against a police or peace officer with a $5,000 penalty?", ("Assault - Violent Crime", "Aggravated assault upon a police or peace officer", "Robbery in the 1st degree", "Coercion in the 1st degree"), "B"),
    ("Which item is unlawful weapon possession with a $1,500 penalty?", ("WPN-style unlawful weapon possession", "Possession of burglar's tools", "Controlled substance possession", "Failure to identify"), "A"),
    ("Which offense causes death through criminal negligence and carries a $1,000 penalty?", ("Manslaughter in the 2nd degree", "Criminally negligent homicide", "Murder in the 1st degree", "Robbery in the 2nd degree"), "B"),
    ("Which offense carries a $10,000 penalty and involves intentionally causing death or depraved-risk conduct?", ("Manslaughter in the 1st degree", "Murder in the 2nd degree", "Criminal attempt", "Trespass in the 1st degree"), "B"),
    ("Which description best matches Robbery in the 2nd degree with a $2,500 penalty?", ("Forcibly stealing property with no aggravation", "Forcible stealing aided by another present, causing injury, or displaying what appears to be a firearm", "Simple theft below felony threshold", "Possession of burglar's tools"), "B"),
    ("Which offense is rape by forcible compulsion or when the victim is physically helpless and carries a $5,000 penalty?", ("Sexual misconduct", "Rape in the 1st degree", "Consensual sodomy (legacy)", "Criminal solicitation"), "B"),
    ("Which offense is listed as a legacy consensual sodomy offense with a $250 penalty?", ("Sexual misconduct", "Consensual sodomy (legacy)", "Sodomy in the 3rd degree", "Sodomy in the 1st degree"), "B"),
    ("Which item is the Class A misdemeanor carrying a $500 penalty for soliciting felony conduct?", ("Solicitation violation ($150)", "Solicitation for felony conduct ($500)", "Solicitation involving under 16 ($1,000)", "Solicitation for Class A felony ($2,500)"), "B"),
    ("Which facilitation offense applies when someone provides means to help commit a Class A felony and carries a $2,500 penalty?", ("Minor facilitation - $500", "Facilitation involving under 16 - $1,000", "Facilitation for Class A felony - $2,500", "Highest-level facilitation involving under 16 - $5,000"), "C"),
    ("Which conspiracy offense carries a $10,000 penalty for agreeing to commit a Class A felony with a participant under 16?", ("Low-level conspiracy - $250", "Mid-level conspiracy - $1,500", "Conspiracy to commit Class A felony - $5,000", "Conspiracy with under-16 participant - $10,000"), "D"),
    ("Which offense is Trespass in the 2nd degree for unlawfully entering a dwelling with a $500 penalty?", ("Trespass in the 3rd degree (building)", "Trespass in the 2nd degree (dwelling)", "Trespass in the 1st degree (weapon present)", "Burglary in the 3rd degree"), "B"),
    ("Which description best fits Burglary in the 1st degree with a $5,000 penalty?", ("Entering a building to commit any crime", "Burglary of a dwelling involving a deadly weapon, injury, or displayed firearm", "Possession of burglar's tools only", "Simple trespass on enclosed property"), "B"),
    ("Which basic idea describes Coercion in the 1st degree with a $1,500 penalty?", ("Minor annoyance or persuasion", "Using fear of physical injury or property damage to force serious acts", "Friendly suggestion to comply", "Only economic pressure"), "B"),
    ("Reckless Endangerment in the 1st degree shows depraved indifference and carries which penalty?", ("$500", "$1,000", "$1,500", "$5,000"), "C"),
    ("Which item is Controlled Substance Possession listed as a narcotics misdemeanor with a $900 penalty?", ("Controlled substance possession - $900", "Petty theft - $600", "Trespassing property - $450", "Failure to identify - $350"), "A"),
    ("Which traffic citation is Speeding 16-30 Over with a $300 fine and 4 points?", ("Speeding 1-15 Over - $150", "Speeding 16-30 Over - $300", "Speed Not Reasonable and Prudent - $200", "Speed in Zone - $250"), "B"),
    ("Which violation is portable electronic device use while driving with a $200 fine and 5 points?", ("Portable electronic device use - $200 and 5 points", "Seat belt violation - $100", "Vehicle equipment violation - $110", "Speeding 1-15 Over - $150"), "A"),
)
DEPARTMENT_POSTINGS = (
    {
        "key": "sheriff",
        "label": "Sheriff's Office",
        "division": "Faircroft Sheriff's Office",
        "role_key": "sheriff",
        "form_type": "law_enforcement",
        "command_roles": (),
        "badge": "Deputy Trainee",
        "schedule": "County patrol, warrant service, transport, court security, and rural response.",
        "requirements": "Interview required, mature RP, custody awareness, and county patrol availability.",
    },
    {
        "key": "fire_ems",
        "label": "Fire & EMS",
        "division": "Fire & Emergency Medical Services",
        "role_key": "fireman",
        "role_label": "Fire & EMS",
        "command_roles": FIRE_COMMAND_ROLES,
        "badge": "Fire & EMS Candidate",
        "schedule": "Fire response, rescue operations, medical calls, triage, transport RP, and hospital handoff.",
        "requirements": "Scene safety, calm communication, medical and fire RP standards, radio discipline, and command training.",
    },
    {
        "key": "lawyer",
        "label": "Wanna Be a Lawyer?",
        "division": "Faircroft Bar Association",
        "role_key": "lawyer",
        "role_label": "Licensed Attorney",
        "form_type": "bar_exam",
        "command_roles": ("judge",),
        "badge": "Take the Faircroft Bar Exam",
        "schedule": "Represent clients, review case law, prepare arguments, and work inside the Faircroft justice system.",
        "requirements": "Complete all 20 Bar Exam questions. Results are reviewed by the judiciary and Indeed staff.",
    },
)
SYSTEM_SETTING_DEFAULTS = {
    "autopilot_verify_enabled": "0",
    "autopilot_verify_minutes": "120",
    "autopilot_license_enabled": "1",
    "autopilot_license_minutes": "6",
    "update_lockdown_enabled": "0",
    "update_lockdown_message": "System update in progress. Driver License and LEO MDT remain available.",
    "beta_recruiting_enabled": "0",
    "beta_recruiting_message": "Help test upcoming Faircroft features before public release. Beta testers receive guided tasks and can report issues directly to the development team.",
    "beta_campaign_id": "1",
    "app_visibility": "{}",
}
APP_VISIBILITY_OPTIONS = (
    ("getting-started", "Getting Started"),
    ("dmv", "DMV"),
    ("jobs", "Jobs"),
    ("my-faircroft", "MyFaircroft"),
    ("court", "Court"),
    ("business", "Business"),
    ("properties", "Properties"),
    ("bank", "Bank"),
    ("messages", "Messages"),
    ("changelog", "Changelog"),
    ("contracts", "Contracts"),
    ("mdt", "MDT"),
    ("fire", "Fire MDT"),
    ("fire-settings", "Fire Settings"),
    ("indeed-admin", "Indeed Admin"),
    ("admin", "Admin"),
    ("fine-settlement", "Fine Settlement"),
    ("beta-tasks", "Beta Tasks"),
)
PROTECTED_APP_IDS = frozenset(("profile", "jobs", "dev-tools", "system", "restriction"))


def posting_command_roles(posting: dict[str, Any]) -> tuple[str, ...]:
    roles = ["owner", "admin", INDEED_ADMIN_ROLE]
    roles.extend(str(role) for role in posting.get("command_roles", ()) if str(role).strip())
    return tuple(sorted(set(normalize_role(role) for role in roles)))


def clean_law_enforcement_application(payload: dict[str, Any], posting: dict[str, Any], user: DbRow) -> tuple[str, str]:
    answers: list[dict[str, str]] = []
    answer_map: dict[str, str] = {}
    for field in LAW_ENFORCEMENT_APPLICATION_FIELDS:
        key = str(field["key"])
        label = str(field["label"])
        value = str(payload.get(key) or "").strip()
        kind = str(field.get("kind") or "text")
        if not value:
            raise ValueError(f"Missing required field: {label}")
        if kind == "yesno":
            clean = value.lower()
            if clean not in ("yes", "no"):
                raise ValueError(f"{label} must be Yes or No")
            value = "Yes" if clean == "yes" else "No"
        elif kind == "choice":
            choices = tuple(str(choice) for choice in field.get("choices", ()))
            if value not in choices:
                raise ValueError(f"Invalid selection for {label}")
        elif kind == "age":
            if not value.isdigit():
                raise ValueError("Age must be a number")
            age = int(value)
            if age < 13 or age > 100:
                raise ValueError("Age must be between 13 and 100")
        else:
            minimum = int(field.get("min", 1))
            maximum = int(field.get("max", 4000))
            if len(value) < minimum:
                raise ValueError(f"{label} must be at least {minimum} characters")
            if len(value) > maximum:
                value = value[:maximum]
        answer_map[key] = value
        answers.append({"key": key, "question": label, "answer": value})
    if answer_map.get("truth_acknowledgement") != "Yes":
        raise ValueError("You must acknowledge the falsification policy to submit this application")
    if answer_map.get("chain_of_command") != "Yes":
        raise ValueError("You must agree to follow chain of command to submit this application")
    record = {
        "type": "law_enforcement_application",
        "version": 1,
        "posting_key": posting["key"],
        "posting_label": posting["label"],
        "applicant_user_id": user["id"],
        "applicant_civ_number": user.get("civ_number") or "",
        "answers": answers,
    }
    message_lines = [
        f"Applicant: {answer_map['in_game_name']} / CIV {user.get('civ_number') or 'pending'}",
        f"Discord: {answer_map['discord_name']}",
        f"Age: {answer_map['age']}",
        f"Requested department: {answer_map['department_choice']}",
        "",
    ]
    message_lines.extend(f"{item['question']}\n{item['answer']}" for item in answers)
    return json.dumps(record, ensure_ascii=False), "\n\n".join(message_lines)


def clean_bar_exam_application(payload: dict[str, Any], posting: dict[str, Any], user: DbRow) -> tuple[str, str]:
    applicant_name = str(payload.get("in_game_name") or user.get("name") or "").strip()[:120]
    discord_name = str(payload.get("discord_name") or "").strip()[:120]
    if len(applicant_name) < 2 or len(discord_name) < 2:
        raise ValueError("Your in-game name and Discord name are required")
    answers: list[dict[str, str]] = []
    correct = 0
    letters = ("A", "B", "C", "D")
    for index, (question, options, answer_key) in enumerate(BAR_EXAM_QUESTIONS, start=1):
        selected = str(payload.get(f"bar_q{index}") or "").strip().upper()
        if selected not in letters:
            raise ValueError(f"Question {index} requires an answer")
        option_index = letters.index(selected)
        correct += int(selected == answer_key)
        answers.append({
            "key": f"bar_q{index}",
            "question": f"{index}. {question}",
            "answer": f"{selected}. {options[option_index]}",
        })
    score_percent = round(correct * 100 / len(BAR_EXAM_QUESTIONS))
    record = {
        "type": "bar_exam_application",
        "version": 1,
        "posting_key": posting["key"],
        "posting_label": posting["label"],
        "applicant_user_id": user["id"],
        "applicant_civ_number": user.get("civ_number") or "",
        "applicant_name": applicant_name,
        "discord_name": discord_name,
        "score": correct,
        "total": len(BAR_EXAM_QUESTIONS),
        "score_percent": score_percent,
        "answers": answers,
    }
    message = (
        f"Applicant: {applicant_name} / CIV {user.get('civ_number') or 'pending'}\n"
        f"Discord: {discord_name}\n"
        f"Bar Exam score: {correct}/{len(BAR_EXAM_QUESTIONS)} ({score_percent}%)"
    )
    return json.dumps(record, ensure_ascii=False), message


def business_staff_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "admin", "business_registrar", "city_hall", "economy_manager"):
        return "Business registry or admin access required"
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
                callsign TEXT NOT NULL DEFAULT '',
                car_entry_code TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                roles TEXT NOT NULL DEFAULT '["civ"]',
                primary_agency TEXT,
                bank_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
                cash_balance NUMERIC(12,2) NOT NULL DEFAULT 250,
                referral_code TEXT UNIQUE,
                referred_by_user_id INTEGER,
                active_character_id INTEGER,
                name_change_locked INTEGER NOT NULL DEFAULT 0,
                name_change_unlocked_at TEXT,
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

            CREATE TABLE IF NOT EXISTS user_characters (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                character_name TEXT NOT NULL,
                biography TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS profile_name_changes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                character_id INTEGER,
                old_name TEXT NOT NULL,
                new_name TEXT NOT NULL,
                changed_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (character_id) REFERENCES user_characters(id) ON DELETE SET NULL
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

            CREATE TABLE IF NOT EXISTS arma_game_bank_balances (
                identity_id TEXT PRIMARY KEY,
                balance NUMERIC(18,2) NOT NULL DEFAULT 0,
                source_file TEXT NOT NULL DEFAULT '',
                source_saved_at TEXT,
                raw_payload TEXT NOT NULL DEFAULT '{}',
                synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS anticheat_players (
                uid TEXT PRIMARY KEY,
                player_name TEXT NOT NULL DEFAULT '',
                reported_system TEXT NOT NULL DEFAULT '',
                teleport_flags INTEGER NOT NULL DEFAULT 0,
                aim_flags INTEGER NOT NULL DEFAULT 0,
                ticket_count INTEGER NOT NULL DEFAULT 0,
                raw_payload TEXT NOT NULL DEFAULT '{}',
                source_file TEXT NOT NULL DEFAULT '',
                first_synced_at TEXT NOT NULL,
                last_synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS anticheat_events (
                event_fingerprint TEXT PRIMARY KEY,
                player_uid TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT '',
                event_time TEXT NOT NULL DEFAULT '',
                details TEXT NOT NULL DEFAULT '',
                source_file TEXT NOT NULL DEFAULT '',
                first_synced_at TEXT NOT NULL,
                last_synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS anticheat_alt_groups (
                group_key TEXT PRIMARY KEY,
                note TEXT NOT NULL DEFAULT '',
                first_seen TEXT NOT NULL DEFAULT '',
                last_seen TEXT NOT NULL DEFAULT '',
                raw_payload TEXT NOT NULL DEFAULT '{}',
                last_synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS anticheat_alt_members (
                group_key TEXT NOT NULL,
                uid TEXT NOT NULL,
                observed_name TEXT NOT NULL DEFAULT '',
                last_synced_at TEXT NOT NULL,
                PRIMARY KEY (group_key, uid)
            );

            CREATE TABLE IF NOT EXISTS anticheat_live_sessions (
                server_id TEXT NOT NULL,
                player_uid TEXT NOT NULL,
                player_name TEXT NOT NULL DEFAULT '',
                linked_user_id INTEGER,
                joined_at TEXT NOT NULL,
                last_heartbeat_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'online',
                PRIMARY KEY (server_id, player_uid)
            );

            CREATE TABLE IF NOT EXISTS anticheat_sync_status (
                source_key TEXT PRIMARY KEY,
                source_path TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                records INTEGER NOT NULL DEFAULT 0,
                last_success_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS game_persistence_records (
                source_path TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                record_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                owner_identity TEXT NOT NULL DEFAULT '',
                identity_values TEXT NOT NULL DEFAULT '[]',
                component_types TEXT NOT NULL DEFAULT '[]',
                prefab TEXT NOT NULL DEFAULT '',
                record_status TEXT NOT NULL DEFAULT '',
                amount_text TEXT NOT NULL DEFAULT '',
                summary_payload TEXT NOT NULL DEFAULT '{}',
                raw_payload TEXT NOT NULL DEFAULT '{}',
                source_modified_at TEXT NOT NULL DEFAULT '',
                synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS game_persistence_sync_status (
                source_root TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                records INTEGER NOT NULL DEFAULT 0,
                category_counts TEXT NOT NULL DEFAULT '{}',
                last_success_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS developer_unlink_codes (
                id SERIAL PRIMARY KEY,
                code_hash TEXT NOT NULL UNIQUE,
                code_hint TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                uses_remaining INTEGER NOT NULL DEFAULT 1,
                used_by INTEGER,
                used_at TEXT,
                revoked_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS account_sanctions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                sanction_type TEXT NOT NULL,
                reason TEXT NOT NULL,
                report_number TEXT NOT NULL DEFAULT '',
                rule_code TEXT NOT NULL DEFAULT '',
                incident_at TEXT NOT NULL DEFAULT '',
                incident_summary TEXT NOT NULL DEFAULT '',
                evidence TEXT NOT NULL DEFAULT '',
                witness_names TEXT NOT NULL DEFAULT '',
                staff_findings TEXT NOT NULL DEFAULT '',
                player_statement TEXT NOT NULL DEFAULT '',
                appeal_guidance TEXT NOT NULL DEFAULT '',
                internal_notes TEXT NOT NULL DEFAULT '',
                bail_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                starts_at TEXT NOT NULL,
                expires_at TEXT,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                revoked_by INTEGER,
                revoked_at TEXT,
                revoke_reason TEXT NOT NULL DEFAULT '',
                game_enforcement_status TEXT NOT NULL DEFAULT '',
                game_enforcement_response TEXT NOT NULL DEFAULT '',
                game_enforcement_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS account_internal_warnings (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                severity TEXT NOT NULL DEFAULT 'standard',
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                resolved_by INTEGER,
                resolved_at TEXT,
                resolution_notes TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS admin_audit_logs (
                id SERIAL PRIMARY KEY,
                actor_id INTEGER,
                target_user_id INTEGER,
                action TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
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

            CREATE TABLE IF NOT EXISTS department_applications (
                id SERIAL PRIMARY KEY,
                application_number TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                department_key TEXT NOT NULL,
                department_name TEXT NOT NULL,
                desired_role TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'submitted',
                statement TEXT NOT NULL DEFAULT '',
                reviewed_by INTEGER,
                reviewer_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
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
                kind TEXT NOT NULL DEFAULT 'criminal',
                minimum_sentence_minutes INTEGER NOT NULL DEFAULT 0,
                maximum_sentence_minutes INTEGER NOT NULL DEFAULT 0
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
                disposition TEXT NOT NULL DEFAULT '',
                sentence_minutes INTEGER NOT NULL DEFAULT 0,
                sentence_notes TEXT NOT NULL DEFAULT '',
                minimum_sentence_minutes INTEGER NOT NULL DEFAULT 0,
                maximum_sentence_minutes INTEGER NOT NULL DEFAULT 0,
                decided_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (charge_id) REFERENCES charge_catalog(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS mdt_bookings (
                id SERIAL PRIMARY KEY,
                booking_number TEXT NOT NULL UNIQUE,
                civ_id INTEGER NOT NULL,
                officer_id INTEGER NOT NULL,
                charge_id INTEGER NOT NULL,
                court_case_id INTEGER,
                charge_code TEXT NOT NULL,
                charge_title TEXT NOT NULL,
                category TEXT NOT NULL,
                severity TEXT NOT NULL,
                arrest_location TEXT NOT NULL,
                arrest_datetime TEXT NOT NULL,
                arresting_agency TEXT NOT NULL DEFAULT '',
                incident_number TEXT NOT NULL DEFAULT '',
                probable_cause TEXT NOT NULL,
                property_inventory TEXT NOT NULL DEFAULT '',
                medical_notes TEXT NOT NULL DEFAULT '',
                booking_notes TEXT NOT NULL DEFAULT '',
                holding_cell TEXT NOT NULL DEFAULT '',
                bond_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'intake',
                transport_confirmed_at TEXT,
                court_date TEXT,
                release_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (charge_id) REFERENCES charge_catalog(id) ON DELETE RESTRICT,
                FOREIGN KEY (court_case_id) REFERENCES citations(id) ON DELETE SET NULL
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

            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id INTEGER NOT NULL,
                referred_user_id INTEGER NOT NULL UNIQUE,
                code_used TEXT NOT NULL,
                bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 50000,
                status TEXT NOT NULL DEFAULT 'pending',
                deposited_by INTEGER,
                deposited_at TEXT,
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (deposited_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS treasury_requests (
                id SERIAL PRIMARY KEY,
                request_number TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                request_type TEXT NOT NULL DEFAULT 'stimulus',
                requested_amount NUMERIC(12,2) NOT NULL DEFAULT 75000,
                approved_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'submitted',
                reason TEXT NOT NULL DEFAULT '',
                proof_images TEXT NOT NULL DEFAULT '[]',
                proof_bypass INTEGER NOT NULL DEFAULT 0,
                reviewer_id INTEGER,
                reviewer_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                decided_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
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
                caller_name TEXT NOT NULL DEFAULT '',
                call_type TEXT NOT NULL DEFAULT 'Emergency Call',
                priority TEXT NOT NULL DEFAULT 'standard',
                location TEXT NOT NULL,
                note TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                resolved_at TEXT,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dispatch_call_units (
                id SERIAL PRIMARY KEY,
                alert_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                assigned_by INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'assigned',
                notes TEXT NOT NULL DEFAULT '',
                attached_at TEXT NOT NULL,
                detached_at TEXT,
                FOREIGN KEY (alert_id) REFERENCES panic_alerts(id) ON DELETE CASCADE,
                FOREIGN KEY (unit_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dispatch_call_notes (
                id SERIAL PRIMARY KEY,
                alert_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                note_type TEXT NOT NULL DEFAULT 'dispatch update',
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (alert_id) REFERENCES panic_alerts(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cad_after_call_reports (
                id SERIAL PRIMARY KEY,
                report_number TEXT NOT NULL UNIQUE,
                officer_id INTEGER NOT NULL,
                related_alert_id INTEGER,
                involved_civ_id INTEGER,
                involved_name TEXT NOT NULL DEFAULT '',
                call_type TEXT NOT NULL,
                disposition TEXT NOT NULL DEFAULT 'cleared',
                location TEXT NOT NULL DEFAULT '',
                narrative TEXT NOT NULL,
                actions_taken TEXT NOT NULL DEFAULT '',
                evidence_links TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (related_alert_id) REFERENCES panic_alerts(id) ON DELETE SET NULL,
                FOREIGN KEY (involved_civ_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS mdt_bolos (
                id SERIAL PRIMARY KEY,
                bolo_number TEXT NOT NULL UNIQUE,
                created_by INTEGER NOT NULL,
                target_name TEXT NOT NULL,
                target_description TEXT NOT NULL DEFAULT '',
                vehicle_description TEXT NOT NULL DEFAULT '',
                plate TEXT NOT NULL DEFAULT '',
                last_seen TEXT NOT NULL DEFAULT '',
                caution_level TEXT NOT NULL DEFAULT 'standard',
                reason TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                resolved_at TEXT,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fire_rig_assignments (
                id SERIAL PRIMARY KEY,
                rig_name TEXT NOT NULL UNIQUE,
                user_id INTEGER,
                position TEXT NOT NULL DEFAULT 'Firefighter',
                status TEXT NOT NULL DEFAULT 'available',
                notes TEXT NOT NULL DEFAULT '',
                assigned_by INTEGER,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
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

            CREATE TABLE IF NOT EXISTS cid_internal_affairs_notes (
                id SERIAL PRIMARY KEY,
                ia_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                note_type TEXT NOT NULL DEFAULT 'file note',
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (ia_id) REFERENCES cid_internal_affairs(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS roadmap_items (
                id SERIAL PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'Platform',
                summary TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'planned',
                progress INTEGER NOT NULL DEFAULT 0,
                target_date TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                accent TEXT NOT NULL DEFAULT 'mint',
                icon TEXT NOT NULL DEFAULT 'route',
                is_visible INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS roadmap_votes (
                item_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                vote INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (item_id, user_id),
                FOREIGN KEY (item_id) REFERENCES roadmap_items(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        ensure_migrations(db)
        seed_owner(db)
        seed_jobs(db)
        seed_charges(db)
        seed_properties(db)
        seed_roadmap(db)


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
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS car_entry_code TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS callsign TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active_character_id INTEGER")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name_change_locked INTEGER NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name_change_unlocked_at TEXT")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT")
    db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_civ_number_unique ON users (civ_number)")
    for user in all_rows(db, "SELECT id FROM users WHERE civ_number IS NULL"):
        db.execute("UPDATE users SET civ_number = ? WHERE id = ?", (generate_civ_number(db), user["id"]))
    for user in all_rows(db, "SELECT id FROM users WHERE referral_code IS NULL OR referral_code = '' ORDER BY id"):
        db.execute("UPDATE users SET referral_code = ? WHERE id = ?", (generate_referral_code(db), user["id"]))
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique ON users (referral_code)")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS user_characters (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            character_name TEXT NOT NULL,
            biography TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS profile_name_changes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            character_id INTEGER,
            old_name TEXT NOT NULL,
            new_name TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (character_id) REFERENCES user_characters(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS user_characters_user_idx ON user_characters (user_id)")
    db.execute("CREATE INDEX IF NOT EXISTS profile_name_changes_user_idx ON profile_name_changes (user_id, changed_at)")
    for existing_user in all_rows(db, "SELECT id, name FROM users ORDER BY id"):
        ensure_default_character(db, int(existing_user["id"]), str(existing_user["name"] or "Civilian"))
    db.execute("ALTER TABLE charge_catalog ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'criminal'")
    db.execute("ALTER TABLE charge_catalog ADD COLUMN IF NOT EXISTS minimum_sentence_minutes INTEGER NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE charge_catalog ADD COLUMN IF NOT EXISTS maximum_sentence_minutes INTEGER NOT NULL DEFAULT 0")
    db.execute("UPDATE charge_catalog SET kind = 'citation' WHERE code LIKE ?", ("TRF-%",))
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS judge_id INTEGER")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS final_result TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS sentence_minutes INTEGER NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS sentence_notes TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS minimum_sentence_minutes INTEGER NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS maximum_sentence_minutes INTEGER NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS decided_at TEXT")
    db.execute("ALTER TABLE anticheat_players ADD COLUMN IF NOT EXISTS reported_system TEXT NOT NULL DEFAULT ''")
    db.execute("UPDATE citations SET judge_id = NULL WHERE judge_id = civ_id")
    db.execute("UPDATE citations SET final_result = status WHERE final_result = '' AND status NOT IN ('issued','contested','reviewed','reduced')")
    db.execute(
        """
        UPDATE citations c
        SET minimum_sentence_minutes = catalog.minimum_sentence_minutes,
            maximum_sentence_minutes = catalog.maximum_sentence_minutes
        FROM charge_catalog catalog
        WHERE c.charge_id = catalog.id
          AND c.minimum_sentence_minutes = 0
          AND c.maximum_sentence_minutes = 0
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS fine_settlement_batches (
            id SERIAL PRIMARY KEY,
            batch_number TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'draft',
            approval_code_hash TEXT NOT NULL DEFAULT '',
            approval_code_hint TEXT NOT NULL DEFAULT '',
            approval_expires_at TEXT,
            approved_by INTEGER,
            approved_at TEXT,
            processing_started_at TEXT,
            completed_at TEXT,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS fine_settlement_items (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER NOT NULL,
            citation_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            identity_id TEXT NOT NULL,
            fine_amount NUMERIC(12,2) NOT NULL,
            balance_before NUMERIC(12,2) NOT NULL,
            expected_balance NUMERIC(12,2) NOT NULL,
            verified_balance NUMERIC(12,2),
            status TEXT NOT NULL DEFAULT 'pending',
            failure_reason TEXT NOT NULL DEFAULT '',
            verified_at TEXT,
            FOREIGN KEY (batch_id) REFERENCES fine_settlement_batches(id) ON DELETE CASCADE,
            FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE RESTRICT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS fine_settlement_batch_idx ON fine_settlement_items (batch_id)")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS business_tax_assessments (
            id SERIAL PRIMARY KEY,
            business_id INTEGER NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            period_label TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'unpaid',
            assessed_by INTEGER NOT NULL,
            assessed_at TEXT NOT NULL,
            settlement_batch_id INTEGER,
            settled_at TEXT,
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY (assessed_by) REFERENCES users(id) ON DELETE RESTRICT
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS business_tax_settlement_batches (
            id SERIAL PRIMARY KEY,
            batch_number TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'draft',
            approval_code_hash TEXT NOT NULL DEFAULT '',
            approval_code_hint TEXT NOT NULL DEFAULT '',
            approval_expires_at TEXT,
            approved_by INTEGER,
            approved_at TEXT,
            completed_at TEXT,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS business_tax_settlement_items (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER NOT NULL,
            business_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            identity_id TEXT NOT NULL,
            tax_amount NUMERIC(12,2) NOT NULL,
            balance_before NUMERIC(12,2) NOT NULL,
            expected_balance NUMERIC(12,2) NOT NULL,
            verified_balance NUMERIC(12,2),
            status TEXT NOT NULL DEFAULT 'pending',
            failure_reason TEXT NOT NULL DEFAULT '',
            verified_at TEXT,
            FOREIGN KEY (batch_id) REFERENCES business_tax_settlement_batches(id) ON DELETE CASCADE,
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE (batch_id, business_id)
        )
        """
    )
    db.execute("ALTER TABLE business_tax_assessments ADD COLUMN IF NOT EXISTS settlement_batch_id INTEGER")
    db.execute("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tax_last_assessed_at TEXT")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS mdt_bookings (
            id SERIAL PRIMARY KEY,
            booking_number TEXT NOT NULL UNIQUE,
            civ_id INTEGER NOT NULL,
            officer_id INTEGER NOT NULL,
            charge_id INTEGER NOT NULL,
            court_case_id INTEGER,
            charge_code TEXT NOT NULL,
            charge_title TEXT NOT NULL,
            category TEXT NOT NULL,
            severity TEXT NOT NULL,
            arrest_location TEXT NOT NULL,
            arrest_datetime TEXT NOT NULL,
            arresting_agency TEXT NOT NULL DEFAULT '',
            incident_number TEXT NOT NULL DEFAULT '',
            probable_cause TEXT NOT NULL,
            property_inventory TEXT NOT NULL DEFAULT '',
            medical_notes TEXT NOT NULL DEFAULT '',
            booking_notes TEXT NOT NULL DEFAULT '',
            holding_cell TEXT NOT NULL DEFAULT '',
            bond_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'intake',
            transport_confirmed_at TEXT,
            court_date TEXT,
            release_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (charge_id) REFERENCES charge_catalog(id) ON DELETE RESTRICT,
            FOREIGN KEY (court_case_id) REFERENCES citations(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("ALTER TABLE mdt_bookings ADD COLUMN IF NOT EXISTS transport_confirmed_at TEXT")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS record_expunged_at TEXT")
    db.execute("ALTER TABLE citations ADD COLUMN IF NOT EXISTS record_expunged_by INTEGER")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS court_record_requests (
            id SERIAL PRIMARY KEY,
            citation_id INTEGER NOT NULL,
            civ_id INTEGER NOT NULL,
            request_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            supporting_statement TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            judge_id INTEGER,
            decision_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            decided_at TEXT,
            FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
            FOREIGN KEY (civ_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS mdt_booking_charges (
            booking_id INTEGER NOT NULL,
            charge_id INTEGER NOT NULL,
            court_case_id INTEGER,
            charge_code TEXT NOT NULL,
            charge_title TEXT NOT NULL,
            category TEXT NOT NULL,
            severity TEXT NOT NULL,
            fine_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            points INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            PRIMARY KEY (booking_id, charge_id),
            FOREIGN KEY (booking_id) REFERENCES mdt_bookings(id) ON DELETE CASCADE,
            FOREIGN KEY (charge_id) REFERENCES charge_catalog(id) ON DELETE RESTRICT,
            FOREIGN KEY (court_case_id) REFERENCES citations(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS target_context TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS last_known TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE rp_contracts ADD COLUMN IF NOT EXISTS requirements TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'police'")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS caller_name TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS call_type TEXT NOT NULL DEFAULT 'Emergency Call'")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'standard'")
    db.execute("ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS report_number TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS rule_code TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS incident_at TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS incident_summary TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS evidence TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS witness_names TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS staff_findings TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS player_statement TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS appeal_guidance TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS bail_amount NUMERIC(12,2) NOT NULL DEFAULT 0")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS game_enforcement_status TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS game_enforcement_response TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE account_sanctions ADD COLUMN IF NOT EXISTS game_enforcement_at TEXT")
    # Legacy profile-entered IDs are not links. Preserve only IDs backed by the
    # authoritative link table; new links are created exclusively by code claim.
    db.execute(
        """
        UPDATE users
        SET arma_id = NULL
        WHERE arma_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM arma_account_links l
              WHERE l.user_id = users.id AND l.identity_id = users.arma_id
          )
        """
    )
    db.execute("UPDATE panic_alerts SET updated_at = created_at WHERE updated_at = ''")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_call_units (
            id SERIAL PRIMARY KEY,
            alert_id INTEGER NOT NULL,
            unit_id INTEGER NOT NULL,
            assigned_by INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'assigned',
            notes TEXT NOT NULL DEFAULT '',
            attached_at TEXT NOT NULL,
            detached_at TEXT,
            FOREIGN KEY (alert_id) REFERENCES panic_alerts(id) ON DELETE CASCADE,
            FOREIGN KEY (unit_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_call_notes (
            id SERIAL PRIMARY KEY,
            alert_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            note_type TEXT NOT NULL DEFAULT 'dispatch update',
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (alert_id) REFERENCES panic_alerts(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS cad_after_call_reports (
            id SERIAL PRIMARY KEY,
            report_number TEXT NOT NULL UNIQUE,
            officer_id INTEGER NOT NULL,
            related_alert_id INTEGER,
            involved_civ_id INTEGER,
            involved_name TEXT NOT NULL DEFAULT '',
            call_type TEXT NOT NULL,
            disposition TEXT NOT NULL DEFAULT 'cleared',
            location TEXT NOT NULL DEFAULT '',
            narrative TEXT NOT NULL,
            actions_taken TEXT NOT NULL DEFAULT '',
            evidence_links TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (officer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (related_alert_id) REFERENCES panic_alerts(id) ON DELETE SET NULL,
            FOREIGN KEY (involved_civ_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS mdt_bolos (
            id SERIAL PRIMARY KEY,
            bolo_number TEXT NOT NULL UNIQUE,
            created_by INTEGER NOT NULL,
            target_name TEXT NOT NULL,
            target_description TEXT NOT NULL DEFAULT '',
            vehicle_description TEXT NOT NULL DEFAULT '',
            plate TEXT NOT NULL DEFAULT '',
            last_seen TEXT NOT NULL DEFAULT '',
            caution_level TEXT NOT NULL DEFAULT 'standard',
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS fire_rig_assignments (
            id SERIAL PRIMARY KEY,
            rig_name TEXT NOT NULL UNIQUE,
            user_id INTEGER,
            position TEXT NOT NULL DEFAULT 'Firefighter',
            status TEXT NOT NULL DEFAULT 'available',
            notes TEXT NOT NULL DEFAULT '',
            assigned_by INTEGER,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS department_applications (
            id SERIAL PRIMARY KEY,
            application_number TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            department_key TEXT NOT NULL,
            department_name TEXT NOT NULL,
            desired_role TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'submitted',
            statement TEXT NOT NULL DEFAULT '',
            reviewed_by INTEGER,
            reviewer_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS arma_link_codes_code_idx ON arma_link_codes (code)")
    db.execute("CREATE INDEX IF NOT EXISTS arma_link_codes_status_idx ON arma_link_codes (status)")
    db.execute("CREATE INDEX IF NOT EXISTS arma_activity_logs_user_idx ON arma_activity_logs (user_id)")
    db.execute("CREATE INDEX IF NOT EXISTS anticheat_events_player_idx ON anticheat_events (player_uid, event_time DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS anticheat_alt_members_uid_idx ON anticheat_alt_members (uid)")
    db.execute("CREATE INDEX IF NOT EXISTS anticheat_live_sessions_heartbeat_idx ON anticheat_live_sessions (last_heartbeat_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS game_persistence_category_idx ON game_persistence_records (category, synced_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS game_persistence_record_idx ON game_persistence_records (record_id)")
    db.execute("CREATE INDEX IF NOT EXISTS account_sanctions_user_idx ON account_sanctions (user_id, created_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS account_warnings_user_idx ON account_internal_warnings (user_id, created_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS panic_alerts_department_idx ON panic_alerts (department)")
    db.execute("CREATE INDEX IF NOT EXISTS panic_alerts_status_idx ON panic_alerts (status, priority, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS dispatch_call_units_alert_idx ON dispatch_call_units (alert_id, detached_at)")
    db.execute("CREATE INDEX IF NOT EXISTS dispatch_call_units_unit_idx ON dispatch_call_units (unit_id, detached_at)")
    db.execute("CREATE INDEX IF NOT EXISTS dispatch_call_notes_alert_idx ON dispatch_call_notes (alert_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS cad_after_call_reports_officer_idx ON cad_after_call_reports (officer_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS cad_after_call_reports_alert_idx ON cad_after_call_reports (related_alert_id)")
    db.execute("CREATE INDEX IF NOT EXISTS cad_after_call_reports_disposition_idx ON cad_after_call_reports (disposition)")
    db.execute("CREATE INDEX IF NOT EXISTS mdt_bolos_status_idx ON mdt_bolos (status, updated_at)")
    db.execute("CREATE INDEX IF NOT EXISTS mdt_bolos_created_by_idx ON mdt_bolos (created_by, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS mdt_bookings_status_idx ON mdt_bookings (status, updated_at)")
    db.execute("CREATE INDEX IF NOT EXISTS mdt_bookings_civ_idx ON mdt_bookings (civ_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS mdt_bookings_officer_idx ON mdt_bookings (officer_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS department_applications_user_idx ON department_applications (user_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS department_applications_department_idx ON department_applications (department_key, status)")
    db.execute("CREATE INDEX IF NOT EXISTS roadmap_items_route_idx ON roadmap_items (is_visible, sort_order, id)")
    db.execute("CREATE INDEX IF NOT EXISTS roadmap_votes_item_idx ON roadmap_votes (item_id, vote)")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER NOT NULL,
            referred_user_id INTEGER NOT NULL UNIQUE,
            code_used TEXT NOT NULL,
            bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 50000,
            status TEXT NOT NULL DEFAULT 'pending',
            deposited_by INTEGER,
            deposited_at TEXT,
            admin_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (deposited_by) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'deposited'")
    db.execute("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS deposited_by INTEGER")
    db.execute("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS deposited_at TEXT")
    db.execute("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS admin_notes TEXT NOT NULL DEFAULT ''")
    db.execute("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS updated_at TEXT")
    db.execute("UPDATE referrals SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
    db.execute("ALTER TABLE referrals ALTER COLUMN updated_at SET NOT NULL")
    db.execute("ALTER TABLE referrals ALTER COLUMN status SET DEFAULT 'pending'")
    db.execute("CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS referrals_code_idx ON referrals (code_used)")
    db.execute("CREATE INDEX IF NOT EXISTS referrals_status_idx ON referrals (status, updated_at)")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS treasury_requests (
            id SERIAL PRIMARY KEY,
            request_number TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            request_type TEXT NOT NULL DEFAULT 'stimulus',
            requested_amount NUMERIC(12,2) NOT NULL DEFAULT 75000,
            approved_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'submitted',
            reason TEXT NOT NULL DEFAULT '',
            proof_images TEXT NOT NULL DEFAULT '[]',
            proof_bypass INTEGER NOT NULL DEFAULT 0,
            reviewer_id INTEGER,
            reviewer_notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            decided_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS treasury_requests_user_idx ON treasury_requests (user_id, created_at)")
    db.execute("CREATE INDEX IF NOT EXISTS treasury_requests_status_idx ON treasury_requests (status, updated_at)")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS cid_internal_affairs_notes (
            id SERIAL PRIMARY KEY,
            ia_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            note_type TEXT NOT NULL DEFAULT 'file note',
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (ia_id) REFERENCES cid_internal_affairs(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS cid_internal_affairs_notes_ia_idx ON cid_internal_affairs_notes (ia_id, created_at)")


def get_system_settings(db: Database) -> dict[str, Any]:
    rows = all_rows(db, "SELECT setting_key, setting_value FROM system_settings")
    raw = {row["setting_key"]: row["setting_value"] for row in rows}
    raw = {**SYSTEM_SETTING_DEFAULTS, **raw}
    try:
        minutes = int(raw.get("autopilot_verify_minutes") or SYSTEM_SETTING_DEFAULTS["autopilot_verify_minutes"])
    except (TypeError, ValueError):
        minutes = int(SYSTEM_SETTING_DEFAULTS["autopilot_verify_minutes"])
    minutes = max(1, min(minutes, 10080))
    try:
        license_minutes = int(raw.get("autopilot_license_minutes") or SYSTEM_SETTING_DEFAULTS["autopilot_license_minutes"])
    except (TypeError, ValueError):
        license_minutes = int(SYSTEM_SETTING_DEFAULTS["autopilot_license_minutes"])
    license_minutes = max(1, min(license_minutes, 10080))
    try:
        app_visibility_raw = json.loads(str(raw.get("app_visibility") or "{}"))
    except (TypeError, json.JSONDecodeError):
        app_visibility_raw = {}
    app_visibility = {
        app_id: bool(app_visibility_raw.get(app_id, True))
        for app_id, _label in APP_VISIBILITY_OPTIONS
    }
    try:
        beta_campaign_id = max(1, int(raw.get("beta_campaign_id") or "1"))
    except (TypeError, ValueError):
        beta_campaign_id = 1
    return {
        "autopilot_verify_enabled": str(raw.get("autopilot_verify_enabled") or "0") in ("1", "true", "True", "yes", "on"),
        "autopilot_verify_minutes": minutes,
        "autopilot_license_enabled": str(raw.get("autopilot_license_enabled") or "0") in ("1", "true", "True", "yes", "on"),
        "autopilot_license_minutes": license_minutes,
        "update_lockdown_enabled": str(raw.get("update_lockdown_enabled") or "0") in ("1", "true", "True", "yes", "on"),
        "update_lockdown_message": str(raw.get("update_lockdown_message") or SYSTEM_SETTING_DEFAULTS["update_lockdown_message"]).strip()[:240],
        "beta_recruiting_enabled": str(raw.get("beta_recruiting_enabled") or "0") in ("1", "true", "True", "yes", "on"),
        "beta_recruiting_message": str(raw.get("beta_recruiting_message") or SYSTEM_SETTING_DEFAULTS["beta_recruiting_message"]).strip()[:600],
        "beta_campaign_id": beta_campaign_id,
        "app_visibility": app_visibility,
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


def auto_license_stats(db: Database, settings: dict[str, Any] | None = None) -> dict[str, int]:
    settings = settings or get_system_settings(db)
    cutoff = (utcnow() - dt.timedelta(minutes=int(settings["autopilot_license_minutes"]))).isoformat()
    pending = one(
        db,
        "SELECT COUNT(*) AS count FROM dmv_license_applications WHERE status IN ('submitted','pending','under_review')",
    )
    eligible = one(
        db,
        """
        SELECT COUNT(*) AS count
        FROM dmv_license_applications a
        LEFT JOIN dmv_records d ON d.user_id = a.user_id
        WHERE a.status IN ('submitted','pending','under_review')
          AND a.created_at <= ?
          AND COALESCE(d.license_status, '') NOT IN ('Suspended','Revoked')
        """,
        (cutoff,),
    )
    return {
        "pending_license_applications": int(pending["count"] if pending else 0),
        "eligible_license_applications": int(eligible["count"] if eligible else 0),
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


def apply_auto_license_approval(db: Database) -> int:
    settings = get_system_settings(db)
    if not settings["autopilot_license_enabled"]:
        return 0
    cutoff = (utcnow() - dt.timedelta(minutes=int(settings["autopilot_license_minutes"]))).isoformat()
    rows = all_rows(
        db,
        """
        SELECT a.id, a.user_id, a.application_type, a.license_class, u.name
        FROM dmv_license_applications a
        JOIN users u ON u.id = a.user_id
        LEFT JOIN dmv_records d ON d.user_id = a.user_id
        WHERE a.status IN ('submitted','pending','under_review')
          AND a.created_at <= ?
          AND COALESCE(d.license_status, '') NOT IN ('Suspended','Revoked')
        ORDER BY a.created_at ASC
        LIMIT 100
        """,
        (cutoff,),
    )
    ts = now_iso()
    for row in rows:
        user_id = int(row["user_id"])
        create_default_dmv(db, user_id)
        db.execute(
            "UPDATE dmv_license_applications SET status = 'approved', updated_at = ? WHERE id = ?",
            (ts, row["id"]),
        )
        db.execute(
            "UPDATE dmv_records SET license_status = 'Valid', license_class = ?, updated_at = ? WHERE user_id = ?",
            (row["license_class"], ts, user_id),
        )
        add_message(
            db,
            user_id,
            "Driver license approved",
            f"Your {row['application_type']} was automatically approved after {settings['autopilot_license_minutes']} minutes.",
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
        character = ensure_default_character(db, int(existing["id"]), OWNER_NAME)
        db.execute(
            "UPDATE user_characters SET character_name = ?, updated_at = ? WHERE id = ?",
            (OWNER_NAME, now_iso(), character["id"]),
        )
        db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (character["id"], OWNER_NAME, existing["id"]))
        return
    ts = now_iso()
    created = db.execute(
        """
        INSERT INTO users
        (civ_number, name, email, arma_id, referral_code, password_hash, verified, roles, primary_agency, bank_balance, cash_balance, last_income_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'Owner Command', 50000, 1000, ?, ?)
        RETURNING id
        """,
        (generate_civ_number(db), OWNER_NAME, OWNER_EMAIL, None, generate_referral_code(db), hash_password(OWNER_PASSWORD), json.dumps(owner_roles), ts, ts),
    ).fetchone()
    ensure_default_character(db, int(created["id"]), OWNER_NAME)


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
        ("VTL-1110A", "Disobey Traffic Control Device", "NYS VTL - Traffic Control", "Failure to obey an official traffic-control device or lawful traffic regulation.", 150, 2, "Traffic Infraction", "citation"),
        ("VTL-1111D1", "Passed Steady Red Signal", "NYS VTL - Traffic Control", "Failed to stop for a steady red traffic-control signal before entering the intersection.", 250, 3, "Traffic Infraction", "citation"),
        ("VTL-1172A", "Failed to Stop at Stop Sign", "NYS VTL - Traffic Control", "Failed to stop at a stop sign before entering the crosswalk or intersection.", 180, 3, "Traffic Infraction", "citation"),
        ("VTL-1180A", "Speed Not Reasonable and Prudent", "NYS VTL - Speeding", "Operated at a speed not reasonable and prudent for roadway, traffic, or weather conditions.", 200, 3, "Traffic Infraction", "citation"),
        ("VTL-1180B", "Speed Over Posted Limit", "NYS VTL - Speeding", "Exceeded the maximum speed limit posted for the roadway.", 250, 4, "Traffic Infraction", "citation"),
        ("VTL-1180D", "Speed in Zone", "NYS VTL - Speeding", "Exceeded speed restrictions established for a designated speed zone.", 250, 4, "Traffic Infraction", "citation"),
        ("VTL-1128A", "Unsafe Lane Change", "NYS VTL - Moving Violation", "Moved from a lane when the movement could not be made safely or failed to stay within a single lane.", 160, 3, "Traffic Infraction", "citation"),
        ("VTL-1163A", "Improper or No Turn Signal", "NYS VTL - Moving Violation", "Turned or moved right/left without giving the required signal.", 125, 2, "Traffic Infraction", "citation"),
        ("VTL-1129A", "Following Too Closely", "NYS VTL - Moving Violation", "Followed another vehicle more closely than was reasonable and prudent.", 180, 4, "Traffic Infraction", "citation"),
        ("VTL-1211A", "Unsafe Backing", "NYS VTL - Moving Violation", "Backed a vehicle when the movement could not be made safely.", 125, 2, "Traffic Infraction", "citation"),
        ("VTL-1212", "Reckless Driving", "NYS VTL - Moving Violation", "Operated in a manner unreasonably interfering with highway use or endangering highway users.", 750, 5, "Misdemeanor", "citation"),
        ("VTL-1225C2A", "Mobile Phone Use While Driving", "NYS VTL - Distracted Driving", "Used a mobile telephone while operating a motor vehicle.", 200, 5, "Traffic Infraction", "citation"),
        ("VTL-1225D", "Portable Electronic Device Use", "NYS VTL - Distracted Driving", "Used a portable electronic device while operating a motor vehicle.", 200, 5, "Traffic Infraction", "citation"),
        ("VTL-1229C3", "Seat Belt Violation", "NYS VTL - Occupant Safety", "Operator or passenger failed to use a required safety restraint.", 100, 0, "Traffic Infraction", "citation"),
        ("VTL-5091", "Unlicensed Operator", "NYS VTL - License", "Operated a motor vehicle without being duly licensed.", 250, 0, "Traffic Infraction", "citation"),
        ("VTL-5111A", "Aggravated Unlicensed Operation 3rd", "NYS VTL - License", "Operated while license or driving privilege was suspended or revoked.", 500, 0, "Misdemeanor", "citation"),
        ("VTL-4011A", "Unregistered Motor Vehicle", "NYS VTL - Registration", "Operated or permitted operation of a motor vehicle without valid registration.", 200, 0, "Traffic Infraction", "citation"),
        ("VTL-3191", "Operating Without Insurance", "NYS VTL - Insurance", "Operated a motor vehicle without required financial security or insurance.", 500, 0, "Traffic Infraction", "citation"),
        ("VTL-306B", "Uninspected Motor Vehicle", "NYS VTL - Inspection", "Operated a motor vehicle without a valid inspection certificate.", 120, 0, "Traffic Infraction", "citation"),
        ("VTL-3752A1", "No or Inadequate Headlights", "NYS VTL - Vehicle Equipment", "Operated without required headlamps or with inadequate lighting.", 110, 0, "Equipment Violation", "citation"),
        ("VTL-37512A", "Illegal Window Tint", "NYS VTL - Vehicle Equipment", "Operated with window tint or light transmittance below the allowed standard.", 150, 0, "Equipment Violation", "citation"),
        ("VTL-37531", "Obstructed or Dirty Plate", "NYS VTL - Vehicle Equipment", "Displayed a number plate that was obstructed, dirty, covered, or not plainly visible.", 100, 0, "Equipment Violation", "citation"),
        ("VTL-1200A", "General Parking Regulation Violation", "NYS VTL - Parking", "Stopped, stood, or parked contrary to posted or local parking regulations.", 75, 0, "Parking Ticket", "citation"),
        ("VTL-1201A", "Stopped or Parked on Highway", "NYS VTL - Parking", "Stopped, parked, or left standing on the paved or traveled part of a highway where prohibited.", 95, 0, "Parking Ticket", "citation"),
        ("VTL-1202A1A", "Parking on Sidewalk", "NYS VTL - Parking", "Stopped, stood, or parked a vehicle on a sidewalk.", 90, 0, "Parking Ticket", "citation"),
        ("VTL-1202A1B", "Blocking Driveway", "NYS VTL - Parking", "Stopped, stood, or parked in front of a public or private driveway.", 90, 0, "Parking Ticket", "citation"),
        ("VTL-1202A1C", "Parking in Intersection", "NYS VTL - Parking", "Stopped, stood, or parked within an intersection.", 100, 0, "Parking Ticket", "citation"),
        ("VTL-1202A1D", "Parking Near Fire Hydrant", "NYS VTL - Parking", "Stopped, stood, or parked within the prohibited distance of a fire hydrant.", 115, 0, "Parking Ticket", "citation"),
        ("VTL-1202A1E", "Parking on Crosswalk", "NYS VTL - Parking", "Stopped, stood, or parked on a crosswalk.", 95, 0, "Parking Ticket", "citation"),
        ("VTL-1202A2A", "Double Parking", "NYS VTL - Parking", "Stopped, stood, or parked on the roadway side of another stopped or parked vehicle.", 115, 0, "Parking Ticket", "citation"),
        ("VTL-1203B", "Improper Angle Parking", "NYS VTL - Parking", "Parked other than parallel or angle parking required by traffic control or local rule.", 75, 0, "Parking Ticket", "citation"),
        ("VTL-1204B", "Accessible Parking Violation", "NYS VTL - Parking", "Parked in a space reserved for people with disabilities without authorization.", 250, 0, "Parking Ticket", "citation"),
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
    db.execute(
        """
        UPDATE charge_catalog
        SET minimum_sentence_minutes = CASE
                WHEN kind <> 'criminal' THEN 0
                WHEN severity = 'Class A-I Felony' THEN 45
                WHEN severity = 'Class A-II Felony' THEN 40
                WHEN severity = 'Class B Felony' THEN 30
                WHEN severity = 'Class C Felony' THEN 24
                WHEN severity = 'Class D Felony' THEN 18
                WHEN severity = 'Class E Felony' THEN 12
                WHEN severity = 'Felony' THEN 18
                WHEN severity = 'Class A Misdemeanor' THEN 6
                WHEN severity = 'Class B Misdemeanor' THEN 3
                WHEN severity = 'Misdemeanor' THEN 5
                WHEN severity = 'Offense Class Varies' THEN 0
                ELSE 0
            END,
            maximum_sentence_minutes = CASE
                WHEN kind <> 'criminal' THEN 0
                WHEN severity = 'Class A-I Felony' THEN 90
                WHEN severity = 'Class A-II Felony' THEN 80
                WHEN severity = 'Class B Felony' THEN 65
                WHEN severity = 'Class C Felony' THEN 50
                WHEN severity = 'Class D Felony' THEN 40
                WHEN severity = 'Class E Felony' THEN 30
                WHEN severity = 'Felony' THEN 45
                WHEN severity = 'Class A Misdemeanor' THEN 20
                WHEN severity = 'Class B Misdemeanor' THEN 12
                WHEN severity = 'Misdemeanor' THEN 18
                WHEN severity = 'Offense Class Varies' THEN 45
                WHEN severity = 'Violation' THEN 5
                ELSE 0
            END
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS beta_program_responses (
            user_id INTEGER NOT NULL,
            campaign_id INTEGER NOT NULL,
            response TEXT NOT NULL,
            responded_at TEXT NOT NULL,
            PRIMARY KEY (user_id, campaign_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS beta_tasks (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            instructions TEXT NOT NULL,
            test_area TEXT NOT NULL DEFAULT 'General',
            priority TEXT NOT NULL DEFAULT 'standard',
            active INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS beta_bug_reports (
            id SERIAL PRIMARY KEY,
            task_id INTEGER,
            reporter_id INTEGER NOT NULL,
            summary TEXT NOT NULL,
            steps TEXT NOT NULL,
            expected_result TEXT NOT NULL DEFAULT '',
            actual_result TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'standard',
            status TEXT NOT NULL DEFAULT 'submitted',
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES beta_tasks(id) ON DELETE SET NULL,
            FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        UPDATE citations c
        SET minimum_sentence_minutes = catalog.minimum_sentence_minutes,
            maximum_sentence_minutes = catalog.maximum_sentence_minutes
        FROM charge_catalog catalog
        WHERE c.charge_id = catalog.id
          AND c.minimum_sentence_minutes = 0
          AND c.maximum_sentence_minutes = 0
        """
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


def seed_roadmap(db: Database) -> None:
    ts = now_iso()
    milestones = [
        (
            "pwa-command-core",
            "Faircroft PWA Command Core",
            "Foundation",
            "The live phone OS, civilian services, role-based workspaces, CAD, courts, DMV, and staff tools.",
            "The shared account and roleplay foundation is online. Future roadmap phases build on this profile, permissions, messaging, court, DMV, and PostgreSQL core.",
            "shipped",
            100,
            "2026-07-23",
            10,
            "mint",
            "shield",
        ),
        (
            "tbs-account-link",
            "TBS RP Linking Expansion",
            "Game Link",
            "Finish the account bridge that joins Arma identities to Faircroft online profiles.",
            "The mod already generates identity-linked codes and the API foundation is partially complete. This phase hardens claiming, presence, event delivery, retry behavior, and link diagnostics.",
            "building",
            42,
            "2026-07-30",
            20,
            "cyan",
            "link",
        ),
        (
            "live-cad-game-sync",
            "Live CAD and Game Sync",
            "Public Safety",
            "Move active CAD events, callsigns, dispatch assignments, and roleplay outcomes between the game and the PWA.",
            "The goal is a reliable two-way operational bridge: server events enter CAD, authorized CAD actions can be reflected in game systems, and every update retains an audit trail.",
            "building",
            31,
            "2026-08-03",
            30,
            "coral",
            "route",
        ),
        (
            "android-app-parity",
            "Faircroft Android App",
            "Mobile",
            "Package a native-feeling Android APK with the same working systems as the PWA.",
            "The first Android release targets installable parity with the current PWA, secure session handling, push-ready notifications, native back behavior, and a polished small-screen shell.",
            "building",
            18,
            "2026-08-07",
            40,
            "gold",
            "rocket",
        ),
        (
            "mobile-banking-sync",
            "Connected Mobile Banking",
            "Economy",
            "Connect Faircroft bank balances and approved transactions to live roleplay activity.",
            "Banking will move beyond a display page into a controlled ledger shared by the PWA and approved game events, with staff adjustments, transfer safeguards, and transaction audit history.",
            "next",
            12,
            "2026-08-12",
            50,
            "mint",
            "bank",
        ),
        (
            "property-ownership",
            "Properties and Ownership",
            "World",
            "Launch searchable properties, ownership records, access rights, sales, leases, and staff controls.",
            "This phase turns the coming-soon Properties icon into a complete RP ownership system designed to connect with banking and later in-game entry and persistence events.",
            "next",
            7,
            "2026-08-19",
            60,
            "violet",
            "home",
        ),
        (
            "connected-economy",
            "Connected Faircroft Economy",
            "Long Range",
            "Unify jobs, businesses, banking, properties, contracts, and game events into one balanced economy.",
            "The long-range system will give staff clear economic controls while players see consistent balances, ownership, reputation, applications, and activity across every Faircroft surface.",
            "planned",
            3,
            None,
            70,
            "cyan",
            "settings",
        ),
    ]
    db.executemany(
        """
        INSERT INTO roadmap_items
        (slug, title, category, summary, details, status, progress, target_date, sort_order, accent, icon, is_visible, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (slug) DO NOTHING
        """,
        [(*item, ts, ts) for item in milestones],
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


def clean_character_name(value: Any) -> str:
    name = " ".join(str(value or "").strip().split())
    if len(name) < 3:
        raise ValueError("Character name must be at least 3 characters")
    if len(name) > 80:
        raise ValueError("Character name must be 80 characters or less")
    return name


def ensure_default_character(db: Database, user_id: int, current_name: str | None = None) -> DbRow:
    active = one(
        db,
        "SELECT * FROM user_characters WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT 1",
        (user_id,),
    )
    if active:
        db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (active["id"], active["character_name"], user_id))
        return active
    existing = one(db, "SELECT * FROM user_characters WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1", (user_id,))
    if existing:
        db.execute("UPDATE user_characters SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?", (existing["id"], user_id))
        db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (existing["id"], existing["character_name"], user_id))
        return existing
    try:
        character_name = clean_character_name(current_name)
    except ValueError:
        character_name = f"Civilian {user_id}"
    ts = now_iso()
    created = db.execute(
        """
        INSERT INTO user_characters (user_id, character_name, biography, status, is_active, created_at, updated_at)
        VALUES (?, ?, '', 'active', 1, ?, ?)
        RETURNING *
        """,
        (user_id, character_name, ts, ts),
    ).fetchone()
    db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (created["id"], character_name, user_id))
    return created


def name_change_status(db: Database, user_id: int) -> dict[str, Any]:
    user = one(db, "SELECT name_change_locked, name_change_unlocked_at FROM users WHERE id = ?", (user_id,))
    window_start = utcnow() - dt.timedelta(days=NAME_CHANGE_WINDOW_DAYS)
    unlocked_at = user.get("name_change_unlocked_at") if user else None
    if unlocked_at:
        unlocked_dt = parse_iso(unlocked_at)
        if unlocked_dt > window_start:
            window_start = unlocked_dt
    row = one(
        db,
        "SELECT COUNT(*) AS count FROM profile_name_changes WHERE user_id = ? AND changed_at >= ?",
        (user_id, window_start.isoformat()),
    )
    used = int(row["count"] if row else 0)
    locked = bool(user.get("name_change_locked", 0)) if user else False
    return {
        "locked": locked,
        "used": used,
        "limit": NAME_CHANGE_LIMIT,
        "remaining": max(0, NAME_CHANGE_LIMIT - used),
        "window_days": NAME_CHANGE_WINDOW_DAYS,
        "window_start": window_start.isoformat(),
        "unlocked_at": unlocked_at,
    }


def admin_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "admin"):
        return "Owner or admin access required"
    return None


def developer_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "dev"):
        return "Owner or developer access required"
    return None


def fine_settlement_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "dev"):
        return "Owner or developer access required"
    return None


def active_account_block(db: Database, user_id: int) -> DbRow | None:
    now = now_iso()
    return one(
        db,
        """
        SELECT * FROM account_sanctions
        WHERE user_id = ?
          AND revoked_at IS NULL
          AND sanction_type IN ('ban', 'timeout')
          AND starts_at <= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY CASE sanction_type WHEN 'ban' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
        """,
        (user_id, now, now),
    )


def add_admin_audit(
    db: Database,
    actor_id: int,
    action: str,
    target_user_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (actor_id, target_user_id, action[:100], json.dumps(details or {}, separators=(",", ":"), default=str)[:4000], now_iso()),
    )


def application_review_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "owner", "admin", INDEED_ADMIN_ROLE, "judge"):
        return "Indeed Admin access required"
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


def court_access_required(db: Database, user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if bool(user["verified"]) or has_any(user, "owner", "admin"):
        return None
    if one(db, "SELECT id FROM citations WHERE civ_id = ? LIMIT 1", (user["id"],)):
        return None
    return "Civilian verification required"


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
    if not has_any(user, *LAW_SERVICE_ROLES):
        return "Law enforcement access required"
    return None


def fire_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, *FIRE_SERVICE_ROLES, "owner"):
        return "Fire department access required"
    return None


def fire_chief_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, *FIRE_COMMAND_ROLES, "owner"):
        return "Fire command access required"
    return None


def dispatcher_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "dispatcher", "owner"):
        return "Dispatcher access required"
    return None


def emergency_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, *LAW_SERVICE_ROLES, *FIRE_SERVICE_ROLES, "dispatcher", "owner"):
        return "Emergency services access required"
    return None


def emergency_departments_for(user: DbRow) -> list[str]:
    if has_any(user, "owner", "dispatcher"):
        return ["police", "fire", "ems"]
    departments: list[str] = []
    if has_any(user, *LAW_SERVICE_ROLES):
        departments.append("police")
    if has_any(user, "fireman", *FIRE_COMMAND_ROLES):
        departments.append("fire")
    if has_any(user, "ems"):
        departments.append("ems")
    return departments or ["police"]


def cid_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "cid", "cid_director", "iu", "iu_director"):
        return "CID access required"
    return None


def judge_required(user: DbRow | None) -> str | None:
    if not user:
        return "Authentication required"
    if not has_any(user, "judge", "owner"):
        return "Court access required"
    return None


def app_catalog(user: DbRow | None, settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not user:
        return []
    settings = settings or {}
    lockdown = bool(settings.get("update_lockdown_enabled"))
    verified = bool(user["verified"]) or has_any(user, "owner", "admin")
    contracts_enabled = contracts_required(user) is None
    business_enabled = verified or is_business_staff(user)
    if lockdown:
        apps: list[dict[str, Any]] = []
        if verified:
            apps.append({"id": "dmv", "label": "Driver License", "icon": "id-card", "enabled": True, "coming_soon": False, "hidden": False})
        if has_any(user, *LAW_SERVICE_ROLES):
            apps.append({"id": "mdt", "label": "MDT", "icon": "shield", "enabled": True, "coming_soon": False, "hidden": False})
        if has_any(user, "owner"):
            apps.append({"id": "system", "label": "System", "icon": "settings", "enabled": True, "coming_soon": False, "hidden": False})
        visibility = settings.get("app_visibility") or {}
        return [item for item in apps if item["id"] in PROTECTED_APP_IDS or visibility.get(item["id"], True)]
    base = [
        ("profile", "Profile", "user", True, False),
        ("getting-started", "Getting Started", "map", True, False),
        ("roadmap", "Roadmap", "route", True, False),
        ("dmv", "DMV", "id-card", verified, False),
        ("jobs", "JOB", "briefcase", True, False),
        ("my-faircroft", "MyFaircroft", "civic", True, False),
        ("business", "Business", "store", business_enabled, False),
        ("properties", "PROPERTIES", "home", False, True),
        ("bank", "BANK", "bank", verified, False),
        ("messages", "Messages", "message", verified, False),
        ("changelog", "Changelog", "scroll", True, False),
    ]
    apps = [
        {"id": key, "label": label, "icon": icon, "enabled": enabled, "coming_soon": coming_soon, "hidden": False}
        for key, label, icon, enabled, coming_soon in base
    ]
    if contracts_enabled:
        apps.append({"id": "contracts", "label": "Contracts", "icon": "target", "enabled": True, "coming_soon": False, "hidden": False})
    if has_any(user, *LAW_SERVICE_ROLES):
        apps.append({"id": "mdt", "label": "MDT", "icon": "shield", "enabled": True, "hidden": False})
    if has_any(user, "judge", "owner"):
        apps.append({"id": "court", "label": "Court", "icon": "gavel", "enabled": True, "hidden": False})
    if has_any(user, *FIRE_SERVICE_ROLES, "owner"):
        apps.append({"id": "fire", "label": "Fire MDT", "icon": "flame", "enabled": True, "hidden": False})
    if has_any(user, *FIRE_COMMAND_ROLES, "owner"):
        apps.append({"id": "fire-settings", "label": "Fire Settings", "icon": "settings", "enabled": True, "hidden": False})
    if has_any(user, "owner"):
        apps.append({"id": "system", "label": "System", "icon": "settings", "enabled": True, "hidden": False})
    if has_any(user, "owner", "admin", "dev", INDEED_ADMIN_ROLE, "judge"):
        apps.append({"id": "indeed-admin", "label": "Indeed Admin", "icon": "briefcase", "enabled": True, "hidden": False})
    if has_any(user, "owner", "admin"):
        apps.append({"id": "admin", "label": "Admin", "icon": "settings", "enabled": True, "hidden": False})
    if has_any(user, "owner", "dev"):
        apps.append({"id": "dev-tools", "label": "Dev Tools", "icon": "code", "enabled": True, "hidden": False})
    if has_any(user, "beta"):
        apps.append({"id": "beta-tasks", "label": "Beta Tasks", "icon": "target", "enabled": True, "hidden": False})
    if has_any(user, "owner", "dev"):
        apps.append({"id": "fine-settlement", "label": "Fine Settlement", "icon": "gavel", "enabled": True, "hidden": False})
    visibility = settings.get("app_visibility") or {}
    return [item for item in apps if item["id"] in PROTECTED_APP_IDS or visibility.get(item["id"], True)]


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


def clean_treasury_amount(value: Any, default: float | None = None) -> float:
    if value in (None, "") and default is not None:
        amount = default
    else:
        amount = float(value)
    amount = round(amount, 2)
    if amount <= 0:
        raise ValueError("Treasury amount must be greater than zero")
    if amount > TREASURY_MAX_REQUEST_AMOUNT:
        raise ValueError("Treasury amount is above the server compensation limit")
    return amount


def clean_treasury_proofs(raw: Any) -> list[dict[str, str]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValueError("Proof uploads must be sent as a list")
    proofs: list[dict[str, str]] = []
    total_chars = 0
    allowed_prefixes = {
        "data:image/png;base64,": "image/png",
        "data:image/jpeg;base64,": "image/jpeg",
        "data:image/jpg;base64,": "image/jpeg",
        "data:image/webp;base64,": "image/webp",
    }
    for index, item in enumerate(raw[:TREASURY_MAX_PROOFS], start=1):
        if isinstance(item, str):
            name = f"proof-{index}"
            data_url = item.strip()
        elif isinstance(item, dict):
            name = str(item.get("name") or f"proof-{index}").strip()[:120]
            data_url = str(item.get("data_url") or item.get("dataUrl") or "").strip()
        else:
            continue
        if not data_url:
            continue
        mime_type = ""
        for prefix, candidate in allowed_prefixes.items():
            if data_url.startswith(prefix):
                mime_type = candidate
                break
        if not mime_type:
            raise ValueError("Proof uploads must be PNG, JPG, or WEBP images")
        if len(data_url) > TREASURY_MAX_PROOF_CHARS:
            raise ValueError("One proof image is too large. Upload a smaller screenshot.")
        total_chars += len(data_url)
        if total_chars > TREASURY_MAX_PROOF_CHARS * TREASURY_MAX_PROOFS:
            raise ValueError("Too much proof data uploaded. Keep it to four compressed screenshots.")
        proofs.append({"name": name or f"proof-{index}", "type": mime_type, "data_url": data_url})
    return proofs


def treasury_row_payload(row: DbRow, include_proofs: bool = True) -> dict[str, Any]:
    item = dict(row)
    item["requested_amount"] = round(float(item.get("requested_amount") or 0), 2)
    item["approved_amount"] = round(float(item.get("approved_amount") or 0), 2)
    item["proof_bypass"] = bool(item.get("proof_bypass", 0))
    try:
        proofs = json.loads(str(item.get("proof_images") or "[]"))
    except json.JSONDecodeError:
        proofs = []
    clean_proofs = [proof for proof in proofs if isinstance(proof, dict)]
    item["proof_count"] = len(clean_proofs)
    if include_proofs:
        item["proof_images"] = clean_proofs
    else:
        item["proof_images"] = [
            {"name": proof.get("name", "proof"), "type": proof.get("type", "image")}
            for proof in clean_proofs
        ]
    return item


def human_request_type(value: Any) -> str:
    return str(value or "treasury request").replace("_", " ").title()


ACTIVE_CASE_STATUSES = ("issued", "contested", "reviewed", "reduced", "continued")
CLOSED_CASE_STATUSES = ("paid", "dismissed", "closed")
COURT_DISPOSITIONS = ("under_review", "continued", "liable", "guilty", "plea_agreement", "not_guilty", "dismissed")
CONVICTION_DISPOSITIONS = ("guilty", "plea_agreement")
NONPAYABLE_DISPOSITIONS = ("not_guilty", "dismissed")


def case_status_clause(active: bool) -> str:
    if active:
        return "c.status IN ('issued','contested','reviewed','reduced','continued')"
    return "c.status NOT IN ('issued','contested','reviewed','reduced','continued')"


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


def court_decision_result(disposition: str, fine_amount: float, sentence_minutes: int, notes: str) -> str:
    labels = {
        "liable": "Liable",
        "guilty": "Guilty",
        "plea_agreement": "Plea agreement accepted",
        "not_guilty": "Not guilty",
        "dismissed": "Dismissed by court",
        "continued": "Hearing continued",
        "under_review": "Under judicial review",
    }
    result = labels.get(disposition, disposition.replace("_", " ").title())
    details: list[str] = []
    if disposition not in NONPAYABLE_DISPOSITIONS and fine_amount > 0:
        details.append(f"fine ${fine_amount:,.2f}")
    if sentence_minutes > 0:
        details.append(f"{sentence_minutes} RP minute sentence")
    if details:
        result = f"{result} - {', '.join(details)}"
    if notes:
        result = f"{result}: {notes}"
    return result


def pick_presiding_judge(db: Database, defendant_id: int | None = None) -> DbRow | None:
    excluded = int(defendant_id or 0)
    judge = one(
        db,
        "SELECT id, name FROM users WHERE roles LIKE ? AND id <> ? ORDER BY id LIMIT 1",
        ("%judge%", excluded),
    )
    if judge:
        return judge
    return one(
        db,
        "SELECT id, name FROM users WHERE roles LIKE ? AND id <> ? ORDER BY id LIMIT 1",
        ("%owner%", excluded),
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
    seconds = presence_seconds(db, user["id"])
    return {
        "pending_income": 0,
        "eligible_rate_per_hour": 0,
        "active_jobs": [],
        "presence_seconds_today": seconds,
        "requirements": [],
        "last_income_at": user["last_income_at"],
        "disabled": True,
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

    def do_DELETE(self) -> None:
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
        transfer_encoding = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in transfer_encoding:
            chunks = bytearray()
            while True:
                size_line = self.rfile.readline().strip()
                if not size_line:
                    return {}
                try:
                    chunk_size = int(size_line.split(b";", 1)[0], 16)
                except ValueError:
                    return {}
                if chunk_size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    break
                chunks.extend(self.rfile.read(chunk_size))
                self.rfile.read(2)
            raw = bytes(chunks)
        else:
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
                if user and path not in ("/api/session", "/api/auth/logout"):
                    block = active_account_block(db, int(user["id"]))
                    timeout_allowed = path in ("/api/health", "/api/profile", "/api/bank", "/api/presence")
                    if block and (block["sanction_type"] == "ban" or not timeout_allowed):
                        self.error(403, f"Account {block['sanction_type']}: {block['reason']}")
                        return
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
                elif path == "/api/roadmap" and method == "GET":
                    self.api_roadmap(db, user)
                elif path == "/api/roadmap/items" and method == "POST":
                    self.api_create_roadmap_item(db, user)
                elif path.startswith("/api/roadmap/items/") and path.endswith("/vote") and method == "POST":
                    self.api_vote_roadmap_item(db, user, self.path_int(path, 3))
                elif path.startswith("/api/roadmap/items/") and method == "PATCH":
                    self.api_update_roadmap_item(db, user, self.path_int(path, 3))
                elif path == "/api/presence" and method == "POST":
                    self.api_presence(db, user)
                elif path == "/api/profile" and method == "GET":
                    self.api_profile(db, user)
                elif path == "/api/profile/car-entry-code" and method == "POST":
                    self.api_profile_update_car_entry_code(db, user)
                elif path == "/api/profile/callsign" and method == "POST":
                    self.api_profile_update_callsign(db, user)
                elif path == "/api/profile/name" and method == "POST":
                    self.api_profile_change_name(db, user)
                elif path == "/api/profile/characters" and method == "POST":
                    self.api_profile_create_character(db, user)
                elif path.startswith("/api/profile/characters/") and path.endswith("/activate") and method == "POST":
                    self.api_profile_activate_character(db, user, self.path_int(path, 3))
                elif path == "/api/profile/link-arma" and method == "POST":
                    self.api_claim_arma_link(db, user)
                elif path == "/api/profile/unlink-arma" and method == "POST":
                    self.api_unlink_arma(db, user)
                elif path == "/api/arma/link-requests" and method == "POST":
                    self.api_arma_link_requests(db)
                elif path == "/api/arma/snapshot" and method == "GET":
                    self.api_arma_snapshot(db)
                elif path == "/api/arma/events" and method == "POST":
                    self.api_arma_events(db)
                elif path == "/api/arma/game-database/banks" and method == "POST":
                    self.api_arma_game_banks(db)
                elif path == "/api/jobs" and method == "GET":
                    self.api_jobs(db, user)
                elif path == "/api/jobs/department-applications" and method == "POST":
                    self.api_apply_department(db, user)
                elif path.startswith("/api/jobs/") and path.endswith("/apply") and method == "POST":
                    self.api_apply_job(db, user, self.path_int(path, 2))
                elif path == "/api/bank" and method == "GET":
                    self.api_bank(db, user)
                elif path == "/api/bank/collect" and method == "POST":
                    self.api_collect_bank(db, user)
                elif path == "/api/bank/treasury-adjust" and method == "POST":
                    self.api_bank_treasury_adjust(db, user)
                elif path == "/api/cash/transfer" and method == "POST":
                    self.api_cash_transfer(db, user)
                elif path == "/api/treasury" and method == "GET":
                    self.api_treasury(db, user)
                elif path == "/api/treasury" and method == "POST":
                    self.api_create_treasury_request(db, user)
                elif path.startswith("/api/treasury/requests/") and method == "PATCH":
                    self.api_review_treasury_request(db, user, self.path_int(path, 3))
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
                elif path.startswith("/api/business/licenses/") and path.endswith("/taxes") and method == "POST":
                    self.api_create_business_tax(db, user, self.path_int(path, 3))
                elif path.startswith("/api/business/licenses/") and method == "PATCH":
                    self.api_update_business_license(db, user, self.path_int(path, 3))
                elif path == "/api/properties" and method == "GET":
                    self.api_properties(db, user)
                elif path.startswith("/api/properties/") and path.endswith("/buy") and method == "POST":
                    self.api_buy_property(db, user, self.path_int(path, 2))
                elif path == "/api/my-faircroft" and method == "GET":
                    self.api_my_faircroft(db, user)
                elif path.startswith("/api/my-faircroft/fines/") and path.endswith("/pay") and method == "POST":
                    self.api_pay_case(db, user, self.path_int(path, 3))
                elif path.startswith("/api/my-faircroft/fines/") and path.endswith("/contest") and method == "POST":
                    self.api_contest_case(db, user, self.path_int(path, 3))
                elif path.startswith("/api/my-faircroft/records/") and path.endswith("/appeal") and method == "POST":
                    self.api_create_record_request(db, user, self.path_int(path, 3), "appeal")
                elif path.startswith("/api/my-faircroft/records/") and path.endswith("/expunge") and method == "POST":
                    self.api_create_record_request(db, user, self.path_int(path, 3), "expungement")
                elif path.startswith("/api/my-faircroft/taxes/") and path.endswith("/pay") and method == "POST":
                    self.api_pay_business_tax(db, user, self.path_int(path, 3))
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
                elif path.startswith("/api/court/petitions/") and method == "PATCH":
                    self.api_update_record_request(db, user, self.path_int(path, 3))
                elif path == "/api/mdt/search" and method == "GET":
                    self.api_mdt_search(db, user, query)
                elif path == "/api/mdt/charges" and method == "GET":
                    self.api_mdt_charges(db, user)
                elif path.startswith("/api/mdt/users/") and path.endswith("/license") and method == "PATCH":
                    self.api_mdt_update_license(db, user, self.path_int(path, 3))
                elif path == "/api/mdt/charge-warrants" and method == "POST":
                    self.api_issue_charge_warrant(db, user)
                elif path == "/api/mdt/citations" and method == "POST":
                    self.api_issue_citation(db, user)
                elif path == "/api/mdt/bookings" and method == "GET":
                    self.api_mdt_bookings(db, user)
                elif path == "/api/mdt/bookings" and method == "POST":
                    self.api_create_mdt_booking(db, user)
                elif path.startswith("/api/mdt/bookings/") and method == "PATCH":
                    self.api_update_mdt_booking(db, user, self.path_int(path, 3))
                elif path == "/api/mdt/panic" and method == "POST":
                    self.api_panic(db, user)
                elif path == "/api/mdt/reports" and method == "GET":
                    self.api_mdt_reports(db, user)
                elif path == "/api/mdt/reports" and method == "POST":
                    self.api_create_mdt_report(db, user)
                elif path == "/api/mdt/bolos" and method == "GET":
                    self.api_mdt_bolos(db, user)
                elif path == "/api/mdt/bolos" and method == "POST":
                    self.api_create_mdt_bolo(db, user)
                elif path.startswith("/api/mdt/bolos/") and method == "PATCH":
                    self.api_update_mdt_bolo(db, user, self.path_int(path, 3))
                elif path == "/api/mdt/alerts" and method == "GET":
                    self.api_alerts(db, user)
                elif path.startswith("/api/mdt/alerts/") and method == "PATCH":
                    self.api_clear_alert(db, user, self.path_int(path, 3))
                elif path == "/api/fire/overview" and method == "GET":
                    self.api_fire_overview(db, user)
                elif path == "/api/fire/rigs" and method == "PATCH":
                    self.api_update_fire_rig(db, user)
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
                elif path.startswith("/api/cid/internal-affairs/") and path.endswith("/notes") and method == "POST":
                    self.api_cid_add_ia_note(db, user, self.path_int(path, 3))
                elif path.startswith("/api/cid/internal-affairs/") and method == "PATCH":
                    self.api_cid_update_ia(db, user, self.path_int(path, 3))
                elif path == "/api/system/settings" and method == "GET":
                    self.api_system_settings(db, user)
                elif path == "/api/system/settings" and method == "PATCH":
                    self.api_update_system_settings(db, user)
                elif path == "/api/beta/respond" and method == "POST":
                    self.api_beta_respond(db, user)
                elif path == "/api/beta/tasks" and method == "GET":
                    self.api_beta_tasks(db, user)
                elif path == "/api/beta/reports" and method == "POST":
                    self.api_beta_report(db, user)
                elif path == "/api/dev-tools" and method == "GET":
                    self.api_dev_tools(db, user)
                elif path == "/api/dev-tools/beta-program" and method == "PATCH":
                    self.api_dev_beta_program(db, user)
                elif path == "/api/dev-tools/beta-tasks" and method == "POST":
                    self.api_dev_create_beta_task(db, user)
                elif path.startswith("/api/dev-tools/beta-tasks/") and method == "PATCH":
                    self.api_dev_update_beta_task(db, user, self.path_int(path, 3))
                elif path.startswith("/api/dev-tools/accounts/") and method == "GET":
                    self.api_dev_account(db, user, self.path_int(path, 3))
                elif path == "/api/dev-tools/unlink-codes" and method == "POST":
                    self.api_dev_generate_unlink_code(db, user)
                elif path == "/api/dev-tools/sanctions" and method == "POST":
                    self.api_dev_create_sanction(db, user)
                elif path.startswith("/api/dev-tools/sanctions/") and path.endswith("/revoke") and method == "POST":
                    self.api_dev_revoke_sanction(db, user, self.path_int(path, 3))
                elif path == "/api/dev-tools/warnings" and method == "POST":
                    self.api_dev_create_warning(db, user)
                elif path == "/api/dev-tools/app-visibility" and method == "PATCH":
                    self.api_dev_update_app_visibility(db, user)
                elif path.startswith("/api/dev-tools/warnings/") and path.endswith("/resolve") and method == "POST":
                    self.api_dev_resolve_warning(db, user, self.path_int(path, 3))
                elif path == "/api/fine-settlement" and method == "GET":
                    self.api_fine_settlement(db, user)
                elif path == "/api/fine-settlement/batches" and method == "POST":
                    self.api_create_fine_settlement_batch(db, user)
                elif path.startswith("/api/fine-settlement/batches/") and path.endswith("/code") and method == "POST":
                    self.api_fine_settlement_code(db, user, self.path_int(path, 3))
                elif path.startswith("/api/fine-settlement/batches/") and path.endswith("/approve") and method == "POST":
                    self.api_approve_fine_settlement(db, user, self.path_int(path, 3))
                elif path.startswith("/api/fine-settlement/batches/") and path.endswith("/complete") and method == "POST":
                    self.api_complete_fine_settlement(db, user, self.path_int(path, 3))
                elif path == "/api/fine-settlement/tax-batches" and method == "POST":
                    self.api_create_tax_settlement_batch(db, user)
                elif path.startswith("/api/fine-settlement/tax-batches/") and path.endswith("/code") and method == "POST":
                    self.api_tax_settlement_code(db, user, self.path_int(path, 3))
                elif path.startswith("/api/fine-settlement/tax-batches/") and path.endswith("/approve") and method == "POST":
                    self.api_approve_tax_settlement(db, user, self.path_int(path, 3))
                elif path.startswith("/api/fine-settlement/tax-batches/") and path.endswith("/complete") and method == "POST":
                    self.api_complete_tax_settlement(db, user, self.path_int(path, 3))
                elif path == "/api/admin/overview" and method == "GET":
                    self.api_admin_overview(db, user)
                elif path == "/api/admin/users" and method == "GET":
                    self.api_admin_users(db, user)
                elif path == "/api/admin/referrals" and method == "GET":
                    self.api_admin_referrals(db, user)
                elif path.startswith("/api/admin/referrals/") and path.endswith("/deposit") and method == "POST":
                    self.api_admin_deposit_referral(db, user, self.path_int(path, 3))
                elif path == "/api/admin/department-applications" and method == "GET":
                    self.api_admin_department_applications(db, user)
                elif path.startswith("/api/admin/department-applications/") and method == "PATCH":
                    self.api_admin_review_department_application(db, user, self.path_int(path, 3))
                elif path == "/api/indeed-admin/applications" and method == "GET":
                    self.api_admin_department_applications(db, user)
                elif path.startswith("/api/indeed-admin/applications/") and method == "PATCH":
                    self.api_admin_review_department_application(db, user, self.path_int(path, 3))
                elif path.startswith("/api/admin/users/") and method == "DELETE":
                    self.api_admin_delete_user(db, user, self.path_int(path, 3))
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
        missing = require_fields(payload, "name", "email", "car_entry_code", "password")
        if missing:
            self.error(400, missing)
            return
        email = str(payload["email"]).strip().lower()
        try:
            car_entry_code = clean_car_entry_code(payload.get("car_entry_code"))
        except ValueError as exc:
            self.error(400, str(exc))
            return
        password = str(payload["password"])
        if len(password) < 6:
            self.error(400, "Password must be at least 6 characters")
            return
        try:
            referral_code = clean_referral_code(payload.get("referral_code") or payload.get("referral"))
        except ValueError as exc:
            self.error(400, str(exc))
            return
        referrer = None
        if referral_code:
            referrer = one(db, "SELECT id, name, email FROM users WHERE referral_code = ?", (referral_code,))
            if not referrer:
                self.error(400, "Referral code was not found")
                return
            if str(referrer["email"]).strip().lower() == email:
                self.error(400, "You cannot use your own referral code")
                return
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO users (civ_number, name, email, arma_id, car_entry_code, referral_code, referred_by_user_id, password_hash, verified, roles, bank_balance, cash_balance, last_income_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 250, ?, ?)
            RETURNING id
            """,
            (
                generate_civ_number(db),
                str(payload["name"]).strip(),
                email,
                None,
                car_entry_code,
                generate_referral_code(db),
                referrer["id"] if referrer else None,
                hash_password(password),
                json.dumps(["civ"]),
                ts,
                ts,
            ),
        )
        created = cur.fetchone()
        user_id = int(created["id"])
        create_default_dmv(db, user_id)
        ensure_default_character(db, user_id, str(payload["name"]).strip())
        if referrer:
            db.execute(
                """
                INSERT INTO referrals
                (referrer_id, referred_user_id, code_used, bonus_amount, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?)
                """,
                (referrer["id"], user_id, referral_code, REFERRAL_BONUS_AMOUNT, ts, ts),
            )
            add_message(
                db,
                int(referrer["id"]),
                "Referral payout pending",
                f"{str(payload['name']).strip()} used your referral code. An in-game reward ticket is waiting for staff review.",
                user_id,
            )
            add_message(
                db,
                user_id,
                "Referral code accepted",
                f"Your registration used {referrer['name']}'s referral code. Their in-game reward ticket is pending staff review.",
                int(referrer["id"]),
            )
            staff = all_rows(
                db,
                "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? ORDER BY id LIMIT 120",
                ('%"owner"%', '%"admin"%'),
            )
            for row in staff:
                add_message(
                    db,
                    int(row["id"]),
                    "Referral payout ticket",
                    f"{referrer['name']} earned a ${REFERRAL_BONUS_AMOUNT:,.0f} referral ticket from {str(payload['name']).strip()}. Deposit it from Admin > Referral Tickets.",
                    user_id,
                )
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
        block = active_account_block(db, int(user["id"]))
        if block and block["sanction_type"] == "ban":
            until = block.get("expires_at") or "indefinitely"
            self.error(403, f"Account {block['sanction_type']}: {block['reason']} (until {until})")
            return
        self.send_json(200, {"ok": True, "user": public_user_with_game_bank(db, user)}, {"Set-Cookie": self.session_header(user["id"])})

    def api_session(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.send_json(200, {"user": None, "apps": []})
            return
        apply_auto_verification(db)
        apply_auto_license_approval(db)
        settings = get_system_settings(db)
        user = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],)) or user
        block = active_account_block(db, int(user["id"]))
        if block and block["sanction_type"] == "ban":
            self.send_json(
                403,
                {
                    "error": f"Account {block['sanction_type']}: {block['reason']}",
                    "sanction": {
                        "type": block["sanction_type"],
                        "reason": block["reason"],
                        "expires_at": block.get("expires_at"),
                    },
                },
                {"Set-Cookie": self.clear_session_header()},
            )
            return
        unread = one(db, "SELECT COUNT(*) AS count FROM messages WHERE recipient_id = ? AND read_at IS NULL", (user["id"],))
        arma_linked = bool(one(db, "SELECT id FROM arma_account_links WHERE user_id = ?", (user["id"],)))
        beta_response = one(
            db,
            "SELECT response FROM beta_program_responses WHERE user_id = ? AND campaign_id = ?",
            (user["id"], settings["beta_campaign_id"]),
        )
        beta_invite = bool(
            settings["beta_recruiting_enabled"]
            and not has_any(user, "beta")
            and not beta_response
        )
        apps = app_catalog(user, settings)
        if block and block["sanction_type"] == "timeout":
            apps = [
                {"id": "profile", "label": "Profile", "icon": "user", "enabled": True, "coming_soon": False, "hidden": False},
                {"id": "bank", "label": "Bank", "icon": "bank", "enabled": True, "coming_soon": False, "hidden": False},
                {"id": "restriction", "label": "Restriction", "icon": "lock", "enabled": True, "coming_soon": False, "hidden": False},
            ]
        if court_access_required(db, user) is None:
            for item in apps:
                if item["id"] == "court":
                    item["enabled"] = True
                    item["coming_soon"] = False
                    break
        self.send_json(
            200,
            {
                "user": public_user_with_game_bank(db, user),
                "apps": apps,
                "unread_messages": int(unread["count"] if unread else 0),
                "income": income_snapshot(db, user),
                "arma_linked": arma_linked,
                "requires_arma_link": bool(user["verified"]) and not arma_linked,
                "sanction": (
                    {
                        "type": block["sanction_type"],
                        "reason": block["reason"],
                        "report_number": block.get("report_number") or "",
                        "expires_at": block.get("expires_at"),
                        "bail_amount": float(block.get("bail_amount") or 0),
                    }
                    if block and block["sanction_type"] == "timeout"
                    else None
                ),
                "system": {
                    "update_lockdown_enabled": settings["update_lockdown_enabled"],
                    "update_lockdown_message": settings["update_lockdown_message"],
                    "beta_invite": beta_invite,
                    "beta_recruiting_message": settings["beta_recruiting_message"],
                },
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

    def api_roadmap(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        can_manage = has_any(user, "owner", "admin")
        visibility_sql = "" if can_manage else "WHERE i.is_visible = 1"
        rows = all_rows(
            db,
            f"""
            SELECT i.*,
                   (SELECT COUNT(*) FROM roadmap_votes rv WHERE rv.item_id = i.id AND rv.vote = 1) AS upvotes,
                   (SELECT COUNT(*) FROM roadmap_votes rv WHERE rv.item_id = i.id AND rv.vote = -1) AS downvotes,
                   COALESCE((SELECT rv.vote FROM roadmap_votes rv WHERE rv.item_id = i.id AND rv.user_id = ?), 0) AS user_vote
            FROM roadmap_items i
            {visibility_sql}
            ORDER BY i.sort_order, i.id
            """,
            (user["id"],),
        )
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["progress"] = int(item.get("progress") or 0)
            item["sort_order"] = int(item.get("sort_order") or 0)
            item["is_visible"] = bool(item.get("is_visible"))
            item["upvotes"] = int(item.get("upvotes") or 0)
            item["downvotes"] = int(item.get("downvotes") or 0)
            item["score"] = item["upvotes"] - item["downvotes"]
            item["user_vote"] = int(item.get("user_vote") or 0)
            items.append(item)
        public_items = [item for item in items if item["is_visible"]]
        active = [item for item in public_items if item["status"] in ("building", "next")]
        shipped = [item for item in public_items if item["status"] == "shipped"]
        total_votes = sum(item["upvotes"] + item["downvotes"] for item in public_items)
        overall_progress = round(sum(item["progress"] for item in public_items) / max(len(public_items), 1))
        android = next((item for item in public_items if item["slug"] == "android-app-parity"), None)
        android_days = None
        if android and android.get("target_date"):
            android_days = max(0, (dt.date.fromisoformat(str(android["target_date"])) - utcnow().date()).days)
        self.send_json(
            200,
            {
                "items": items,
                "can_manage": can_manage,
                "stats": {
                    "overall_progress": overall_progress,
                    "active_phases": len(active),
                    "shipped_phases": len(shipped),
                    "community_votes": total_votes,
                    "android_days": android_days,
                    "android_target": android.get("target_date") if android else None,
                },
                "options": {
                    "statuses": list(ROADMAP_STATUSES),
                    "accents": list(ROADMAP_ACCENTS),
                    "icons": list(ROADMAP_ICONS),
                },
            },
        )

    def api_vote_roadmap_item(self, db: Database, user: DbRow | None, item_id: int) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        item = one(db, "SELECT id, is_visible FROM roadmap_items WHERE id = ?", (item_id,))
        if not item or (not bool(item["is_visible"]) and not has_any(user, "owner", "admin")):
            self.error(404, "Roadmap milestone not found")
            return
        payload = self.read_json()
        try:
            vote = int(payload.get("vote", 0))
        except (TypeError, ValueError):
            self.error(400, "Vote must be up, down, or cleared")
            return
        if vote not in (-1, 0, 1):
            self.error(400, "Vote must be up, down, or cleared")
            return
        if vote == 0:
            db.execute("DELETE FROM roadmap_votes WHERE item_id = ? AND user_id = ?", (item_id, user["id"]))
        else:
            db.execute(
                """
                INSERT INTO roadmap_votes (item_id, user_id, vote, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (item_id, user_id)
                DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at
                """,
                (item_id, user["id"], vote, now_iso()),
            )
        counts = one(
            db,
            """
            SELECT
                (SELECT COUNT(*) FROM roadmap_votes WHERE item_id = ? AND vote = 1) AS upvotes,
                (SELECT COUNT(*) FROM roadmap_votes WHERE item_id = ? AND vote = -1) AS downvotes
            """,
            (item_id, item_id),
        ) or {"upvotes": 0, "downvotes": 0}
        upvotes = int(counts["upvotes"] or 0)
        downvotes = int(counts["downvotes"] or 0)
        self.send_json(200, {"ok": True, "item_id": item_id, "user_vote": vote, "upvotes": upvotes, "downvotes": downvotes, "score": upvotes - downvotes})

    def api_create_roadmap_item(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        values = roadmap_payload_values(payload)
        slug_base = "".join(character.lower() if character.isalnum() else "-" for character in values["title"])
        slug_base = "-".join(part for part in slug_base.split("-") if part)[:70] or "milestone"
        slug = slug_base
        suffix = 2
        while one(db, "SELECT id FROM roadmap_items WHERE slug = ?", (slug,)):
            slug = f"{slug_base[:64]}-{suffix}"
            suffix += 1
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO roadmap_items
            (slug, title, category, summary, details, status, progress, target_date, sort_order, accent, icon, is_visible, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                slug,
                values["title"],
                values["category"],
                values["summary"],
                values["details"],
                values["status"],
                values["progress"],
                values["target_date"],
                values["sort_order"],
                values["accent"],
                values["icon"],
                values["is_visible"],
                user["id"],
                ts,
                ts,
            ),
        ).fetchone()
        self.send_json(201, {"ok": True, "id": int(created["id"]), "slug": slug})

    def api_update_roadmap_item(self, db: Database, user: DbRow | None, item_id: int) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        item = one(db, "SELECT * FROM roadmap_items WHERE id = ?", (item_id,))
        if not item:
            self.error(404, "Roadmap milestone not found")
            return
        values = roadmap_payload_values(self.read_json(), item)
        db.execute(
            """
            UPDATE roadmap_items
            SET title = ?, category = ?, summary = ?, details = ?, status = ?, progress = ?,
                target_date = ?, sort_order = ?, accent = ?, icon = ?, is_visible = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                values["title"],
                values["category"],
                values["summary"],
                values["details"],
                values["status"],
                values["progress"],
                values["target_date"],
                values["sort_order"],
                values["accent"],
                values["icon"],
                values["is_visible"],
                now_iso(),
                item_id,
            ),
        )
        self.send_json(200, {"ok": True, "id": item_id})

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
        apply_auto_license_approval(db)
        self.send_json(200, {"ok": True, "presence_seconds_today": presence_seconds(db, user["id"])})

    def api_profile(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        active_character = ensure_default_character(db, int(user["id"]), str(user["name"] or "Civilian"))
        user = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],)) or user
        characters = all_rows(
            db,
            """
            SELECT *
            FROM user_characters
            WHERE user_id = ?
            ORDER BY is_active DESC, updated_at DESC, id DESC
            """,
            (user["id"],),
        )
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
        referral_rows = all_rows(
            db,
            """
            SELECT r.*, referred.name AS referred_name, referred.civ_number AS referred_civ_number
            FROM referrals r
            JOIN users referred ON referred.id = r.referred_user_id
            WHERE r.referrer_id = ?
            ORDER BY r.created_at DESC
            LIMIT 10
            """,
            (user["id"],),
        )
        referral_total = one(
            db,
            """
            SELECT COUNT(*) AS count,
                   COALESCE(SUM(CASE WHEN status = 'deposited' THEN bonus_amount ELSE 0 END), 0) AS total,
                   COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
                   COALESCE(SUM(CASE WHEN status = 'pending' THEN bonus_amount ELSE 0 END), 0) AS pending_total
            FROM referrals
            WHERE referrer_id = ?
            """,
            (user["id"],),
        )
        referred_by = one(
            db,
            "SELECT id, name, civ_number FROM users WHERE id = ?",
            (user.get("referred_by_user_id"),),
        ) if user.get("referred_by_user_id") else None
        self.send_json(
            200,
            {
                "user": public_user_with_game_bank(db, user),
                "characters": [dict(row) for row in characters],
                "active_character": dict(active_character) if active_character else None,
                "name_change": name_change_status(db, int(user["id"])),
                "arma_link": dict(link) if link else None,
                "recent_activity": [dict(row) for row in activity],
                "claimed_codes": [dict(row) for row in pending_codes],
                "referrals": {
                    "code": user.get("referral_code") or "",
                    "bonus_amount": REFERRAL_BONUS_AMOUNT,
                    "count": int(referral_total["count"] if referral_total else 0),
                    "total_bonus": round(float(referral_total["total"] if referral_total else 0), 2),
                    "pending_count": int(referral_total["pending_count"] if referral_total else 0),
                    "pending_total": round(float(referral_total["pending_total"] if referral_total else 0), 2),
                    "referred_by": dict(referred_by) if referred_by else None,
                    "recent": [dict(row) for row in referral_rows],
                },
            },
        )

    def api_profile_create_character(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        payload = self.read_json()
        character_name = clean_character_name(payload.get("character_name") or payload.get("name"))
        biography = str(payload.get("biography") or "").strip()[:800]
        ts = now_iso()
        db.execute("UPDATE user_characters SET is_active = 0 WHERE user_id = ?", (user["id"],))
        created = db.execute(
            """
            INSERT INTO user_characters (user_id, character_name, biography, status, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 'active', 1, ?, ?)
            RETURNING *
            """,
            (user["id"], character_name, biography, ts, ts),
        ).fetchone()
        db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (created["id"], character_name, user["id"]))
        add_message(db, user["id"], "Character created", f"{character_name} is now your active RP character.")
        self.send_json(201, {"ok": True, "character": dict(created), "user": public_user(one(db, "SELECT * FROM users WHERE id = ?", (user["id"],)))})

    def api_profile_update_car_entry_code(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        payload = self.read_json()
        try:
            code = clean_car_entry_code(payload.get("car_entry_code") or payload.get("code"))
        except ValueError as exc:
            self.error(400, str(exc))
            return
        db.execute("UPDATE users SET car_entry_code = ? WHERE id = ?", (code, user["id"]))
        updated = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],))
        self.send_json(200, {"ok": True, "user": public_user(updated), "car_entry_code": code})

    def api_profile_update_callsign(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        roles = roles_for(user)
        if set(roles) == {"civ"}:
            self.error(403, "You must be assigned to a department role to set a callsign")
            return
        payload = self.read_json()
        callsign = payload.get("callsign")
        if callsign is None:
            self.error(400, "Callsign is required")
            return
        callsign = clean_callsign(callsign)
        db.execute("UPDATE users SET callsign = ? WHERE id = ?", (callsign, user["id"]))
        updated = one(db, "SELECT * FROM users WHERE id = ?", (user["id"],))
        self.send_json(200, {"ok": True, "user": public_user(updated), "callsign": callsign})

    def api_profile_activate_character(self, db: Database, user: DbRow | None, character_id: int) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        character = one(db, "SELECT * FROM user_characters WHERE id = ? AND user_id = ?", (character_id, user["id"]))
        if not character:
            self.error(404, "Character not found")
            return
        if character["status"] != "active":
            self.error(409, "Only active characters can be selected")
            return
        ts = now_iso()
        db.execute("UPDATE user_characters SET is_active = 0 WHERE user_id = ?", (user["id"],))
        db.execute("UPDATE user_characters SET is_active = 1, updated_at = ? WHERE id = ?", (ts, character_id))
        db.execute("UPDATE users SET active_character_id = ?, name = ? WHERE id = ?", (character_id, character["character_name"], user["id"]))
        self.send_json(200, {"ok": True, "active_character_id": character_id, "name": character["character_name"]})

    def api_profile_change_name(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        active_character = ensure_default_character(db, int(user["id"]), str(user["name"] or "Civilian"))
        status = name_change_status(db, int(user["id"]))
        if status["locked"]:
            self.error(423, "Name changes are locked until an admin unlocks this account.")
            return
        if status["used"] >= NAME_CHANGE_LIMIT:
            db.execute("UPDATE users SET name_change_locked = 1 WHERE id = ?", (user["id"],))
            self.error(423, "Name change limit reached. An admin must unlock this account before another name change.")
            return
        payload = self.read_json()
        new_name = clean_character_name(payload.get("name") or payload.get("character_name"))
        old_name = str(active_character["character_name"])
        if old_name.lower() == new_name.lower():
            self.error(400, "New name must be different from the current name")
            return
        ts = now_iso()
        db.execute("UPDATE user_characters SET character_name = ?, updated_at = ? WHERE id = ?", (new_name, ts, active_character["id"]))
        db.execute("UPDATE users SET name = ? WHERE id = ?", (new_name, user["id"]))
        db.execute(
            "INSERT INTO profile_name_changes (user_id, character_id, old_name, new_name, changed_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], active_character["id"], old_name, new_name, ts),
        )
        updated_status = name_change_status(db, int(user["id"]))
        if updated_status["used"] >= NAME_CHANGE_LIMIT:
            db.execute("UPDATE users SET name_change_locked = 1 WHERE id = ?", (user["id"],))
            updated_status = name_change_status(db, int(user["id"]))
        add_message(db, user["id"], "Profile name changed", f"Your active character name changed from {old_name} to {new_name}.")
        self.send_json(200, {"ok": True, "name": new_name, "name_change": updated_status})

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

    def api_unlink_arma(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        payload = self.read_json()
        if payload.get("confirmation") != "UNLINK FOR DEVELOPMENT":
            self.error(400, "Confirm that unlinking is for development reasons and is being done with server engineer guidance.")
            return
        dev_code = str(payload.get("dev_code") or "").strip().upper()
        if not dev_code:
            self.error(400, "A specialized developer unlink code is required")
            return
        code_hash = hashlib.sha256(dev_code.encode("utf-8")).hexdigest()
        code_record = one(
            db,
            """
            SELECT * FROM developer_unlink_codes
            WHERE code_hash = ?
              AND revoked_at IS NULL
              AND uses_remaining > 0
              AND expires_at > ?
            """,
            (code_hash, now_iso()),
        )
        if not code_record:
            self.error(403, "Developer unlink code is invalid, expired, or already used")
            return
        link = one(db, "SELECT * FROM arma_account_links WHERE user_id = ?", (user["id"],))
        if not link:
            self.error(404, "No linked Arma account was found")
            return
        db.execute("DELETE FROM arma_account_links WHERE user_id = ?", (user["id"],))
        db.execute("UPDATE users SET arma_id = NULL WHERE id = ?", (user["id"],))
        db.execute(
            "UPDATE arma_link_codes SET status = 'unlinked' WHERE claimed_by = ? AND status = 'claimed'",
            (user["id"],),
        )
        db.execute(
            """
            UPDATE developer_unlink_codes
            SET uses_remaining = uses_remaining - 1, used_by = ?, used_at = ?
            WHERE id = ?
            """,
            (user["id"], now_iso(), code_record["id"]),
        )
        add_admin_audit(
            db,
            int(code_record["created_by"]),
            "arma.development_unlink",
            int(user["id"]),
            {"code_hint": code_record["code_hint"], "identity_id": link["identity_id"]},
        )
        add_message(
            db,
            user["id"],
            "Arma account unlinked",
            "The Arma account link was removed for development testing with server engineer guidance.",
        )
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
                   u.primary_agency, COALESCE(game_bank.balance, 0) AS game_bank_balance
            FROM arma_account_links l
            JOIN users u ON u.id = l.user_id
            LEFT JOIN arma_game_bank_balances game_bank ON game_bank.identity_id = l.identity_id
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
                    "Cash": 0,
                    "Bank": int(float(row["game_bank_balance"] or 0)),
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
                add_transaction(db, user_id, f"arma_{action or 'money'}", amount, reason or source_system)
            if link:
                db.execute("UPDATE arma_account_links SET last_seen_at = ?, last_sync_at = ? WHERE id = ?", (created_at, received_at, link["id"]))
            presence_values = {action.strip().lower(), event_type.strip().lower()}
            joined_presence = bool(
                presence_values
                & {
                    "anticheat.player_joined",
                    "player.joined",
                    "player.connected",
                    "player_joined",
                }
            )
            heartbeat_presence = bool(
                presence_values
                & {
                    "anticheat.player_heartbeat",
                    "player.heartbeat",
                    "player.presence",
                    "player_heartbeat",
                }
            )
            departed_presence = bool(
                presence_values
                & {
                    "anticheat.player_left",
                    "anticheat.player_disconnected",
                    "player.left",
                    "player.disconnected",
                    "player_left",
                }
            )
            if joined_presence or heartbeat_presence or departed_presence:
                player_uid = str(event.get("Uid") or event.get("IdentityId") or "").strip()[:160]
                if player_uid:
                    server_id = str(event.get("ServerId") or data.get("ServerId") or "default")[:80]
                    player_name = str(event.get("PlayerName") or "")[:120]
                    if departed_presence:
                        db.execute(
                            """
                            UPDATE anticheat_live_sessions
                            SET player_name = CASE WHEN ? <> '' THEN ? ELSE player_name END,
                                linked_user_id = COALESCE(?, linked_user_id),
                                last_heartbeat_at = ?, status = 'offline'
                            WHERE server_id = ? AND player_uid = ?
                            """,
                            (player_name, player_name, user_id, received_at, server_id, player_uid),
                        )
                    elif joined_presence:
                        db.execute(
                            """
                            INSERT INTO anticheat_live_sessions
                            (server_id, player_uid, player_name, linked_user_id, joined_at,
                             last_heartbeat_at, status)
                            VALUES (?, ?, ?, ?, ?, ?, 'online')
                            ON CONFLICT (server_id, player_uid) DO UPDATE SET
                                player_name = EXCLUDED.player_name,
                                linked_user_id = EXCLUDED.linked_user_id,
                                joined_at = EXCLUDED.joined_at,
                                last_heartbeat_at = EXCLUDED.last_heartbeat_at,
                                status = 'online'
                            """,
                            (server_id, player_uid, player_name, user_id, created_at, received_at),
                        )
                    else:
                        db.execute(
                            """
                            INSERT INTO anticheat_live_sessions
                            (server_id, player_uid, player_name, linked_user_id, joined_at,
                             last_heartbeat_at, status)
                            VALUES (?, ?, ?, ?, ?, ?, 'online')
                            ON CONFLICT (server_id, player_uid) DO UPDATE SET
                                player_name = EXCLUDED.player_name,
                                linked_user_id = EXCLUDED.linked_user_id,
                                last_heartbeat_at = EXCLUDED.last_heartbeat_at,
                                status = 'online'
                            """,
                            (server_id, player_uid, player_name, user_id, created_at, received_at),
                        )
            accepted.append(event_id)
        self.send_json(200, {"ok": True, "accepted_event_ids": accepted, "skipped_event_ids": skipped})

    def api_arma_game_banks(self, db: Database) -> None:
        err = self.bridge_error()
        if err:
            self.error(403, err)
            return
        payload = self.read_json()
        data = self.bridge_payload_data(payload)
        balances = data.get("Balances") or data.get("m_Banks") or {}
        if not isinstance(balances, dict):
            self.error(400, "Bank payload must contain a Balances map")
            return
        source_file = str(data.get("SourceFile") or "")[:255]
        source_saved_at = str(data.get("SourceSavedAt") or data.get("m_iLastSaved") or "")[:80]
        synced_at = now_iso()
        accepted = 0
        linked = 0
        for identity_id, raw_balance in balances.items():
            identity = str(identity_id or "").strip()[:160]
            if not identity:
                continue
            try:
                balance = round(float(raw_balance or 0), 2)
            except (TypeError, ValueError):
                continue
            db.execute(
                """
                INSERT INTO arma_game_bank_balances
                (identity_id, balance, source_file, source_saved_at, raw_payload, synced_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (identity_id) DO UPDATE SET
                    balance = EXCLUDED.balance,
                    source_file = EXCLUDED.source_file,
                    source_saved_at = EXCLUDED.source_saved_at,
                    raw_payload = EXCLUDED.raw_payload,
                    synced_at = EXCLUDED.synced_at
                """,
                (identity, balance, source_file, source_saved_at, json.dumps({"balance": balance}), synced_at),
            )
            if one(db, "SELECT id FROM arma_account_links WHERE identity_id = ?", (identity,)):
                linked += 1
            accepted += 1
        self.send_json(200, {"ok": True, "accepted": accepted, "matched_linked_accounts": linked, "synced_at": synced_at})

    def api_jobs(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        applications = all_rows(
            db,
            """
            SELECT a.*, reviewer.name AS reviewer_name
            FROM department_applications a
            LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
            WHERE a.user_id = ?
            ORDER BY a.updated_at DESC
            """,
            (user["id"],),
        )
        self.send_json(
            200,
            {
                "jobs": [],
                "active_jobs": [],
                "income": income_snapshot(db, user),
                "department_postings": [dict(posting) for posting in DEPARTMENT_POSTINGS],
                "department_applications": [dict(row) for row in applications],
            },
        )

    def api_apply_department(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        payload = self.read_json()
        department_key = str(payload.get("department_key") or "").strip().lower()
        posting = next((item for item in DEPARTMENT_POSTINGS if item["key"] == department_key), None)
        if not posting:
            self.error(400, "Unknown department posting")
            return
        existing = one(
            db,
            """
            SELECT id, status
            FROM department_applications
            WHERE user_id = ? AND department_key = ? AND status NOT IN ('denied','withdrawn','closed')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user["id"], department_key),
        )
        if existing:
            self.error(409, f"You already have an active {posting['label']} application")
            return
        message_body = ""
        if posting.get("form_type") == "law_enforcement":
            try:
                statement, message_body = clean_law_enforcement_application(payload, posting, user)
            except ValueError as exc:
                self.error(400, str(exc))
                return
        elif posting.get("form_type") == "bar_exam":
            try:
                statement, message_body = clean_bar_exam_application(payload, posting, user)
            except ValueError as exc:
                self.error(400, str(exc))
                return
        else:
            statement = str(payload.get("statement") or "").strip()
            if len(statement) < 20:
                self.error(400, "Application statement must be at least 20 characters")
                return
            statement = statement[:4000]
            message_body = statement
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO department_applications
            (application_number, user_id, department_key, department_name, desired_role, status, statement, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
            RETURNING id, application_number
            """,
            (
                generate_record_number(db, "department_applications", "application_number", "DEPT"),
                user["id"],
                posting["key"],
                posting["division"],
                posting["role_key"],
                statement,
                ts,
                ts,
            ),
        ).fetchone()
        add_message(db, user["id"], "Department application submitted", f"Your {posting['label']} application {created['application_number']} was submitted for command review.")
        recipient_roles = posting_command_roles(posting)
        recipient_patterns = tuple(f"%{role}%" for role in recipient_roles)
        staff = all_rows(
            db,
            "SELECT id FROM users WHERE " + " OR ".join(["roles LIKE ?"] * len(recipient_patterns)) + " ORDER BY id LIMIT 120",
            recipient_patterns,
        )
        for row in staff:
            if row["id"] != user["id"]:
                add_message(
                    db,
                    row["id"],
                    "Department application pending",
                    f"{user['name']} applied for {posting['label']} ({created['application_number']}).\n\n{message_body}",
                    user["id"],
                )
        self.send_json(201, {"ok": True, "id": int(created["id"]), "application_number": created["application_number"]})

    def api_apply_job(self, db: Database, user: DbRow | None, job_id: int) -> None:
        self.error(410, "Passive income jobs have been removed from this server.")
        return

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
        game_bank = one(
            db,
            """
            SELECT b.* FROM arma_account_links l
            JOIN arma_game_bank_balances b ON b.identity_id = l.identity_id
            WHERE l.user_id = ?
            """,
            (user["id"],),
        )
        payload: dict[str, Any] = {
            "balance": round(float(game_bank["balance"] or 0), 2) if game_bank else 0,
            "balance_source": "FCRPMUSSALO",
            "balance_synced": bool(game_bank),
            "balance_synced_at": game_bank.get("synced_at") if game_bank else None,
            "income": income_snapshot(db, user),
            "transactions": [dict(row) for row in transactions],
            "can_manage_treasury": False,
        }
        if payload["can_manage_treasury"]:
            recent = all_rows(
                db,
                """
                SELECT tr.*, target.name AS user_name, target.civ_number AS user_civ_number, reviewer.name AS reviewer_name
                FROM treasury_requests tr
                JOIN users target ON target.id = tr.user_id
                LEFT JOIN users reviewer ON reviewer.id = tr.reviewer_id
                WHERE tr.status = 'paid'
                ORDER BY COALESCE(tr.decided_at, tr.updated_at) DESC
                LIMIT 40
                """,
            )
            staff_users = all_rows(
                db,
                "SELECT id, civ_number, name, email, bank_balance FROM users ORDER BY name LIMIT 500",
            )
            stats = {
                "paid_count": one(db, "SELECT COUNT(*) AS count FROM treasury_requests WHERE status = 'paid'")["count"],
                "pending_count": one(db, "SELECT COUNT(*) AS count FROM treasury_requests WHERE status = 'submitted'")["count"],
                "paid_total": round(float((one(db, "SELECT COALESCE(SUM(approved_amount), 0) AS total FROM treasury_requests WHERE status = 'paid'") or {}).get("total") or 0), 2),
            }
            payload.update(
                {
                    "treasury_recent": [treasury_row_payload(row, include_proofs=False) for row in recent],
                    "treasury_users": [dict(row) for row in staff_users],
                    "treasury_stats": stats,
                }
            )
        self.send_json(200, payload)

    def api_collect_bank(self, db: Database, user: DbRow | None) -> None:
        self.error(410, "Passive income collection has been removed from this server.")
        return

    def api_bank_treasury_adjust(self, db: Database, user: DbRow | None) -> None:
        self.error(410, "Railway bank adjustments are disabled. FCRPMUSSALO is the authoritative bank source.")

    def api_treasury(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        mine = all_rows(
            db,
            """
            SELECT tr.*, reviewer.name AS reviewer_name
            FROM treasury_requests tr
            LEFT JOIN users reviewer ON reviewer.id = tr.reviewer_id
            WHERE tr.user_id = ?
            ORDER BY tr.created_at DESC
            LIMIT 30
            """,
            (user["id"],),
        )
        payload: dict[str, Any] = {
            "stimulus_amount": TREASURY_STIMULUS_AMOUNT,
            "max_proofs": TREASURY_MAX_PROOFS,
            "my_requests": [treasury_row_payload(row, include_proofs=row.get("status") == "submitted") for row in mine],
            "can_review": admin_required(user) is None,
        }
        if payload["can_review"]:
            queue = all_rows(
                db,
                """
                SELECT tr.*, target.name AS user_name, target.email AS user_email, target.civ_number AS user_civ_number,
                       target.bank_balance AS user_bank_balance, reviewer.name AS reviewer_name
                FROM treasury_requests tr
                JOIN users target ON target.id = tr.user_id
                LEFT JOIN users reviewer ON reviewer.id = tr.reviewer_id
                ORDER BY CASE tr.status WHEN 'submitted' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, tr.updated_at DESC
                LIMIT 80
                """,
            )
            users = all_rows(db, "SELECT id, civ_number, name, email, bank_balance FROM users ORDER BY name LIMIT 500")
            payload.update(
                {
                    "review_queue": [treasury_row_payload(row, include_proofs=row.get("status") == "submitted") for row in queue],
                    "users": [dict(row) for row in users],
                }
            )
        self.send_json(200, payload)

    def api_create_treasury_request(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        request_type = str(payload.get("request_type") or "stimulus").strip().lower()
        if request_type not in ("stimulus", "wipe_compensation"):
            self.error(400, "Treasury request type is not supported")
            return
        proofs = clean_treasury_proofs(payload.get("proof_images"))
        proof_bypass = str(payload.get("proof_bypass", "")).lower() in ("1", "true", "yes", "on")
        if proof_bypass and not proofs:
            request_type = "stimulus"
            amount = TREASURY_STIMULUS_AMOUNT
        elif not proofs:
            self.error(400, "Upload screenshot proof, or check the no-proof stimulus request box for the standard $75,000 stimulus.")
            return
        elif request_type == "stimulus":
            amount = TREASURY_STIMULUS_AMOUNT
        else:
            amount = clean_treasury_amount(payload.get("requested_amount"))
        reason = str(payload.get("reason") or "").strip()[:1200]
        if not reason:
            reason = "No proof available - requesting standard Faircroft stimulus." if proof_bypass else "Server wipe compensation request with balance proof."
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO treasury_requests
            (request_number, user_id, request_type, requested_amount, status, reason, proof_images, proof_bypass, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)
            RETURNING id, request_number
            """,
            (
                generate_record_number(db, "treasury_requests", "request_number", "TRS"),
                user["id"],
                request_type,
                amount,
                reason,
                json.dumps(proofs, separators=(",", ":")),
                1 if proof_bypass else 0,
                ts,
                ts,
            ),
        ).fetchone()
        add_message(db, user["id"], "Treasury request filed", f"Faircroft Treasury received request {created['request_number']}.", None)
        staff = all_rows(
            db,
            "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ? ORDER BY id LIMIT 120",
            ('%"owner"%', '%"admin"%'),
        )
        for row in staff:
            if row["id"] != user["id"]:
                add_message(db, row["id"], "Treasury request pending", f"{user['name']} filed Treasury request {created['request_number']} for {amount:,.2f}.", user["id"])
        self.send_json(201, {"ok": True, "id": int(created["id"]), "request_number": created["request_number"]})

    def api_review_treasury_request(self, db: Database, user: DbRow | None, request_id: int) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        request = one(db, "SELECT * FROM treasury_requests WHERE id = ?", (request_id,))
        if not request:
            self.error(404, "Treasury request not found")
            return
        payload = self.read_json()
        status = str(payload.get("status") or payload.get("action") or "").strip().lower()
        notes = str(payload.get("reviewer_notes") or payload.get("notes") or "").strip()[:1200]
        ts = now_iso()
        if status in ("approve", "approved", "pay", "paid"):
            self.error(410, "Treasury bank deposits are disabled while FCRPMUSSALO is authoritative. Apply the payment in-game.")
            return
        if status in ("deny", "denied"):
            if request["status"] == "paid":
                self.error(409, "Paid Treasury requests cannot be denied")
                return
            db.execute(
                """
                UPDATE treasury_requests
                SET status = 'denied', approved_amount = 0, reviewer_id = ?, reviewer_notes = ?, updated_at = ?, decided_at = ?
                WHERE id = ?
                """,
                (user["id"], notes, ts, ts, request_id),
            )
            add_message(db, request["user_id"], "Faircroft Treasury denied", f"Request {request['request_number']} was denied. {notes}".strip(), user["id"])
            self.send_json(200, {"ok": True, "status": "denied"})
            return
        self.error(400, "Treasury review status must be approve or deny")

    def api_cash_transfer(self, db: Database, user: DbRow | None) -> None:
        self.error(410, "Website transfers are disabled. Use the in-game banking system.")

    def api_dmv_me(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        apply_auto_license_approval(db)
        settings = get_system_settings(db)
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
        server_now = utcnow()
        application_payload = []
        approval_minutes = int(settings["autopilot_license_minutes"])
        for application in applications:
            item = dict(application)
            if settings["autopilot_license_enabled"] and item.get("status") in ("submitted", "pending", "under_review"):
                approval_at = parse_iso(item["created_at"]) + dt.timedelta(minutes=approval_minutes)
                item["approval_at"] = approval_at.isoformat()
                item["approval_remaining_seconds"] = max(0, int((approval_at - server_now).total_seconds()))
            else:
                item["approval_at"] = ""
                item["approval_remaining_seconds"] = 0
            application_payload.append(item)
        self.send_json(
            200,
            {
                "record": dict(record),
                "vehicles": vehicles,
                "license_applications": application_payload,
                "license_autopilot": {
                    "enabled": settings["autopilot_license_enabled"],
                    "minutes": approval_minutes,
                    "server_time": server_now.isoformat(),
                },
            },
        )

    def api_dmv_update(self, db: Database, user: DbRow | None) -> None:
        err = verified_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        if get_system_settings(db)["update_lockdown_enabled"]:
            self.error(423, "DMV vehicle updates are locked during system update mode")
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
        if get_system_settings(db)["update_lockdown_enabled"]:
            self.error(423, "Vehicle registration is locked during system update mode")
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
        tax_anchor = parse_iso(str(row.get("tax_last_assessed_at") or row.get("created_at") or now_iso()))
        accrued_weeks = max(0, int((utcnow() - tax_anchor).total_seconds() // (7 * 24 * 60 * 60)))
        weekly_tax = round(float(row["weekly_tax"] or 0), 2)
        payload = {
            **dict(row),
            "startup_budget": round(float(row["startup_budget"] or 0), 2),
            "weekly_tax": weekly_tax,
            "planned_employees": int(row["planned_employees"] or 0),
            "activity_requirement_minutes": int(row["activity_requirement_minutes"] or 0),
            "reputation_score": int(row["reputation_score"] or 0),
            "insurance_required": bool(row["insurance_required"]),
            "open_violations": int(row.get("open_violations") or 0),
            "inspection_count": int(row.get("inspection_count") or 0),
        }
        if row.get("identity_id"):
            payload.update(
                {
                    "unpaid_tax": round(float(row.get("unpaid_tax") or 0), 2),
                    "accrued_tax": round(weekly_tax * accrued_weeks, 2),
                    "accrued_weeks": accrued_weeks,
                    "tax_available_at": (tax_anchor + dt.timedelta(days=7)).isoformat(),
                }
            )
        return payload

    def business_staff_rows(self, db: Database) -> list[DbRow]:
        return all_rows(
            db,
            """
            SELECT id FROM users
            WHERE roles LIKE ? OR roles LIKE ? OR roles LIKE ? OR roles LIKE ? OR roles LIKE ?
            """,
            ("%owner%", "%admin%", "%business_registrar%", "%city_hall%", "%economy_manager%"),
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

    def api_create_business_tax(self, db: Database, user: DbRow | None, business_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        business = one(db, "SELECT * FROM businesses WHERE id = ?", (business_id,))
        if not business:
            self.error(404, "Business license not found")
            return
        payload = self.read_json()
        anchor = parse_iso(str(business.get("tax_last_assessed_at") or business.get("created_at") or now_iso()))
        assessed_at = utcnow()
        accrued_weeks = max(0, int((assessed_at - anchor).total_seconds() // (7 * 24 * 60 * 60)))
        weekly_tax = round(float(business["weekly_tax"] or 0), 2)
        amount = round(weekly_tax * accrued_weeks, 2)
        if accrued_weeks < 1 or amount <= 0:
            available_at = anchor + dt.timedelta(days=7)
            self.error(409, f"No full weekly tax period has accrued. Next assessment: {available_at.isoformat()}")
            return
        period_end = anchor + dt.timedelta(days=7 * accrued_weeks)
        period_label = f"{accrued_weeks} week(s): {anchor.date().isoformat()} through {period_end.date().isoformat()}"
        created = db.execute(
            """
            INSERT INTO business_tax_assessments
            (business_id, amount, period_label, notes, assessed_by, assessed_at)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (business_id, amount, period_label, str(payload.get("notes") or "").strip()[:1200], user["id"], assessed_at.isoformat()),
        ).fetchone()
        db.execute("UPDATE businesses SET tax_last_assessed_at = ?, updated_at = ? WHERE id = ?", (period_end.isoformat(), assessed_at.isoformat(), business_id))
        add_message(db, business["owner_id"], "Business tax assessed", f"{business['business_name']} received a {amount:.2f} tax assessment for {period_label}.", user["id"])
        add_admin_audit(db, int(user["id"]), "business.tax.assessed", int(business["owner_id"]), {"business_id": business_id, "amount": amount, "period": period_label})
        self.send_json(201, {"ok": True, "id": int(created["id"])})

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
        self.error(410, "Website bank purchases are disabled. Complete this purchase through the in-game economy.")

    def my_faircroft_payload(self, db: Database, user: DbRow) -> dict[str, Any]:
        cases = all_rows(
            db,
            """
            SELECT c.*, catalog.kind, officer.name AS officer_name, judge.name AS judge_name,
                   settlement.status AS payment_item_status, batch.status AS payment_batch_status,
                   batch.batch_number AS payment_batch_number, batch.created_at AS payment_requested_at
            FROM citations c
            JOIN charge_catalog catalog ON catalog.id = c.charge_id
            JOIN users officer ON officer.id = c.officer_id
            LEFT JOIN users judge ON judge.id = c.judge_id
            LEFT JOIN fine_settlement_items settlement ON settlement.citation_id = c.id
            LEFT JOIN fine_settlement_batches batch ON batch.id = settlement.batch_id
            WHERE c.civ_id = ?
            ORDER BY c.created_at DESC
            """,
            (user["id"],),
        )
        taxes = all_rows(
            db,
            """
            SELECT tax.*, business.business_name, business.license_number,
                   item.status AS payment_item_status, batch.status AS payment_batch_status,
                   batch.batch_number AS payment_batch_number, batch.created_at AS payment_requested_at
            FROM business_tax_assessments tax
            JOIN businesses business ON business.id = tax.business_id
            LEFT JOIN business_tax_settlement_items item
                   ON item.batch_id = tax.settlement_batch_id AND item.business_id = tax.business_id
            LEFT JOIN business_tax_settlement_batches batch ON batch.id = tax.settlement_batch_id
            WHERE business.owner_id = ?
            ORDER BY tax.assessed_at DESC
            """,
            (user["id"],),
        )
        record_requests = all_rows(
            db,
            """
            SELECT r.*, c.charge_code, c.charge_title
            FROM court_record_requests r
            JOIN citations c ON c.id = r.citation_id
            WHERE r.civ_id = ?
            ORDER BY r.created_at DESC
            """,
            (user["id"],),
        )
        case_payload = [dict(row) for row in cases]
        tax_payload = [dict(row) for row in taxes]
        outstanding_fines = [
            item
            for item in case_payload
            if item["status"] not in ("paid", "dismissed")
            and item.get("disposition") not in NONPAYABLE_DISPOSITIONS
            and float(item.get("fine_amount") or 0) > 0
        ]
        outstanding_taxes = [item for item in tax_payload if item["status"] == "unpaid"]
        pending_fine_ids = {
            int(item["id"])
            for item in outstanding_fines
            if item.get("payment_batch_status") not in (None, "completed", "cancelled")
        }
        pending_tax_ids = {
            int(item["id"])
            for item in outstanding_taxes
            if item.get("payment_batch_status") not in (None, "completed", "cancelled")
        }
        return {
            "cases": case_payload,
            "record_requests": [dict(item) for item in record_requests],
            "taxes": tax_payload,
            "bank": public_user_with_game_bank(db, user),
            "summary": {
                "outstanding_fines": round(sum(float(item["fine_amount"] or 0) for item in outstanding_fines), 2),
                "outstanding_taxes": round(sum(float(item["amount"] or 0) for item in outstanding_taxes), 2),
                "open_cases": sum(1 for item in case_payload if item["status"] in ACTIVE_CASE_STATUSES),
                "pending_payments": len(pending_fine_ids) + len(pending_tax_ids),
            },
        }

    def api_my_faircroft(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        self.send_json(200, self.my_faircroft_payload(db, user))

    def api_my_cases(self, db: Database, user: DbRow | None) -> None:
        err = court_access_required(db, user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.my_faircroft_payload(db, user)
        active = [item for item in payload["cases"] if item["status"] in ACTIVE_CASE_STATUSES]
        previous = [item for item in payload["cases"] if item["status"] not in ACTIVE_CASE_STATUSES]
        self.send_json(
            200,
            {
                "cases": active,
                "defendant": {"active": active, "previous": previous},
                "officer": {"active": [], "previous": []},
                "judge": None,
            },
        )

    def api_pay_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        case = one(
            db,
            """
            SELECT c.*, settlement.id AS settlement_item_id, batch.batch_number AS existing_batch_number,
                   link.identity_id, bank.balance
            FROM citations c
            LEFT JOIN fine_settlement_items settlement ON settlement.citation_id = c.id
            LEFT JOIN fine_settlement_batches batch ON batch.id = settlement.batch_id
            LEFT JOIN arma_account_links link ON link.user_id = c.civ_id
            LEFT JOIN arma_game_bank_balances bank ON bank.identity_id = link.identity_id
            WHERE c.id = ? AND c.civ_id = ?
            """,
            (case_id, user["id"]),
        )
        if not case:
            self.error(404, "Fine not found")
            return
        if case["status"] in ("paid", "dismissed") or case.get("disposition") in NONPAYABLE_DISPOSITIONS:
            self.error(409, "This case has no payable fine")
            return
        if case["status"] == "contested":
            self.error(409, "This citation is contested. Wait for a court decision before requesting payment.")
            return
        fine = round(float(case["fine_amount"] or 0), 2)
        if fine <= 0:
            self.error(409, "This case has no payable balance")
            return
        if case.get("settlement_item_id"):
            self.error(409, f"Payment already requested in {case.get('existing_batch_number') or 'an existing settlement'}")
            return
        if not case.get("identity_id") or case.get("balance") is None:
            self.error(409, "Link your Arma account and wait for a synced game-bank balance before paying")
            return
        pending_fine = one(
            db,
            """
            SELECT batch.batch_number
            FROM fine_settlement_items item
            JOIN fine_settlement_batches batch ON batch.id = item.batch_id
            WHERE item.identity_id = ? AND batch.status NOT IN ('completed', 'cancelled')
            LIMIT 1
            """,
            (case["identity_id"],),
        )
        pending_tax = one(
            db,
            """
            SELECT batch.batch_number
            FROM business_tax_settlement_items item
            JOIN business_tax_settlement_batches batch ON batch.id = item.batch_id
            WHERE item.identity_id = ? AND batch.status NOT IN ('completed', 'cancelled')
            LIMIT 1
            """,
            (case["identity_id"],),
        )
        pending_batch = pending_fine or pending_tax
        if pending_batch:
            self.error(409, f"Complete existing payment request {pending_batch['batch_number']} before starting another")
            return
        balance = round(float(case["balance"]), 2)
        if balance < fine:
            self.error(409, f"Insufficient synced game-bank funds. Required ${fine:,.2f}; available ${balance:,.2f}")
            return
        created_at = utcnow()
        batch_number = f"FC-PAY-{created_at.strftime('%Y%m%d')}-{secrets.randbelow(900000) + 100000}"
        batch = db.execute(
            """
            INSERT INTO fine_settlement_batches (batch_number, created_by, created_at, notes)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (batch_number, user["id"], created_at.isoformat(), f"MyFaircroft payment request for court case #{case_id}"),
        ).fetchone()
        db.execute(
            """
            INSERT INTO fine_settlement_items
            (batch_id, citation_id, user_id, identity_id, fine_amount, balance_before, expected_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (batch["id"], case_id, user["id"], case["identity_id"], fine, balance, round(balance - fine, 2)),
        )
        for staff in all_rows(db, "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?", ("%owner%", "%dev%")):
            add_message(db, staff["id"], "MyFaircroft fine payment", f"{user['name']} requested payment of ${fine:,.2f} for case #{case_id}. Batch {batch_number}.", user["id"])
        add_admin_audit(db, int(user["id"]), "myfaircroft.fine.payment_requested", int(user["id"]), {"case_id": case_id, "batch_number": batch_number, "amount": fine})
        self.send_json(201, {"ok": True, "batch_number": batch_number, "amount": fine})

    def api_pay_business_tax(self, db: Database, user: DbRow | None, business_id: int) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        existing = one(
            db,
            """
            SELECT batch.batch_number
            FROM business_tax_assessments tax
            JOIN businesses business ON business.id = tax.business_id
            JOIN business_tax_settlement_batches batch ON batch.id = tax.settlement_batch_id
            WHERE business.id = ? AND business.owner_id = ? AND tax.status = 'unpaid'
            LIMIT 1
            """,
            (business_id, user["id"]),
        )
        if existing:
            self.error(409, f"Tax payment already requested in {existing['batch_number']}")
            return
        account = one(
            db,
            """
            SELECT business.id AS business_id, business.business_name, business.license_number,
                   link.identity_id, bank.balance, SUM(tax.amount) AS tax_amount
            FROM businesses business
            JOIN business_tax_assessments tax ON tax.business_id = business.id
            LEFT JOIN arma_account_links link ON link.user_id = business.owner_id
            LEFT JOIN arma_game_bank_balances bank ON bank.identity_id = link.identity_id
            WHERE business.id = ? AND business.owner_id = ?
              AND tax.status = 'unpaid' AND tax.settlement_batch_id IS NULL
            GROUP BY business.id, business.business_name, business.license_number, link.identity_id, bank.balance
            """,
            (business_id, user["id"]),
        )
        if not account or float(account.get("tax_amount") or 0) <= 0:
            self.error(404, "No unpaid tax balance was found for this business")
            return
        amount = round(float(account["tax_amount"]), 2)
        if not account.get("identity_id") or account.get("balance") is None:
            self.error(409, "Link your Arma account and wait for a synced game-bank balance before paying")
            return
        pending_fine = one(
            db,
            """
            SELECT batch.batch_number
            FROM fine_settlement_items item
            JOIN fine_settlement_batches batch ON batch.id = item.batch_id
            WHERE item.identity_id = ? AND batch.status NOT IN ('completed', 'cancelled')
            LIMIT 1
            """,
            (account["identity_id"],),
        )
        pending_tax = one(
            db,
            """
            SELECT batch.batch_number
            FROM business_tax_settlement_items item
            JOIN business_tax_settlement_batches batch ON batch.id = item.batch_id
            WHERE item.identity_id = ? AND batch.status NOT IN ('completed', 'cancelled')
            LIMIT 1
            """,
            (account["identity_id"],),
        )
        pending_batch = pending_fine or pending_tax
        if pending_batch:
            self.error(409, f"Complete existing payment request {pending_batch['batch_number']} before starting another")
            return
        balance = round(float(account["balance"]), 2)
        if balance < amount:
            self.error(409, f"Insufficient synced game-bank funds. Required ${amount:,.2f}; available ${balance:,.2f}")
            return
        created_at = utcnow()
        batch_number = f"FC-TAX-{created_at.strftime('%Y%m%d')}-{secrets.randbelow(900000) + 100000}"
        batch = db.execute(
            """
            INSERT INTO business_tax_settlement_batches (batch_number, created_by, created_at, notes)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (batch_number, user["id"], created_at.isoformat(), f"MyFaircroft tax payment for {account['business_name']}"),
        ).fetchone()
        db.execute(
            """
            INSERT INTO business_tax_settlement_items
            (batch_id, business_id, user_id, identity_id, tax_amount, balance_before, expected_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (batch["id"], business_id, user["id"], account["identity_id"], amount, balance, round(balance - amount, 2)),
        )
        db.execute(
            """
            UPDATE business_tax_assessments SET settlement_batch_id = ?
            WHERE business_id = ? AND status = 'unpaid' AND settlement_batch_id IS NULL
            """,
            (batch["id"], business_id),
        )
        for staff in all_rows(db, "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?", ("%owner%", "%dev%")):
            add_message(db, staff["id"], "MyFaircroft tax payment", f"{user['name']} requested payment of ${amount:,.2f} for {account['business_name']}. Batch {batch_number}.", user["id"])
        add_admin_audit(db, int(user["id"]), "myfaircroft.tax.payment_requested", int(user["id"]), {"business_id": business_id, "batch_number": batch_number, "amount": amount})
        self.send_json(201, {"ok": True, "batch_number": batch_number, "amount": amount})

    def api_contest_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        case = one(db, "SELECT * FROM citations WHERE id = ? AND civ_id = ?", (case_id, user["id"]))
        if not case:
            self.error(404, "Case not found")
            return
        if case["status"] not in ("issued", "reviewed", "reduced"):
            self.error(409, "This case can no longer be contested")
            return
        if one(db, "SELECT id FROM fine_settlement_items WHERE citation_id = ?", (case_id,)):
            self.error(409, "A payment request already exists for this fine")
            return
        db.execute("UPDATE citations SET status = 'contested', disposition = '', updated_at = ? WHERE id = ?", (now_iso(), case_id))
        judges = all_rows(db, "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?", ("%judge%", "%owner%"))
        for judge in judges:
            if int(judge["id"]) != int(user["id"]):
                add_message(db, judge["id"], "Citation contested", f"{user['name']} contested {case['charge_code']} - {case['charge_title']}.", user["id"])
        self.send_json(200, {"ok": True})

    def api_create_record_request(self, db: Database, user: DbRow | None, case_id: int, request_type: str) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        case = one(db, "SELECT * FROM citations WHERE id = ? AND civ_id = ?", (case_id, user["id"]))
        if not case:
            self.error(404, "Court record not found")
            return
        if not case.get("decided_at") or case["status"] in ACTIVE_CASE_STATUSES:
            self.error(409, "A final court decision is required before filing this request")
            return
        if case.get("record_expunged_at"):
            self.error(409, "This record has already been expunged")
            return
        existing = one(
            db,
            "SELECT id FROM court_record_requests WHERE citation_id = ? AND request_type = ? AND status = 'pending'",
            (case_id, request_type),
        )
        if existing:
            self.error(409, f"A pending {request_type} request already exists")
            return
        payload = self.read_json()
        reason = str(payload.get("reason") or "").strip()
        supporting_statement = str(payload.get("supporting_statement") or "").strip()
        if len(reason) < 20:
            self.error(400, "Explain the basis for this request in at least 20 characters")
            return
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO court_record_requests
            (citation_id, civ_id, request_type, reason, supporting_statement, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (case_id, user["id"], request_type, reason[:2000], supporting_statement[:3000], ts, ts),
        ).fetchone()
        for judge in all_rows(db, "SELECT id FROM users WHERE roles LIKE ? OR roles LIKE ?", ("%judge%", "%owner%")):
            if int(judge["id"]) != int(user["id"]):
                add_message(db, judge["id"], f"New {request_type} petition", f"{user['name']} filed a {request_type} request for case #{case_id}.", user["id"])
        self.send_json(201, {"ok": True, "request_id": int(created["id"]), "status": "pending"})

    def api_update_record_request(self, db: Database, user: DbRow | None, request_id: int) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        request = one(
            db,
            """
            SELECT r.*, c.charge_code, c.charge_title, c.officer_id
            FROM court_record_requests r
            JOIN citations c ON c.id = r.citation_id
            WHERE r.id = ?
            """,
            (request_id,),
        )
        if not request:
            self.error(404, "Court petition not found")
            return
        conflict_roles = []
        if int(request["civ_id"]) == int(user["id"]):
            conflict_roles.append("petitioner/defendant")
        if int(request["officer_id"]) == int(user["id"]):
            conflict_roles.append("filing officer")
        if conflict_roles:
            self.error(403, f"Conflict of interest: you are the {' and '.join(conflict_roles)} in the underlying case and cannot decide this petition")
            return
        if request["status"] != "pending":
            self.error(409, "This petition has already been decided")
            return
        payload = self.read_json()
        decision = str(payload.get("decision") or "").strip().lower()
        if decision not in ("approved", "denied"):
            self.error(400, "Select approve or deny")
            return
        notes = str(payload.get("decision_notes") or "").strip()
        if len(notes) < 3:
            self.error(400, "Judicial decision notes are required")
            return
        ts = now_iso()
        db.execute(
            """
            UPDATE court_record_requests
            SET status = ?, judge_id = ?, decision_notes = ?, decided_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (decision, user["id"], notes[:2000], ts, ts, request_id),
        )
        if decision == "approved" and request["request_type"] == "expungement":
            db.execute(
                "UPDATE citations SET record_expunged_at = ?, record_expunged_by = ?, updated_at = ? WHERE id = ?",
                (ts, user["id"], ts, request["citation_id"]),
            )
        elif decision == "approved" and request["request_type"] == "appeal":
            db.execute(
                "UPDATE citations SET status = 'contested', disposition = 'under_review', updated_at = ? WHERE id = ?",
                (ts, request["citation_id"]),
            )
        add_message(db, request["civ_id"], f"{request['request_type'].title()} petition {decision}", f"Case #{request['citation_id']}: {notes}", user["id"])
        self.send_json(200, {"ok": True, "status": decision})

    def api_judge_cases(self, db: Database, user: DbRow | None) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        base_query = """
            SELECT c.*, catalog.kind, civ.name AS civ_name, civ.email AS civ_email,
                   civ.civ_number, officer.name AS officer_name, judge.name AS judge_name
            FROM citations c
            JOIN charge_catalog catalog ON catalog.id = c.charge_id
            JOIN users civ ON civ.id = c.civ_id
            JOIN users officer ON officer.id = c.officer_id
            LEFT JOIN users judge ON judge.id = c.judge_id
        """
        if has_any(user, "owner"):
            scope = "TRUE"
            params: tuple[Any, ...] = ()
        else:
            scope = "(c.judge_id = ? OR c.judge_id IS NULL)"
            params = (user["id"],)
        active = all_rows(
            db,
            f"""
            {base_query}
            WHERE {scope} AND {case_status_clause(True)}
            ORDER BY CASE c.status WHEN 'contested' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END,
                     c.court_date ASC NULLS LAST, c.created_at ASC
            LIMIT 160
            """,
            params,
        )
        decided = all_rows(
            db,
            f"""
            {base_query}
            WHERE {scope} AND {case_status_clause(False)}
            ORDER BY c.decided_at DESC NULLS LAST, c.updated_at DESC
            LIMIT 160
            """,
            params,
        )
        standards = all_rows(
            db,
            """
            SELECT severity, minimum_sentence_minutes, maximum_sentence_minutes, COUNT(*) AS code_count
            FROM charge_catalog
            WHERE kind = 'criminal'
            GROUP BY severity, minimum_sentence_minutes, maximum_sentence_minutes
            ORDER BY maximum_sentence_minutes, minimum_sentence_minutes, severity
            """,
        )
        petitions = all_rows(
            db,
            """
            SELECT r.*, c.charge_code, c.charge_title, c.final_result, c.officer_id,
                   civ.name AS civ_name, civ.civ_number, officer.name AS officer_name,
                   judge.name AS judge_name
            FROM court_record_requests r
            JOIN citations c ON c.id = r.citation_id
            JOIN users civ ON civ.id = r.civ_id
            JOIN users officer ON officer.id = c.officer_id
            LEFT JOIN users judge ON judge.id = r.judge_id
            ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
            LIMIT 160
            """
        )
        def court_conflict(row: DbRow) -> dict[str, Any]:
            item = dict(row)
            reasons = []
            if int(item["civ_id"]) == int(user["id"]):
                reasons.append("You are the defendant in this case")
            if int(item["officer_id"]) == int(user["id"]):
                reasons.append("You filed or issued this case")
            item["conflict_of_interest"] = bool(reasons)
            item["conflict_reasons"] = reasons
            return item

        active_payload = [court_conflict(row) for row in active]
        decided_payload = [court_conflict(row) for row in decided]
        petition_payload = [court_conflict(row) for row in petitions]
        self.send_json(
            200,
            {
                "active": active_payload,
                "decided": decided_payload,
                "standards": [dict(row) for row in standards],
                "petitions": petition_payload,
                "stats": {
                    "active": len(active),
                    "contested": sum(1 for row in active if row["status"] == "contested"),
                    "criminal": sum(1 for row in active if row["kind"] == "criminal"),
                    "decided": len(decided),
                    "petitions": sum(1 for row in petitions if row["status"] == "pending"),
                    "conflicts": sum(1 for row in active_payload if row["conflict_of_interest"]),
                },
            },
        )

    def api_update_case(self, db: Database, user: DbRow | None, case_id: int) -> None:
        err = judge_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        case = one(
            db,
            """
            SELECT c.*, catalog.kind
            FROM citations c
            JOIN charge_catalog catalog ON catalog.id = c.charge_id
            WHERE c.id = ?
            """,
            (case_id,),
        )
        if not case:
            self.error(404, "Court case not found")
            return
        conflict_roles = []
        if int(case["civ_id"]) == int(user["id"]):
            conflict_roles.append("defendant")
        if int(case["officer_id"]) == int(user["id"]):
            conflict_roles.append("filing/issuing officer")
        if conflict_roles:
            self.error(403, f"Conflict of interest: you are the {' and '.join(conflict_roles)} in this case and cannot perform judicial action")
            return
        payload = self.read_json()
        disposition = str(payload.get("disposition") or "").strip().lower()
        if not disposition:
            legacy_status = str(payload.get("status") or "").strip().lower()
            disposition = {
                "reviewed": "under_review",
                "reduced": "liable",
                "dismissed": "dismissed",
                "closed": "liable" if case["kind"] == "citation" else "guilty",
            }.get(legacy_status, legacy_status)
        if disposition not in COURT_DISPOSITIONS:
            self.error(400, "Select a valid court disposition")
            return
        if case["kind"] == "citation" and disposition in CONVICTION_DISPOSITIONS:
            self.error(400, "Traffic and civil citations use a liable or not-liable disposition")
            return
        if case["kind"] == "criminal" and disposition == "liable":
            self.error(400, "Criminal matters require a guilty, plea agreement, not guilty, or dismissal disposition")
            return
        try:
            amount = round(float(payload.get("fine_amount", case["fine_amount"])), 2)
            sentence_minutes = int(payload.get("sentence_minutes") or 0)
        except (TypeError, ValueError):
            self.error(400, "Fine and sentence must be valid numbers")
            return
        if amount < 0 or sentence_minutes < 0:
            self.error(400, "Fine and sentence cannot be negative")
            return
        minimum = int(case.get("minimum_sentence_minutes") or 0)
        maximum = int(case.get("maximum_sentence_minutes") or 0)
        if case["kind"] == "citation" and sentence_minutes:
            self.error(400, "Citations cannot carry a custodial RP sentence")
            return
        if disposition in CONVICTION_DISPOSITIONS:
            if sentence_minutes < minimum:
                self.error(400, f"Mandatory RP minimum is {minimum} minute(s) for this charge")
                return
            if maximum > 0 and sentence_minutes > maximum:
                self.error(400, f"RP sentence cannot exceed the {maximum}-minute guideline maximum")
                return
        else:
            sentence_minutes = 0
        notes = str(payload.get("judgment_notes") or "").strip()[:2000]
        sentence_notes = str(payload.get("sentence_notes") or "").strip()[:1200]
        final_decision = disposition not in ("under_review", "continued")
        court_date = str(payload.get("court_date") or case.get("court_date") or "").strip()
        if disposition == "continued":
            if not court_date:
                self.error(400, "Select the next court date before continuing this hearing")
                return
            try:
                scheduled_date = dt.date.fromisoformat(court_date)
            except ValueError:
                self.error(400, "Select a valid next court date")
                return
            if scheduled_date < utcnow().date():
                self.error(400, "The continued hearing date cannot be in the past")
                return
        if final_decision and len(notes) < 3:
            self.error(400, "A short written finding is required for a final decision")
            return
        payment = one(
            db,
            """
            SELECT item.id AS item_id, item.status AS item_status, batch.id AS batch_id, batch.status AS batch_status
            FROM fine_settlement_items item
            JOIN fine_settlement_batches batch ON batch.id = item.batch_id
            WHERE item.citation_id = ?
            """,
            (case_id,),
        )
        fine_changed = abs(amount - float(case["fine_amount"] or 0)) > 0.009
        void_payment = disposition in NONPAYABLE_DISPOSITIONS or fine_changed
        if payment and void_payment:
            if payment["item_status"] == "paid" or payment["batch_status"] == "completed":
                self.error(409, "This fine was already settled; staff review is required before changing the decision")
                return
            if payment["batch_status"] != "draft":
                self.error(409, "This fine has an approved settlement in progress and cannot be changed")
                return
            db.execute("DELETE FROM fine_settlement_items WHERE id = ?", (payment["item_id"],))
            db.execute("UPDATE fine_settlement_batches SET status = 'cancelled', completed_at = ? WHERE id = ?", (now_iso(), payment["batch_id"]))
        status = {
            "under_review": "reviewed",
            "continued": "continued",
            "not_guilty": "dismissed",
            "dismissed": "dismissed",
        }.get(disposition, "closed")
        decided_at = now_iso() if final_decision else None
        final_result = court_decision_result(disposition, amount, sentence_minutes, notes) if final_decision else ""
        saved_case = db.execute(
            """
            UPDATE citations
            SET status = ?, disposition = ?, fine_amount = ?, sentence_minutes = ?, sentence_notes = ?,
                judgment_notes = ?, judge_id = ?, final_result = ?, decided_at = ?, court_date = ?, updated_at = ?
            WHERE id = ?
            RETURNING id, status, disposition, final_result, decided_at, court_date
            """,
            (
                status,
                disposition,
                amount,
                sentence_minutes,
                sentence_notes,
                notes,
                user["id"],
                final_result,
                decided_at,
                court_date,
                now_iso(),
                case_id,
            ),
        ).fetchone()
        if not saved_case:
            self.error(409, "The court action could not be saved; refresh the docket and try again")
            return
        if final_decision and saved_case["status"] in ACTIVE_CASE_STATUSES:
            raise RuntimeError(f"Final court decision for case {case_id} remained active")
        if final_decision and case["kind"] == "criminal":
            booking_status = "sentenced" if disposition in CONVICTION_DISPOSITIONS else "released"
            db.execute(
                "UPDATE mdt_bookings SET status = ?, release_notes = ?, updated_at = ?, completed_at = ? WHERE court_case_id = ?",
                (booking_status, final_result, now_iso(), now_iso(), case_id),
            )
        action_result = final_result or (f"Hearing continued to {court_date}" if disposition == "continued" else disposition.replace("_", " "))
        add_message(db, case["civ_id"], "Court date issued" if disposition == "continued" else "Court decision updated", f"Case #{case_id} / {case['charge_code']}: {action_result}. Open MyFaircroft for your record.", user["id"])
        add_message(db, case["officer_id"], "Court date issued" if disposition == "continued" else "Officer case updated", f"Case #{case_id} / {case['charge_code']}: {action_result}.", user["id"])
        add_admin_audit(db, int(user["id"]), "court.case.decided" if final_decision else "court.case.updated", int(case["civ_id"]), {"case_id": case_id, "disposition": disposition, "court_date": court_date, "sentence_minutes": sentence_minutes, "fine_amount": amount})
        self.send_json(
            200,
            {
                "ok": True,
                "status": saved_case["status"],
                "disposition": saved_case["disposition"],
                "final_result": saved_case["final_result"],
                "decided_at": saved_case["decided_at"],
                "court_date": saved_case["court_date"],
                "final_decision": final_decision,
                "docket": "completed" if final_decision else "active",
            },
        )

    def api_mdt_search(self, db: Database, user: DbRow | None, query: dict[str, list[str]]) -> None:
        err = emergency_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        term = (query.get("q") or [""])[0].strip()
        if len(term) < 2:
            self.send_json(200, {"results": []})
            return
        like = f"%{term}%"
        can_view_account_email = bool(user and has_any(user, "owner", "admin"))
        email_column = ", u.email" if can_view_account_email else ""
        email_filter = " OR u.email ILIKE ?" if can_view_account_email else ""
        search_params = (like, like, like, like, like, like) if can_view_account_email else (like, like, like, like, like)
        rows = all_rows(
            db,
            f"""
            SELECT u.id, u.civ_number, u.name{email_column}, u.verified, u.roles, u.car_entry_code, u.callsign, d.license_status, d.license_class, d.vehicle_make,
                   d.vehicle_model, d.vehicle_color, d.plate, d.registration_status, d.insurance_status
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            WHERE u.name ILIKE ? OR u.civ_number ILIKE ? OR u.car_entry_code ILIKE ? OR d.plate ILIKE ?
               OR EXISTS (SELECT 1 FROM dmv_vehicles v WHERE v.user_id = u.id AND v.plate ILIKE ?)
               {email_filter}
            ORDER BY u.name
            LIMIT 25
            """,
            search_params,
        )
        results = []
        for row in rows:
            warrants = all_rows(
                db,
                "SELECT id, charge_code, charge_title, status, fine_amount FROM citations WHERE civ_id = ? AND record_expunged_at IS NULL AND status IN ('issued', 'contested', 'reviewed', 'reduced') ORDER BY created_at DESC LIMIT 10",
                (row["id"],),
            )
            criminal_record = all_rows(
                db,
                """
                SELECT c.id, c.charge_code, c.charge_title, c.severity, c.disposition, c.final_result,
                       c.sentence_minutes, c.decided_at, judge.name AS judge_name
                FROM citations c
                JOIN charge_catalog catalog ON catalog.id = c.charge_id
                LEFT JOIN users judge ON judge.id = c.judge_id
                WHERE c.civ_id = ? AND catalog.kind = 'criminal' AND c.decided_at IS NOT NULL
                  AND c.record_expunged_at IS NULL
                ORDER BY c.decided_at DESC
                LIMIT 30
                """,
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
            user_warrants = all_rows(
                db,
                """
                SELECT w.*, creator.name AS creator_name, i.case_number
                FROM cid_warrants w
                JOIN users creator ON creator.id = w.created_by
                LEFT JOIN cid_investigations i ON i.id = w.investigation_id
                WHERE w.subject_civ_id = ?
                ORDER BY CASE w.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, w.updated_at DESC
                LIMIT 20
                """,
                (row["id"],),
            )
            booking_rows = all_rows(
                db,
                """
                SELECT b.*, officer.name AS officer_name, c.status AS court_status
                FROM mdt_bookings b
                JOIN users officer ON officer.id = b.officer_id
                LEFT JOIN citations c ON c.id = b.court_case_id
                WHERE b.civ_id = ?
                ORDER BY CASE WHEN b.status IN ('intake','booked','holding','ready_for_court') THEN 0 ELSE 1 END,
                         b.updated_at DESC
                LIMIT 20
                """,
                (row["id"],),
            )
            item = dict(row)
            if not can_view_account_email:
                item.pop("email", None)
            item["roles"] = roles_for(row)
            item["open_cases"] = [dict(w) for w in warrants]
            item["criminal_record"] = [dict(record) for record in criminal_record]
            item["vehicles"] = vehicles
            item["license_applications"] = applications
            item["warrants"] = [dict(warrant) for warrant in user_warrants]
            item["bookings"] = [dict(booking) for booking in booking_rows]
            results.append(item)
        self.send_json(200, {"results": results})

    def api_mdt_charges(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(db, "SELECT * FROM charge_catalog ORDER BY kind DESC, category, code")
        catalog = [dict(row) for row in rows]
        civilians = all_rows(
            db,
            """
            SELECT u.id, u.civ_number, u.name, u.verified, d.license_status, d.license_class
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            ORDER BY u.name
            """
        )
        self.send_json(
            200,
            {
                "charges": catalog,
                "citations": [row for row in catalog if row.get("kind") == "citation"],
                "criminal_charges": [row for row in catalog if row.get("kind") == "criminal"],
                "civilians": civilians,
            },
        )

    def api_mdt_update_license(self, db: Database, user: DbRow | None, target_id: int) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        status = str(payload.get("status") or "Suspended").strip()[:30]
        if status != "Suspended":
            self.error(400, "Only license suspension is supported from the MDT")
            return
        target = one(
            db,
            """
            SELECT u.id, u.name, d.license_status, d.license_class
            FROM users u
            JOIN dmv_records d ON d.user_id = u.id
            WHERE u.id = ?
            """,
            (target_id,),
        )
        if not target:
            self.error(404, "Civilian DMV record not found")
            return
        if target["license_status"] != "Valid":
            self.error(409, "Only a valid driver license can be suspended")
            return
        reason = str(payload.get("reason") or "Suspended by law enforcement MDT").strip()[:240]
        ts = now_iso()
        db.execute(
            "UPDATE dmv_records SET license_status = 'Suspended', updated_at = ? WHERE user_id = ?",
            (ts, target_id),
        )
        add_message(db, target_id, "Driver license suspended", f"Your driver license was suspended. Reason: {reason}", user["id"])
        self.send_json(200, {"ok": True, "license_status": "Suspended"})

    def api_issue_charge_warrant(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "civ_id", "charge_id", "location", "probable_cause")
        if missing:
            self.error(400, missing)
            return
        civ = one(db, "SELECT * FROM users WHERE id = ?", (int(payload["civ_id"]),))
        if not civ:
            self.error(404, "Civilian not found")
            return
        charge = one(db, "SELECT * FROM charge_catalog WHERE id = ?", (int(payload["charge_id"]),))
        if not charge:
            self.error(404, "Charge not found")
            return
        if charge.get("kind") != "criminal":
            self.error(400, "Charge warrant requires a criminal charge")
            return
        presiding_judge = pick_presiding_judge(db, int(civ["id"]))
        ts = now_iso()
        default_court_date = (utcnow() + dt.timedelta(days=3)).date().isoformat()
        court_date = str(payload.get("court_date") or "").strip() or default_court_date
        probable_cause = str(payload["probable_cause"]).strip()[:1400]
        location = str(payload["location"]).strip()[:120]
        bypass_court = str(payload.get("bypass_court") or "").lower() in ("1", "true", "yes", "on")
        citation_id = None
        if not bypass_court:
            citation = db.execute(
                """
                INSERT INTO citations
                (civ_id, officer_id, judge_id, charge_id, charge_code, charge_title, category, fine_amount, points, severity,
                 minimum_sentence_minutes, maximum_sentence_minutes, location, narrative, court_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    float(charge["fine_amount"]),
                    int(charge["points"]),
                    charge["severity"],
                    int(charge["minimum_sentence_minutes"]),
                    int(charge["maximum_sentence_minutes"]),
                    location,
                    probable_cause,
                    court_date,
                    ts,
                    ts,
                ),
            ).fetchone()
            citation_id = int(citation["id"])
        warrant_number = generate_record_number(db, "cid_warrants", "warrant_number", "WAR")
        warrant_pc = f"{charge['code']} - {charge['title']}. Probable cause: {probable_cause}"[:1600]
        operation_plan_default = "Serve warrant and hold subject for command review." if bypass_court else "Serve warrant and bring defendant before the assigned court."
        operation_plan = str(payload.get("operation_plan") or operation_plan_default).strip()[:1600]
        created_warrant = db.execute(
            """
            INSERT INTO cid_warrants
            (warrant_number, investigation_id, subject_civ_id, subject_name, warrant_type, status, priority, probable_cause, operation_plan, authorized_by, created_by, issued_at, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, warrant_number
            """,
            (
                warrant_number,
                int(payload["investigation_id"]) if str(payload.get("investigation_id") or "").strip() else None,
                civ["id"],
                civ["name"],
                str(payload.get("warrant_type") or "Criminal Charge Warrant").strip()[:70],
                "active",
                str(payload.get("priority") or "elevated").strip()[:30],
                warrant_pc,
                operation_plan,
                str(payload.get("authorized_by") or f"Officer {user['name']}{' / court bypass' if bypass_court else ''}").strip()[:120],
                user["id"],
                ts,
                str(payload.get("expires_at") or "").strip()[:20] or None,
                ts,
            ),
        ).fetchone()
        warrant_id = int(created_warrant["id"])
        add_message(
            db,
            civ["id"],
            "Criminal warrant issued",
            f"{charge['code']} - {charge['title']} was filed with warrant {created_warrant['warrant_number']}." + ("" if bypass_court else f" Court date: {court_date}."),
            user["id"],
        )
        add_message(
            db,
            user["id"],
            "Charge warrant signed",
            f"Warrant {created_warrant['warrant_number']} was filed against {civ['name']}."
            if bypass_court
            else f"Warrant {created_warrant['warrant_number']} and court case #{citation_id} were filed against {civ['name']}.",
            user["id"],
        )
        if presiding_judge and not bypass_court:
            add_message(
                db,
                presiding_judge["id"],
                "Criminal warrant case assigned",
                f"Case #{citation_id} / warrant {created_warrant['warrant_number']} was assigned to you. Defendant: {civ['name']}.",
                user["id"],
            )
        self.send_json(
            201,
            {
                "ok": True,
                "citation_id": citation_id,
                "warrant_id": warrant_id,
                "warrant_number": created_warrant["warrant_number"],
                "court_date": None if bypass_court else court_date,
                "bypass_court": bypass_court,
                "judge_id": None if bypass_court or not presiding_judge else presiding_judge["id"],
            },
        )

    def api_issue_citation(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "civ_id", "location", "narrative")
        if missing:
            self.error(400, missing)
            return
        raw_charge_ids = payload.get("charge_ids")
        if not isinstance(raw_charge_ids, list):
            raw_charge_ids = [raw_charge_ids or payload.get("charge_id")]
        charge_ids: list[int] = []
        try:
            for raw_charge_id in raw_charge_ids:
                charge_id = int(raw_charge_id)
                if charge_id not in charge_ids:
                    charge_ids.append(charge_id)
        except (TypeError, ValueError):
            self.error(400, "Select valid citation codes")
            return
        if not charge_ids:
            self.error(400, "Select at least one citation code")
            return
        if len(charge_ids) > 12:
            self.error(400, "A traffic stop can contain no more than 12 citations")
            return
        civ = one(db, "SELECT * FROM users WHERE id = ?", (int(payload["civ_id"]),))
        charge_placeholders = ", ".join("?" for _ in charge_ids)
        charge_rows = all_rows(db, f"SELECT * FROM charge_catalog WHERE id IN ({charge_placeholders})", tuple(charge_ids))
        charges_by_id = {int(row["id"]): row for row in charge_rows}
        charges = [charges_by_id[charge_id] for charge_id in charge_ids if charge_id in charges_by_id]
        if not civ or len(charges) != len(charge_ids):
            self.error(404, "Civilian or charge not found")
            return
        if any(charge.get("kind") != "citation" for charge in charges):
            self.error(400, "Criminal charges must be processed through Booking after transport confirmation")
            return
        default_court_date = (utcnow() + dt.timedelta(days=3)).date().isoformat()
        court_date = str(payload.get("court_date") or "").strip() or default_court_date
        presiding_judge = pick_presiding_judge(db, int(civ["id"]))
        ts = now_iso()
        citation_ids: list[int] = []
        for charge in charges:
            created = db.execute(
                """
                INSERT INTO citations
                (civ_id, officer_id, judge_id, charge_id, charge_code, charge_title, category, fine_amount, points, severity,
                 minimum_sentence_minutes, maximum_sentence_minutes, location, narrative, court_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    int(charge["minimum_sentence_minutes"]),
                    int(charge["maximum_sentence_minutes"]),
                    str(payload["location"])[:120],
                    str(payload["narrative"])[:1000],
                    court_date,
                    ts,
                    ts,
                ),
            ).fetchone()
            citation_ids.append(int(created["id"]))
        citation_id = citation_ids[0]
        total_fines = sum(float(charge["fine_amount"]) for charge in charges)
        charge_summary = ", ".join(f"{charge['code']} - {charge['title']}" for charge in charges)
        add_message(
            db,
            civ["id"],
            f"New traffic stop citations ({len(charges)})",
            f"{user['name']} issued {charge_summary}. Total fines: ${total_fines:,.2f}. Open MyFaircroft to pay or contest each filing.",
            user["id"],
        )
        add_message(db, user["id"], "Officer traffic stop filed", f"{len(citation_ids)} citation case(s) were filed against {civ['name']} and routed to the Court docket.", user["id"])
        if presiding_judge:
            add_message(
                db,
                presiding_judge["id"],
                "Traffic stop cases assigned",
                f"Cases {', '.join(f'#{case_id}' for case_id in citation_ids)} were assigned to you. Defendant: {civ['name']}. Officer: {user['name']}.",
                user["id"],
            )
        self.send_json(201, {"ok": True, "citation_id": citation_id, "citation_ids": citation_ids, "citation_count": len(citation_ids), "court_date": court_date, "judge_id": presiding_judge["id"] if presiding_judge else None})

    def api_mdt_bookings(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        active_statuses = ("intake", "booked", "holding", "ready_for_court")
        active = all_rows(
            db,
            """
            SELECT b.*, civ.name AS civ_name, civ.civ_number, officer.name AS officer_name,
                   judge.name AS judge_name, c.status AS court_status
            FROM mdt_bookings b
            JOIN users civ ON civ.id = b.civ_id
            JOIN users officer ON officer.id = b.officer_id
            LEFT JOIN citations c ON c.id = b.court_case_id
            LEFT JOIN users judge ON judge.id = c.judge_id
            WHERE b.status IN (?, ?, ?, ?)
            ORDER BY CASE b.status WHEN 'intake' THEN 0 WHEN 'booked' THEN 1 WHEN 'holding' THEN 2 ELSE 3 END,
                     b.updated_at DESC
            LIMIT 120
            """,
            active_statuses,
        )
        recent = all_rows(
            db,
            """
            SELECT b.*, civ.name AS civ_name, civ.civ_number, officer.name AS officer_name,
                   judge.name AS judge_name, c.status AS court_status
            FROM mdt_bookings b
            JOIN users civ ON civ.id = b.civ_id
            JOIN users officer ON officer.id = b.officer_id
            LEFT JOIN citations c ON c.id = b.court_case_id
            LEFT JOIN users judge ON judge.id = c.judge_id
            ORDER BY b.created_at DESC
            LIMIT 120
            """,
        )
        active_items = [dict(row) for row in active]
        recent_items = [dict(row) for row in recent]
        booking_ids = list({int(item["id"]) for item in active_items + recent_items})
        charges_by_booking: dict[int, list[dict[str, Any]]] = {}
        if booking_ids:
            booking_placeholders = ", ".join("?" for _ in booking_ids)
            linked_charges = all_rows(
                db,
                f"""
                SELECT booking_id, charge_id, court_case_id, charge_code, charge_title, category,
                       severity, fine_amount, points
                FROM mdt_booking_charges
                WHERE booking_id IN ({booking_placeholders})
                ORDER BY booking_id, charge_code
                """,
                tuple(booking_ids),
            )
            for linked_charge in linked_charges:
                charges_by_booking.setdefault(int(linked_charge["booking_id"]), []).append(dict(linked_charge))
        for item in active_items + recent_items:
            item["charges"] = charges_by_booking.get(int(item["id"])) or [{
                "charge_id": item["charge_id"],
                "court_case_id": item["court_case_id"],
                "charge_code": item["charge_code"],
                "charge_title": item["charge_title"],
                "category": item["category"],
                "severity": item["severity"],
            }]
        stats = {
            "active": one(db, "SELECT COUNT(*) AS count FROM mdt_bookings WHERE status IN (?, ?, ?, ?)", active_statuses)["count"],
            "today": one(db, "SELECT COUNT(*) AS count FROM mdt_bookings WHERE created_at >= ?", (utcnow().date().isoformat(),))["count"],
            "released": one(db, "SELECT COUNT(*) AS count FROM mdt_bookings WHERE status = 'released'")["count"],
        }
        self.send_json(200, {"active": active_items, "recent": recent_items, "stats": stats})

    def api_create_mdt_booking(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        missing = require_fields(payload, "civ_id", "arrest_location", "probable_cause", "holding_cell")
        if missing:
            self.error(400, missing)
            return
        raw_charge_ids = payload.get("charge_ids")
        if not isinstance(raw_charge_ids, list):
            raw_charge_ids = [raw_charge_ids or payload.get("charge_id")]
        charge_ids: list[int] = []
        try:
            for raw_charge_id in raw_charge_ids:
                charge_id = int(raw_charge_id)
                if charge_id not in charge_ids:
                    charge_ids.append(charge_id)
        except (TypeError, ValueError):
            self.error(400, "Select valid criminal charge codes")
            return
        if not charge_ids:
            self.error(400, "Select at least one criminal charge")
            return
        if len(charge_ids) > 12:
            self.error(400, "A booking packet can contain no more than 12 criminal charges")
            return
        transport_confirmed = str(payload.get("transport_confirmed") or "").strip().lower() in ("1", "true", "yes", "on")
        if not transport_confirmed:
            self.error(400, "Confirm that the suspect was transported to Booking before filing the criminal charge")
            return
        civ = one(db, "SELECT * FROM users WHERE id = ?", (int(payload["civ_id"]),))
        charge_placeholders = ", ".join("?" for _ in charge_ids)
        charge_rows = all_rows(db, f"SELECT * FROM charge_catalog WHERE id IN ({charge_placeholders})", tuple(charge_ids))
        charges_by_id = {int(row["id"]): row for row in charge_rows}
        charges = [charges_by_id[charge_id] for charge_id in charge_ids if charge_id in charges_by_id]
        if not civ or len(charges) != len(charge_ids):
            self.error(404, "Civilian or criminal code not found")
            return
        if any(charge.get("kind") != "criminal" for charge in charges):
            self.error(400, "Booking requires a criminal charge code")
            return
        charge = charges[0]
        try:
            bond_amount = round(float(payload.get("bond_amount") or 0), 2)
        except (TypeError, ValueError):
            self.error(400, "Bond amount must be a number")
            return
        if bond_amount < 0:
            self.error(400, "Bond amount cannot be negative")
            return
        ts = now_iso()
        default_court_date = (utcnow() + dt.timedelta(days=3)).date().isoformat()
        court_date = str(payload.get("court_date") or "").strip() or default_court_date
        arrest_location = str(payload["arrest_location"]).strip()[:180]
        probable_cause = str(payload["probable_cause"]).strip()[:1800]
        if not arrest_location or not probable_cause:
            self.error(400, "Arrest location and probable cause are required")
            return
        presiding_judge = pick_presiding_judge(db, int(civ["id"]))
        court_case_ids: list[int] = []
        for selected_charge in charges:
            court_case = db.execute(
                """
                INSERT INTO citations
                (civ_id, officer_id, judge_id, charge_id, charge_code, charge_title, category, fine_amount, points, severity,
                 minimum_sentence_minutes, maximum_sentence_minutes, location, narrative, court_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    civ["id"],
                    user["id"],
                    presiding_judge["id"] if presiding_judge else None,
                    selected_charge["id"],
                    selected_charge["code"],
                    selected_charge["title"],
                    selected_charge["category"],
                    float(selected_charge["fine_amount"]),
                    int(selected_charge["points"]),
                    selected_charge["severity"],
                    int(selected_charge["minimum_sentence_minutes"]),
                    int(selected_charge["maximum_sentence_minutes"]),
                    arrest_location,
                    probable_cause,
                    court_date,
                    ts,
                    ts,
                ),
            ).fetchone()
            court_case_ids.append(int(court_case["id"]))
        court_case_id = court_case_ids[0]
        booking_number = generate_record_number(db, "mdt_bookings", "booking_number", "BKG")
        arresting_agency = str(payload.get("arresting_agency") or user["primary_agency"] or "Law Enforcement").strip()[:120]
        created = db.execute(
            """
            INSERT INTO mdt_bookings
            (booking_number, civ_id, officer_id, charge_id, court_case_id, charge_code, charge_title, category, severity,
             arrest_location, arrest_datetime, arresting_agency, incident_number, probable_cause, property_inventory,
             medical_notes, booking_notes, holding_cell, bond_amount, status, transport_confirmed_at, court_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?, ?, ?)
            RETURNING id, booking_number
            """,
            (
                booking_number,
                civ["id"],
                user["id"],
                charge["id"],
                court_case_id,
                charge["code"],
                charge["title"],
                charge["category"],
                charge["severity"],
                arrest_location,
                str(payload.get("arrest_datetime") or ts).strip()[:40],
                arresting_agency,
                str(payload.get("incident_number") or "").strip()[:80],
                probable_cause,
                str(payload.get("property_inventory") or "").strip()[:1800],
                str(payload.get("medical_notes") or "").strip()[:1200],
                str(payload.get("booking_notes") or "").strip()[:1600],
                str(payload.get("holding_cell") or "").strip()[:80],
                bond_amount,
                ts,
                court_date,
                ts,
                ts,
            ),
        ).fetchone()
        for selected_charge, selected_court_case_id in zip(charges, court_case_ids):
            db.execute(
                """
                INSERT INTO mdt_booking_charges
                (booking_id, charge_id, court_case_id, charge_code, charge_title, category, severity,
                 fine_amount, points, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(created["id"]),
                    int(selected_charge["id"]),
                    selected_court_case_id,
                    selected_charge["code"],
                    selected_charge["title"],
                    selected_charge["category"],
                    selected_charge["severity"],
                    float(selected_charge["fine_amount"]),
                    int(selected_charge["points"]),
                    ts,
                ),
            )
        charge_summary = ", ".join(f"{item['code']} - {item['title']}" for item in charges)
        add_message(
            db,
            civ["id"],
            "Arrest booking processed",
            f"Booking {created['booking_number']} was filed with {len(charges)} charge(s): {charge_summary}. Court date: {court_date}.",
            user["id"],
        )
        add_message(
            db,
            user["id"],
            "Booking packet filed",
            f"Booking {created['booking_number']} and {len(court_case_ids)} court case(s) were filed for {civ['name']}.",
            user["id"],
        )
        if presiding_judge:
            add_message(
                db,
                presiding_judge["id"],
                "Booking case assigned",
                f"Booking {created['booking_number']} / cases {', '.join(f'#{case_id}' for case_id in court_case_ids)} were assigned to you. Defendant: {civ['name']}.",
                user["id"],
            )
        self.send_json(
            201,
            {
                "ok": True,
                "id": int(created["id"]),
                "booking_number": created["booking_number"],
                "court_case_id": court_case_id,
                "court_case_ids": court_case_ids,
                "charge_count": len(charges),
                "court_date": court_date,
                "judge_id": presiding_judge["id"] if presiding_judge else None,
            },
        )

    def api_update_mdt_booking(self, db: Database, user: DbRow | None, booking_id: int) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        booking = one(db, "SELECT * FROM mdt_bookings WHERE id = ?", (booking_id,))
        if not booking:
            self.error(404, "Booking not found")
            return
        allowed_statuses = {"intake", "booked", "holding", "ready_for_court", "released", "transferred", "voided"}
        status = str(payload.get("status") or booking["status"]).strip().lower()
        if status not in allowed_statuses:
            self.error(400, "Unsupported booking status")
            return
        try:
            bond_amount = round(float(payload.get("bond_amount") if payload.get("bond_amount") not in (None, "") else booking["bond_amount"]), 2)
        except (TypeError, ValueError):
            self.error(400, "Bond amount must be a number")
            return
        if bond_amount < 0:
            self.error(400, "Bond amount cannot be negative")
            return
        final_status = status in {"released", "transferred", "voided"}
        completed_at = now_iso() if final_status and not booking["completed_at"] else booking["completed_at"]
        ts = now_iso()
        db.execute(
            """
            UPDATE mdt_bookings
            SET status = ?, holding_cell = ?, release_notes = ?, booking_notes = ?, medical_notes = ?,
                property_inventory = ?, bond_amount = ?, updated_at = ?, completed_at = ?
            WHERE id = ?
            """,
            (
                status,
                str(payload.get("holding_cell") if payload.get("holding_cell") is not None else booking["holding_cell"]).strip()[:80],
                str(payload.get("release_notes") if payload.get("release_notes") is not None else booking["release_notes"]).strip()[:1200],
                str(payload.get("booking_notes") if payload.get("booking_notes") is not None else booking["booking_notes"]).strip()[:1600],
                str(payload.get("medical_notes") if payload.get("medical_notes") is not None else booking["medical_notes"]).strip()[:1200],
                str(payload.get("property_inventory") if payload.get("property_inventory") is not None else booking["property_inventory"]).strip()[:1800],
                bond_amount,
                ts,
                completed_at,
                booking_id,
            ),
        )
        if final_status:
            add_message(db, booking["civ_id"], "Booking status updated", f"Booking {booking['booking_number']} is now marked {status}.", user["id"])
        self.send_json(200, {"ok": True, "status": status})

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
        ts = now_iso()
        cur = db.execute(
            """
            INSERT INTO panic_alerts
            (officer_id, department, call_type, priority, location, note, created_at, updated_at)
            VALUES (?, ?, 'Panic Activation', 'critical', ?, ?, ?, ?)
            RETURNING id
            """,
            (user["id"], department, location, note, ts, ts),
        )
        created = cur.fetchone()
        recipient_patterns = {
            "police": ("%leo%", "%sheriff%", "%police%", "%metro_police_chief%", "%state_police%", "%state_police_commander%", "%cid%", "%cid_director%", "%iu%", "%iu_director%", "%dispatcher%", "%owner%"),
            "fire": ("%fireman%", "%fire_chief%", "%deputy_chief%", "%fire_marshal%", "%dispatcher%", "%owner%"),
            "ems": ("%ems%", "%dispatcher%", "%owner%", "%admin%"),
        }[department]
        recipient_sql = "SELECT id FROM users WHERE " + " OR ".join(["roles LIKE ?"] * len(recipient_patterns))
        recipients = all_rows(
            db,
            recipient_sql,
            recipient_patterns,
        )
        subject = f"911 {department.upper()} ALERT"
        for recipient in recipients:
            if recipient["id"] != user["id"]:
                add_message(db, recipient["id"], subject, f"{user['name']} activated a {department} emergency at {location}. {note}", user["id"])
        self.send_json(201, {"ok": True, "alert_id": int(created["id"]), "department": department})

    def api_mdt_reports(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        can_review_all = has_any(user, "owner", "cid", "cid_director", "iu", "iu_director")
        report_where = "" if can_review_all else "WHERE r.officer_id = ?"
        report_params: tuple[Any, ...] = () if can_review_all else (user["id"],)
        reports = all_rows(
            db,
            f"""
            SELECT r.*, officer.name AS officer_name, officer.primary_agency AS officer_agency,
                   civ.name AS involved_civ_name, civ.civ_number AS involved_civ_number,
                   alert.department AS related_department, alert.status AS related_alert_status,
                   alert.created_at AS related_alert_created_at
            FROM cad_after_call_reports r
            JOIN users officer ON officer.id = r.officer_id
            LEFT JOIN users civ ON civ.id = r.involved_civ_id
            LEFT JOIN panic_alerts alert ON alert.id = r.related_alert_id
            {report_where}
            ORDER BY r.created_at DESC
            LIMIT 160
            """,
            report_params,
        )
        alerts = all_rows(
            db,
            """
            SELECT p.*, u.name AS officer_name, u.primary_agency
            FROM panic_alerts p
            JOIN users u ON u.id = p.officer_id
            ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'responding' THEN 1 ELSE 2 END, p.created_at DESC
            LIMIT 80
            """,
        )
        civilians = all_rows(
            db,
            """
            SELECT u.id, u.civ_number, u.name, u.verified, d.license_status, d.license_class
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            ORDER BY u.name
            LIMIT 500
            """,
        )
        self.send_json(
            200,
            {
                "reports": [dict(row) for row in reports],
                "alerts": [dict(row) for row in alerts],
                "civilians": [dict(row) for row in civilians],
                "can_review_all": can_review_all,
            },
        )

    def api_create_mdt_report(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        missing = require_fields(payload, "call_type", "disposition", "location", "narrative")
        if missing:
            self.error(400, missing)
            return
        allowed_dispositions = {
            "cleared",
            "founded",
            "unfounded",
            "report taken",
            "citation issued",
            "arrest made",
            "referred to CID",
            "false alarm",
            "unable to locate",
        }
        disposition = str(payload["disposition"]).strip()[:60]
        if disposition not in allowed_dispositions:
            self.error(400, "Unsupported report disposition")
            return
        related_alert_id: int | None = None
        if str(payload.get("related_alert_id") or "").strip():
            try:
                related_alert_id = int(payload["related_alert_id"])
            except (TypeError, ValueError):
                self.error(400, "Invalid linked CAD call")
                return
            if not one(db, "SELECT id FROM panic_alerts WHERE id = ?", (related_alert_id,)):
                self.error(404, "Linked CAD call not found")
                return
        involved_civ_id: int | None = None
        involved_name = str(payload.get("involved_name") or "").strip()[:140]
        if str(payload.get("involved_civ_id") or "").strip():
            try:
                involved_civ_id = int(payload["involved_civ_id"])
            except (TypeError, ValueError):
                self.error(400, "Invalid involved civilian")
                return
            civ = one(db, "SELECT id, name FROM users WHERE id = ?", (involved_civ_id,))
            if not civ:
                self.error(404, "Involved civilian not found")
                return
            if not involved_name:
                involved_name = str(civ["name"])[:140]
        call_type = str(payload["call_type"]).strip()[:80]
        location = str(payload["location"]).strip()[:180]
        narrative = str(payload["narrative"]).strip()
        actions_taken = str(payload.get("actions_taken") or "").strip()
        evidence_links = str(payload.get("evidence_links") or "").strip()
        if not narrative:
            self.error(400, "Narrative is required")
            return
        ts = now_iso()
        report_number = generate_record_number(db, "cad_after_call_reports", "report_number", "ACR")
        created = db.execute(
            """
            INSERT INTO cad_after_call_reports
            (report_number, officer_id, related_alert_id, involved_civ_id, involved_name, call_type, disposition, location, narrative, actions_taken, evidence_links, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, report_number
            """,
            (
                report_number,
                user["id"],
                related_alert_id,
                involved_civ_id,
                involved_name,
                call_type,
                disposition,
                location,
                narrative,
                actions_taken,
                evidence_links,
                ts,
                ts,
            ),
        ).fetchone()
        if related_alert_id and disposition in ("cleared", "unfounded", "false alarm", "unable to locate"):
            db.execute(
                "UPDATE panic_alerts SET status = 'cleared', resolved_at = COALESCE(resolved_at, ?) WHERE id = ?",
                (ts, related_alert_id),
            )
        self.send_json(201, {"ok": True, "id": int(created["id"]), "report_number": created["report_number"], "disposition": disposition})

    def api_mdt_bolos(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        active = all_rows(
            db,
            """
            SELECT b.*, u.name AS officer_name, u.primary_agency AS officer_agency
            FROM mdt_bolos b
            JOIN users u ON u.id = b.created_by
            WHERE b.status = 'active'
            ORDER BY CASE b.caution_level WHEN 'armed' THEN 0 WHEN 'high' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END,
                     b.updated_at DESC
            LIMIT 100
            """,
        )
        recent = all_rows(
            db,
            """
            SELECT b.*, u.name AS officer_name, u.primary_agency AS officer_agency
            FROM mdt_bolos b
            JOIN users u ON u.id = b.created_by
            WHERE b.status <> 'active'
            ORDER BY b.updated_at DESC
            LIMIT 40
            """,
        )
        self.send_json(200, {"active": [dict(row) for row in active], "recent": [dict(row) for row in recent]})

    def api_create_mdt_bolo(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        missing = require_fields(payload, "target_name", "reason")
        if missing:
            self.error(400, missing)
            return
        caution_level = str(payload.get("caution_level") or "standard").strip().lower()
        if caution_level not in ("standard", "elevated", "high", "armed"):
            self.error(400, "Invalid caution level")
            return
        target_name = str(payload.get("target_name") or "").strip()[:140]
        reason = str(payload.get("reason") or "").strip()
        if not target_name or not reason:
            self.error(400, "Target name and BOLO reason are required")
            return
        ts = now_iso()
        bolo_number = generate_record_number(db, "mdt_bolos", "bolo_number", "BOLO")
        created = db.execute(
            """
            INSERT INTO mdt_bolos
            (bolo_number, created_by, target_name, target_description, vehicle_description, plate, last_seen, caution_level, reason, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            RETURNING id, bolo_number
            """,
            (
                bolo_number,
                user["id"],
                target_name,
                str(payload.get("target_description") or "").strip()[:800],
                str(payload.get("vehicle_description") or "").strip()[:500],
                str(payload.get("plate") or "").strip().upper()[:32],
                str(payload.get("last_seen") or "").strip()[:240],
                caution_level,
                reason[:1600],
                ts,
                ts,
            ),
        ).fetchone()
        recipient_patterns = tuple(f"%{role}%" for role in LAW_SERVICE_ROLES) + ("%owner%",)
        recipients = all_rows(
            db,
            "SELECT id FROM users WHERE " + " OR ".join(["roles LIKE ?"] * len(recipient_patterns)) + " ORDER BY id LIMIT 200",
            recipient_patterns,
        )
        notice = f"{user['name']} issued {created['bolo_number']} for {target_name}. Caution: {caution_level}. {reason[:220]}"
        for recipient in recipients:
            if recipient["id"] != user["id"]:
                add_message(db, recipient["id"], "Active BOLO issued", notice, user["id"])
        self.send_json(201, {"ok": True, "id": int(created["id"]), "bolo_number": created["bolo_number"]})

    def api_update_mdt_bolo(self, db: Database, user: DbRow | None, bolo_id: int) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        status = str(payload.get("status") or "cleared").strip().lower()
        if status not in ("active", "cleared", "cancelled", "expired"):
            self.error(400, "Invalid BOLO status")
            return
        bolo = one(db, "SELECT * FROM mdt_bolos WHERE id = ?", (bolo_id,))
        if not bolo:
            self.error(404, "BOLO not found")
            return
        ts = now_iso()
        resolved_at = None if status == "active" else ts
        db.execute(
            """
            UPDATE mdt_bolos
            SET status = ?, updated_at = ?, resolved_at = ?
            WHERE id = ?
            """,
            (status, ts, resolved_at, bolo_id),
        )
        self.send_json(200, {"ok": True, "id": bolo_id, "status": status})

    def api_alerts(self, db: Database, user: DbRow | None) -> None:
        err = leo_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT p.*, u.name AS officer_name, u.primary_agency,
                   (SELECT COUNT(*) FROM dispatch_call_units a WHERE a.alert_id = p.id AND a.detached_at IS NULL) AS assigned_unit_count,
                   (SELECT n.body FROM dispatch_call_notes n WHERE n.alert_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS dispatch_last_note,
                   (SELECT n.note_type FROM dispatch_call_notes n WHERE n.alert_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS dispatch_last_note_type
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

    def api_dispatch_overview(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        can_view_dispatch = bool(has_any(user, "admin", "dispatcher", *LAW_SERVICE_ROLES, *FIRE_SERVICE_ROLES, "owner"))
        if not can_view_dispatch:
            self.error(403, "Dispatch access required")
            return
        calls = all_rows(
            db,
            """
            SELECT p.*, u.name AS created_by_name, u.primary_agency AS created_by_agency
            FROM panic_alerts p
            JOIN users u ON u.id = p.officer_id
            ORDER BY CASE p.status
                WHEN 'active' THEN 0
                WHEN 'staged' THEN 1
                WHEN 'responding' THEN 2
                WHEN 'on_scene' THEN 3
                WHEN 'held' THEN 4
                ELSE 5
            END,
            CASE p.priority WHEN 'critical' THEN 0 WHEN 'elevated' THEN 1 ELSE 2 END,
            p.created_at DESC
            LIMIT 140
            """,
        )
        assignments = all_rows(
            db,
            """
            SELECT a.*, unit.name AS unit_name, unit.roles AS unit_roles, unit.primary_agency AS unit_agency, unit.callsign AS unit_callsign,
                   dispatcher.name AS dispatcher_name
            FROM dispatch_call_units a
            JOIN users unit ON unit.id = a.unit_id
            JOIN users dispatcher ON dispatcher.id = a.assigned_by
            ORDER BY a.attached_at DESC
            LIMIT 300
            """,
        )
        notes = all_rows(
            db,
            """
            SELECT n.*, author.name AS author_name
            FROM dispatch_call_notes n
            JOIN users author ON author.id = n.author_id
            ORDER BY n.created_at DESC
            LIMIT 300
            """,
        )
        unit_rows = all_rows(
            db,
            """
            SELECT id, civ_number, name, roles, primary_agency, callsign, verified
            FROM users
            WHERE verified = 1 OR id IN (SELECT id FROM users WHERE roles LIKE ?)
            ORDER BY name
            LIMIT 600
            """,
            ("%owner%",),
        )
        units = [
            dict(row)
            for row in unit_rows
            if has_any(row, *LAW_SERVICE_ROLES, *FIRE_SERVICE_ROLES, "owner")
        ]
        active_statuses = {"active", "staged", "responding", "on_scene", "held"}
        stats = {
            "active": sum(1 for row in calls if row.get("status") in active_statuses),
            "critical": sum(1 for row in calls if row.get("priority") == "critical" and row.get("status") in active_statuses),
            "assigned_units": sum(1 for row in assignments if not row.get("detached_at")),
            "police": sum(1 for row in calls if row.get("department") == "police" and row.get("status") in active_statuses),
            "fire": sum(1 for row in calls if row.get("department") == "fire" and row.get("status") in active_statuses),
            "ems": sum(1 for row in calls if row.get("department") == "ems" and row.get("status") in active_statuses),
        }
        self.send_json(
            200,
            {
                "calls": [dict(row) for row in calls],
                "assignments": [dict(row) for row in assignments],
                "notes": [dict(row) for row in notes],
                "units": units,
                "stats": stats,
                "can_manage_dispatch": bool(has_any(user, "owner", "dispatcher")),
            },
        )

    def api_dispatch_create_call(self, db: Database, user: DbRow | None) -> None:
        err = dispatcher_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        missing = require_fields(payload, "department", "location", "note")
        if missing:
            self.error(400, missing)
            return
        department = str(payload.get("department") or "police").strip().lower()
        if department not in ("police", "fire", "ems"):
            self.error(400, "Invalid emergency department")
            return
        priority = str(payload.get("priority") or "standard").strip().lower()
        if priority not in ("standard", "elevated", "critical"):
            self.error(400, "Invalid call priority")
            return
        call_type = str(payload.get("call_type") or "911 Call").strip()[:80]
        location = str(payload.get("location") or "").strip()[:180]
        note = str(payload.get("note") or "").strip()[:1200]
        caller_name = str(payload.get("caller_name") or "").strip()[:120]
        if not location or not note:
            self.error(400, "Location and initial call notes are required")
            return
        ts = now_iso()
        created = db.execute(
            """
            INSERT INTO panic_alerts
            (officer_id, department, caller_name, call_type, priority, location, note, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            RETURNING id
            """,
            (user["id"], department, caller_name, call_type, priority, location, note, ts, ts),
        ).fetchone()
        alert_id = int(created["id"])
        db.execute(
            "INSERT INTO dispatch_call_notes (alert_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (alert_id, user["id"], "call intake", note, ts),
        )
        recipient_patterns = {
            "police": ("%leo%", "%sheriff%", "%police%", "%metro_police_chief%", "%state_police%", "%state_police_commander%", "%cid%", "%cid_director%", "%iu%", "%iu_director%", "%dispatcher%", "%owner%"),
            "fire": ("%fireman%", "%fire_chief%", "%deputy_chief%", "%fire_marshal%", "%dispatcher%", "%owner%"),
            "ems": ("%ems%", "%dispatcher%", "%owner%", "%admin%"),
        }[department]
        recipients = all_rows(
            db,
            "SELECT id FROM users WHERE " + " OR ".join(["roles LIKE ?"] * len(recipient_patterns)),
            recipient_patterns,
        )
        for recipient in recipients:
            if recipient["id"] != user["id"]:
                add_message(db, recipient["id"], f"CAD call #{alert_id}", f"{department.upper()} {priority} call: {call_type} at {location}. {note[:220]}", user["id"])
        self.send_json(201, {"ok": True, "alert_id": alert_id})

    def api_dispatch_update_call(self, db: Database, user: DbRow | None, alert_id: int) -> None:
        err = dispatcher_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        call = one(db, "SELECT * FROM panic_alerts WHERE id = ?", (alert_id,))
        if not call:
            self.error(404, "CAD call not found")
            return
        status = str(payload.get("status") or call["status"]).strip().lower()
        priority = str(payload.get("priority") or call["priority"] or "standard").strip().lower()
        if status not in ("active", "staged", "responding", "on_scene", "held", "cleared", "closed"):
            self.error(400, "Invalid call status")
            return
        if priority not in ("standard", "elevated", "critical"):
            self.error(400, "Invalid call priority")
            return
        ts = now_iso()
        resolved_at = ts if status in ("cleared", "closed") else None
        db.execute(
            "UPDATE panic_alerts SET status = ?, priority = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
            (status, priority, ts, resolved_at, alert_id),
        )
        body = str(payload.get("note") or "").strip()
        if body:
            db.execute(
                "INSERT INTO dispatch_call_notes (alert_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
                (alert_id, user["id"], "status update", body[:1600], ts),
            )
            active_units = all_rows(
                db,
                "SELECT unit_id FROM dispatch_call_units WHERE alert_id = ? AND detached_at IS NULL",
                (alert_id,),
            )
            for assigned in active_units:
                if assigned["unit_id"] != user["id"]:
                    add_message(db, assigned["unit_id"], f"CAD status #{alert_id}", f"{status}: {body[:220]}", user["id"])
        self.send_json(200, {"ok": True, "id": alert_id, "status": status, "priority": priority})

    def api_dispatch_attach_unit(self, db: Database, user: DbRow | None, alert_id: int) -> None:
        err = dispatcher_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        call = one(db, "SELECT * FROM panic_alerts WHERE id = ?", (alert_id,))
        if not call:
            self.error(404, "CAD call not found")
            return
        try:
            unit_id = int(payload.get("unit_id") or 0)
        except (TypeError, ValueError):
            self.error(400, "Invalid unit")
            return
        unit = one(db, "SELECT id, name, roles, callsign FROM users WHERE id = ?", (unit_id,))
        if not unit or not has_any(unit, *LAW_SERVICE_ROLES, *FIRE_SERVICE_ROLES, "owner"):
            self.error(404, "Emergency unit not found")
            return
        if not str(unit.get("callsign") or "").strip():
            self.error(400, "Unit callsign is required before dispatch assignment. Update your callsign in profile.")
            return
        status = str(payload.get("status") or "assigned").strip().lower()
        if status not in ("assigned", "enroute", "on_scene", "staged", "cleared"):
            self.error(400, "Invalid unit status")
            return
        notes = str(payload.get("notes") or "").strip()[:800]
        existing = one(
            db,
            "SELECT id FROM dispatch_call_units WHERE alert_id = ? AND unit_id = ? AND detached_at IS NULL",
            (alert_id, unit_id),
        )
        ts = now_iso()
        if existing:
            assignment_id = int(existing["id"])
            db.execute(
                "UPDATE dispatch_call_units SET status = ?, notes = ? WHERE id = ?",
                (status, notes, assignment_id),
            )
        else:
            created = db.execute(
                """
                INSERT INTO dispatch_call_units (alert_id, unit_id, assigned_by, status, notes, attached_at)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (alert_id, unit_id, user["id"], status, notes, ts),
            ).fetchone()
            assignment_id = int(created["id"])
        if call["status"] in ("active", "staged"):
            db.execute("UPDATE panic_alerts SET status = 'responding', updated_at = ? WHERE id = ?", (ts, alert_id))
        db.execute(
            "INSERT INTO dispatch_call_notes (alert_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (alert_id, user["id"], "unit attached", f"{unit['name']} attached as {status}. {notes}".strip(), ts),
        )
        add_message(
            db,
            unit_id,
            f"Assigned CAD call #{alert_id}",
            f"Dispatch attached {unit['name']} (Callsign {unit['callsign']}) to {call['department'].upper()} call at {call['location']}. {notes}".strip(),
            user["id"],
        )
        self.send_json(201, {"ok": True, "assignment_id": assignment_id})

    def api_dispatch_update_assignment(self, db: Database, user: DbRow | None, assignment_id: int) -> None:
        err = dispatcher_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        assignment = one(
            db,
            """
            SELECT a.*, p.location, unit.name AS unit_name
            FROM dispatch_call_units a
            JOIN panic_alerts p ON p.id = a.alert_id
            JOIN users unit ON unit.id = a.unit_id
            WHERE a.id = ?
            """,
            (assignment_id,),
        )
        if not assignment:
            self.error(404, "Unit assignment not found")
            return
        detach = bool(payload.get("detach"))
        status = str(payload.get("status") or assignment["status"]).strip().lower()
        if status not in ("assigned", "enroute", "on_scene", "staged", "cleared", "detached"):
            self.error(400, "Invalid unit status")
            return
        if detach:
            status = "detached"
        notes = str(payload.get("notes") or assignment.get("notes") or "").strip()[:800]
        ts = now_iso()
        db.execute(
            "UPDATE dispatch_call_units SET status = ?, notes = ?, detached_at = ? WHERE id = ?",
            (status, notes, ts if detach else assignment.get("detached_at"), assignment_id),
        )
        note_type = "unit detached" if detach else "unit status"
        db.execute(
            "INSERT INTO dispatch_call_notes (alert_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (assignment["alert_id"], user["id"], note_type, f"{assignment['unit_name']} {status}. {notes}".strip(), ts),
        )
        self.send_json(200, {"ok": True, "assignment_id": assignment_id, "status": status})

    def api_dispatch_add_note(self, db: Database, user: DbRow | None, alert_id: int) -> None:
        err = dispatcher_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        call = one(db, "SELECT * FROM panic_alerts WHERE id = ?", (alert_id,))
        if not call:
            self.error(404, "CAD call not found")
            return
        body = str(payload.get("body") or "").strip()
        if not body:
            self.error(400, "Dispatch note is required")
            return
        note_type = str(payload.get("note_type") or "dispatch update").strip()[:60]
        ts = now_iso()
        db.execute(
            "INSERT INTO dispatch_call_notes (alert_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (alert_id, user["id"], note_type, body[:2000], ts),
        )
        db.execute("UPDATE panic_alerts SET updated_at = ? WHERE id = ?", (ts, alert_id))
        active_units = all_rows(
            db,
            "SELECT unit_id FROM dispatch_call_units WHERE alert_id = ? AND detached_at IS NULL",
            (alert_id,),
        )
        for assigned in active_units:
            if assigned["unit_id"] != user["id"]:
                add_message(db, assigned["unit_id"], f"CAD note #{alert_id}", f"{note_type}: {body[:220]}", user["id"])
        self.send_json(201, {"ok": True})

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
            SELECT p.*, u.name AS officer_name, u.primary_agency,
                   (SELECT COUNT(*) FROM dispatch_call_units a WHERE a.alert_id = p.id AND a.detached_at IS NULL) AS assigned_unit_count,
                   (SELECT n.body FROM dispatch_call_notes n WHERE n.alert_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS dispatch_last_note,
                   (SELECT n.note_type FROM dispatch_call_notes n WHERE n.alert_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS dispatch_last_note_type
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
        rig_rows = all_rows(
            db,
            """
            SELECT r.*, u.name AS assigned_name, u.civ_number AS assigned_civ_number, chief.name AS assigned_by_name
            FROM fire_rig_assignments r
            LEFT JOIN users u ON u.id = r.user_id
            LEFT JOIN users chief ON chief.id = r.assigned_by
            ORDER BY r.rig_name
            """
        )
        rigs_by_name = {row["rig_name"]: dict(row) for row in rig_rows}
        rigs = []
        for rig_name in FIRE_RIG_NAMES:
            rigs.append(
                rigs_by_name.get(
                    rig_name,
                    {
                        "rig_name": rig_name,
                        "user_id": None,
                        "assigned_name": "",
                        "assigned_civ_number": "",
                        "assigned_by_name": "",
                        "position": "Firefighter",
                        "status": "available",
                        "notes": "",
                        "updated_at": "",
                    },
                )
            )
        for rig_name, row in rigs_by_name.items():
            if rig_name not in FIRE_RIG_NAMES:
                rigs.append(row)
        personnel_rows = all_rows(
            db,
            """
            SELECT id, civ_number, name, roles, primary_agency
            FROM users
            ORDER BY name
            LIMIT 200
            """
        )
        personnel = [dict(row) for row in personnel_rows if has_any(row, *FIRE_SERVICE_ROLES, "owner")]
        self.send_json(
            200,
            {
                "departments": visible,
                "stats": stats,
                "alerts": [dict(row) for row in rows],
                "rigs": rigs,
                "personnel": personnel,
                "can_manage_rigs": has_any(user, *FIRE_COMMAND_ROLES, "owner"),
            },
        )

    def api_update_fire_rig(self, db: Database, user: DbRow | None) -> None:
        err = fire_chief_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        rig_name = str(payload.get("rig_name") or "").strip()[:60]
        if not rig_name:
            self.error(400, "Rig name is required")
            return
        user_id_raw = str(payload.get("user_id") or "").strip()
        user_id = int(user_id_raw) if user_id_raw else None
        if user_id and not one(db, "SELECT id FROM users WHERE id = ?", (user_id,)):
            self.error(404, "Assigned firefighter not found")
            return
        status = str(payload.get("status") or "available").strip().lower()
        if status not in ("available", "assigned", "out_of_service"):
            self.error(400, "Invalid rig status")
            return
        position = str(payload.get("position") or "Firefighter").strip()[:60]
        notes = str(payload.get("notes") or "").strip()[:400]
        ts = now_iso()
        db.execute(
            """
            INSERT INTO fire_rig_assignments (rig_name, user_id, position, status, notes, assigned_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(rig_name) DO UPDATE SET
                user_id = excluded.user_id,
                position = excluded.position,
                status = excluded.status,
                notes = excluded.notes,
                assigned_by = excluded.assigned_by,
                updated_at = excluded.updated_at
            """,
            (rig_name, user_id, position, status, notes, user["id"], ts),
        )
        if user_id:
            add_message(db, user_id, "Fire rig assignment", f"You were assigned to {rig_name} as {position}. Status: {status}.", user["id"])
        self.send_json(200, {"ok": True})

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
            SELECT i.*, lead.name AS lead_name, target.name AS target_civ_name,
                   (SELECT COUNT(*) FROM cid_investigation_notes n WHERE n.investigation_id = i.id) AS note_count,
                   (SELECT COUNT(*) FROM cid_warrants w WHERE w.investigation_id = i.id) AS warrant_count
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
            SELECT w.*, creator.name AS creator_name, target.name AS subject_civ_name, target.civ_number AS subject_civ_number, i.case_number
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
            SELECT ia.*, assigned.name AS assigned_name, subject.name AS subject_officer_name, creator.name AS created_by_name,
                   (SELECT COUNT(*) FROM cid_internal_affairs_notes n WHERE n.ia_id = ia.id) AS note_count
            FROM cid_internal_affairs ia
            JOIN users assigned ON assigned.id = ia.assigned_to
            JOIN users creator ON creator.id = ia.created_by
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
            LIMIT 300
            """
        )
        ia_notes = all_rows(
            db,
            """
            SELECT n.*, ia.ia_number, author.name AS author_name
            FROM cid_internal_affairs_notes n
            JOIN cid_internal_affairs ia ON ia.id = n.ia_id
            JOIN users author ON author.id = n.author_id
            ORDER BY n.created_at DESC
            LIMIT 500
            """
        )
        civilians = all_rows(
            db,
            """
            SELECT u.id, u.civ_number, u.name, u.verified, d.license_status, d.license_class
            FROM users u
            LEFT JOIN dmv_records d ON d.user_id = u.id
            ORDER BY u.name
            LIMIT 300
            """
        )
        stats = {
            "open_investigations": one(db, "SELECT COUNT(*) AS count FROM cid_investigations WHERE status NOT IN ('closed','archived')")["count"],
            "active_warrants": one(db, "SELECT COUNT(*) AS count FROM cid_warrants WHERE status = 'active'")["count"],
            "ia_open": one(db, "SELECT COUNT(*) AS count FROM cid_internal_affairs WHERE status NOT IN ('closed','sustained','unfounded')")["count"],
        }
        self.send_json(200, {"stats": stats, "investigations": investigations, "warrants": warrants, "ia_cases": ia_cases, "ia_notes": ia_notes, "notes": notes, "civilians": civilians})

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
        target_civ_raw = str(payload.get("target_civ_id") or "").strip()
        target_civ_id = int(target_civ_raw) if target_civ_raw and target_civ_raw != "0" else None
        target = one(db, "SELECT id, name FROM users WHERE id = ?", (target_civ_id,)) if target_civ_id else None
        if target_civ_id and not target:
            self.error(404, "Selected civilian target not found")
            return
        target_name = str(payload.get("target_name") or (target["name"] if target else "")).strip()
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
                target_name[:120],
                str(payload["summary"]).strip(),
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
            (investigation_id, user["id"], str(payload.get("note_type") or "case note").strip()[:50], str(payload["body"]).strip(), now_iso()),
        )
        db.execute("UPDATE cid_investigations SET updated_at = ? WHERE id = ?", (now_iso(), investigation_id))
        self.send_json(201, {"ok": True})

    def api_cid_create_warrant(self, db: Database, user: DbRow | None) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "warrant_type", "probable_cause")
        if missing:
            self.error(400, missing)
            return
        investigation_id = int(payload["investigation_id"]) if str(payload.get("investigation_id") or "").strip() else None
        subject_civ_id = int(payload["subject_civ_id"]) if str(payload.get("subject_civ_id") or "").strip() else None
        subject = one(db, "SELECT id, name FROM users WHERE id = ?", (subject_civ_id,)) if subject_civ_id else None
        if subject_civ_id and not subject:
            self.error(404, "Selected civilian not found")
            return
        subject_name_value = payload.get("subject_name")
        if subject and not str(subject_name_value or "").strip():
            subject_name_value = subject["name"]
        subject_name = str(subject_name_value or "").strip()[:120]
        if not subject_name:
            self.error(400, "Subject civilian or subject name is required")
            return
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
                subject_name,
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
        err = leo_required(user)
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

    def api_cid_add_ia_note(self, db: Database, user: DbRow | None, ia_id: int) -> None:
        err = cid_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "body")
        if missing:
            self.error(400, missing)
            return
        if not one(db, "SELECT id FROM cid_internal_affairs WHERE id = ?", (ia_id,)):
            self.error(404, "IA file not found")
            return
        ts = now_iso()
        db.execute(
            "INSERT INTO cid_internal_affairs_notes (ia_id, author_id, note_type, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (ia_id, user["id"], str(payload.get("note_type") or "file note").strip()[:60], str(payload["body"]).strip(), ts),
        )
        db.execute("UPDATE cid_internal_affairs SET updated_at = ? WHERE id = ?", (ts, ia_id))
        self.send_json(201, {"ok": True})

    def api_system_settings(self, db: Database, user: DbRow | None) -> None:
        err = owner_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        auto_verified = apply_auto_verification(db)
        auto_licensed = apply_auto_license_approval(db)
        settings = get_system_settings(db)
        stats = {**auto_verify_stats(db, settings), **auto_license_stats(db, settings)}
        self.send_json(200, {"settings": settings, "stats": stats, "auto_verified_now": auto_verified, "auto_licensed_now": auto_licensed})

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
        if "autopilot_license_enabled" in payload:
            license_enabled = payload.get("autopilot_license_enabled")
        else:
            license_enabled = current_settings["autopilot_license_enabled"]
        try:
            license_minutes = int(payload.get("autopilot_license_minutes") or current_settings["autopilot_license_minutes"])
        except (TypeError, ValueError):
            self.error(400, "Driver license autopilot time must be a number of minutes")
            return
        license_minutes = max(1, min(license_minutes, 10080))
        enabled_value = "1" if str(enabled).lower() in ("1", "true", "yes", "on") else "0"
        license_enabled_value = "1" if str(license_enabled).lower() in ("1", "true", "yes", "on") else "0"
        lockdown_enabled = payload.get("update_lockdown_enabled", current_settings["update_lockdown_enabled"])
        lockdown_enabled_value = "1" if str(lockdown_enabled).lower() in ("1", "true", "yes", "on") else "0"
        lockdown_message = str(payload.get("update_lockdown_message") or current_settings["update_lockdown_message"] or SYSTEM_SETTING_DEFAULTS["update_lockdown_message"]).strip()[:240]
        set_system_setting(db, "autopilot_verify_enabled", enabled_value)
        set_system_setting(db, "autopilot_verify_minutes", str(minutes))
        set_system_setting(db, "autopilot_license_enabled", license_enabled_value)
        set_system_setting(db, "autopilot_license_minutes", str(license_minutes))
        set_system_setting(db, "update_lockdown_enabled", lockdown_enabled_value)
        set_system_setting(db, "update_lockdown_message", lockdown_message)
        auto_verified = apply_auto_verification(db)
        auto_licensed = apply_auto_license_approval(db)
        settings = get_system_settings(db)
        stats = {**auto_verify_stats(db, settings), **auto_license_stats(db, settings)}
        self.send_json(200, {"ok": True, "settings": settings, "stats": stats, "auto_verified_now": auto_verified, "auto_licensed_now": auto_licensed})

    def api_beta_respond(self, db: Database, user: DbRow | None) -> None:
        if not user:
            self.error(401, "Authentication required")
            return
        settings = get_system_settings(db)
        payload = self.read_json()
        response = str(payload.get("response") or "").strip().lower()
        if response not in ("accepted", "declined"):
            self.error(400, "Response must be accepted or declined")
            return
        if response == "accepted" and not settings["beta_recruiting_enabled"]:
            self.error(409, "Beta recruitment is currently closed")
            return
        db.execute(
            """
            INSERT INTO beta_program_responses (user_id, campaign_id, response, responded_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, campaign_id) DO UPDATE SET response = excluded.response, responded_at = excluded.responded_at
            """,
            (user["id"], settings["beta_campaign_id"], response, now_iso()),
        )
        if response == "accepted":
            updated_roles = sorted(set([*roles_for(user), "beta"]))
            db.execute("UPDATE users SET roles = ? WHERE id = ?", (json.dumps(updated_roles), user["id"]))
            add_message(db, user["id"], "Welcome to the Faircroft Beta Program", "Beta access is active. Open Beta Tasks to begin testing upcoming releases.")
        self.send_json(200, {"ok": True, "response": response})

    def api_beta_tasks(self, db: Database, user: DbRow | None) -> None:
        if not user or not has_any(user, "beta", "dev", "owner"):
            self.error(403 if user else 401, "Beta Program access required")
            return
        tasks = all_rows(db, "SELECT * FROM beta_tasks WHERE active <> 0 ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, updated_at DESC")
        reports = all_rows(
            db,
            "SELECT r.*, t.title AS task_title FROM beta_bug_reports r LEFT JOIN beta_tasks t ON t.id = r.task_id WHERE r.reporter_id = ? ORDER BY r.created_at DESC LIMIT 100",
            (user["id"],),
        )
        self.send_json(200, {"tasks": [dict(row) for row in tasks], "reports": [dict(row) for row in reports]})

    def api_beta_report(self, db: Database, user: DbRow | None) -> None:
        if not user or not has_any(user, "beta", "dev", "owner"):
            self.error(403 if user else 401, "Beta Program access required")
            return
        payload = self.read_json()
        summary = str(payload.get("summary") or "").strip()[:180]
        steps = str(payload.get("steps") or "").strip()[:4000]
        actual = str(payload.get("actual_result") or "").strip()[:3000]
        expected = str(payload.get("expected_result") or "").strip()[:3000]
        severity = str(payload.get("severity") or "standard").strip().lower()
        if not summary or len(steps) < 10 or len(actual) < 5:
            self.error(400, "Summary, reproduction steps, and actual result are required")
            return
        if severity not in ("low", "standard", "high", "critical"):
            severity = "standard"
        task_id = payload.get("task_id")
        task_id = int(task_id) if str(task_id or "").isdigit() else None
        db.execute(
            "INSERT INTO beta_bug_reports (task_id, reporter_id, summary, steps, expected_result, actual_result, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (task_id, user["id"], summary, steps, expected, actual, severity, now_iso()),
        )
        self.send_json(201, {"ok": True})

    def api_dev_beta_program(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        current = get_system_settings(db)
        enabled = bool(payload.get("enabled"))
        message = str(payload.get("message") or current["beta_recruiting_message"]).strip()[:600]
        if len(message) < 20:
            self.error(400, "Recruitment message must be at least 20 characters")
            return
        campaign_id = current["beta_campaign_id"]
        if enabled and not current["beta_recruiting_enabled"]:
            campaign_id += 1
        set_system_setting(db, "beta_recruiting_enabled", "1" if enabled else "0")
        set_system_setting(db, "beta_recruiting_message", message)
        set_system_setting(db, "beta_campaign_id", str(campaign_id))
        add_admin_audit(db, int(user["id"]), "beta.recruitment.updated", details={"enabled": enabled, "campaign_id": campaign_id})
        self.send_json(200, {"ok": True, "settings": get_system_settings(db)})

    def api_dev_create_beta_task(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        title = str(payload.get("title") or "").strip()[:140]
        instructions = str(payload.get("instructions") or "").strip()[:5000]
        test_area = str(payload.get("test_area") or "General").strip()[:80]
        priority = str(payload.get("priority") or "standard").strip().lower()
        if len(title) < 3 or len(instructions) < 10:
            self.error(400, "Task title and detailed instructions are required")
            return
        if priority not in ("low", "standard", "high", "critical"):
            priority = "standard"
        ts = now_iso()
        db.execute(
            "INSERT INTO beta_tasks (title, instructions, test_area, priority, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (title, instructions, test_area, priority, user["id"], ts, ts),
        )
        self.send_json(201, {"ok": True})

    def api_dev_update_beta_task(self, db: Database, user: DbRow | None, task_id: int) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        active = 1 if bool(payload.get("active")) else 0
        db.execute("UPDATE beta_tasks SET active = ?, updated_at = ? WHERE id = ?", (active, now_iso(), task_id))
        self.send_json(200, {"ok": True})

    def api_dev_tools(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        users = all_rows(
            db,
            """
            SELECT u.id, u.civ_number, u.name, u.email, u.verified, u.roles, u.arma_id, u.created_at,
                   CASE WHEN l.id IS NULL THEN 0 ELSE 1 END AS arma_linked,
                   l.identity_id AS linked_arma_id, l.linked_at
            FROM users u
            LEFT JOIN arma_account_links l ON l.user_id = u.id
            ORDER BY u.name, u.id LIMIT 500
            """,
        )
        sanctions = all_rows(
            db,
            """
            SELECT s.*, target.name AS target_name, target.civ_number,
                   creator.name AS created_by_name, revoker.name AS revoked_by_name
            FROM account_sanctions s
            JOIN users target ON target.id = s.user_id
            JOIN users creator ON creator.id = s.created_by
            LEFT JOIN users revoker ON revoker.id = s.revoked_by
            ORDER BY s.created_at DESC LIMIT 250
            """,
        )
        warnings = all_rows(
            db,
            """
            SELECT w.*, target.name AS target_name, target.civ_number,
                   creator.name AS created_by_name, resolver.name AS resolved_by_name
            FROM account_internal_warnings w
            JOIN users target ON target.id = w.user_id
            JOIN users creator ON creator.id = w.created_by
            LEFT JOIN users resolver ON resolver.id = w.resolved_by
            ORDER BY w.created_at DESC LIMIT 250
            """,
        )
        audit_logs = all_rows(
            db,
            """
            SELECT l.*, actor.name AS actor_name, target.name AS target_name, target.civ_number
            FROM admin_audit_logs l
            LEFT JOIN users actor ON actor.id = l.actor_id
            LEFT JOIN users target ON target.id = l.target_user_id
            ORDER BY l.created_at DESC LIMIT 300
            """,
        )
        codes = all_rows(
            db,
            """
            SELECT c.id, c.code_hint, c.expires_at, c.uses_remaining, c.used_at, c.revoked_at, c.created_at,
                   creator.name AS created_by_name, used.name AS used_by_name
            FROM developer_unlink_codes c
            JOIN users creator ON creator.id = c.created_by
            LEFT JOIN users used ON used.id = c.used_by
            ORDER BY c.created_at DESC LIMIT 100
            """,
        )
        now = utcnow()
        active_sanctions = [
            row for row in sanctions
            if not row.get("revoked_at") and (not row.get("expires_at") or parse_iso(row["expires_at"]) > now)
        ]
        active_bans = sum(1 for row in active_sanctions if row.get("sanction_type") == "ban")
        active_timeouts = sum(1 for row in active_sanctions if row.get("sanction_type") == "timeout")
        account_stats = one(
            db,
            """
            SELECT
                COUNT(*) AS total_accounts,
                COUNT(*) FILTER (WHERE u.verified <> 0) AS verified_accounts,
                COUNT(*) FILTER (WHERE u.verified = 0) AS unverified_accounts,
                COUNT(l.id) AS linked_accounts,
                COUNT(*) FILTER (WHERE l.id IS NULL) AS unlinked_accounts,
                COUNT(*) FILTER (WHERE u.verified <> 0 AND l.id IS NULL) AS verified_unlinked
            FROM users u
            LEFT JOIN arma_account_links l ON l.user_id = u.id
            """,
        )
        recent_links = all_rows(
            db,
            """
            SELECT l.id, l.user_id AS account_id, l.linked_at, l.player_name, l.identity_id AS arma_id,
                   u.name AS account_name, u.civ_number
            FROM arma_account_links l
            JOIN users u ON u.id = l.user_id
            ORDER BY l.linked_at DESC LIMIT 40
            """,
        )
        system_settings = get_system_settings(db)
        app_visibility = system_settings["app_visibility"]
        beta_tasks = all_rows(db, "SELECT * FROM beta_tasks ORDER BY active DESC, updated_at DESC LIMIT 100")
        beta_reports = all_rows(
            db,
            """
            SELECT r.*, reporter.name AS reporter_name, t.title AS task_title
            FROM beta_bug_reports r
            JOIN users reporter ON reporter.id = r.reporter_id
            LEFT JOIN beta_tasks t ON t.id = r.task_id
            ORDER BY r.created_at DESC LIMIT 200
            """,
        )
        beta_member_rows = all_rows(
            db,
            """
            SELECT u.id, u.name, u.civ_number, u.email, u.verified, u.roles,
                   (SELECT MAX(r.responded_at) FROM beta_program_responses r
                    WHERE r.user_id = u.id AND r.response = 'accepted') AS beta_joined_at,
                   CASE WHEN link.id IS NULL THEN 0 ELSE 1 END AS arma_linked,
                   link.identity_id AS linked_arma_id
            FROM users u
            LEFT JOIN arma_account_links link ON link.user_id = u.id
            WHERE u.roles LIKE ?
            ORDER BY COALESCE(
                (SELECT MAX(r.responded_at) FROM beta_program_responses r
                 WHERE r.user_id = u.id AND r.response = 'accepted'),
                u.created_at
            ) DESC, u.name
            """,
            ("%beta%",),
        )
        live_cutoff = (utcnow() - dt.timedelta(seconds=ANTICHEAT_LIVE_TTL_SECONDS)).isoformat()
        anticheat_players = all_rows(
            db,
            """
            SELECT p.*, link.user_id AS linked_user_id, link.linked_platform,
                   COALESCE(NULLIF(p.reported_system, ''), NULLIF(link.linked_platform, ''), 'Unknown') AS detected_system,
                   account.name AS account_name,
                   account.civ_number, live.server_id, live.joined_at,
                   live.last_heartbeat_at,
                   CASE WHEN live.last_heartbeat_at >= ? THEN 1 ELSE 0 END AS online,
                   COALESCE(alts.alt_group_count, 0) AS alt_group_count
            FROM anticheat_players p
            LEFT JOIN LATERAL (
                SELECT l.user_id, l.platform AS linked_platform FROM arma_account_links l
                WHERE l.identity_id = p.uid OR l.uid = p.uid
                ORDER BY l.linked_at DESC LIMIT 1
            ) link ON TRUE
            LEFT JOIN users account ON account.id = link.user_id
            LEFT JOIN LATERAL (
                SELECT s.server_id, s.joined_at, s.last_heartbeat_at
                FROM anticheat_live_sessions s
                WHERE s.player_uid = p.uid
                ORDER BY s.last_heartbeat_at DESC LIMIT 1
            ) live ON TRUE
            LEFT JOIN (
                SELECT uid, COUNT(*) AS alt_group_count
                FROM anticheat_alt_members GROUP BY uid
            ) alts ON alts.uid = p.uid
            ORDER BY online DESC, p.ticket_count DESC, p.last_synced_at DESC
            LIMIT 1000
            """,
            (live_cutoff,),
        )
        anticheat_events = all_rows(
            db,
            """
            SELECT e.*, p.player_name
            FROM anticheat_events e
            LEFT JOIN anticheat_players p ON p.uid = e.player_uid
            ORDER BY e.event_time DESC, e.first_synced_at DESC LIMIT 500
            """,
        )
        anticheat_alt_groups = all_rows(
            db, "SELECT * FROM anticheat_alt_groups ORDER BY last_seen DESC, group_key LIMIT 300"
        )
        anticheat_alt_members = all_rows(
            db, "SELECT * FROM anticheat_alt_members ORDER BY group_key, observed_name LIMIT 2000"
        )
        anticheat_sync_status = all_rows(
            db, "SELECT * FROM anticheat_sync_status ORDER BY source_key"
        )
        anticheat_online = sum(1 for row in anticheat_players if row.get("online"))
        anticheat_flagged = sum(
            1 for row in anticheat_players
            if int(row.get("teleport_flags") or 0) + int(row.get("aim_flags") or 0) > 0
        )
        persistence_sync = one(
            db,
            "SELECT * FROM game_persistence_sync_status ORDER BY updated_at DESC LIMIT 1",
        )
        persistence_categories = all_rows(
            db,
            """
            SELECT category, COUNT(*) AS records, MAX(synced_at) AS last_synced_at
            FROM game_persistence_records
            GROUP BY category ORDER BY category
            """,
        )
        bank_category = one(
            db,
            "SELECT COUNT(*) AS records, MAX(synced_at) AS last_synced_at FROM arma_game_bank_balances",
        )
        bank_economy = one(
            db,
            """
            SELECT COUNT(*) AS bank_accounts,
                   COALESCE(SUM(balance), 0) AS currency_in_circulation,
                   COALESCE(AVG(balance), 0) AS average_balance,
                   COALESCE(MAX(balance), 0) AS largest_balance,
                   SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS funded_accounts,
                   SUM(CASE WHEN balance <= 0 THEN 1 ELSE 0 END) AS empty_accounts,
                   MAX(synced_at) AS last_synced_at
            FROM arma_game_bank_balances
            """,
        )
        linked_bank_accounts = one(
            db,
            """
            SELECT COUNT(DISTINCT b.identity_id) AS linked_accounts
            FROM arma_game_bank_balances b
            JOIN arma_account_links l ON l.identity_id = b.identity_id
            """,
        )
        if bank_category and int(bank_category.get("records") or 0):
            persistence_categories.insert(0, {
                "category": "Banks",
                "records": int(bank_category["records"] or 0),
                "last_synced_at": bank_category.get("last_synced_at"),
            })
        self.send_json(
            200,
            {
                "users": [dict(row) for row in users],
                "sanctions": [dict(row) for row in sanctions],
                "active_sanctions": len(active_sanctions),
                "active_bans": active_bans,
                "active_timeouts": active_timeouts,
                "total_accounts": int(account_stats["total_accounts"] or 0),
                "verified_accounts": int(account_stats["verified_accounts"] or 0),
                "verified_unlinked": int(account_stats["verified_unlinked"] or 0),
                "unverified_accounts": int(account_stats["unverified_accounts"] or 0),
                "linked_accounts": int(account_stats["linked_accounts"] or 0),
                "unlinked_accounts": int(account_stats["unlinked_accounts"] or 0),
                "recent_links": [dict(row) for row in recent_links],
                "warnings": [dict(row) for row in warnings],
                "audit_logs": [dict(row) for row in audit_logs],
                "unlink_codes": [dict(row) for row in codes],
                "beta_program": {
                    "recruiting_enabled": system_settings["beta_recruiting_enabled"],
                    "recruiting_message": system_settings["beta_recruiting_message"],
                    "campaign_id": system_settings["beta_campaign_id"],
                    "members": len(beta_member_rows),
                    "member_roster": [dict(row) for row in beta_member_rows],
                    "tasks": [dict(row) for row in beta_tasks],
                    "reports": [dict(row) for row in beta_reports],
                },
                "anti_cheat": {
                    "players": [dict(row) for row in anticheat_players],
                    "events": [dict(row) for row in anticheat_events],
                    "alt_groups": [dict(row) for row in anticheat_alt_groups],
                    "alt_members": [dict(row) for row in anticheat_alt_members],
                    "sync_status": [dict(row) for row in anticheat_sync_status],
                    "live_ttl_seconds": ANTICHEAT_LIVE_TTL_SECONDS,
                    "metrics": {
                        "players": len(anticheat_players),
                        "online": anticheat_online,
                        "flagged": anticheat_flagged,
                        "alt_groups": len(anticheat_alt_groups),
                        "events": len(anticheat_events),
                    },
                },
                "game_intelligence": {
                    "sync": dict(persistence_sync) if persistence_sync else {
                        "status": "awaiting_first_sync",
                        "records": 0,
                        "source_root": SHADOWHAVEN_PERSISTENCE_ROOT,
                    },
                    "categories": [dict(row) for row in persistence_categories],
                    "economy": {
                        "currency_in_circulation": float(bank_economy.get("currency_in_circulation") or 0),
                        "average_balance": float(bank_economy.get("average_balance") or 0),
                        "largest_balance": float(bank_economy.get("largest_balance") or 0),
                        "bank_accounts": int(bank_economy.get("bank_accounts") or 0),
                        "funded_accounts": int(bank_economy.get("funded_accounts") or 0),
                        "empty_accounts": int(bank_economy.get("empty_accounts") or 0),
                        "linked_accounts": int(linked_bank_accounts.get("linked_accounts") or 0),
                        "last_synced_at": bank_economy.get("last_synced_at"),
                        "source": "FCRPMUSSALO/Banks",
                    },
                    "read_only": True,
                    "transaction_history_available": False,
                },
                "app_visibility": {
                    "apps": [
                        {"id": app_id, "label": label, "enabled": app_visibility.get(app_id, True)}
                        for app_id, label in APP_VISIBILITY_OPTIONS
                    ],
                    "protected": sorted(PROTECTED_APP_IDS),
                },
            },
        )

    def api_dev_update_app_visibility(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        payload = self.read_json()
        visibility_payload = payload.get("visibility")
        if not isinstance(visibility_payload, dict):
            self.error(400, "App visibility must be an object")
            return
        allowed = {app_id for app_id, _label in APP_VISIBILITY_OPTIONS}
        visibility = {
            app_id: bool(visibility_payload.get(app_id, True))
            for app_id in allowed
        }
        set_system_setting(db, "app_visibility", json.dumps(visibility, separators=(",", ":"), sort_keys=True))
        add_admin_audit(
            db,
            int(user["id"]),
            "system.app_visibility.updated",
            details={"disabled": sorted(app_id for app_id, enabled in visibility.items() if not enabled)},
        )
        self.send_json(
            200,
            {
                "ok": True,
                "apps": [
                    {"id": app_id, "label": label, "enabled": visibility.get(app_id, True)}
                    for app_id, label in APP_VISIBILITY_OPTIONS
                ],
            },
        )

    def api_dev_generate_unlink_code(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        try:
            expiry_minutes = max(5, min(int(payload.get("expiry_minutes") or 30), 1440))
        except (TypeError, ValueError):
            self.error(400, "Expiry must be a number of minutes")
            return
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw_code = "DEV-" + "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))
        code_hash = hashlib.sha256(raw_code.encode("utf-8")).hexdigest()
        created_at = utcnow()
        expires_at = created_at + dt.timedelta(minutes=expiry_minutes)
        db.execute(
            """
            INSERT INTO developer_unlink_codes
            (code_hash, code_hint, created_by, expires_at, uses_remaining, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (code_hash, raw_code[-4:], user["id"], expires_at.isoformat(), created_at.isoformat()),
        )
        add_admin_audit(db, int(user["id"]), "dev.unlink_code.created", details={"code_hint": raw_code[-4:], "expires_at": expires_at.isoformat()})
        self.send_json(201, {"ok": True, "code": raw_code, "expires_at": expires_at.isoformat(), "uses": 1})

    def api_dev_account(self, db: Database, user: DbRow | None, target_id: int) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        account = one(
            db,
            """
            SELECT u.*, l.id AS link_id, l.server_id, l.identity_id, l.uid,
                   l.rpl_identity, l.platform, l.player_name, l.linked_at,
                   l.last_seen_at, l.last_sync_at
            FROM users u
            LEFT JOIN arma_account_links l ON l.user_id = u.id
            WHERE u.id = ?
            """,
            (target_id,),
        )
        if not account:
            self.error(404, "Account not found")
            return
        if not account.get("link_id"):
            self.error(409, "This account does not have an active Arma link")
            return
        sanctions = all_rows(
            db,
            """
            SELECT s.*, creator.name AS created_by_name, revoker.name AS revoked_by_name
            FROM account_sanctions s
            JOIN users creator ON creator.id = s.created_by
            LEFT JOIN users revoker ON revoker.id = s.revoked_by
            WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100
            """,
            (target_id,),
        )
        warnings = all_rows(
            db,
            """
            SELECT w.*, creator.name AS created_by_name, resolver.name AS resolved_by_name
            FROM account_internal_warnings w
            JOIN users creator ON creator.id = w.created_by
            LEFT JOIN users resolver ON resolver.id = w.resolved_by
            WHERE w.user_id = ? ORDER BY w.created_at DESC LIMIT 100
            """,
            (target_id,),
        )
        arma_activity = all_rows(
            db,
            """
            SELECT * FROM arma_activity_logs
            WHERE user_id = ? ORDER BY received_at DESC LIMIT 150
            """,
            (target_id,),
        )
        characters = all_rows(
            db,
            "SELECT * FROM user_characters WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC",
            (target_id,),
        )
        jobs = all_rows(
            db,
            """
            SELECT uj.*, j.title, j.market
            FROM user_jobs uj JOIN jobs j ON j.id = uj.job_id
            WHERE uj.user_id = ? ORDER BY uj.started_at DESC
            """,
            (target_id,),
        )
        citations = all_rows(
            db,
            """
            SELECT c.*
            FROM citations c
            WHERE c.civ_id = ? ORDER BY c.created_at DESC LIMIT 100
            """,
            (target_id,),
        )
        properties = all_rows(
            db,
            """
            SELECT p.* FROM properties p
            WHERE p.owner_id = ? ORDER BY p.created_at DESC
            """,
            (target_id,),
        )
        active_block = active_account_block(db, target_id)
        game_bank = one(
            db,
            "SELECT * FROM arma_game_bank_balances WHERE identity_id = ?",
            (account.get("identity_id") or "",),
        )
        identity_candidates = [
            str(account.get("identity_id") or "").strip(),
            str(account.get("uid") or "").strip(),
            str(account.get("rpl_identity") or "").strip(),
        ]
        identity_candidates = [value for value in dict.fromkeys(identity_candidates) if value]
        persistence_records: list[DbRow] = []
        if identity_candidates:
            clauses: list[str] = []
            params: list[str] = []
            for identity in identity_candidates:
                clauses.extend([
                    "record_id = ?",
                    "owner_identity = ?",
                    "identity_values LIKE ?",
                    "raw_payload LIKE ?",
                ])
                params.extend([identity, identity, f"%{identity}%", f"%{identity}%"])
            persistence_records = all_rows(
                db,
                f"""
                SELECT source_path, category, record_id, title, owner_identity,
                       identity_values, component_types, prefab, record_status,
                       amount_text, summary_payload, source_modified_at, synced_at
                FROM game_persistence_records
                WHERE {" OR ".join(clauses)}
                ORDER BY category, source_modified_at DESC, record_id
                LIMIT 500
                """,
                tuple(params),
            )
        normalized_persistence: list[dict[str, Any]] = []
        for row in persistence_records:
            record = dict(row)
            for key, fallback in (("identity_values", []), ("component_types", []), ("summary_payload", {})):
                try:
                    record[key] = json.loads(record.get(key) or json.dumps(fallback))
                except json.JSONDecodeError:
                    record[key] = fallback
            direct_values = set(record.get("identity_values") or [])
            record["match_confidence"] = (
                "direct"
                if record.get("record_id") in identity_candidates
                or record.get("owner_identity") in identity_candidates
                or direct_values.intersection(identity_candidates)
                else "payload"
            )
            normalized_persistence.append(record)
        persistence_sync = one(
            db,
            "SELECT * FROM game_persistence_sync_status ORDER BY updated_at DESC LIMIT 1",
        )
        anticheat_record = one(
            db,
            """
            SELECT p.*,
                   COALESCE(NULLIF(p.reported_system, ''), NULLIF(?, ''), 'Unknown') AS detected_system
            FROM anticheat_players p
            WHERE p.uid = ? OR p.uid = ?
            ORDER BY p.last_synced_at DESC
            LIMIT 1
            """,
            (
                account.get("platform") or "",
                account.get("uid") or "",
                account.get("identity_id") or "",
            ),
        )
        response_account = public_user(account)
        response_account.update(
            {
                "identity_id": account.get("identity_id") or "",
                "uid": account.get("uid") or "",
                "rpl_identity": account.get("rpl_identity") or "",
                "platform": account.get("platform") or "",
                "player_name": account.get("player_name") or "",
                "server_id": account.get("server_id") or "",
                "linked_at": account.get("linked_at"),
                "last_seen_at": account.get("last_seen_at"),
                "last_sync_at": account.get("last_sync_at"),
            }
        )
        self.send_json(
            200,
            {
                "account": response_account,
                "active_block": dict(active_block) if active_block else None,
                "sanctions": [dict(row) for row in sanctions],
                "warnings": [dict(row) for row in warnings],
                "arma_activity": [dict(row) for row in arma_activity],
                "characters": [dict(row) for row in characters],
                "jobs": [dict(row) for row in jobs],
                "citations": [dict(row) for row in citations],
                "properties": [dict(row) for row in properties],
                "anti_cheat": dict(anticheat_record) if anticheat_record else {
                    "detected_system": account.get("platform") or "Unknown",
                    "reported_system": "",
                    "status": "awaiting_anti_cheat_match",
                },
                "game_database": {
                    "status": "synced" if game_bank or persistence_records else "awaiting_sync",
                    "source": "FCRPMUSSALO",
                    "collections": [
                        "Banks", "Characters", "CopChats", "Criminals", "Items",
                        "PoliceReports", "RootEntityCollections", "Turrets", "Vehicles",
                    ],
                    "bank": dict(game_bank) if game_bank else None,
                    "records": normalized_persistence,
                    "sync": dict(persistence_sync) if persistence_sync else None,
                    "read_only": True,
                    "transaction_history_available": False,
                },
            },
        )

    def api_dev_create_sanction(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "user_id", "sanction_type", "reason")
        if missing:
            self.error(400, missing)
            return
        sanction_type = str(payload["sanction_type"]).strip().lower()
        if sanction_type not in ("ban", "timeout", "sanction"):
            self.error(400, "Sanction type must be ban, timeout, or sanction")
            return
        report_fields = (
            "rule_code",
            "incident_at",
            "incident_summary",
            "evidence",
            "staff_findings",
            "appeal_guidance",
        )
        if sanction_type in ("ban", "timeout"):
            report_missing = require_fields(payload, *report_fields)
            if report_missing:
                self.error(400, f"A complete enforcement report is required: {report_missing}")
                return
            if len(str(payload.get("incident_summary") or "").strip()) < 40:
                self.error(400, "Incident summary must contain at least 40 characters")
                return
            if len(str(payload.get("staff_findings") or "").strip()) < 30:
                self.error(400, "Staff findings must contain at least 30 characters")
                return
            if len(str(payload.get("evidence") or "").strip()) < 10:
                self.error(400, "Evidence and log references must contain at least 10 characters")
                return
        target_id = int(payload["user_id"])
        target = one(db, "SELECT * FROM users WHERE id = ?", (target_id,))
        if not target:
            self.error(404, "Target account not found")
            return
        if has_any(target, "owner") and not has_any(user, "owner"):
            self.error(403, "Only the owner can sanction an owner account")
            return
        starts_at = utcnow()
        report_number = f"FR-{starts_at.strftime('%Y%m%d')}-{secrets.randbelow(900000) + 100000}"
        expires_at: str | None = None
        try:
            bail_amount = max(0.0, min(float(payload.get("bail_amount") or 0), 10_000_000.0))
        except (TypeError, ValueError):
            self.error(400, "Bail amount must be a valid number")
            return
        if sanction_type == "timeout":
            try:
                duration_minutes = max(1, min(int(payload.get("duration_minutes") or 60), 525600))
            except (TypeError, ValueError):
                self.error(400, "Timeout duration must be a number of minutes")
                return
            expires_at = (starts_at + dt.timedelta(minutes=duration_minutes)).isoformat()
        elif sanction_type == "sanction" and payload.get("duration_minutes"):
            expires_at = (starts_at + dt.timedelta(minutes=max(1, int(payload["duration_minutes"])))).isoformat()
        game_enforcement = {"status": "not_required", "response": ""}
        identity = one(
            db,
            "SELECT identity_id FROM arma_account_links WHERE user_id = ? ORDER BY linked_at DESC LIMIT 1",
            (target_id,),
        )
        if sanction_type in ("ban", "timeout"):
            if not identity or not str(identity.get("identity_id") or "").strip():
                self.error(409, "This account has no linked Bohemia identity, so the game ban cannot be applied")
                return
            if not arma_rcon_configured():
                self.error(503, "Arma RCON is not configured. Set ARMA_RCON_HOST, ARMA_RCON_PORT, and ARMA_RCON_PASSWORD.")
                return
            duration_seconds = 0
            if sanction_type == "timeout":
                duration_seconds = duration_minutes * 60
            rcon_reason = " ".join(str(payload["reason"]).replace("#", "").split())[:240]
            try:
                game_enforcement = execute_arma_rcon(
                    f"#ban create {identity['identity_id']} {duration_seconds} {rcon_reason}"
                )
            except (OSError, RuntimeError) as exc:
                add_admin_audit(
                    db,
                    int(user["id"]),
                    f"account.{sanction_type}.rcon_failed",
                    target_id,
                    {"report_number": report_number, "identity_id": identity["identity_id"], "error": str(exc)[:500]},
                )
                self.error(502, f"The enforcement report was not created because Arma RCON failed: {exc}")
                return
        created = db.execute(
            """
            INSERT INTO account_sanctions
            (user_id, sanction_type, reason, report_number, rule_code, incident_at,
             incident_summary, evidence, witness_names, staff_findings, player_statement,
             appeal_guidance, internal_notes, bail_amount, starts_at, expires_at, created_by, created_at,
             game_enforcement_status, game_enforcement_response, game_enforcement_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (
                target_id,
                sanction_type,
                str(payload["reason"]).strip()[:1200],
                report_number,
                str(payload.get("rule_code") or "").strip()[:40],
                str(payload.get("incident_at") or "").strip()[:80],
                str(payload.get("incident_summary") or "").strip()[:5000],
                str(payload.get("evidence") or "").strip()[:5000],
                str(payload.get("witness_names") or "").strip()[:1200],
                str(payload.get("staff_findings") or "").strip()[:5000],
                str(payload.get("player_statement") or "").strip()[:3000],
                str(payload.get("appeal_guidance") or "").strip()[:2000],
                str(payload.get("internal_notes") or "").strip()[:2000],
                bail_amount,
                starts_at.isoformat(),
                expires_at,
                user["id"],
                starts_at.isoformat(),
                game_enforcement["status"],
                game_enforcement["response"],
                starts_at.isoformat() if game_enforcement["status"] == "applied" else None,
            ),
        ).fetchone()
        add_admin_audit(db, int(user["id"]), f"account.{sanction_type}.created", target_id, {"report_number": report_number, "rule_code": payload.get("rule_code"), "reason": payload["reason"], "expires_at": expires_at, "game_enforcement_status": game_enforcement["status"], "identity_id": identity.get("identity_id") if identity else None})
        self.send_json(
            201,
            {
                "ok": True,
                "id": int(created["id"]),
                "report_number": report_number,
                "expires_at": expires_at,
                "game_enforcement_status": game_enforcement["status"],
                "game_enforcement_response": game_enforcement["response"],
            },
        )

    def api_dev_revoke_sanction(self, db: Database, user: DbRow | None, sanction_id: int) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        sanction = one(db, "SELECT * FROM account_sanctions WHERE id = ?", (sanction_id,))
        if not sanction:
            self.error(404, "Sanction not found")
            return
        if sanction.get("revoked_at"):
            self.error(409, "Sanction is already revoked")
            return
        payload = self.read_json()
        reason = str(payload.get("reason") or "Revoked by staff").strip()[:1000]
        game_enforcement = {"status": "not_required", "response": ""}
        if sanction.get("sanction_type") in ("ban", "timeout"):
            identity = one(
                db,
                "SELECT identity_id FROM arma_account_links WHERE user_id = ? ORDER BY linked_at DESC LIMIT 1",
                (sanction["user_id"],),
            )
            if not identity or not str(identity.get("identity_id") or "").strip():
                self.error(409, "This account has no linked Bohemia identity, so it cannot be unbanned in Arma")
                return
            if not arma_rcon_configured():
                self.error(503, "Arma RCON is not configured. Set ARMA_RCON_HOST, ARMA_RCON_PORT, and ARMA_RCON_PASSWORD.")
                return
            try:
                game_enforcement = execute_arma_rcon(f"#ban remove {identity['identity_id']}")
            except (OSError, RuntimeError) as exc:
                add_admin_audit(
                    db,
                    int(user["id"]),
                    "account.unban.rcon_failed",
                    int(sanction["user_id"]),
                    {"sanction_id": sanction_id, "identity_id": identity["identity_id"], "error": str(exc)[:500]},
                )
                self.error(502, f"The CAD sanction remains active because Arma RCON unban failed: {exc}")
                return
        db.execute(
            """UPDATE account_sanctions
               SET revoked_by = ?, revoked_at = ?, revoke_reason = ?,
                   game_enforcement_status = ?, game_enforcement_response = ?, game_enforcement_at = ?
               WHERE id = ?""",
            (user["id"], now_iso(), reason, game_enforcement["status"], game_enforcement["response"], now_iso() if game_enforcement["status"] == "applied" else None, sanction_id),
        )
        audit_action = "account.unban.applied" if sanction.get("sanction_type") in ("ban", "timeout") else "account.sanction.revoked"
        add_admin_audit(db, int(user["id"]), audit_action, int(sanction["user_id"]), {"sanction_id": sanction_id, "reason": reason, "game_enforcement_status": game_enforcement["status"]})
        self.send_json(200, {"ok": True, "game_enforcement_status": game_enforcement["status"], "game_enforcement_response": game_enforcement["response"]})

    def api_dev_create_warning(self, db: Database, user: DbRow | None) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        missing = require_fields(payload, "user_id", "subject", "body")
        if missing:
            self.error(400, missing)
            return
        target_id = int(payload["user_id"])
        if not one(db, "SELECT id FROM users WHERE id = ?", (target_id,)):
            self.error(404, "Target account not found")
            return
        severity = str(payload.get("severity") or "standard").strip().lower()
        if severity not in ("low", "standard", "high", "critical"):
            self.error(400, "Invalid warning severity")
            return
        created = db.execute(
            """
            INSERT INTO account_internal_warnings
            (user_id, severity, subject, body, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (target_id, severity, str(payload["subject"]).strip()[:160], str(payload["body"]).strip()[:3000], user["id"], now_iso()),
        ).fetchone()
        add_admin_audit(db, int(user["id"]), "account.internal_warning.created", target_id, {"severity": severity, "subject": payload["subject"]})
        self.send_json(201, {"ok": True, "id": int(created["id"])})

    def api_dev_resolve_warning(self, db: Database, user: DbRow | None, warning_id: int) -> None:
        err = developer_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        warning = one(db, "SELECT * FROM account_internal_warnings WHERE id = ?", (warning_id,))
        if not warning:
            self.error(404, "Warning not found")
            return
        payload = self.read_json()
        notes = str(payload.get("notes") or "Resolved by staff").strip()[:1200]
        db.execute(
            "UPDATE account_internal_warnings SET resolved_by = ?, resolved_at = ?, resolution_notes = ? WHERE id = ?",
            (user["id"], now_iso(), notes, warning_id),
        )
        add_admin_audit(db, int(user["id"]), "account.internal_warning.resolved", int(warning["user_id"]), {"warning_id": warning_id, "notes": notes})
        self.send_json(200, {"ok": True})

    def fine_settlement_payload(self, db: Database) -> dict[str, Any]:
        unpaid = all_rows(
            db,
            """
            SELECT c.id, c.charge_code, c.charge_title, c.fine_amount, c.status,
                   c.created_at, u.id AS user_id, u.name, u.civ_number,
                   l.identity_id, b.balance, b.synced_at
            FROM citations c
            JOIN users u ON u.id = c.civ_id
            LEFT JOIN arma_account_links l ON l.user_id = u.id
            LEFT JOIN arma_game_bank_balances b ON b.identity_id = l.identity_id
            LEFT JOIN fine_settlement_items i ON i.citation_id = c.id
            WHERE c.status IN ('issued', 'reviewed', 'reduced', 'closed') AND i.id IS NULL
              AND COALESCE(c.disposition, '') NOT IN ('not_guilty', 'dismissed')
              AND l.identity_id IS NOT NULL AND b.balance IS NOT NULL
              AND b.balance >= c.fine_amount
            ORDER BY c.created_at ASC
            """
        )
        batches = all_rows(
            db,
            """
            SELECT b.*, creator.name AS created_by_name, approver.name AS approved_by_name,
                   COUNT(i.id) AS item_count, COALESCE(SUM(i.fine_amount), 0) AS total_amount
            FROM fine_settlement_batches b
            JOIN users creator ON creator.id = b.created_by
            LEFT JOIN users approver ON approver.id = b.approved_by
            LEFT JOIN fine_settlement_items i ON i.batch_id = b.id
            GROUP BY b.id, creator.name, approver.name
            ORDER BY b.created_at DESC LIMIT 30
            """
        )
        result_batches: list[dict[str, Any]] = []
        for batch in batches:
            item = dict(batch)
            item["items"] = [
                dict(row)
                for row in all_rows(
                    db,
                    """
                    SELECT i.*, c.charge_code, c.charge_title, u.name, u.civ_number
                    FROM fine_settlement_items i
                    JOIN citations c ON c.id = i.citation_id
                    JOIN users u ON u.id = i.user_id
                    WHERE i.batch_id = ? ORDER BY i.id
                    """,
                    (batch["id"],),
                )
            ]
            result_batches.append(item)
        tax_ready = all_rows(
            db,
            """
            SELECT b.id AS business_id, b.business_name, b.license_number, u.id AS user_id,
                   u.name AS owner_name, u.civ_number, l.identity_id, bank.balance, bank.synced_at,
                   COUNT(t.id) AS assessment_count, SUM(t.amount) AS tax_amount
            FROM business_tax_assessments t
            JOIN businesses b ON b.id = t.business_id
            JOIN users u ON u.id = b.owner_id
            JOIN arma_account_links l ON l.user_id = u.id
            JOIN arma_game_bank_balances bank ON bank.identity_id = l.identity_id
            WHERE t.status = 'unpaid' AND t.settlement_batch_id IS NULL
            GROUP BY b.id, b.business_name, b.license_number, u.id, u.name, u.civ_number,
                     l.identity_id, bank.balance, bank.synced_at
            HAVING bank.balance >= SUM(t.amount)
            ORDER BY b.business_name
            """
        )
        tax_license_rows = all_rows(
            db,
            """
            SELECT b.*, u.name AS owner_name, u.civ_number AS owner_civ_number,
                   l.identity_id, bank.balance, bank.synced_at,
                   (SELECT COALESCE(SUM(t.amount), 0) FROM business_tax_assessments t
                    WHERE t.business_id = b.id AND t.status = 'unpaid') AS unpaid_tax
            FROM businesses b
            JOIN users u ON u.id = b.owner_id
            JOIN arma_account_links l ON l.user_id = u.id
            LEFT JOIN arma_game_bank_balances bank ON bank.identity_id = l.identity_id
            WHERE b.status IN ('active', 'suspended')
            ORDER BY b.business_name
            """
        )
        tax_licenses = [self.business_license_payload(row) for row in tax_license_rows]
        tax_batches = all_rows(
            db,
            """
            SELECT b.*, creator.name AS created_by_name, approver.name AS approved_by_name,
                   COUNT(i.id) AS item_count, COALESCE(SUM(i.tax_amount), 0) AS total_amount
            FROM business_tax_settlement_batches b
            JOIN users creator ON creator.id = b.created_by
            LEFT JOIN users approver ON approver.id = b.approved_by
            LEFT JOIN business_tax_settlement_items i ON i.batch_id = b.id
            GROUP BY b.id, creator.name, approver.name
            ORDER BY b.created_at DESC LIMIT 30
            """
        )
        result_tax_batches: list[dict[str, Any]] = []
        for batch in tax_batches:
            item = dict(batch)
            item["items"] = [
                dict(row) for row in all_rows(
                    db,
                    """
                    SELECT i.*, b.business_name, b.license_number, u.name AS owner_name
                    FROM business_tax_settlement_items i
                    JOIN businesses b ON b.id = i.business_id
                    JOIN users u ON u.id = i.user_id
                    WHERE i.batch_id = ? ORDER BY i.id
                    """,
                    (batch["id"],),
                )
            ]
            result_tax_batches.append(item)
        return {
            "unpaid": [dict(row) for row in unpaid],
            "batches": result_batches,
            "tax_ready": [dict(row) for row in tax_ready],
            "tax_licenses": tax_licenses,
            "tax_batches": result_tax_batches,
        }

    def api_fine_settlement(self, db: Database, user: DbRow | None) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        self.send_json(200, self.fine_settlement_payload(db))

    def api_create_fine_settlement_batch(self, db: Database, user: DbRow | None) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        raw_ids = payload.get("citation_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            self.error(400, "Select at least one unpaid fine")
            return
        citation_ids = list(dict.fromkeys(int(value) for value in raw_ids))[:100]
        placeholders = ",".join("?" for _ in citation_ids)
        rows = all_rows(
            db,
            f"""
            SELECT c.id, c.civ_id, c.fine_amount, c.status, l.identity_id, b.balance
            FROM citations c
            JOIN arma_account_links l ON l.user_id = c.civ_id
            JOIN arma_game_bank_balances b ON b.identity_id = l.identity_id
            LEFT JOIN fine_settlement_items i ON i.citation_id = c.id
            WHERE c.id IN ({placeholders})
              AND c.status IN ('issued', 'reviewed', 'reduced', 'closed') AND i.id IS NULL
              AND COALESCE(c.disposition, '') NOT IN ('not_guilty', 'dismissed')
              AND b.balance >= c.fine_amount
            """,
            tuple(citation_ids),
        )
        if len(rows) != len(citation_ids):
            self.error(409, "Every selected fine must be unpaid, unbatched, linked, and have a synced game balance")
            return
        created_at = utcnow()
        batch_number = f"DCJS-{created_at.strftime('%Y%m%d')}-{secrets.randbelow(900000) + 100000}"
        batch = db.execute(
            """
            INSERT INTO fine_settlement_batches (batch_number, created_by, created_at, notes)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (batch_number, user["id"], created_at.isoformat(), str(payload.get("notes") or "").strip()[:2000]),
        ).fetchone()
        for row in rows:
            fine = round(float(row["fine_amount"]), 2)
            before = round(float(row["balance"]), 2)
            db.execute(
                """
                INSERT INTO fine_settlement_items
                (batch_id, citation_id, user_id, identity_id, fine_amount, balance_before, expected_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (batch["id"], row["id"], row["civ_id"], row["identity_id"], fine, before, round(before - fine, 2)),
            )
        add_admin_audit(db, int(user["id"]), "fine_settlement.batch.created", details={"batch_number": batch_number, "citation_ids": citation_ids})
        self.send_json(201, {"ok": True, "batch_id": int(batch["id"]), "batch_number": batch_number})

    def api_fine_settlement_code(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        batch = one(db, "SELECT * FROM fine_settlement_batches WHERE id = ?", (batch_id,))
        if not batch:
            self.error(404, "Settlement batch not found")
            return
        if batch["status"] != "draft":
            self.error(409, "Only a draft batch can receive a new approval code")
            return
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw_code = "DCJS-" + "".join(secrets.choice(alphabet) for _ in range(8))
        expires_at = (utcnow() + dt.timedelta(minutes=10)).isoformat()
        db.execute(
            "UPDATE fine_settlement_batches SET approval_code_hash = ?, approval_code_hint = ?, approval_expires_at = ? WHERE id = ?",
            (hash_password(raw_code), raw_code[-4:], expires_at, batch_id),
        )
        add_admin_audit(db, int(user["id"]), "fine_settlement.code.created", details={"batch_id": batch_id, "hint": raw_code[-4:]})
        self.send_json(201, {"ok": True, "code": raw_code, "expires_at": expires_at})

    def api_approve_fine_settlement(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        batch = one(db, "SELECT * FROM fine_settlement_batches WHERE id = ?", (batch_id,))
        code = str(payload.get("code") or "").strip().upper()
        if not batch or batch["status"] != "draft":
            self.error(409, "Settlement batch is not awaiting approval")
            return
        if not batch["approval_code_hash"] or not verify_password(code, batch["approval_code_hash"]):
            self.error(403, "Invalid settlement authorization code")
            return
        if not batch["approval_expires_at"] or dt.datetime.fromisoformat(batch["approval_expires_at"]) <= utcnow():
            self.error(403, "Settlement authorization code has expired")
            return
        approved_at = now_iso()
        db.execute(
            """
            UPDATE fine_settlement_batches
            SET status = 'awaiting_codex', approved_by = ?, approved_at = ?,
                processing_started_at = ?, approval_code_hash = ''
            WHERE id = ?
            """,
            (user["id"], approved_at, approved_at, batch_id),
        )
        prompt = (
            f"Process approved DCJS fine settlement batch {batch['batch_number']} (database batch ID {batch_id}). "
            "Use the signed-in Shadowhaven panel and configured SFTP access. Stop the Arma server manually, "
            "wait the full 120 seconds, confirm it is offline, then edit only the matching live FCRPMUSSALO/Banks "
            "JSON balances to the locked expected values shown in Fine Settlement. Do not create a backup. "
            "Start the server, wait for Railway bank sync, then use Verify synced balances in the Fine Settlement app. "
            "Never mark fines paid unless every actual synced balance matches its expected value."
        )
        add_admin_audit(db, int(user["id"]), "fine_settlement.batch.approved", details={"batch_id": batch_id})
        self.send_json(200, {"ok": True, "codex_prompt": prompt})

    def api_complete_fine_settlement(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        batch = one(db, "SELECT * FROM fine_settlement_batches WHERE id = ?", (batch_id,))
        if not batch or batch["status"] not in ("awaiting_codex", "needs_review"):
            self.error(409, "Batch is not ready for balance verification")
            return
        items = all_rows(db, "SELECT * FROM fine_settlement_items WHERE batch_id = ?", (batch_id,))
        paid = 0
        for item in items:
            if item["status"] == "paid":
                paid += 1
                continue
            bank = one(db, "SELECT balance FROM arma_game_bank_balances WHERE identity_id = ?", (item["identity_id"],))
            actual = round(float(bank["balance"]), 2) if bank else None
            expected = round(float(item["expected_balance"]), 2)
            if actual is not None and abs(actual - expected) <= 0.01:
                verified_at = now_iso()
                court_case = one(db, "SELECT final_result, disposition FROM citations WHERE id = ?", (item["citation_id"],))
                paid_result = final_result_for("paid", f"Settled through {batch['batch_number']}", float(item["fine_amount"]))
                if court_case and court_case.get("final_result") and court_case.get("disposition"):
                    paid_result = f"{court_case['final_result']} | Fine satisfied through {batch['batch_number']}"
                db.execute(
                    "UPDATE fine_settlement_items SET status = 'paid', verified_balance = ?, verified_at = ?, failure_reason = '' WHERE id = ?",
                    (actual, verified_at, item["id"]),
                )
                db.execute(
                    "UPDATE citations SET status = 'paid', final_result = ?, updated_at = ? WHERE id = ?",
                    (paid_result, verified_at, item["citation_id"]),
                )
                add_transaction(
                    db, int(item["user_id"]), "dcjs_fine_settlement", -float(item["fine_amount"]),
                    f"State of Faircroft DCJS · Fine settlement · Case {item['citation_id']} · Batch {batch['batch_number']}",
                )
                paid += 1
            else:
                reason = "Live bank balance has not synced" if actual is None else f"Expected {expected:.2f}; synced {actual:.2f}"
                db.execute(
                    "UPDATE fine_settlement_items SET status = 'needs_review', verified_balance = ?, verified_at = ?, failure_reason = ? WHERE id = ?",
                    (actual, now_iso(), reason, item["id"]),
                )
        status = "completed" if paid == len(items) else "needs_review"
        db.execute(
            "UPDATE fine_settlement_batches SET status = ?, completed_at = ? WHERE id = ?",
            (status, now_iso() if status == "completed" else None, batch_id),
        )
        add_admin_audit(db, int(user["id"]), "fine_settlement.batch.verified", details={"batch_id": batch_id, "paid": paid, "total": len(items), "status": status})
        self.send_json(200, {"ok": status == "completed", "status": status, "paid": paid, "total": len(items)})

    def api_create_tax_settlement_batch(self, db: Database, user: DbRow | None) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        raw_ids = payload.get("business_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            self.error(400, "Select at least one business tax account")
            return
        business_ids = list(dict.fromkeys(int(value) for value in raw_ids))[:100]
        placeholders = ",".join("?" for _ in business_ids)
        rows = all_rows(
            db,
            f"""
            SELECT b.id AS business_id, b.owner_id, l.identity_id, bank.balance, SUM(t.amount) AS tax_amount
            FROM businesses b
            JOIN business_tax_assessments t ON t.business_id = b.id
            JOIN arma_account_links l ON l.user_id = b.owner_id
            JOIN arma_game_bank_balances bank ON bank.identity_id = l.identity_id
            WHERE b.id IN ({placeholders}) AND t.status = 'unpaid' AND t.settlement_batch_id IS NULL
            GROUP BY b.id, b.owner_id, l.identity_id, bank.balance
            HAVING bank.balance >= SUM(t.amount)
            """,
            tuple(business_ids),
        )
        if len(rows) != len(business_ids):
            self.error(409, "Every business must have unpaid taxes, a linked owner, and sufficient synced game funds")
            return
        identities = [str(row["identity_id"]) for row in rows]
        if len(set(identities)) != len(identities):
            self.error(409, "Select only one business per Arma account in each batch")
            return
        created_at = utcnow()
        batch_number = f"DCJS-TAX-{created_at.strftime('%Y%m%d')}-{secrets.randbelow(900000) + 100000}"
        batch = db.execute(
            "INSERT INTO business_tax_settlement_batches (batch_number, created_by, created_at, notes) VALUES (?, ?, ?, ?) RETURNING id",
            (batch_number, user["id"], created_at.isoformat(), str(payload.get("notes") or "").strip()[:2000]),
        ).fetchone()
        for row in rows:
            amount = round(float(row["tax_amount"]), 2)
            before = round(float(row["balance"]), 2)
            db.execute(
                """
                INSERT INTO business_tax_settlement_items
                (batch_id, business_id, user_id, identity_id, tax_amount, balance_before, expected_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (batch["id"], row["business_id"], row["owner_id"], row["identity_id"], amount, before, round(before - amount, 2)),
            )
            db.execute(
                """
                UPDATE business_tax_assessments SET settlement_batch_id = ?
                WHERE business_id = ? AND status = 'unpaid' AND settlement_batch_id IS NULL
                """,
                (batch["id"], row["business_id"]),
            )
        add_admin_audit(db, int(user["id"]), "business_tax.batch.created", details={"batch_number": batch_number, "business_ids": business_ids})
        self.send_json(201, {"ok": True, "batch_id": int(batch["id"]), "batch_number": batch_number})

    def api_tax_settlement_code(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        batch = one(db, "SELECT * FROM business_tax_settlement_batches WHERE id = ?", (batch_id,))
        if not batch or batch["status"] != "draft":
            self.error(409, "Tax settlement batch is not a draft")
            return
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw_code = "TAX-" + "".join(secrets.choice(alphabet) for _ in range(8))
        expires_at = (utcnow() + dt.timedelta(minutes=10)).isoformat()
        db.execute(
            "UPDATE business_tax_settlement_batches SET approval_code_hash = ?, approval_code_hint = ?, approval_expires_at = ? WHERE id = ?",
            (hash_password(raw_code), raw_code[-4:], expires_at, batch_id),
        )
        self.send_json(201, {"ok": True, "code": raw_code, "expires_at": expires_at})

    def api_approve_tax_settlement(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        payload = self.read_json()
        batch = one(db, "SELECT * FROM business_tax_settlement_batches WHERE id = ?", (batch_id,))
        code = str(payload.get("code") or "").strip().upper()
        if not batch or batch["status"] != "draft":
            self.error(409, "Tax settlement batch is not awaiting approval")
            return
        if not batch["approval_code_hash"] or not verify_password(code, batch["approval_code_hash"]):
            self.error(403, "Invalid tax authorization code")
            return
        if not batch["approval_expires_at"] or dt.datetime.fromisoformat(batch["approval_expires_at"]) <= utcnow():
            self.error(403, "Tax authorization code has expired")
            return
        db.execute(
            "UPDATE business_tax_settlement_batches SET status = 'awaiting_codex', approved_by = ?, approved_at = ?, approval_code_hash = '' WHERE id = ?",
            (user["id"], now_iso(), batch_id),
        )
        prompt = (
            f"Process approved State of Faircroft DCJS business-tax batch {batch['batch_number']} (database batch ID {batch_id}). "
            "Use the signed-in Shadowhaven panel and configured SFTP access. Stop the Arma server manually, wait the full "
            "120 seconds, confirm it is offline, then change only the matching live FCRPMUSSALO/Banks JSON balances to the "
            "locked expected values in Fine Settlement. Do not create a backup. Start the server, wait for Railway bank sync, "
            "then select Verify synced tax balances. Do not mark taxes paid unless every synced balance matches."
        )
        add_admin_audit(db, int(user["id"]), "business_tax.batch.approved", details={"batch_id": batch_id})
        self.send_json(200, {"ok": True, "codex_prompt": prompt})

    def api_complete_tax_settlement(self, db: Database, user: DbRow | None, batch_id: int) -> None:
        err = fine_settlement_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        batch = one(db, "SELECT * FROM business_tax_settlement_batches WHERE id = ?", (batch_id,))
        if not batch or batch["status"] not in ("awaiting_codex", "needs_review"):
            self.error(409, "Tax batch is not ready for verification")
            return
        items = all_rows(db, "SELECT * FROM business_tax_settlement_items WHERE batch_id = ?", (batch_id,))
        paid = 0
        for item in items:
            if item["status"] == "paid":
                paid += 1
                continue
            bank = one(db, "SELECT balance FROM arma_game_bank_balances WHERE identity_id = ?", (item["identity_id"],))
            actual = round(float(bank["balance"]), 2) if bank else None
            expected = round(float(item["expected_balance"]), 2)
            if actual is not None and abs(actual - expected) <= 0.01:
                verified_at = now_iso()
                db.execute(
                    "UPDATE business_tax_settlement_items SET status = 'paid', verified_balance = ?, verified_at = ?, failure_reason = '' WHERE id = ?",
                    (actual, verified_at, item["id"]),
                )
                db.execute(
                    "UPDATE business_tax_assessments SET status = 'paid', settled_at = ? WHERE settlement_batch_id = ? AND business_id = ?",
                    (verified_at, batch_id, item["business_id"]),
                )
                business = one(db, "SELECT business_name, license_number FROM businesses WHERE id = ?", (item["business_id"],))
                add_transaction(
                    db, int(item["user_id"]), "dcjs_business_tax", -float(item["tax_amount"]),
                    f"State of Faircroft DCJS · Business tax · {business['business_name']} ({business['license_number']}) · Batch {batch['batch_number']}",
                )
                paid += 1
            else:
                reason = "Live bank balance has not synced" if actual is None else f"Expected {expected:.2f}; synced {actual:.2f}"
                db.execute(
                    "UPDATE business_tax_settlement_items SET status = 'needs_review', verified_balance = ?, verified_at = ?, failure_reason = ? WHERE id = ?",
                    (actual, now_iso(), reason, item["id"]),
                )
        status = "completed" if paid == len(items) else "needs_review"
        db.execute(
            "UPDATE business_tax_settlement_batches SET status = ?, completed_at = ? WHERE id = ?",
            (status, now_iso() if status == "completed" else None, batch_id),
        )
        add_admin_audit(db, int(user["id"]), "business_tax.batch.verified", details={"batch_id": batch_id, "paid": paid, "total": len(items), "status": status})
        self.send_json(200, {"ok": status == "completed", "status": status, "paid": paid, "total": len(items)})

    def api_admin_overview(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        stats = {
            "users": one(db, "SELECT COUNT(*) AS count FROM users")["count"],
            "unverified": one(db, "SELECT COUNT(*) AS count FROM users WHERE verified = 0")["count"],
            "department_applications": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status IN ('submitted','under_review','interview_requested')")["count"],
            "open_cases": one(db, "SELECT COUNT(*) AS count FROM citations WHERE status NOT IN ('paid','dismissed')")["count"],
            "panic_alerts": one(db, "SELECT COUNT(*) AS count FROM panic_alerts WHERE status = 'active'")["count"],
            "pending_referrals": one(db, "SELECT COUNT(*) AS count FROM referrals WHERE status = 'pending'")["count"],
        }
        self.send_json(200, {"stats": stats})

    def api_admin_users(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT u.*, l.identity_id AS linked_arma_id, l.linked_at AS arma_linked_at
            FROM users u
            LEFT JOIN arma_account_links l ON l.user_id = u.id
            ORDER BY u.verified ASC, u.created_at DESC
            """,
        )
        users = []
        for row in rows:
            item = public_user(row)
            item["arma_id"] = row.get("linked_arma_id")
            item["arma_linked"] = bool(row.get("linked_arma_id"))
            item["arma_linked_at"] = row.get("arma_linked_at")
            item["presence_seconds_today"] = presence_seconds(db, row["id"])
            item["name_change"] = name_change_status(db, int(row["id"]))
            count = one(db, "SELECT COUNT(*) AS count FROM user_characters WHERE user_id = ?", (row["id"],))
            active = one(db, "SELECT character_name FROM user_characters WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1", (row["id"],))
            item["character_count"] = int(count["count"] if count else 0)
            item["active_character_name"] = active["character_name"] if active else row["name"]
            users.append(item)
        self.send_json(200, {"users": users})

    def api_admin_referrals(self, db: Database, user: DbRow | None) -> None:
        err = admin_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT r.*,
                   referrer.name AS referrer_name,
                   referrer.civ_number AS referrer_civ_number,
                   referrer.email AS referrer_email,
                   referred.name AS referred_name,
                   referred.civ_number AS referred_civ_number,
                   deposited.name AS deposited_by_name
            FROM referrals r
            JOIN users referrer ON referrer.id = r.referrer_id
            JOIN users referred ON referred.id = r.referred_user_id
            LEFT JOIN users deposited ON deposited.id = r.deposited_by
            ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.updated_at DESC, r.created_at DESC
            LIMIT 160
            """,
        )
        stats = {
            "pending": one(db, "SELECT COUNT(*) AS count FROM referrals WHERE status = 'pending'")["count"],
            "deposited": one(db, "SELECT COUNT(*) AS count FROM referrals WHERE status = 'deposited'")["count"],
            "pending_total": round(float((one(db, "SELECT COALESCE(SUM(bonus_amount), 0) AS total FROM referrals WHERE status = 'pending'") or {}).get("total") or 0), 2),
            "deposited_total": round(float((one(db, "SELECT COALESCE(SUM(bonus_amount), 0) AS total FROM referrals WHERE status = 'deposited'") or {}).get("total") or 0), 2),
        }
        self.send_json(200, {"stats": stats, "referrals": [dict(row) for row in rows]})

    def api_admin_deposit_referral(self, db: Database, user: DbRow | None, referral_id: int) -> None:
        self.error(410, "Railway referral cash deposits are disabled. Apply approved rewards through the in-game economy.")

    def api_admin_department_applications(self, db: Database, user: DbRow | None) -> None:
        err = application_review_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        rows = all_rows(
            db,
            """
            SELECT a.*,
                   applicant.name AS applicant_name,
                   applicant.email AS applicant_email,
                   applicant.civ_number AS applicant_civ_number,
                   arma_link.identity_id AS applicant_arma_id,
                   applicant.primary_agency AS applicant_primary_agency,
                   applicant.callsign AS applicant_callsign,
                   reviewer.name AS reviewer_name
            FROM department_applications a
            JOIN users applicant ON applicant.id = a.user_id
            LEFT JOIN arma_account_links arma_link ON arma_link.user_id = applicant.id
            LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
            ORDER BY
                CASE a.status
                    WHEN 'submitted' THEN 0
                    WHEN 'under_review' THEN 1
                    WHEN 'approved' THEN 2
                    WHEN 'denied' THEN 3
                    WHEN 'withdrawn' THEN 4
                    ELSE 5
                END,
                a.updated_at DESC,
                a.created_at DESC
            LIMIT 240
            """,
        )
        stats = {
            "active": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status IN ('submitted','under_review','interview_requested')")["count"],
            "submitted": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status = 'submitted'")["count"],
            "under_review": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status = 'under_review'")["count"],
            "approved": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status = 'approved'")["count"],
            "denied": one(db, "SELECT COUNT(*) AS count FROM department_applications WHERE status = 'denied'")["count"],
        }
        applications = []
        can_view_sensitive = bool(user and has_any(user, "owner", "admin"))
        for row in rows:
            item = dict(row)
            if not can_view_sensitive:
                item["applicant_email"] = "Restricted"
                item["applicant_arma_id"] = "Restricted"
            applications.append(item)
        self.send_json(200, {"stats": stats, "applications": applications})

    def api_admin_review_department_application(self, db: Database, user: DbRow | None, application_id: int) -> None:
        err = application_review_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        application = one(db, "SELECT * FROM department_applications WHERE id = ?", (application_id,))
        if not application:
            self.error(404, "Department application not found")
            return
        payload = self.read_json()
        status = str(payload.get("status") or application["status"]).strip().lower()
        if status not in ("submitted", "under_review", "approved", "denied", "withdrawn", "closed"):
            self.error(400, "Invalid application status")
            return
        is_bar_exam = application["department_key"] == "lawyer"
        if has_any(user, "judge") and not has_any(user, "owner", "admin", INDEED_ADMIN_ROLE) and not is_bar_exam:
            self.error(403, "Judges may only review Bar Exam applications")
            return
        if is_bar_exam and status == "approved":
            if not has_any(user, "judge", "owner"):
                self.error(403, "A Judge must sign the Bar certificate")
                return
            try:
                exam_record = json.loads(application["statement"])
                exam_score = int(exam_record.get("score", 0))
            except (TypeError, ValueError, json.JSONDecodeError):
                self.error(409, "This application does not contain a valid Bar Exam result")
                return
            if exam_score < 14:
                self.error(409, "This Bar Exam is not eligible for judicial certification")
                return
        reviewer_notes = str(payload.get("reviewer_notes") or application.get("reviewer_notes") or "").strip()[:1500]
        ts = now_iso()
        db.execute(
            """
            UPDATE department_applications
            SET status = ?, reviewed_by = ?, reviewer_notes = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, user["id"], reviewer_notes, ts, application_id),
        )
        if status == "approved":
            applicant = one(db, "SELECT * FROM users WHERE id = ?", (application["user_id"],))
            if applicant:
                desired_role = normalize_role(application["desired_role"])
                granted_roles = [desired_role]
                if application["department_key"] == "fire_ems":
                    granted_roles = ["fireman", "ems"]
                updated_roles = sorted(set([*roles_for(applicant), *granted_roles]))
                agency = applicant.get("primary_agency") or application["department_name"]
                db.execute(
                    "UPDATE users SET verified = 1, roles = ?, primary_agency = ? WHERE id = ?",
                    (json.dumps(updated_roles), agency, application["user_id"]),
                )
        subject = f"{application['department_name']} application {status.replace('_', ' ')}"
        note = reviewer_notes or f"Your {application['department_name']} application is now {status.replace('_', ' ')}."
        if is_bar_exam and status == "approved":
            subject = "Faircroft Bar certificate signed"
            note = f"{reviewer_notes}\n\n" if reviewer_notes else ""
            note += f"Judge {user['name']} signed your Faircroft Bar certificate. Licensed Attorney access has been added to your account."
        elif status == "approved":
            note = f"{note}\n\nDepartment access has been added to your account."
        add_message(db, application["user_id"], subject, note, user["id"])
        self.send_json(200, {"ok": True, "status": status})

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
        cleaned = sorted(set(["civ", *[normalize_role(role) for role in next_roles if str(role).strip()]]))
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
        callsign = payload.get("callsign")
        if callsign is not None and str(callsign).strip():
            callsign = clean_callsign(callsign)
        elif callsign is not None:
            callsign = ""
        db.execute(
            "UPDATE users SET verified = ?, roles = ?, primary_agency = ?, callsign = ? WHERE id = ?",
            (verified, json.dumps(cleaned), agency, callsign if callsign is not None else target.get("callsign", ""), target_id),
        )
        if next_password:
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(next_password), target_id))
        if bool(payload.get("unlock_name_changes", False)):
            db.execute(
                "UPDATE users SET name_change_locked = 0, name_change_unlocked_at = ? WHERE id = ?",
                (now_iso(), target_id),
            )
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

    def api_admin_delete_user(self, db: Database, user: DbRow | None, target_id: int) -> None:
        err = owner_required(user)
        if err:
            self.error(403 if user else 401, err)
            return
        assert user is not None
        target = one(db, "SELECT * FROM users WHERE id = ?", (target_id,))
        if not target:
            self.error(404, "User not found")
            return
        if target_id == user["id"]:
            self.error(400, "You cannot delete the account you are signed in with")
            return
        if has_any(target, "owner"):
            self.error(403, "Owner accounts cannot be deleted from the account panel")
            return
        db.execute("DELETE FROM users WHERE id = ?", (target_id,))
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
    schema_ready = False
    for attempt in range(1, 31):
        try:
            ensure_schema()
            schema_ready = True
            break
        except psycopg.OperationalError as exc:
            print(f"Database unavailable during startup (attempt {attempt}/30): {exc}")
            time.sleep(min(2 * attempt, 15))
    if not schema_ready:
        raise RuntimeError("Database remained unavailable after startup retries")
    threading.Thread(target=shadowhaven_bank_sync_worker, name="shadowhaven-bank-sync", daemon=True).start()
    threading.Thread(
        target=shadowhaven_anticheat_sync_worker,
        name="shadowhaven-anticheat-sync",
        daemon=True,
    ).start()
    threading.Thread(
        target=shadowhaven_persistence_sync_worker,
        name="shadowhaven-persistence-sync",
        daemon=True,
    ).start()
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), RoleplayHandler)
    print(f"Roleplay PWA running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
