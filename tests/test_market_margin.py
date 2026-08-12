import unittest
from pathlib import Path

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

    def test_margin_action_routes_read_numeric_id_segment(self):
        source = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")
        self.assertIn("api_wallstreet_margin_close(db, user, self.path_int(path, 4))", source)
        self.assertIn("api_wallstreet_margin_cancel(db, user, self.path_int(path, 4))", source)
        self.assertNotIn("api_wallstreet_margin_close(db, user, self.path_int(path, 5))", source)

    def test_margin_close_atomically_settles_buying_power_and_records_ledger(self):
        source = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")
        start = source.index("def close_ravenhood_margin_position(")
        end = source.index("\ndef process_queued_ravenhood_margin_orders", start)
        close_source = source[start:end]
        self.assertIn(
            "SET cash_balance=ROUND(CAST(COALESCE(cash_balance,0)+CAST(? AS NUMERIC) AS NUMERIC),2)",
            close_source,
        )
        self.assertNotIn("ROUND(COALESCE(cash_balance,0)+?,2)", close_source)
        self.assertIn("RETURNING cash_balance", close_source)
        self.assertIn("'margin_settlement'", close_source)
        self.assertIn("settlement_status='completed'", close_source)
        self.assertIn('"cash_balance_after": cash_balance_after', close_source)


if __name__ == "__main__":
    unittest.main()
