import unittest
import datetime as dt
from pathlib import Path

from market_math import market_cap_weighted_allocations, ravenhood_residential_pnl_windows


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

    def test_residential_pnl_combines_equity_and_margin_per_resident(self) -> None:
        cutoff = dt.datetime(2026, 8, 11, tzinfo=dt.timezone.utc)
        result = ravenhood_residential_pnl_windows(
            equity_trades=[
                {"account_id": 1, "user_id": 10, "name": "Alpha", "civ_number": "100",
                 "security_id": 11, "action": "buy", "quantity": 10, "unit_price": 10,
                 "gross_amount": 100, "fee_amount": 1, "created_at": cutoff + dt.timedelta(hours=1)},
                {"account_id": 1, "user_id": 10, "name": "Alpha", "civ_number": "100",
                 "security_id": 11, "action": "sell", "quantity": 5, "unit_price": 14,
                 "gross_amount": 70, "fee_amount": 1, "created_at": cutoff + dt.timedelta(hours=2)},
            ],
            current_holdings=[
                {"account_id": 1, "user_id": 10, "name": "Alpha", "civ_number": "100",
                 "security_id": 11, "quantity": 5, "average_cost": 10.1, "current_price": 15},
            ],
            margin_positions=[
                {"account_id": 1, "user_id": 10, "name": "Alpha", "civ_number": "100",
                 "security_id": 12, "direction": "long", "quantity": 2, "entry_price": 20,
                 "mark_price": 30, "open_fee": 2, "status": "open",
                 "opened_at": cutoff + dt.timedelta(hours=1)},
                {"account_id": 2, "user_id": 20, "name": "Bravo", "civ_number": "200",
                 "security_id": 13, "direction": "short", "quantity": 10, "entry_price": 30,
                 "close_price": 25, "mark_price": 25, "open_fee": 2, "close_fee": 3,
                 "status": "closed", "opened_at": cutoff + dt.timedelta(hours=1),
                 "closed_at": cutoff + dt.timedelta(hours=3)},
            ],
            cutoff_prices={"1d": {11: 10, 12: 20, 13: 30}},
            windows={"1d": cutoff},
        )["1d"]

        self.assertEqual(result["realized_pnl"], 63.5)
        self.assertEqual(result["unrealized_pnl"], 42.5)
        self.assertEqual(result["net_pnl"], 106.0)
        self.assertEqual(result["equity_pnl"], 43.0)
        self.assertEqual(result["margin_pnl"], 63.0)
        self.assertEqual(result["resident_count"], 2)
        self.assertEqual(result["profitable_residents"], 2)
        residents = {row["name"]: row for row in result["residents"]}
        self.assertEqual(residents["Alpha"]["net_pnl"], 61.0)
        self.assertEqual(residents["Bravo"]["net_pnl"], 45.0)

    def test_residential_pnl_marks_pre_window_holdings_from_cutoff_quote(self) -> None:
        cutoff = dt.datetime(2026, 8, 11, tzinfo=dt.timezone.utc)
        result = ravenhood_residential_pnl_windows(
            equity_trades=[],
            current_holdings=[
                {"account_id": 1, "user_id": 10, "name": "Alpha", "security_id": 11,
                 "quantity": 4, "average_cost": 2, "current_price": 15},
            ],
            margin_positions=[],
            cutoff_prices={"12h": {11: 12}},
            windows={"12h": cutoff},
        )["12h"]

        self.assertEqual(result["realized_pnl"], 0.0)
        self.assertEqual(result["unrealized_pnl"], 12.0)
        self.assertEqual(result["net_pnl"], 12.0)


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
        self.assertIn('"residential_pnl"', section)
        self.assertIn("ravenhood_residential_pnl_windows", section)
        self.assertIn('"12h"', section)
        self.assertIn('"1d"', section)
        self.assertIn('"1w"', section)

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
        self.assertIn("Net residential P&amp;L", FRONTEND_SOURCE)
        self.assertIn("data-fec-pnl-window", FRONTEND_SOURCE)
        self.assertIn("LARGEST GAINS", FRONTEND_SOURCE)
        self.assertIn("LARGEST LOSSES", FRONTEND_SOURCE)
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

    def test_fec_can_resume_selected_or_all_active_security_halts(self) -> None:
        self.assertIn('path == "/api/dev-tools/market/fec/security-halts/bulk-resume"', APP_SOURCE)
        handler = APP_SOURCE.split("def api_dev_market_fec_security_bulk_resume", 1)[1].split(
            "def api_dev_market_fec_security_delist", 1
        )[0]
        self.assertNotIn('expected_confirmation = "RESUME ALL" if resume_all else "RESUME SELECTED"', handler)
        self.assertNotIn('payload.get("confirmation")', handler)
        self.assertIn("one-click FEC market control", handler)
        self.assertIn("WHERE h.status='active'", handler)
        self.assertIn("market.fec.trading_bulk_resumed", handler)
        self.assertIn("data-fec-halt-select", FRONTEND_SOURCE)
        self.assertIn("data-fec-resume-selected", FRONTEND_SOURCE)
        self.assertIn("data-fec-resume-all", FRONTEND_SOURCE)
        self.assertIn("resumeFecHaltBatch", FRONTEND_SOURCE)

    def test_fec_security_halt_controls_are_one_click_after_selection(self) -> None:
        halt_handler = APP_SOURCE.split("def api_dev_market_fec_security_halt", 1)[1].split(
            "def api_dev_market_fec_account_restriction", 1
        )[0]
        resume_handler = APP_SOURCE.split("def api_dev_market_fec_security_resume", 1)[1].split(
            "def api_dev_market_fec_security_bulk_resume", 1
        )[0]
        halt_ui = FRONTEND_SOURCE.split('id="devMarketFecHaltForm"', 1)[1].split('</form>', 1)[0]
        halt_events = FRONTEND_SOURCE.split("const fecHaltForm", 1)[1].split("const fecDelistForm", 1)[0]
        self.assertNotIn('payload.get("confirmation")', halt_handler)
        self.assertNotIn('payload.get("case_reference")', halt_handler)
        self.assertNotIn('payload.get("public_notice")', halt_handler)
        self.assertIn('reason_code = "investor_protection"', halt_handler)
        self.assertNotIn('payload.get("confirmation")', resume_handler)
        self.assertNotIn('name="confirmation"', halt_ui)
        self.assertNotIn('name="case_reference"', halt_ui)
        self.assertNotIn('name="public_notice"', halt_ui)
        self.assertNotIn("prompt(`Document why", halt_events)
        self.assertNotIn("prompt(`Type RESUME", halt_events)

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

    def test_fec_can_delist_and_relist_without_bankruptcy_or_deletion(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS market_security_delistings", APP_SOURCE)
        self.assertIn("MARKET_DELISTING_REASONS", APP_SOURCE)
        self.assertIn('path == "/api/dev-tools/market/fec/security-delistings"', APP_SOURCE)
        self.assertIn('re.fullmatch(r"/api/dev-tools/market/fec/security-delistings/\\d+/relist", path)', APP_SOURCE)
        delist = APP_SOURCE.split("def api_dev_market_fec_security_delist", 1)[1].split(
            "def api_dev_market_fec_security_relist", 1
        )[0]
        self.assertIn("SET lifecycle_status='delisted'", delist)
        self.assertIn("status='superseded_delisting'", delist)
        self.assertNotIn("DELETE FROM market_securities", delist)
        self.assertNotIn("bankruptcy_chapter", delist)
        relist = APP_SOURCE.split("def api_dev_market_fec_security_relist", 1)[1].split(
            "def api_dev_market_fec_seizure", 1
        )[0]
        self.assertIn("SET lifecycle_status='active'", relist)
        self.assertIn("status='relisted'", relist)

    def test_delisted_security_is_suspended_across_exchange_activity(self) -> None:
        self.assertIn("market_security_delisting_error", APP_SOURCE)
        self.assertIn("AS trading_delisted", APP_SOURCE)
        self.assertIn('"active_delistings":', APP_SOURCE)
        self.assertIn('"delisting_history":', APP_SOURCE)
        self.assertIn("COALESCE(s.lifecycle_status,'active')='active'", APP_SOURCE)
        self.assertIn("COALESCE(lifecycle_status,'active')='active'", APP_SOURCE)

    def test_frontend_exposes_separate_delisting_and_relisting_authority(self) -> None:
        self.assertIn('id="devMarketFecDelistForm"', FRONTEND_SOURCE)
        self.assertIn("Halt &amp; delist from FCX", FRONTEND_SOURCE)
        self.assertIn("data-fec-relist-security", FRONTEND_SOURCE)
        self.assertIn("OFF-EXCHANGE REGISTER", FRONTEND_SOURCE)
        self.assertIn("FEC LISTING STATUS NOTICE", FRONTEND_SOURCE)
        self.assertIn("selectedDelisted", FRONTEND_SOURCE)
        self.assertIn("listedSecurities", FRONTEND_SOURCE)

    def test_developer_can_zero_all_resident_equity_cash_with_audited_snapshot(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS market_fec_equity_cash_resets", APP_SOURCE)
        self.assertIn('path == "/api/dev-tools/market/fec/equity-cash/reset-all"', APP_SOURCE)
        handler = APP_SOURCE.split("def api_dev_market_fec_equity_cash_reset_all", 1)[1].split(
            "def api_dev_market_fec_seizure", 1
        )[0]
        self.assertIn('admin_tools_section_required(db, user, "fec-investigations")', handler)
        self.assertIn("strict_developer_required(user)", handler)
        self.assertIn('confirmation != "DELETE ALL EQUITY CASH"', handler)
        self.assertIn("FOR UPDATE OF a", handler)
        self.assertIn("cash_balance_before", handler)
        self.assertIn("account_snapshot_json", handler)
        self.assertIn("UPDATE market_accounts SET cash_balance=0", handler)
        self.assertIn("WHERE cash_balance>0.005", handler)
        self.assertNotIn("bank_bridge_commands", handler)
        self.assertNotIn("market_fec_asset_pool", handler)

    def test_frontend_exposes_guarded_systemwide_equity_cash_control(self) -> None:
        self.assertIn("can_reset_all_equity_cash", FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecEquityCashResetForm"', FRONTEND_SOURCE)
        self.assertIn("DELETE ALL EQUITY CASH", FRONTEND_SOURCE)
        self.assertIn("Systemwide equity-cash deletion", FRONTEND_SOURCE)
        self.assertIn("PERMANENT RESET LEDGER", FRONTEND_SOURCE)
        self.assertIn("/api/dev-tools/market/fec/equity-cash/reset-all", FRONTEND_SOURCE)

    def test_developer_can_zero_all_resident_shares_with_an_audited_snapshot(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS market_fec_share_resets", APP_SOURCE)
        self.assertIn('path == "/api/dev-tools/market/fec/shares/reset-all"', APP_SOURCE)
        handler = APP_SOURCE.split("def api_dev_market_fec_shares_reset_all", 1)[1].split(
            "def api_dev_market_fec_seizure", 1
        )[0]
        self.assertIn('admin_tools_section_required(db, user, "fec-investigations")', handler)
        self.assertIn("strict_developer_required(user)", handler)
        self.assertIn('confirmation != "DELETE ALL RESIDENT SHARES"', handler)
        self.assertIn("FOR UPDATE OF h", handler)
        self.assertIn("quantity_before", handler)
        self.assertIn("holding_snapshot_json", handler)
        self.assertIn("UPDATE market_holdings SET quantity=0,average_cost=0", handler)
        self.assertNotIn("bank_bridge_commands", handler)
        self.assertNotIn("fcx_engine_npc_positions", handler)

    def test_frontend_exposes_guarded_systemwide_resident_share_control(self) -> None:
        self.assertIn("can_reset_all_shares", FRONTEND_SOURCE)
        self.assertIn('id="devMarketFecShareResetForm"', FRONTEND_SOURCE)
        self.assertIn("DELETE ALL RESIDENT SHARES", FRONTEND_SOURCE)
        self.assertIn("Systemwide resident-share deletion", FRONTEND_SOURCE)
        self.assertIn("PERMANENT SHARE-RESET LEDGER", FRONTEND_SOURCE)
        self.assertIn("/api/dev-tools/market/fec/shares/reset-all", FRONTEND_SOURCE)


if __name__ == "__main__":
    unittest.main()
