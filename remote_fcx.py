"""Faircroft CAD 1's only player-facing path into the shared FCX exchange.

The module accepts a CAD-owned resident and game-bank snapshot, then talks to
FCX-Control exclusively through its authenticated community API.  It contains
no FCX database connection and no global market controls.
"""
from __future__ import annotations

import math
import os
import secrets
from typing import Any

from community_config import CommunityConfig
from fcx_client import FcxClient, FcxClientError


def remote_market_enabled() -> bool:
    return str(os.environ.get("FCX_REMOTE_MARKET_ENABLED", "1")).strip().lower() in {
        "1", "true", "yes", "on",
    }


def _client() -> FcxClient:
    return FcxClient(CommunityConfig.load())


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "open", "enabled"}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def connection_status() -> dict[str, Any]:
    """Return a credential-safe, read-only connection panel payload."""
    try:
        config = CommunityConfig.load()
        bootstrap = FcxClient(config, timeout_seconds=6).bootstrap()
        community = bootstrap.get("community") if isinstance(bootstrap.get("community"), dict) else {}
        remote_id = str(bootstrap.get("community_id") or community.get("community_id") or "").lower()
        matched = remote_id == config.community_id
        return {
            "configured": True,
            "connected": matched,
            "authenticated": matched,
            "community_id": config.community_id,
            "source": "fcx_api",
            "mode": "read_only_status",
            "error_type": "" if matched else "community_mismatch",
        }
    except Exception as exc:
        return {
            "configured": bool(str(os.environ.get("FCX_API_URL") or "").strip()),
            "connected": False,
            "authenticated": False,
            "community_id": str(os.environ.get("COMMUNITY_ID") or "faircroft").strip().lower(),
            "source": "fcx_api",
            "mode": "read_only_status",
            "error_type": type(exc).__name__,
        }


def resolve_account(user: dict[str, Any], identity_id: str) -> dict[str, Any]:
    response = _client().resolve_account(
        community_user_id=str(user["id"]),
        display_name=str(user.get("name") or user.get("username") or "Resident")[:200],
        bohemia_identity_id=str(identity_id or "")[:200],
        verified=bool(identity_id),
    )
    account = response.get("account")
    if not isinstance(account, dict) or not str(account.get("account_id") or ""):
        raise FcxClientError("FCX did not return a Ravenhood account")
    return account


