import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class MarketAutopilotTests(unittest.TestCase):
    def test_continuous_engine_and_gemini_use_separate_workers(self) -> None:
        self.assertIn('name="ravenhood-market-automation"', APP_SOURCE)
        self.assertIn('name="ravenhood-gemini-autopilot"', APP_SOURCE)
        core_worker = APP_SOURCE.split("def market_automation_worker", 1)[1].split(
            "def market_gemini_worker", 1
        )[0]
        self.assertNotIn("market_gemini_adjustment_cycle", core_worker)

    def test_autopilot_profiles_and_custom_range_are_persisted(self) -> None:
        for profile in ("light", "aggressive", "extreme"):
            self.assertIn(f'"{profile}"', APP_SOURCE)
        self.assertIn('"market_volatility_min_percent"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_autopilot_profile"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_volatility_min_percent"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_volatility_percent"', APP_SOURCE)
        self.assertIn('name="autopilot_profile"', FRONTEND_SOURCE)
        self.assertIn('name="volatility_min_percent"', FRONTEND_SOURCE)

    def test_future_programs_wait_and_capture_the_activation_quote(self) -> None:
        function_source = APP_SOURCE.split("def apply_market_price_programs", 1)[1].split(
            "def execute_ravenhood_order", 1
        )[0]
        self.assertIn("status IN ('active','scheduled')", function_source)
        self.assertIn("if current < starts", function_source)
        self.assertIn("live_security", function_source)
        self.assertIn("status='active',start_price", function_source)
        self.assertIn('name="starts_at" type="datetime-local"', FRONTEND_SOURCE)
        self.assertIn('America/New_York', APP_SOURCE)


if __name__ == "__main__":
    unittest.main()
