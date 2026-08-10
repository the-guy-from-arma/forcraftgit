from __future__ import annotations

from typing import Any


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
