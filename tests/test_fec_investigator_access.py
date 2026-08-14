import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class FecInvestigatorAccessTests(unittest.TestCase):
    def test_role_is_assignable_and_receives_admin_tools_app(self) -> None:
        self.assertIn('FEC_INVESTIGATOR_ROLE = "fec_investigator"', APP_SOURCE)
        self.assertIn('"dev", "fec_investigator", "beta"', FRONTEND_SOURCE)
        self.assertEqual(
            APP_SOURCE.count('"owner", "admin", "dev", FEC_INVESTIGATOR_ROLE'),
            3,
        )

    def test_role_is_strictly_scoped_to_fec_section(self) -> None:
        helper = APP_SOURCE.split("def admin_tools_effective_sections", 1)[1].split(
            "def admin_tools_section_required", 1
        )[0]
        self.assertIn('return {"fec-investigations"}', helper)
        self.assertLess(
            helper.index('has_any(user, FEC_INVESTIGATOR_ROLE)'),
            helper.index('has_any(user, "admin")'),
        )

    def test_base_dev_tools_route_honors_requested_section(self) -> None:
        guard = APP_SOURCE.split('if path.startswith("/api/dev-tools"):', 1)[1].split(
            "if path == \"/api/fine-settlement\"", 1
        )[0]
        self.assertIn('if path == "/api/dev-tools":', guard)
        self.assertIn('query.get("section")', guard)
        self.assertIn("admin_tools_section_required(db, user, routed_section)", guard)

    def test_fec_mutations_use_fec_section_authorization(self) -> None:
        for function_name in (
            "api_dev_market_fec_seizure",
            "api_dev_market_fec_pool_dispose",
        ):
            function = APP_SOURCE.split(f"def {function_name}", 1)[1].split("\n    def ", 1)[0]
            self.assertIn(
                'admin_tools_section_required(db, user, "fec-investigations")',
                function,
            )

    def test_fec_sidebar_hides_every_other_tab(self) -> None:
        self.assertIn("function isScopedFecInvestigator()", FRONTEND_SOURCE)
        self.assertIn('if (isScopedFecInvestigator()) return "fec-investigations";', FRONTEND_SOURCE)
        self.assertIn(
            '[["fec-investigations", "FEC Investigations", "01"]]',
            FRONTEND_SOURCE,
        )

    def test_role_assignment_is_owner_or_developer_controlled(self) -> None:
        update = APP_SOURCE.split("def api_admin_update_user", 1)[1].split(
            "def api_admin_delete_user", 1
        )[0]
        self.assertIn("fec_investigator_role_changed", update)
        self.assertIn('not has_any(user, "owner", "dev")', update)

    def test_fec_investigator_is_server_enforced_read_only_in_ravenhood(self) -> None:
        access = APP_SOURCE.split("def market_account_trading_access", 1)[1].split(
            "def market_account_execution_access", 1
        )[0]
        self.assertIn("FEC_INVESTIGATOR_ROLE in roles_for(user)", access)
        self.assertIn('scope in ("all", "equity")', access)
        self.assertIn('scope in ("all", "margin")', access)
        self.assertIn('"can_trade_equity": not equity_blocked', access)
        self.assertIn('"can_trade_margin": not margin_blocked', access)
        self.assertIn('"can_transfer_shares": not equity_blocked', access)

        for function_name, permission in (
            ("api_wallstreet_order", "can_trade_equity"),
            ("api_wallstreet_margin_open", "can_trade_margin"),
            ("api_wallstreet_transfer", "can_transfer_shares"),
        ):
            function = APP_SOURCE.split(f"def {function_name}", 1)[1].split("\n    def ", 1)[0]
            self.assertIn("market_account_trading_access", function)
            self.assertIn(permission, function)
            self.assertIn("self.error(423", function)

    def test_account_restrictions_cover_direct_and_queued_execution(self) -> None:
        self.assertIn("CREATE TABLE IF NOT EXISTS market_account_trading_restrictions", APP_SOURCE)
        self.assertIn("idx_market_account_restrictions_active", APP_SOURCE)
        self.assertIn("def active_market_account_restriction", APP_SOURCE)
        self.assertIn("market_account_execution_access(db, account_id)", APP_SOURCE)
        self.assertIn('"status_code": 423', APP_SOURCE)

        equity_queue = APP_SOURCE.split("def process_queued_ravenhood_orders", 1)[1].split(
            "def clear_legacy_ravenhood_price_freeze", 1
        )[0]
        margin_queue = APP_SOURCE.split("def process_queued_ravenhood_margin_orders", 1)[1].split(
            "def process_ravenhood_margin_liquidations", 1
        )[0]
        for queue in (equity_queue, margin_queue):
            self.assertIn('status_code") or 0) == 423', queue)
            self.assertIn("SET status='queued',failure_reason=?", queue)

    def test_fec_workspace_exposes_scoped_lock_and_release_controls(self) -> None:
        self.assertIn('path == "/api/dev-tools/market/fec/account-restrictions"', APP_SOURCE)
        self.assertIn("api_dev_market_fec_account_restriction_release", APP_SOURCE)
        self.assertIn('scope not in ("all", "equity", "margin")', APP_SOURCE)
        self.assertIn('confirmation != "RESTRICT"', APP_SOURCE)
        self.assertIn('confirmation != "UNLOCK"', APP_SOURCE)
        self.assertIn('"account_restrictions":', APP_SOURCE)
        self.assertIn('"account_restriction_history":', APP_SOURCE)

        self.assertIn('id="devMarketFecAccountRestrictionForm"', FRONTEND_SOURCE)
        self.assertIn('value="all">All trading', FRONTEND_SOURCE)
        self.assertIn('value="equity">Share trading only', FRONTEND_SOURCE)
        self.assertIn('value="margin">Leverage trading only', FRONTEND_SOURCE)
        self.assertIn("data-fec-account-unlock", FRONTEND_SOURCE)

    def test_live_ravenhood_renderer_hides_trade_button_for_investigator(self) -> None:
        live_renderer = FRONTEND_SOURCE.split("function renderMarketWorkspace()", 1)[1].split(
            "function renderMarketWorkspaceV10", 1
        )[0]
        self.assertIn("const tradingAccess = data.trading_access || {};", live_renderer)
        self.assertIn("const investigatorReadOnly = Boolean(tradingAccess.read_only);", live_renderer)
        self.assertIn("FEC INVESTIGATOR · READ ONLY", live_renderer)
        self.assertIn('investigatorReadOnly ? `<span class="market-v18-read-only"', live_renderer)
        self.assertIn("state.cache.wallstreet?.trading_access?.read_only", FRONTEND_SOURCE)


if __name__ == "__main__":
    unittest.main()
