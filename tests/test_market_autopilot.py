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

    def test_local_gemini_and_deepseek_engines_have_ordered_fallback(self) -> None:
        self.assertIn('DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY"', APP_SOURCE)
        self.assertIn('DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL"', APP_SOURCE)
        self.assertIn('DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL"', APP_SOURCE)
        self.assertIn('primary in ("gemini", "deepseek")', APP_SOURCE)
        self.assertIn('provider_order.append(alternate)', APP_SOURCE)
        self.assertIn('settings["market_ai_local_fallback_enabled"]', APP_SOURCE)
        self.assertIn('f"ai-fallback:{profile}"', APP_SOURCE)
        self.assertIn('name="automation_provider" value="local"', FRONTEND_SOURCE)
        self.assertIn('name="automation_provider" value="gemini"', FRONTEND_SOURCE)
        self.assertIn('name="automation_provider" value="deepseek"', FRONTEND_SOURCE)

    def test_external_provider_attempts_use_interval_and_cooldown_guards(self) -> None:
        self.assertIn('"market_ai_interval_minutes"', APP_SOURCE)
        self.assertIn('"market_ai_cooldown_minutes"', APP_SOURCE)
        self.assertIn('f"market_{provider}_cooldown_until"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_ai_last_tick", attempt_at.isoformat())', APP_SOURCE)
        self.assertIn('name="ai_interval_minutes"', FRONTEND_SOURCE)
        self.assertIn('name="ai_cooldown_minutes"', FRONTEND_SOURCE)

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
