import math
import unittest
from pathlib import Path

from business_issuer import (
    DEFAULT_MIN_IPO_CAPITALIZATION,
    DEFAULT_SECTOR_COMPANY_LIMIT,
    IPO_REVIEW_SLA_HOURS,
    IPO_SECTORS,
    _canonical_sector,
    _float,
    _public_company,
    _revenue_market_repricing,
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

    def test_reported_revenue_reprices_without_changing_issued_shares(self):
        repricing = _revenue_market_repricing(10, 100_000, 250_000)
        self.assertEqual(repricing["price_before"], 10)
        self.assertEqual(repricing["price_after"], 12.5)
        self.assertEqual(repricing["market_cap_before"], 1_000_000)
        self.assertEqual(repricing["market_cap_after"], 1_250_000)
        self.assertEqual(repricing["market_cap_change"], 250_000)

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
        self.assertIn('guardrails["min_capitalization"]', create_source)
        self.assertIn('guardrails["max_public_float_percent"]', create_source)
        self.assertIn('sector_policy["closed"]', create_source)

    def test_resident_ipo_requires_fec_approval_before_bank_bridge(self):
        create_source = BUSINESS_SOURCE.split("def create_ipo", 1)[1].split("def review_ipo", 1)[0]
        review_source = BUSINESS_SOURCE.split("def review_ipo", 1)[1].split("def fec_review_payload", 1)[0]
        self.assertEqual(IPO_REVIEW_SLA_HOURS, 24)
        self.assertIn("pending_fec_review", create_source)
        self.assertIn("awaiting_approval", create_source)
        self.assertIn("business_issuer_ipo_reviews", create_source)
        self.assertNotIn("_queue_next_funding_command", create_source)
        self.assertIn("_queue_next_funding_command", review_source)
        self.assertIn('action == "reject"', review_source)

    def test_scheduled_ipo_requires_24_hours_and_browser_sends_utc(self):
        create_source = BUSINESS_SOURCE.split("def create_ipo", 1)[1].split("def review_ipo", 1)[0]
        self.assertIn("timedelta(hours=IPO_REVIEW_SLA_HOURS)", create_source)
        self.assertIn("Scheduled IPO releases must be at least 24 hours", create_source)
        self.assertIn("body.scheduled_at=release.toISOString()", APP_JS_SOURCE)
        self.assertIn("Optional releases must be scheduled at least 24 hours ahead", APP_JS_SOURCE)

    def test_fec_review_desk_has_decision_route_and_controls(self):
        self.assertIn('/api/dev-tools/market/fec/ipo-reviews/', APP_SOURCE)
        self.assertIn("self.path_int(path, 5)", APP_SOURCE)
        self.assertIn("business_review_ipo", APP_SOURCE)
        self.assertIn("data-fec-ipo-decision", APP_JS_SOURCE)
        self.assertIn("Approve &amp; begin capitalization", APP_JS_SOURCE)
        self.assertIn("Reject filing", APP_JS_SOURCE)

    def test_dev_guardrail_route_and_resident_form_share_the_policy(self):
        self.assertIn('/api/dev-tools/business/ipo-guardrails', APP_SOURCE)
        self.assertIn("developer_required(user)", APP_SOURCE.split("def api_dev_business_ipo_guardrails", 1)[1].split("\n    def ", 1)[0])
        self.assertIn("devBusinessGuardrailsForm", APP_JS_SOURCE)
        self.assertIn("guardrails.min_capitalization", APP_JS_SOURCE)
        self.assertIn("guardrails.max_public_float_percent", APP_JS_SOURCE)
        self.assertIn("guardrails.sectors", APP_JS_SOURCE)

    def test_default_ipo_minimum_is_three_million_and_is_developer_adjustable(self):
        self.assertEqual(DEFAULT_MIN_IPO_CAPITALIZATION, 3_000_000.0)
        self.assertIn('business_ipo_min_capitalization', BUSINESS_SOURCE)
        self.assertIn('name="min_capitalization"', APP_JS_SOURCE)
        self.assertIn('min="${minCapitalization}"', APP_JS_SOURCE)

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

    def test_revenue_audit_and_investor_intelligence_are_present(self):
        self.assertIn("business_issuer_market_cap_history", BUSINESS_SOURCE)
        self.assertIn("_company_intelligence", BUSINESS_SOURCE)
        self.assertIn("Northstar Market Making", BUSINESS_SOURCE)
        self.assertIn("Brokerage Account", BUSINESS_SOURCE)
        self.assertIn('"market_makers": market_makers', BUSINESS_SOURCE)
        self.assertIn('"market_maker_inventory_shares"', BUSINESS_SOURCE)
        self.assertIn('"total_recorded_notional"', BUSINESS_SOURCE)
        self.assertIn('"valuation_adjustment"', BUSINESS_SOURCE)
        company_source = APP_JS_SOURCE.split("function renderIssuerCompany", 1)[1].split(
            "function renderIssuerWire", 1
        )[0]
        self.assertIn("REVENUE / VALUATION AUDIT", company_source)
        self.assertIn("RESIDENT INVESTOR REGISTER", company_source)
        self.assertIn("BROKER REGISTER", company_source)
        self.assertIn("RECENT COMPANY TRADES", company_source)
        self.assertIn('item.participant_type === "market_maker" ? "Brokerage Account"', company_source)
        self.assertIn("PUBLIC FLOAT", company_source)
        self.assertIn("RECORDED NOTIONAL", company_source)
        self.assertIn("VALUATION ADDED", company_source)

    def test_ai_market_makers_are_aggregated_as_fictional_company_only_brokers(self):
        intelligence_source = BUSINESS_SOURCE.split("def _company_intelligence", 1)[1].split(
            "def resident_payload", 1
        )[0]
        self.assertIn("GROUP BY source", intelligence_source)
        self.assertIn("Brokerage Account", intelligence_source)
        self.assertIn('"inventory_side"', intelligence_source)
        self.assertIn('"inventory_value"', intelligence_source)
        self.assertIn("WHERE security_id=?", intelligence_source)

    def test_revenue_is_recognized_only_from_completed_bridge_callback(self):
        callback = BUSINESS_SOURCE.split("def handle_bank_result", 1)[1].split(
            "def publish_announcement", 1
        )[0]
        self.assertIn('if batch["purpose"] == "initial_capitalization"', callback)
        self.assertIn("_revenue_market_repricing", callback)
        self.assertIn("issuer_revenue", callback)
        self.assertIn("funding_batch_id", callback)


if __name__ == "__main__":
    unittest.main()
