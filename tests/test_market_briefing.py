import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class MarketBriefingTests(unittest.TestCase):
    def test_provider_call_is_single_attempt(self) -> None:
        helper = APP_SOURCE.split("def generate_market_analyst_briefing", 1)[1].split(
            "def local_market_analyst_briefing", 1
        )[0]
        self.assertEqual(helper.count("urllib.request.urlopen"), 1)
        self.assertNotIn("time.sleep", helper)
        self.assertNotIn("for attempt", helper)

    def test_briefing_uses_provider_cooldowns_and_fallback(self) -> None:
        handler = APP_SOURCE.split("def api_dev_market_ai_briefing", 1)[1].split(
            "def api_dev_casino_settings", 1
        )[0]
        self.assertIn("market_ai_provider_order(settings)", handler)
        self.assertIn('settings.get(f"market_{provider}_cooldown_until")', handler)
        self.assertIn('set_system_setting(db, f"market_{provider}_cooldown_until"', handler)
        self.assertIn('settings["market_ai_local_fallback_enabled"]', handler)
        self.assertIn("local_market_analyst_briefing", handler)

    def test_duplicate_briefings_are_rejected_on_both_sides(self) -> None:
        handler = APP_SOURCE.split("def api_dev_market_ai_briefing", 1)[1].split(
            "def api_dev_casino_settings", 1
        )[0]
        self.assertIn("MARKET_ANALYST_BRIEFING_LOCK.acquire(blocking=False)", handler)
        self.assertIn("market_briefing_in_progress", handler)
        self.assertIn('form.dataset.submitting==="1"', FRONTEND_SOURCE)
        self.assertIn('button.textContent="Analyst is reviewing the market…"', FRONTEND_SOURCE)

    def test_ui_and_audit_identify_the_actual_provider(self) -> None:
        self.assertIn("MARKET ANALYST", FRONTEND_SOURCE)
        self.assertNotIn("<span>GEMINI ANALYST</span>", FRONTEND_SOURCE)
        self.assertIn('"market.analyst_briefing.generated"', APP_SOURCE)
        self.assertIn('"provider": successful_provider', APP_SOURCE)


if __name__ == "__main__":
    unittest.main()
