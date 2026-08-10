import unittest

from market_math import ravenhood_margin_metrics, ravenhood_margin_quote


class RavenhoodMarginMathTests(unittest.TestCase):
    def test_five_x_long_quote(self):
        quote = ravenhood_margin_quote("long", 100, 1_000, 5, 1, 0.20)
        self.assertEqual(quote["notional"], 5_000)
        self.assertEqual(quote["quantity"], 50)
        self.assertEqual(quote["open_fee"], 50)
        self.assertEqual(quote["liquidation_price"], 84)

    def test_eighty_x_short_quote_remains_bounded(self):
        quote = ravenhood_margin_quote("short", 100, 1_000, 80, 0.5, 0.20)
        self.assertEqual(quote["notional"], 80_000)
        self.assertEqual(quote["quantity"], 800)
        self.assertEqual(quote["liquidation_price"], 101)

    def test_long_profit_and_close_fee(self):
        metrics = ravenhood_margin_metrics("long", 100, 110, 50, 1_000, 5, 1, 0.20)
        self.assertEqual(metrics["unrealized_pnl"], 500)
        self.assertEqual(metrics["close_fee"], 55)
        self.assertEqual(metrics["estimated_payout"], 1_445)
        self.assertFalse(metrics["liquidatable"])

    def test_short_crossing_maintenance_is_liquidatable(self):
        metrics = ravenhood_margin_metrics("short", 100, 116.5, 50, 1_000, 5, 1, 0.20)
        self.assertEqual(metrics["unrealized_pnl"], -825)
        self.assertTrue(metrics["liquidatable"])


if __name__ == "__main__":
    unittest.main()
