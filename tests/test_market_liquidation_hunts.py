import unittest
from pathlib import Path

from market_math import ravenhood_liquidation_hunt_quote


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class LiquidationHuntQuoteTests(unittest.TestCase):
    def test_long_moves_down_without_crossing_liquidation(self):
        quote = ravenhood_liquidation_hunt_quote("long", 100, 84, "extreme", 15)
        self.assertTrue(quote["moved"])
        self.assertLess(quote["new_price"], 100)
        self.assertGreater(quote["new_price"], 84)

    def test_short_moves_up_without_crossing_liquidation(self):
        quote = ravenhood_liquidation_hunt_quote("short", 100, 116, "aggressive", 15)
        self.assertTrue(quote["moved"])
        self.assertGreater(quote["new_price"], 100)
        self.assertLess(quote["new_price"], 116)

    def test_hard_percent_cap_is_respected(self):
        quote = ravenhood_liquidation_hunt_quote("long", 100, 1, "extreme", 2)
        self.assertAlmostEqual(quote["new_price"], 98, places=4)
        self.assertAlmostEqual(quote["movement_percent"], -2, places=4)

    def test_boundary_is_not_crossed_when_already_inside_buffer(self):
        quote = ravenhood_liquidation_hunt_quote("long", 100, 99.99, "extreme", 15)
        self.assertFalse(quote["moved"])
        self.assertEqual(quote["reason"], "at_liquidation_boundary")


class LiquidationHuntIntegrationTests(unittest.TestCase):
    def test_provider_independent_cycle_hooks_exist(self):
        self.assertIn('run_ravenhood_liquidation_hunt(\n                            db, settings, "local", cycle_number', APP_SOURCE)
        self.assertIn('successful_provider, cycle_number', APP_SOURCE)
        self.assertIn('cycle_db, get_system_settings(cycle_db), provider, cycle_number, actor_id', APP_SOURCE)

    def test_ai_provider_never_receives_resident_hunt_data(self):
        ai_cycle = APP_SOURCE.split("def market_gemini_adjustment_cycle", 1)[1].split("def ", 1)[0]
        self.assertNotIn("market_liquidation_hunt_events", ai_cycle)
        self.assertNotIn("resident_name", ai_cycle)

    def test_dev_policy_and_manual_endpoint_are_exposed(self):
        self.assertIn('"/api/dev-tools/market/liquidation-hunt"', APP_SOURCE)
        self.assertIn('id="devMarketLiquidationHuntForm"', FRONTEND_SOURCE)
        self.assertIn("liquidation_hunt_probability_percent", FRONTEND_SOURCE)

    def test_market_settings_returns_saved_hunt_policy(self):
        market_payload = APP_SOURCE.split('if section == "market-settings":', 1)[1].split('if section == "lottery-settings":', 1)[0]
        self.assertIn('"liquidation_hunt_threshold": settings["market_liquidation_hunt_threshold"]', market_payload)
        self.assertIn('"liquidation_hunt_qualified_accounts"', market_payload)
        self.assertIn('"liquidation_hunt_open_positions"', market_payload)

    def test_no_hunt_reason_distinguishes_cash_from_leverage(self):
        hunt_source = APP_SOURCE.split("def run_ravenhood_liquidation_hunt", 1)[1].split("def process_queued_ravenhood_orders", 1)[0]
        self.assertIn('result["reason"] = "no_accounts_above_threshold"', hunt_source)
        self.assertIn('result["reason"] = "no_open_leveraged_positions"', hunt_source)
        self.assertIn('result["reason"] = "outside_trading_session"', hunt_source)


if __name__ == "__main__":
    unittest.main()
