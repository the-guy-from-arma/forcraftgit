import unittest
from pathlib import Path

from market_math import market_cap_weighted_allocations


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class MarketFecAllocationTests(unittest.TestCase):
    def test_market_cap_weighted_allocations_reconcile_to_the_cent(self) -> None:
        allocations = market_cap_weighted_allocations([(1, 60), (2, 30), (3, 10)], 100.01)

        self.assertEqual([row["amount"] for row in allocations], [60.0, 30.0, 10.01])
        self.assertEqual(round(sum(float(row["amount"]) for row in allocations), 2), 100.01)

    def test_market_cap_weighted_allocations_skip_non_positive_caps(self) -> None:
        allocations = market_cap_weighted_allocations([(1, 0), (2, -5), (3, 25)], 50)

        self.assertEqual(allocations, [{"security_id": 3, "amount": 50.0, "weight": 1.0}])


class MarketFecInvestigationWorkspaceTests(unittest.TestCase):
    def test_fec_is_a_separate_delegated_workspace(self) -> None:
        self.assertIn('(\"fec-investigations\", \"FEC Investigations\")', APP_SOURCE)
        self.assertIn('(\"/api/dev-tools/market/fec/\", \"fec-investigations\")', APP_SOURCE)
        self.assertLess(
            APP_SOURCE.index('(\"/api/dev-tools/market/fec/\", \"fec-investigations\")'),
            APP_SOURCE.index('(\"/api/dev-tools/market/\", \"market-settings\")'),
        )
        developer_only = APP_SOURCE.split("ADMIN_TOOLS_DEVELOPER_ONLY_SECTIONS", 1)[1].split(")", 1)[0]
        self.assertNotIn("fec-investigations", developer_only)
        default_admin = APP_SOURCE.split("ADMIN_TOOLS_DEFAULT_ADMIN_SECTIONS", 1)[1].split(")", 1)[0]
        self.assertNotIn("fec-investigations", default_admin)
        self.assertIn("section_id not in ADMIN_TOOLS_DEFAULT_ADMIN_SECTIONS", APP_SOURCE)
        self.assertIn("section_id not in ADMIN_TOOLS_DEVELOPER_ONLY_SECTIONS", APP_SOURCE)

    def test_investigation_payload_has_complete_trade_and_withdrawal_sources(self) -> None:
        section = APP_SOURCE.split('if section == "fec-investigations":', 1)[1].split(
            'if section == "market-settings":', 1
        )[0]
        self.assertIn('"equity_trades"', section)
        self.assertIn("FROM market_orders o", section)
        self.assertIn('"margin_trades"', section)
        self.assertIn("FROM market_margin_positions p", section)
        self.assertIn('"withdrawal_flags"', section)
        self.assertIn("t.transaction_type='withdrawal' AND t.amount>=10000000", section)
        self.assertIn("LEFT JOIN bank_bridge_commands", section)

    def test_frontend_has_searchable_sortable_trade_tape_and_custody_tools(self) -> None:
        self.assertIn("function renderDevFecInvestigations", FRONTEND_SOURCE)
        self.assertIn("data-fec-trade-search", FRONTEND_SOURCE)
        self.assertIn("data-fec-trade-sort", FRONTEND_SOURCE)
        self.assertIn("applyFecTradeView", FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecSeizureForm"', FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecDispositionForm"', FRONTEND_SOURCE)
        market_render = FRONTEND_SOURCE.split("function renderDevMarketSettings", 1)[1].split(
            "function renderDevFecInvestigations", 1
        )[0]
        rendered_output = market_render.split('return `<div class="stack dev-market-view">', 1)[1]
        self.assertNotIn("${fecCustody}", rendered_output)


if __name__ == "__main__":
    unittest.main()
