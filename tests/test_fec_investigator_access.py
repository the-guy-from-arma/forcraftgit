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


if __name__ == "__main__":
    unittest.main()
