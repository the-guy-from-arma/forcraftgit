from __future__ import annotations

import random
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fcx_engine.config import (
    CYCLE_DEFAULTS,
    DEFAULT_DISTRIBUTION,
    EngineConfig,
    PERSONALITY_PROFILES,
    parse_distribution,
    parse_string_list,
)
from fcx_engine.personalities import decide
from fcx_engine.pricing import (
    discover_price,
    fear_greed,
    index_nav,
    ipo_uncertainty_multiplier,
    market_maker_quote,
    regime_for,
    short_squeeze_cover_quantity,
    split_adjustment,
)
from fcx_engine.engine import _event_severity, index_constituent_counts
from fcx_engine.sandbox import run_sandbox


class EngineConfigurationTests(unittest.TestCase):
    def test_index_readiness_uses_public_tickers_not_internal_fund_keys(self) -> None:
        rows = [
            {"fund_key": "stability", "fund_ticker": "FCXS", "constituents": 8},
            {"fund_key": "volatility", "fund_ticker": "FCXV", "constituents": 6},
        ]
        self.assertEqual(index_constituent_counts(rows), {"FCXS": 8, "FCXV": 6})

    def test_index_readiness_supports_legacy_internal_key_rows(self) -> None:
        rows = [
            {"fund_key": "stability", "constituents": 8},
            {"fund_key": "volatility", "constituents": 6},
        ]
        self.assertEqual(index_constituent_counts(rows), {"FCXS": 8, "FCXV": 6})

    def test_fresh_deployment_resets_internal_index_fund_keys(self) -> None:
        app_source = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")
        deploy_source = app_source.split("def deploy_fcx_exchange", 1)[1].split("def ", 1)[0]
        self.assertIn("'STABILITY','VOLATILITY','FCXS','FCXV'", deploy_source)

    def test_all_requested_investor_personalities_exist(self) -> None:
        self.assertEqual(len(PERSONALITY_PROFILES), 15)
        self.assertEqual(set(PERSONALITY_PROFILES), set(DEFAULT_DISTRIBUTION))
        self.assertAlmostEqual(sum(DEFAULT_DISTRIBUTION.values()), 100.0)

    def test_distribution_is_normalized_and_safe(self) -> None:
        result = parse_distribution({"retail": 75, "whale": 25})
        self.assertAlmostEqual(sum(result.values()), 100.0, places=3)
        self.assertEqual(set(result), set(PERSONALITY_PROFILES))
        self.assertGreater(result["retail"], result["whale"])

    def test_paused_values_are_deduplicated(self) -> None:
        self.assertEqual(parse_string_list('["FNN","fnn"," whale "]'), ("fnn", "whale"))

    def test_configuration_is_bounded(self) -> None:
        config = EngineConfig.from_settings(
            {
                "fcx_engine_enabled": "1",
                "fcx_engine_population": "999999",
                "fcx_engine_total_capital": "-10",
                "fcx_engine_minute_cap_percent": "900",
                "fcx_engine_speed": "unsupported",
            }
        )
        self.assertTrue(config.enabled)
        self.assertEqual(config.population, 5000)
        self.assertEqual(config.total_capital, 1000)
        self.assertEqual(config.minute_cap_percent, 100)
        self.assertEqual(config.speed, "normal")
        self.assertEqual(set(config.intervals), set(CYCLE_DEFAULTS))

    def test_operational_safety_controls_are_bounded(self) -> None:
        config = EngineConfig.from_settings(
            {
                "fcx_engine_market_maker_depth_multiplier": "100",
                "fcx_engine_execution_budget_per_tick": "2",
                "fcx_engine_panic_participation_percent": "-10",
                "fcx_engine_circuit_breaker_10m_percent": "9999",
                "fcx_engine_circuit_breaker_30m_duration_minutes": "0",
                "fcx_engine_abnormal_volume_float_percent": "0",
                "fcx_engine_flow_concentration_percent": "140",
                "fcx_engine_coordinated_flow_min_participants": "1",
            }
        )
        self.assertEqual(config.market_maker_depth_multiplier, 10)
        self.assertEqual(config.execution_budget_per_tick, 10)
        self.assertEqual(config.panic_participation_percent, 0)
        self.assertEqual(config.circuit_breaker_10m_percent, 500)
        self.assertEqual(config.circuit_breaker_30m_duration_minutes, 1)
        self.assertEqual(config.abnormal_volume_float_percent, .01)
        self.assertEqual(config.flow_concentration_percent, 100)
        self.assertEqual(config.coordinated_flow_min_participants, 2)


