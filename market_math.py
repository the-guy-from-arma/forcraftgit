from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any


def ravenhood_security_session_open(
    market_open: bool, ticker: str, fcxv_24h_enabled: bool
) -> bool:
    """Return whether a Ravenhood security may trade right now.

    FCXV is the only continuous-session security. The same policy applies to
    ordinary shares and leveraged long/short positions.
    """
    return bool(market_open) or (
        bool(fcxv_24h_enabled) and str(ticker or "").strip().upper() == "FCXV"
    )


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


def ravenhood_liquidation_hunt_quote(
    direction: str,
    mark_price: Any,
    liquidation_price: Any,
    intensity: str,
    max_move_percent: Any,
) -> dict[str, float | str | bool]:
    """Move one quote toward, but never through, a liquidation boundary.

    The market engine chooses the eligible position. This helper only applies
    the configured, deterministic guardrails so Local and hosted AI providers
    receive identical treatment and cannot directly force a liquidation.
    """
    normalized_direction = str(direction or "").strip().lower()
    if normalized_direction not in {"long", "short"}:
        raise ValueError("direction_must_be_long_or_short")
    mark = float(mark_price or 0)
    boundary = float(liquidation_price or 0)
    if mark <= 0 or boundary <= 0:
        raise ValueError("mark_and_liquidation_prices_must_be_positive")
    normalized_intensity = str(intensity or "light").strip().lower()
    intensity_factors = {"light": 0.20, "aggressive": 0.45, "extreme": 0.75}
    if normalized_intensity not in intensity_factors:
        raise ValueError("intensity_must_be_light_aggressive_or_extreme")
    move_cap = max(0.01, min(15.0, float(max_move_percent or 0)))
    safety_buffer = max(0.0001, mark * 0.0005)

    if normalized_direction == "long":
        usable_gap = mark - boundary - safety_buffer
        gap_before = max(0.0, (mark - boundary) / mark * 100.0)
        if usable_gap <= 0:
            return {
                "moved": False, "reason": "at_liquidation_boundary", "direction": normalized_direction,
                "old_price": round(mark, 4), "new_price": round(mark, 4),
                "liquidation_price": round(boundary, 4), "movement_percent": 0.0,
                "gap_before_percent": round(gap_before, 4), "gap_after_percent": round(gap_before, 4),
            }
        desired = usable_gap * intensity_factors[normalized_intensity]
        movement = min(desired, mark * move_cap / 100.0)
        new_price = max(boundary + safety_buffer, mark - movement)
    else:
        usable_gap = boundary - mark - safety_buffer
        gap_before = max(0.0, (boundary - mark) / mark * 100.0)
        if usable_gap <= 0:
            return {
                "moved": False, "reason": "at_liquidation_boundary", "direction": normalized_direction,
                "old_price": round(mark, 4), "new_price": round(mark, 4),
                "liquidation_price": round(boundary, 4), "movement_percent": 0.0,
                "gap_before_percent": round(gap_before, 4), "gap_after_percent": round(gap_before, 4),
            }
        desired = usable_gap * intensity_factors[normalized_intensity]
        movement = min(desired, mark * move_cap / 100.0)
        new_price = min(boundary - safety_buffer, mark + movement)

    new_price = max(0.0001, round(new_price, 4))
    movement_percent = (new_price / mark - 1.0) * 100.0
    gap_after = (
        (new_price - boundary) / new_price * 100.0
        if normalized_direction == "long"
        else (boundary - new_price) / new_price * 100.0
    )
    return {
        "moved": abs(new_price - mark) >= 0.00005,
        "reason": "pressured",
        "direction": normalized_direction,
        "old_price": round(mark, 4),
        "new_price": new_price,
        "liquidation_price": round(boundary, 4),
        "movement_percent": round(movement_percent, 4),
        "gap_before_percent": round(gap_before, 4),
        "gap_after_percent": round(max(0.0, gap_after), 4),
    }
