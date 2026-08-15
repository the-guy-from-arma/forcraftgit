from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


MAX_COMMAND_AMOUNT = Decimal("10000000.00")
MONEY_STEP = Decimal("0.01")
SETTLEMENT_PATH = re.compile(r"^/api/fcx/settlements/([A-Za-z0-9_-]{8,160})$")


def _enabled() -> bool:
    return os.environ.get("FCX_BANK_ADAPTER_ENABLED", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _community_id() -> str:
    return os.environ.get("COMMUNITY_ID", "").strip()


def _settlement_secret() -> str:
    return os.environ.get("FCX_BANK_SETTLEMENT_SECRET", "").strip()


def _state(command: dict[str, Any]) -> str:
    status = str(command.get("status") or "pending").lower()
    operation = str(command.get("operation") or "")
    if status == "completed":
        return "BANK_DEBITED" if operation == "debit_funds" else "BANK_CREDITED"
    if status == "failed":
        return "FAILED"
    if status == "cancelled":
        return "REVERSED"
    return "BANK_AUTHORIZED"


def _authenticate(handler: Any) -> str | None:
    if not _enabled():
        return "FCX bank settlement adapter is disabled"
    expected = _settlement_secret()
    if not expected:
        return "FCX_BANK_SETTLEMENT_SECRET is not configured"
    supplied = str(handler.headers.get("X-FCX-Settlement-Key") or "").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        return "Invalid FCX settlement credential"
    return None


def _public_settlement(row: dict[str, Any], command: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    try:
        result = json.loads(str(command.get("result_json") or "{}"))
    except (TypeError, json.JSONDecodeError):
        result = {}
    return {
        "ok": True,
        "settlement_id": row["settlement_id"],
        "idempotency_key": row["idempotency_key"],
        "community_id": row["community_id"],
        "state": _state(command),
        "bank_reference": row["command_id"],
        "command_status": command.get("status") or "pending",
        "operation": row["operation"],
        "amount": str(row["amount"]),
        "currency": row["currency"],
        "result": result,
        "created_at": row["created_at"],
        "updated_at": command.get("completed_at") or command.get("claimed_at") or row["updated_at"],
    }


def _load(db: Any, settlement_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    row = db.execute(
        "SELECT * FROM fcx_bank_settlements WHERE settlement_id=? AND community_id=?",
        (settlement_id, _community_id()),
    ).fetchone()
    if not row:
        return None
    command = db.execute(
        "SELECT * FROM bank_bridge_commands WHERE command_id=?",
        (row["command_id"],),
    ).fetchone()
    if not command:
        return None
    return row, command


def _parse_money(raw: Any) -> Decimal:
    try:
        amount = Decimal(str(raw)).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("amount must be a valid monetary value") from exc
    if amount <= 0:
        raise ValueError("amount must be greater than zero")
    if amount > MAX_COMMAND_AMOUNT:
        raise ValueError("one FCX settlement cannot exceed 10000000.00; split larger settlements in FCX Control")
    return amount


def handle_fcx_bank_settlement(handler: Any, db: Any, path: str, method: str, *, arma_server_id: str, now_iso: Any) -> None:
    error = _authenticate(handler)
    if error:
        handler.error(503 if "disabled" in error or "not configured" in error else 403, error)
        return
    community_id = _community_id()
    if not community_id:
        handler.error(503, "COMMUNITY_ID is not configured")
        return

    match = SETTLEMENT_PATH.fullmatch(path)
    if method == "GET" and match:
        loaded = _load(db, match.group(1))
        if not loaded:
            handler.error(404, "FCX settlement was not found")
            return
        handler.send_json(200, _public_settlement(*loaded))
        return
    if method != "POST" or path != "/api/fcx/settlements":
        handler.error(404, "FCX settlement endpoint was not found")
        return

    payload = handler.read_json()
    settlement_id = str(payload.get("settlement_id") or "").strip()[:160]
    idempotency_key = str(payload.get("idempotency_key") or "").strip()[:200]
    header_idempotency = str(handler.headers.get("Idempotency-Key") or "").strip()[:200]
    payload_community = str(payload.get("community_id") or "").strip()
    community_user_id = str(payload.get("community_user_id") or "").strip()
    operation = str(payload.get("operation") or "").strip().lower()
    currency = str(payload.get("currency") or "FC").strip().upper()[:12]
    order_reference = str(payload.get("order_reference") or "").strip()[:200]

    if not settlement_id or not re.fullmatch(r"[A-Za-z0-9_-]{8,160}", settlement_id):
        handler.error(400, "A valid settlement_id is required")
        return
    if len(idempotency_key) < 8 or header_idempotency != idempotency_key:
        handler.error(400, "Idempotency-Key must exactly match the settlement payload")
        return
    if payload_community != community_id:
        handler.error(403, "Settlement was addressed to a different community")
        return
    if operation not in {"debit", "credit"}:
        handler.error(400, "operation must be debit or credit")
        return
    try:
        user_id = int(community_user_id)
        amount = _parse_money(payload.get("amount"))
    except (ValueError, TypeError):
        handler.error(400, "community_user_id and amount must be valid")
        return

    existing = db.execute(
        "SELECT * FROM fcx_bank_settlements WHERE community_id=? AND idempotency_key=?",
        (community_id, idempotency_key),
    ).fetchone()
    if existing:
        loaded = _load(db, str(existing["settlement_id"]))
        if not loaded:
            handler.error(409, "The idempotent settlement exists without its bank command")
            return
        response = _public_settlement(*loaded)
        response["idempotent_replay"] = True
        handler.send_json(200, response)
        return

    user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        handler.error(404, "Community user was not found")
        return
    link = db.execute(
        "SELECT identity_id,server_id FROM arma_account_links WHERE user_id=?",
        (user_id,),
    ).fetchone()
    if not link or not str(link.get("identity_id") or "").strip():
        handler.error(409, "Community user does not have a linked Arma identity")
        return
    if str(link.get("server_id") or arma_server_id) not in {arma_server_id, "default"}:
        handler.error(409, "Community user is linked to a different Arma server")
        return

    command_id = "fcx-bank-" + secrets.token_urlsafe(18).replace("_", "").replace("-", "")
    command_operation = "debit_funds" if operation == "debit" else "issue_funds"
    timestamp = now_iso()
    reason = f"FCX {operation} {order_reference or settlement_id}"[:500]
    db.execute(
        """INSERT INTO bank_bridge_commands
           (command_id,idempotency_key,server_id,operation,target_user_id,identity_id,
            amount,currency,reason,status,requested_by,created_at)
           VALUES (?,?,?,?,?,?,?,'bank',?,'pending',?,?)""",
        (command_id, "fcx:" + idempotency_key, arma_server_id, command_operation, user_id,
         str(link["identity_id"]), amount, reason, user_id, timestamp),
    )
    db.execute(
        """INSERT INTO fcx_bank_settlements
           (settlement_id,idempotency_key,community_id,community_user_id,ravenhood_account_id,
            operation,amount,currency,order_reference,command_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (settlement_id, idempotency_key, community_id, community_user_id,
         str(payload.get("ravenhood_account_id") or "")[:200], operation, amount,
         currency, order_reference, command_id, timestamp, timestamp),
    )
    loaded = _load(db, settlement_id)
    if not loaded:
        raise RuntimeError("FCX settlement could not be loaded after creation")
    response = _public_settlement(*loaded)
    response["idempotent_replay"] = False
    handler.send_json(202, response)
