import math
import unittest
from pathlib import Path

from business_issuer import (
    DEFAULT_SECTOR_COMPANY_LIMIT,
    IPO_SECTORS,
    _canonical_sector,
    _float,
    _public_company,
    _sector_limits,
    _text,
    _ticker,
)


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
BUSINESS_SOURCE = (ROOT / "business_issuer.py").read_text(encoding="utf-8")
APP_JS_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class BusinessIssuerHelpersTest(unittest.TestCase):
    def test_ticker_is_uppercase_compact_and_bounded(self):
        self.assertEqual(_ticker(" fc-x ipo! 2026 "), "FCXIPO20")

    def test_text_normalizes_whitespace_and_applies_limit(self):
        self.assertEqual(_text("  Faircroft\n  Foundry   Network  ", 19), "Faircroft Foundry N")

    def test_float_rejects_invalid_and_non_finite_values(self):
        self.assertEqual(_float("not-a-number", 7.0), 7.0)
        self.assertEqual(_float(math.inf, 8.0), 8.0)
        self.assertEqual(_float("12.5"), 12.5)

    def test_public_company_normalizes_financial_fields(self):
        public = _public_company(
            {
                "target_market_cap": "123456.789",
                "authorized_shares": "456.123456789",
                "security_active": 1,
                "company_name": "Faircroft Industries",
            }
        )
        self.assertEqual(public["target_market_cap"], 123456.79)
        self.assertEqual(public["authorized_shares"], 456.123457)
        self.assertIs(public["security_active"], True)
        self.assertEqual(public["company_name"], "Faircroft Industries")

    def test_sector_names_are_canonical_and_unknown_values_are_rejected(self):
        self.assertEqual(_canonical_sector(" real estate "), "Real Estate")
        self.assertEqual(_canonical_sector("Technology"), "Technology")
        self.assertEqual(_canonical_sector("Unapproved Moon Mining"), "")

    def test_sector_limits_default_clamp_and_ignore_unknown_keys(self):
        limits = _sector_limits({"Technology": -4, "Financial": 250, "Media": "12", "Unknown": 1})
        self.assertEqual(limits["Technology"], 0)
        self.assertEqual(limits["Financial"], 100)
        self.assertEqual(limits["Media"], 12)
        self.assertEqual(limits["General"], DEFAULT_SECTOR_COMPANY_LIMIT)
        self.assertEqual(set(limits), set(IPO_SECTORS))

    def test_ipo_guardrails_are_enforced_by_the_backend(self):
        create_source = BUSINESS_SOURCE.split("def create_ipo", 1)[1].split("def contribute", 1)[0]
        self.assertIn("pg_advisory_xact_lock", create_source)
        self.assertIn("guardrails = ipo_guardrails(db)", create_source)
        self.assertIn('guardrails["max_public_float_percent"]', create_source)
        self.assertIn('sector_policy["closed"]', create_source)

    def test_dev_guardrail_route_and_resident_form_share_the_policy(self):
        self.assertIn('/api/dev-tools/business/ipo-guardrails', APP_SOURCE)
        self.assertIn("developer_required(user)", APP_SOURCE.split("def api_dev_business_ipo_guardrails", 1)[1].split("\n    def ", 1)[0])
        self.assertIn("devBusinessGuardrailsForm", APP_JS_SOURCE)
        self.assertIn("guardrails.max_public_float_percent", APP_JS_SOURCE)
        self.assertIn("guardrails.sectors", APP_JS_SOURCE)

    def test_company_action_routes_read_the_numeric_company_segment(self):
        route_source = APP_SOURCE.split('elif path == "/api/business/companies"', 1)[1].split(
            'elif path == "/api/business/applications"', 1
        )[0]
        for handler in (
            "api_business_contribute",
            "api_business_announcement",
            "api_business_retry_funding",
            "api_business_bankruptcy",
        ):
            self.assertIn(f"self.{handler}(db, user, self.path_int(path, 3))", route_source)
        self.assertNotIn("self.path_int(path, 4)", route_source)

    def test_revenue_command_locks_only_the_required_funding_batch(self):
        queue_source = BUSINESS_SOURCE.split("def _queue_next_funding_command", 1)[1].split(
            "def _activate_company", 1
        )[0]
        self.assertIn("LEFT JOIN arma_account_links", queue_source)
        self.assertIn("FOR UPDATE OF b", queue_source)
        self.assertNotIn('WHERE b.id=? FOR UPDATE"""', queue_source)

    def test_issuer_revenue_action_uses_resident_facing_label(self):
        company_source = APP_JS_SOURCE.split("function renderIssuerCompany", 1)[1].split(
            "function renderIssuerWire", 1
        )[0]
        self.assertIn("Report revenue", company_source)
        self.assertNotIn(">Fund treasury<", company_source)


if __name__ == "__main__":
    unittest.main()
