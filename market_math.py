from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any


def market_cap_weighted_allocations(
    capitalizations: list[tuple[int, Any]], total_amount: Any
) -> list[dict[str, float | int]]:
    """Allocate a currency amount across securities by market capitalization.

    Every returned allocation is rounded down to cents.  Any remaining cents
    are assigned to the final eligible security so the allocations always
    reconcile exactly to the requested custody-pool disposition.
    """
    try:
        total = Decimal(str(total_amount or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("total_amount_must_be_numeric") from exc
    if total <= 0:
        raise ValueError("total_amount_must_be_positive")

    eligible: list[tuple[int, Decimal]] = []
    for security_id, raw_cap in capitalizations:
        try:
            cap = Decimal(str(raw_cap or 0))
        except (InvalidOperation, ValueError):
            continue
        if int(security_id) > 0 and cap > 0:
            eligible.append((int(security_id), cap))
    total_cap = sum((cap for _, cap in eligible), Decimal("0"))
    if total_cap <= 0:
        raise ValueError("no_positive_market_capitalizations")

    remaining = total
    allocations: list[dict[str, float | int]] = []
    for index, (security_id, cap) in enumerate(eligible):
        amount = (
            remaining
            if index == len(eligible) - 1
            else (total * cap / total_cap).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        )
        remaining -= amount
        allocations.append(
            {
                "security_id": security_id,
                "amount": float(amount),
                "weight": float(cap / total_cap),
            }
        )
    return allocations


def market_gemini_exposure_shares(buy_shares: Any, sell_shares: Any) -> float:
    """Return Gemini's directional constituent exposure in share units.

    Gemini-generated market trades are intentionally two-sided. Stability
    names often finish a cycle buy-heavy, while volatility names can finish
    sell-heavy. Treating a sell-heavy position as zero made FCXV appear to
    have no Gemini participation even though its constituents had active
    Gemini flow. Fund capitalization uses the magnitude of that net exposure;
    the direction remains available separately in the constituent payload.
    """
    bought = max(0.0, float(buy_shares or 0))
    sold = max(0.0, float(sell_shares or 0))
    return abs(bought - sold)


def ravenhood_margin_quote(
    direction: str,
    entry_price: Any,
    collateral: Any,
    leverage: Any,
    fee_percent: Any,
    maintenance_ratio: Any,
) -> dict[str, float]:
    """Build a deterministic isolated-margin opening quote.

    The position notional is collateral multiplied by leverage.  Maintenance
    is expressed as a fraction of the original collateral, so a 20% setting
    liquidates a position when only 20% of its isolated collateral remains.
    """
    normalized_direction = str(direction or "").strip().lower()
    if normalized_direction not in {"long", "short"}:
        raise ValueError("direction_must_be_long_or_short")
    price = float(entry_price or 0)
    margin = float(collateral or 0)
    multiple = float(leverage or 0)
    fee_rate = max(0.0, float(fee_percent or 0)) / 100.0
    maintenance = max(0.01, min(0.95, float(maintenance_ratio or 0)))
    if price <= 0 or margin <= 0 or multiple < 1:
        raise ValueError("price_collateral_and_leverage_must_be_positive")
    notional = margin * multiple
    quantity = notional / price
    liquidation_move = (1.0 - maintenance) / multiple
    liquidation_price = price * (1.0 - liquidation_move if normalized_direction == "long" else 1.0 + liquidation_move)
    return {
        "notional": round(notional, 2),
        "quantity": round(quantity, 8),
        "open_fee": round(notional * fee_rate, 2),
        "liquidation_price": round(max(0.0001, liquidation_price), 4),
        "maintenance_equity": round(margin * maintenance, 2),
    }


def ravenhood_margin_metrics(
    direction: str,
    entry_price: Any,
    mark_price: Any,
    quantity: Any,
    collateral: Any,
    leverage: Any,
    fee_percent: Any,
    maintenance_ratio: Any,
) -> dict[str, float | bool]:
    """Mark an isolated long/short position and calculate close proceeds."""
    opening = ravenhood_margin_quote(
        direction, entry_price, collateral, leverage, fee_percent, maintenance_ratio
    )
    normalized_direction = str(direction or "").strip().lower()
    entry = float(entry_price or 0)
    mark = max(0.0001, float(mark_price or 0))
    units = max(0.0, float(quantity or 0))
    margin = max(0.0, float(collateral or 0))
    pnl = units * (mark - entry) if normalized_direction == "long" else units * (entry - mark)
    equity = margin + pnl
    close_notional = units * mark
    close_fee = max(0.0, close_notional * max(0.0, float(fee_percent or 0)) / 100.0)
    payout = max(0.0, equity - close_fee)
    maintenance_equity = float(opening["maintenance_equity"])
    return {
        **opening,
        "mark_price": round(mark, 4),
        "unrealized_pnl": round(pnl, 2),
        "equity": round(equity, 2),
        "return_percent": round((pnl / margin * 100.0) if margin else 0.0, 4),
        "close_notional": round(close_notional, 2),
        "close_fee": round(close_fee, 2),
        "estimated_payout": round(payout, 2),
        "liquidatable": equity <= maintenance_equity + 0.0001,
    }