class DecisionEngineTests(unittest.TestCase):
    def test_decisions_are_reproducible_with_a_seed(self) -> None:
        context = {
            "momentum": 14,
            "valuation_gap": 8,
            "fundamental_score": 72,
            "sentiment": 66,
            "volatility": 42,
            "bankruptcy_risk": 5,
            "held_quantity": 0,
        }
        traits = {"confidence": 61, "panic_threshold": 25}
        first = decide("growth", context, traits, random.Random(77))
        second = decide("growth", context, traits, random.Random(77))
        self.assertEqual(first, second)
        self.assertTrue(first.reasons)
        self.assertIn(first.action, {"BUY", "ACCUMULATE", "HOLD", "SELL", "REDUCE", "LIQUIDATE", "SHORT"})

    def test_contrarian_can_react_to_healthy_oversold_stock(self) -> None:
        decision = decide(
            "contrarian",
            {
                "momentum": -28,
                "valuation_gap": 38,
                "fundamental_score": 82,
                "sentiment": 24,
                "volatility": 61,
                "bankruptcy_risk": 8,
                "held_quantity": 0,
            },
            {"confidence": 80, "panic_threshold": 25},
            random.Random(4),
        )
        self.assertIn(decision.action, {"BUY", "ACCUMULATE"})


class PriceDiscoveryTests(unittest.TestCase):
    def quote(self, **overrides: float):
        values = {
            "price": 100.0,
            "human_buy": 0.0,
            "human_sell": 0.0,
            "npc_buy": 0.0,
            "npc_sell": 0.0,
            "issued_shares": 1_000_000.0,
            "volatility": 50.0,
            "market_sentiment": 50.0,
            "company_sentiment": 50.0,
            "fundamental_score": 50.0,
            "fair_value": 100.0,
            "cap_percent": 2.0,
            "price_floor": 0.01,
        }
        values.update(overrides)
        return discover_price(**values)

    def test_massive_orders_obey_tick_caps(self) -> None:
        purchase = self.quote(human_buy=500_000_000)
        sale = self.quote(human_sell=500_000_000)
        self.assertLessEqual(purchase.movement_percent, 2.0)
        self.assertGreaterEqual(sale.movement_percent, -2.0)

    def test_liquidity_changes_market_impact(self) -> None:
        low_liquidity = self.quote(npc_buy=25_000, issued_shares=10_000)
        high_liquidity = self.quote(npc_buy=25_000, issued_shares=1_000_000_000)
        self.assertGreater(low_liquidity.movement_percent, high_liquidity.movement_percent)

    def test_prices_never_cross_the_floor_or_become_non_finite(self) -> None:
        result = self.quote(price=0.01, human_sell=10**20, cap_percent=100, price_floor=0.01)
        self.assertGreaterEqual(result.new_price, 0.01)

    def test_market_indicators_are_bounded(self) -> None:
        self.assertEqual(fear_greed(999, 0, 100, 100, 100), 100.0)
        self.assertEqual(fear_greed(-999, 100, 0, 0, 0), 0.0)
        self.assertEqual(regime_for(10, 95, -20), "crisis")
        self.assertEqual(regime_for(80, 30, 8), "bull")

    def test_index_nav_tracks_weighted_constituents(self) -> None:
        self.assertEqual(index_nav(100, [(0.60, 110, 100), (0.40, 90, 100)]), 102.0)
        self.assertEqual(index_nav(100, []), 100.0)

    def test_short_squeeze_requires_crowding_and_positive_momentum(self) -> None:
        self.assertEqual(short_squeeze_cover_quantity(10_000, 1_000_000, 12, 80), 0)
        self.assertEqual(short_squeeze_cover_quantity(200_000, 1_000_000, -4, 80), 0)
        cover = short_squeeze_cover_quantity(200_000, 1_000_000, 12, 80)
        self.assertGreater(cover, 0)
        self.assertLessEqual(cover, 70_000)

    def test_ipo_uncertainty_decays_without_affecting_established_listings(self) -> None:
        now = datetime(2026, 8, 13, 12, tzinfo=timezone.utc)
        self.assertEqual(ipo_uncertainty_multiplier(None, now), 1.0)
        self.assertEqual(ipo_uncertainty_multiplier(now.isoformat(), now, 10, 2.0), 2.0)
        halfway = (now - timedelta(days=5)).isoformat()
        self.assertEqual(ipo_uncertainty_multiplier(halfway, now, 10, 2.0), 1.5)
        expired = (now - timedelta(days=20)).isoformat()
        self.assertEqual(ipo_uncertainty_multiplier(expired, now, 10, 2.0), 1.0)

    def test_stock_split_preserves_market_value(self) -> None:
        quantity, price = split_adjustment(150, 40, 3, 2)
        self.assertAlmostEqual(quantity * price, 150 * 40, delta=.01)
        reverse_quantity, reverse_price = split_adjustment(quantity, price, 2, 3)
        self.assertAlmostEqual(reverse_quantity, 150, places=5)
        self.assertAlmostEqual(reverse_price, 40, delta=.0002)

    def test_market_maker_quote_has_bounded_spread_and_depth(self) -> None:
        quote = market_maker_quote(
            price=100, volatility=72, configured_spread_percent=.35,
            issued_shares=5_000_000, provider_count=12, depth_factor=1.1,
        )
        self.assertLess(quote.bid_price, quote.mid_price)
        self.assertGreater(quote.ask_price, quote.mid_price)
        self.assertGreater(quote.bid_depth, 0)
        self.assertGreater(quote.ask_depth, 0)
        self.assertLessEqual(quote.spread_percent, 25)

    def test_event_severity_uses_requested_taxonomy(self) -> None:
        self.assertEqual(_event_severity(1, 2, 3), "MINOR")
        self.assertEqual(_event_severity(6, 2, 1), "MODERATE")
        self.assertEqual(_event_severity(-9, 1, 4), "MAJOR")
        self.assertEqual(_event_severity(1, -12, 4), "CRITICAL")
        self.assertEqual(_event_severity(1, 2, 18), "SYSTEMIC")


class SandboxTests(unittest.TestCase):
    def test_supported_balancing_windows_are_isolated_and_reproducible(self) -> None:
        for days in (1, 7, 30, 365):
            with self.subTest(days=days):
                first = run_sandbox(days, seed=12345)
                second = run_sandbox(days, seed=12345)
                self.assertEqual(first, second)
                self.assertEqual(first["days"], days)
                self.assertEqual(first["npc_capital_inflation_percent"], 0.0)
                self.assertGreater(first["ending_fcx"], 0)
                self.assertIn("maximum_drawdown_percent", first)

    def test_sandbox_seed_changes_the_path_without_changing_safety(self) -> None:
        first = run_sandbox(30, seed=10)
        second = run_sandbox(30, seed=11)
        self.assertNotEqual(first["points"], second["points"])
        self.assertGreaterEqual(first["maximum_drawdown_percent"], 0)
        self.assertGreaterEqual(second["maximum_drawdown_percent"], 0)


if __name__ == "__main__":
    unittest.main()
