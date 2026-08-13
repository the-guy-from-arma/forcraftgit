import unittest
from pathlib import Path


APP_SOURCE = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")


class MarketIndexCleanupTests(unittest.TestCase):
    def test_schema_removes_non_operating_constituents(self) -> None:
        schema_source = APP_SOURCE.split(
            "CREATE TABLE IF NOT EXISTS market_index_members", 1
        )[1].split("CREATE TABLE IF NOT EXISTS market_promo_codes", 1)[0]
        self.assertIn('migration_index_constituent_cleanup_20260812', schema_source)
        self.assertIn("if not one(db", schema_source)
        self.assertIn("DELETE FROM market_index_members", schema_source)
        self.assertIn("COALESCE(lifecycle_status,'active')<>'active'", schema_source)
        self.assertIn("VALUES (?, 'completed', ?)", schema_source)

    def test_empty_market_clears_both_fund_baskets(self) -> None:
        rebalance_source = APP_SOURCE.split("def rebalance_market_index_funds", 1)[1].split(
            "def update_market_index_prices", 1
        )[0]
        self.assertIn("if not candidates:", rebalance_source)
        self.assertIn('DELETE FROM market_index_members WHERE fund_id=?', rebalance_source)
        self.assertIn('"constituents": 0', rebalance_source)

    def test_payload_never_displays_bankrupt_or_inactive_members(self) -> None:
        payload_source = APP_SOURCE.split("def market_index_payload", 1)[1].split(
            "def record_market_system_trades", 1
        )[0]
        self.assertIn("WHERE s.active=1", payload_source)
        self.assertIn("COALESCE(s.lifecycle_status,'active')='active'", payload_source)
        self.assertIn("COALESCE(s.index_eligible,1)=1", payload_source)


if __name__ == "__main__":
    unittest.main()