def build_market_payload(
    *,
    user: dict[str, Any],
    identity_id: str,
    game_bank_balance: Any,
    game_bank_synced_at: Any,
    history_ticker: str = "",
    history_range: str = "LIVE",
) -> dict[str, Any]:
    client = _client()
    resolved = resolve_account(user, identity_id)
    account_id = str(resolved["account_id"])
    market_response = client.market()
    portfolio_response = client.portfolio(user["id"], account_id)

    permissions = market_response.get("permissions") if isinstance(market_response.get("permissions"), dict) else {}
    market = market_response.get("market") if isinstance(market_response.get("market"), dict) else {}
    remote_account = portfolio_response.get("account") if isinstance(portfolio_response.get("account"), dict) else {}
    balance = round(_number(game_bank_balance), 2)

    securities: list[dict[str, Any]] = []
    for source in market_response.get("securities") or []:
        if not isinstance(source, dict):
            continue
        current = _number(source.get("price"))
        previous = _number(source.get("previous_price"), current)
        change = ((current - previous) / previous * 100.0) if previous > 0 else 0.0
        securities.append({
            **source,
            "active": 1,
            "lifecycle_status": "active",
            "trading_halted": 1 if _bool(source.get("halted")) else 0,
            "change_percent": round(change, 2),
            "change_24h_percent": round(change, 2),
            "market_cap": _number(source.get("market_cap")),
        })

    holdings: list[dict[str, Any]] = []
    portfolio_value = 0.0
    for source in portfolio_response.get("holdings") or []:
        if not isinstance(source, dict):
            continue
        quantity = _number(source.get("quantity"))
        price = _number(source.get("price"))
        market_value = _number(source.get("market_value"), quantity * price)
        portfolio_value += market_value
        holdings.append({
            **source,
            "quantity": quantity,
            "price": price,
            "current_value": round(market_value, 2),
            "market_value": round(market_value, 2),
        })

    orders: list[dict[str, Any]] = []
    for source in portfolio_response.get("orders") or []:
        if not isinstance(source, dict):
            continue
        orders.append({
            **source,
            "id": str(source.get("trade_request_id") or source.get("id") or ""),
            "status": str(source.get("status") or "pending").lower(),
            "unit_price": _number(source.get("submitted_price")),
            "gross_amount": _number(source.get("estimated_gross")),
            "fee_amount": _number(source.get("estimated_fee")),
        })

    trading_enabled = _bool(permissions.get("trading"), True) and not _bool(market.get("maintenance_mode"))
    buy_enabled = trading_enabled and _bool(permissions.get("buy"), True) and _bool(market.get("buy_enabled"), True)
    sell_enabled = trading_enabled and _bool(permissions.get("sell"), True) and _bool(market.get("sell_enabled"), True)
    account_active = str(remote_account.get("market_status") or remote_account.get("status") or "active").lower() == "active"
    market_open = _bool(market.get("market_open"), True)

    account = {
        **resolved,
        **remote_account,
        "id": account_id,
        "account_id": account_id,
        "user_id": user["id"],
        "status": "active" if account_active else "restricted",
        "cash_balance": balance,
        "buying_power": balance,
        "game_bank_synced_at": game_bank_synced_at,
        "balance_source": "cad1_game_bank_snapshot",
    }
    return {
        "ok": True,
        "remote_fcx": True,
        "community_id": CommunityConfig.load().community_id,
        "account": account,
        "trading_access": {
            "can_trade_equity": account_active and trading_enabled,
            "can_buy": account_active and buy_enabled,
            "can_sell": account_active and sell_enabled,
            "can_trade_margin": _bool(permissions.get("margin"), False),
            "can_transfer_shares": _bool(permissions.get("transfers"), False),
            "source": "fcx_control",
        },
        "securities": securities,
        "holdings": holdings,
        "orders": orders,
        "order_requests": [],
        "cash_transactions": [],
        "transfers": [],
        "promo_redemptions": [],
        "margin_positions": portfolio_response.get("margin_positions") or [],
        "margin_order_requests": portfolio_response.get("margin_orders") or [],
        "margin_summary": portfolio_response.get("margin_summary") or {"open_positions": 0, "collateral": 0, "exposure": 0, "unrealized_pnl": 0},
        "index_funds": market_response.get("index_funds") or [],
        "exchange_market_cap": round(sum(_number(item.get("market_cap")) for item in securities), 2),
        "anonymous_trade_tape": market_response.get("anonymous_trade_tape") or [],
        "company_wire": market_response.get("company_wire") or [],
        "price_history": market_response.get("price_history") or [],
        "market_analytics": market_response.get("market_analytics") or {},
        "history_ticker": str(history_ticker or "").upper().strip(),
        "history_range": str(history_range or "LIVE").upper().strip() or "LIVE",
        "history_range_start": "",
        "pending_withdrawal_amount": 0,
        "available_withdrawal_amount": 0,
        "portfolio_value": round(portfolio_value, 2),
        "market_open": market_open,
        "fcxv_24h_enabled": _bool(market.get("fcxv_24h_enabled"), False),
        "margin_enabled": _bool(permissions.get("margin"), False),
        "market_session_reason": str(market.get("session_reason") or "Shared FCX-Control session"),
        "market_next_transition_at": str(market.get("next_transition_at") or ""),
        "transfer_fee_percent": _number(market.get("transfer_fee_percent")),
        "trade_fee_percent": _number(market.get("trade_fee_percent")),
    }


def create_order(*, user: dict[str, Any], identity_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ticker = str(payload.get("ticker") or "").upper().strip()
    side = str(payload.get("side") or "").lower().strip()
    quantity = _number(payload.get("quantity"))
    if not ticker or side not in {"buy", "sell"} or quantity <= 0:
        raise ValueError("Valid ticker, buy or sell side, and positive quantity are required")
    account = resolve_account(user, identity_id)
    community = CommunityConfig.load().community_id
    idempotency_key = f"{community}-{user['id']}-{secrets.token_urlsafe(18)}"
    return _client().create_order(
        {
            "idempotency_key": idempotency_key,
            "community_user_id": str(user["id"]),
            "account_id": str(account["account_id"]),
            "ticker": ticker,
            "side": side,
            "quantity": round(quantity, 8),
        },
        idempotency_key,
    )

