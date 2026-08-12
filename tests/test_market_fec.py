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
        self.assertIn('"shareholders"', section)
        self.assertIn("COALESCE(position.position_count,0) AS position_count", section)
        self.assertIn("FROM market_holdings h", section)

        market_section = APP_SOURCE.split('if section == "market-settings":', 1)[1].split(
            'if section == "sportsbook-settings":', 1
        )[0]
        self.assertNotIn('"accounts": [dict(row) for row in all_rows(db', market_section)

    def test_frontend_has_searchable_sortable_trade_tape_and_custody_tools(self) -> None:
        self.assertIn("function renderDevFecInvestigations", FRONTEND_SOURCE)
        self.assertIn("data-fec-trade-search", FRONTEND_SOURCE)
        self.assertIn("data-fec-trade-sort", FRONTEND_SOURCE)
        self.assertIn("applyFecTradeView", FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecSeizureForm"', FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecDispositionForm"', FRONTEND_SOURCE)
        self.assertIn("data-fec-resident-portfolios", FRONTEND_SOURCE)
        self.assertIn("FEC FINANCIAL ACCOUNT REGISTRY", FRONTEND_SOURCE)
        market_render = FRONTEND_SOURCE.split("function renderDevMarketSettings", 1)[1].split(
            "function renderDevFecInvestigations", 1
        )[0]
        rendered_output = market_render.split('return `<div class="stack dev-market-view">', 1)[1]
        self.assertNotIn("${fecCustody}", rendered_output)
        self.assertNotIn("${ravenhoodAccountRegistry}", rendered_output)

    def test_fec_can_halt_and_resume_an_individual_security(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS market_security_halts", APP_SOURCE)
        self.assertIn("MARKET_TRADING_HALT_REASONS", APP_SOURCE)
        self.assertIn('"material_news_pending"', APP_SOURCE)
        self.assertIn('"suspected_manipulation"', APP_SOURCE)
        self.assertIn('"technical_operational"', APP_SOURCE)
        self.assertIn("def active_market_security_halt", APP_SOURCE)
        self.assertIn('path == "/api/dev-tools/market/fec/security-halts"', APP_SOURCE)
        self.assertIn('re.fullmatch(r"/api/dev-tools/market/fec/security-halts/\\d+/resume", path)', APP_SOURCE)
        self.assertIn('admin_tools_section_required(db, user, "fec-investigations")', APP_SOURCE)

    def test_halted_security_is_blocked_from_exchange_activity(self) -> None:
        self.assertIn("market_security_halt_error(halt)", APP_SOURCE)
        self.assertIn("AND NOT EXISTS (SELECT 1 FROM market_security_halts h", APP_SOURCE)
        self.assertIn("Suspended while an FEC trading halt is active.", APP_SOURCE)
        self.assertIn("AS trading_halted", APP_SOURCE)
        self.assertIn('"active_halts":', APP_SOURCE)
        self.assertIn('"halt_history":', APP_SOURCE)

    def test_frontend_exposes_halt_authority_and_public_notice(self) -> None:
        self.assertIn('id="devMarketFecHaltForm"', FRONTEND_SOURCE)
        self.assertIn("data-fec-resume-halt", FRONTEND_SOURCE)
        self.assertIn("FEC MARKET INTEGRITY NOTICE", FRONTEND_SOURCE)
        self.assertIn("Trading halted by FEC", FRONTEND_SOURCE)
        self.assertIn("selectedTradingHalt", FRONTEND_SOURCE)


if __name__ == "__main__":
    unittest.main()
