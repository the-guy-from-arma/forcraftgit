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
from urllib.parse import urlsplit

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


def _normalize_trading_restriction_scope(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in {"full", "all", "account", "account_wide"}:
        return "full"
    if normalized in {"equity", "share", "shares", "share_trading", "stock", "stocks"}:
        return "equity"
    if normalized in {"leverage", "leveraged", "margin", "leverage_trading"}:
        return "leverage"
    return "full"


def _active_trading_restrictions(remote_account: dict[str, Any]) -> list[dict[str, Any]]:
    restrictions: list[dict[str, Any]] = []
    raw_restrictions = remote_account.get("trading_restrictions")
    if isinstance(raw_restrictions, list):
        for raw in raw_restrictions:
            if not isinstance(raw, dict):
                continue
            status = str(raw.get("status") or "active").strip().lower()
            if status != "active":
                continue
            restriction = dict(raw)
            restriction["scope"] = _normalize_trading_restriction_scope(raw.get("scope"))
            restrictions.append(restriction)
    if not restrictions and _bool(remote_account.get("is_restricted"), False):
        restrictions.append({
            "id": remote_account.get("restriction_id"),
            "scope": _normalize_trading_restriction_scope(remote_account.get("restriction_scope")),
            "reason": str(remote_account.get("restriction_reason") or "Ravenhood trading is restricted by the FEC."),
            "status": "active",
        })
    return restrictions


def _restriction_for_lane(restrictions: list[dict[str, Any]], lane: str) -> dict[str, Any] | None:
    requested_lane = _normalize_trading_restriction_scope(lane)
    return next(
        (
            restriction
            for restriction in restrictions
            if restriction.get("scope") in {"full", requested_lane}
        ),
        None,
    )


def _grouped_price_history(value: Any) -> dict[str, list[dict[str, Any]]]:
    """Preserve FCX's ticker grouping so each chart receives only its executions."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    if isinstance(value, dict):
        for ticker, rows in value.items():
            if not isinstance(rows, list):
                continue
            key = str(ticker).upper()
            for raw in rows:
                if isinstance(raw, dict):
                    grouped.setdefault(key, []).append(dict(raw))
    elif isinstance(value, list):
        for raw in value:
            if not isinstance(raw, dict):
                continue
            row = dict(raw)
            key = str(row.pop("ticker", "")).upper()
            if key:
                grouped.setdefault(key, []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: str(row.get("recorded_at") or ""))
    return grouped


def connection_status() -> dict[str, Any]:
    """Return a credential-safe, read-only connection panel payload."""
    configured_url = str(os.environ.get("FCX_API_URL") or "").strip()
    parsed_url = urlsplit(configured_url)
    control_origin = f"{parsed_url.scheme}://{parsed_url.netloc}" if parsed_url.scheme and parsed_url.netloc else ""
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
            "service_name": "FCX Exchange",
            "control_origin": control_origin,
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
            "service_name": "FCX Exchange",
            "control_origin": control_origin,
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
    normalized_range = str(history_range or "LIVE").lower().strip() or "live"
    market_response = client.market(
        ticker=str(history_ticker or "").upper().strip(),
        history_range=normalized_range,
    )
    portfolio_response = client.portfolio(user["id"], account_id)

    if not isinstance(market_response, dict) or not isinstance(portfolio_response, dict):
        raise FcxClientError("FCX returned an invalid Ravenhood payload")

    permissions = market_response.get("permissions") if isinstance(market_response.get("permissions"), dict) else {}
    market = market_response.get("market") if isinstance(market_response.get("market"), dict) else {}
    remote_account = portfolio_response.get("account") if isinstance(portfolio_response.get("account"), dict) else {}
    wallet_cash = round(_number(remote_account.get("cash_balance")), 2)
    game_balance = round(_number(game_bank_balance), 2)

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
    restrictions = _active_trading_restrictions(remote_account)
    equity_restriction = _restriction_for_lane(restrictions, "equity")
    leverage_restriction = _restriction_for_lane(restrictions, "leverage")
    full_restriction = _restriction_for_lane(restrictions, "full")
    remote_status = str(remote_account.get("market_status") or remote_account.get("status") or resolved.get("status") or "active").strip().lower()
    account_active = remote_status not in {"inactive", "closed", "disabled", "suspended", "unlinked"}
    market_open = _bool(market.get("market_open"), True)

    account = {
        **resolved,
        **remote_account,
        "id": account_id,
        "account_id": account_id,
        "user_id": user["id"],
        "status": "restricted" if full_restriction else ("active" if account_active else "inactive"),
        "is_restricted": bool(restrictions),
        "equity_restricted": equity_restriction is not None,
        "leverage_restricted": leverage_restriction is not None,
        "trading_restrictions": restrictions,
        "restriction_scope": str((equity_restriction or leverage_restriction or {}).get("scope") or ""),
        "restriction_reason": str((equity_restriction or leverage_restriction or {}).get("reason") or ""),
        "cash_balance": wallet_cash,
        "buying_power": wallet_cash,
        "game_bank_balance": game_balance,
        "game_bank_synced_at": game_bank_synced_at,
        "balance_source": "fcx_wallet",
    }
    return {
        "ok": True,
        "remote_fcx": True,
        "community_id": CommunityConfig.load().community_id,
        "account": account,
        "trading_access": {
            "can_trade_equity": account_active and equity_restriction is None and trading_enabled,
            "can_buy": account_active and equity_restriction is None and buy_enabled,
            "can_sell": account_active and equity_restriction is None and sell_enabled,
            "can_trade_margin": account_active and leverage_restriction is None and _bool(permissions.get("margin"), False),
            "can_transfer_shares": _bool(permissions.get("transfers"), False),
            "restriction": equity_restriction or leverage_restriction,
            "restriction_scope": str((equity_restriction or leverage_restriction or {}).get("scope") or ""),
            "restriction_reason": str((equity_restriction or leverage_restriction or {}).get("reason") or ""),
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
        "price_history": _grouped_price_history(market_response.get("price_history")),
        "market_analytics": market_response.get("market_analytics") or {},
        "history_ticker": str(history_ticker or "").upper().strip(),
        "history_range": str(market_response.get("history_range") or normalized_range).upper(),
        "history_range_start": str(market_response.get("history_range_start") or market_response.get("history_window_start") or ""),
        "history_range_end": str(market_response.get("history_range_end") or ""),
        "pending_withdrawal_amount": 0,
        "available_withdrawal_amount": 0,
        "portfolio_value": round(portfolio_value, 2),
        "account_equity": round(wallet_cash + portfolio_value, 2),
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


def redeem_promotion(*, user: dict[str, Any], identity_id: str, code: str) -> dict[str, Any]:
    account = resolve_account(user, identity_id)
    return _client().redeem_promotion({
        "community_user_id": str(user["id"]),
        "account_id": str(account["account_id"]),
        "code": str(code or "").strip(),
    })


def create_wallet_transfer(
    *,
    user: dict[str, Any],
    identity_id: str,
    transaction_type: str,
    amount: float,
) -> dict[str, Any]:
    direction = str(transaction_type or "").strip().lower()
    if direction not in {"deposit", "withdrawal"}:
        raise ValueError("Choose a valid deposit or withdrawal")
    if amount <= 0 or not math.isfinite(amount):
        raise ValueError("Enter a positive transfer amount")
    account = resolve_account(user, identity_id)
    community = CommunityConfig.load().community_id
    idempotency_key = f"{community}-wallet-{direction}-{user['id']}-{secrets.token_urlsafe(18)}"
    response = _client().create_settlement(
        {
            "idempotency_key": idempotency_key,
            "community_user_id": str(user["id"]),
            "account_id": str(account["account_id"]),
            "operation": "debit" if direction == "deposit" else "credit",
            "amount": round(float(amount), 2),
            "currency": "FC",
            "order_reference": f"Ravenhood {direction}",
            "metadata": {
                "kind": "wallet_transfer",
                "direction": direction,
                "display_name": str(user.get("name") or user.get("username") or "Resident")[:200],
                "bohemia_identity_id": str(identity_id or "")[:200],
            },
        },
        idempotency_key,
    )
    settlement = response.get("settlement") if isinstance(response, dict) else None
    settlement_id = str((settlement or {}).get("settlement_id") or "")
    if not settlement_id:
        raise FcxClientError("FCX did not create the wallet transfer")
    return _client().execute_settlement(settlement_id)
