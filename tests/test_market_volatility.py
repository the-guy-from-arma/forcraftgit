import unittest
from pathlib import Path


APP_SOURCE = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")


class MarketVolatilityCycleTests(unittest.TestCase):
    def test_cycle_does_not_exclude_scheduled_listings(self) -> None:
        function_source = APP_SOURCE.split("def market_volatility_cycle", 1)[1].split(
            "def market_gemini_adjustment_cycle", 1
        )[0]
        self.assertNotIn("NOT EXISTS", function_source)
        self.assertIn("UPDATE market_price_programs SET start_price", function_source)
        self.assertIn("update_market_index_prices", function_source)


if __name__ == "__main__":
    unittest.main()
