import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
FRONTEND_SOURCE = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class MarketAutopilotTests(unittest.TestCase):
    def test_continuous_engine_and_gemini_use_separate_workers(self) -> None:
        self.assertIn('name="ravenhood-market-automation"', APP_SOURCE)
        self.assertIn('name="ravenhood-gemini-autopilot"', APP_SOURCE)
        core_worker = APP_SOURCE.split("def market_automation_worker", 1)[1].split(
            "def market_gemini_worker", 1
        )[0]
        self.assertNotIn("market_gemini_adjustment_cycle", core_worker)

    def test_autopilot_profiles_and_custom_range_are_persisted(self) -> None:
        for profile in ("light", "aggressive", "extreme"):
            self.assertIn(f'"{profile}"', APP_SOURCE)
        self.assertIn('"market_volatility_min_percent"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_autopilot_profile"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_volatility_min_percent"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_volatility_percent"', APP_SOURCE)
        self.assertIn('name="autopilot_profile"', FRONTEND_SOURCE)
        self.assertIn('name="volatility_min_percent"', FRONTEND_SOURCE)

    def test_local_gemini_and_deepseek_engines_have_ordered_fallback(self) -> None:
        self.assertIn('DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY"', APP_SOURCE)
        self.assertIn('DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL"', APP_SOURCE)
        self.assertIn('DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL"', APP_SOURCE)
        self.assertIn('primary in ("gemini", "deepseek")', APP_SOURCE)
        self.assertIn('provider_order.append(alternate)', APP_SOURCE)
        self.assertIn('settings["market_ai_local_fallback_enabled"]', APP_SOURCE)
        self.assertIn('f"ai-fallback:{profile}"', APP_SOURCE)
        self.assertIn('name="automation_provider" value="local"', FRONTEND_SOURCE)
        self.assertIn('name="automation_provider" value="gemini"', FRONTEND_SOURCE)
        self.assertIn('name="automation_provider" value="deepseek"', FRONTEND_SOURCE)

    def test_external_provider_attempts_use_interval_and_cooldown_guards(self) -> None:
        self.assertIn('"market_ai_interval_minutes"', APP_SOURCE)
        self.assertIn('"market_ai_cooldown_minutes"', APP_SOURCE)
        self.assertIn('f"market_{provider}_cooldown_until"', APP_SOURCE)
        self.assertIn('set_system_setting(db, "market_ai_last_tick", attempt_at.isoformat())', APP_SOURCE)
        self.assertIn('name="ai_interval_minutes"', FRONTEND_SOURCE)
        self.assertIn('name="ai_cooldown_minutes"', FRONTEND_SOURCE)

    def test_provider_controls_are_mode_aware_and_cycles_are_audited(self) -> None:
        self.assertIn('def begin_market_automation_cycle', APP_SOURCE)
        self.assertIn('"market_automation_cycle_number"', APP_SOURCE)
        self.assertIn("'automation_provider_failed'", APP_SOURCE)
        self.assertIn('data-automation-mode="local"', FRONTEND_SOURCE)
        self.assertIn('data-automation-mode="ai"', FRONTEND_SOURCE)
        self.assertIn('CYCLE COUNTER', FRONTEND_SOURCE)
        self.assertIn('MARKET CONTROL LOG', FRONTEND_SOURCE)

    def test_manual_local_cycle_is_non_blocking_and_visible_before_work_starts(self) -> None:
        endpoint_source = APP_SOURCE.split("def api_dev_market_volatility_cycle", 1)[1].split(
            "def api_dev_market_program", 1
        )[0]
        worker_source = APP_SOURCE.split("def run_manual_market_volatility_cycle", 1)[1].split(
            "def market_gemini_adjustment_cycle", 1
        )[0]
        self.assertIn("MARKET_MANUAL_CYCLE_LOCK.acquire(blocking=False)", endpoint_source)
        self.assertIn("db.raw.commit()", endpoint_source)
        self.assertIn("target=run_manual_market_volatility_cycle", endpoint_source)
        self.assertIn("self.send_json(202", endpoint_source)
        self.assertIn('finish_market_automation_cycle(cycle_db, cycle_number, "local-manual"', worker_source)
        self.assertIn('"market.volatility_cycle.failed"', worker_source)

    def test_cycle_counter_uses_the_real_system_settings_columns(self) -> None:
        cycle_source = APP_SOURCE.split("def begin_market_automation_cycle", 1)[1].split(
            "def finish_market_automation_cycle", 1
        )[0]
        self.assertIn("SELECT setting_value FROM system_settings WHERE setting_key=?", cycle_source)
        self.assertNotIn("SELECT value FROM system_settings WHERE key=", cycle_source)

    def test_manual_cycle_follows_the_selected_provider(self) -> None:
        endpoint_source = APP_SOURCE.split("def api_dev_market_volatility_cycle", 1)[1].split(
            "def api_dev_market_program", 1
        )[0]
        self.assertIn('payload.get("provider")', endpoint_source)
        self.assertIn("target=run_manual_market_ai_cycle", endpoint_source)
        self.assertIn('body:{provider}', FRONTEND_SOURCE)
        self.assertIn('data-cycle-provider=', FRONTEND_SOURCE)
        self.assertIn('button.textContent = `Starting ${providerLabel} cycle', FRONTEND_SOURCE)

    def test_interval_sequences_are_serialized_and_audited(self) -> None:
        endpoint_source = APP_SOURCE.split("def api_dev_market_volatility_cycle", 1)[1].split(
            "def api_dev_market_program", 1
        )[0]
        sequence_source = APP_SOURCE.split("def run_market_automation_sequence", 1)[1].split(
            "def market_gemini_adjustment_cycle", 1
        )[0]
        self.assertIn("MARKET_AUTOMATION_SEQUENCE_LOCK.acquire(blocking=False)", endpoint_source)
        self.assertIn('payload.get("cycle_count")', endpoint_source)
        self.assertIn('payload.get("timeframe_minutes")', endpoint_source)
        self.assertIn("interval_seconds < 3.0", endpoint_source)
        self.assertIn("MARKET_MANUAL_CYCLE_LOCK.acquire()", sequence_source)
        self.assertIn("automation_sequence_finished", sequence_source)
        self.assertGreaterEqual(APP_SOURCE.count("not MARKET_AUTOMATION_SEQUENCE_LOCK.locked()"), 2)
        self.assertIn('name="sequence_cycle_count"', FRONTEND_SOURCE)
        self.assertIn('name="sequence_timeframe_minutes"', FRONTEND_SOURCE)
        self.assertIn("data-market-interval-sequence", FRONTEND_SOURCE)

    def test_cleared_generic_error_does_not_resurrect_legacy_gemini_error(self) -> None:
        self.assertIn(
            'raw.get("market_ai_last_error") if "market_ai_last_error" in raw else raw.get("market_gemini_last_error")',
            APP_SOURCE,
        )

    def test_future_programs_wait_and_capture_the_activation_quote(self) -> None:
        function_source = APP_SOURCE.split("def apply_market_price_programs", 1)[1].split(
            "def execute_ravenhood_order", 1
        )[0]
        self.assertIn("status IN ('active','scheduled')", function_source)
        self.assertIn("if current < starts", function_source)
        self.assertIn("live_security", function_source)
        self.assertIn("status='active',start_price", function_source)
        self.assertIn('name="starts_at" type="datetime-local"', FRONTEND_SOURCE)
        self.assertIn('America/New_York', APP_SOURCE)

    def test_newest_overlapping_program_owns_quote_and_completion_is_durable(self) -> None:
        function_source = APP_SOURCE.split("def apply_market_price_programs", 1)[1].split(
            "def execute_ravenhood_order", 1
        )[0]
        self.assertIn("latest_due_by_security", function_source)
        self.assertIn("status='superseded'", function_source)
        self.assertIn('"scheduled_program_completed"', function_source)
        self.assertIn("rebase_market_index_quote", function_source)

    def test_scheduled_program_is_final_market_writer_for_worker_tick(self) -> None:
        worker_source = APP_SOURCE.split("def market_automation_worker", 1)[1].split(
            "def market_gemini_worker", 1
        )[0]
        self.assertLess(
            worker_source.index("market_volatility_cycle"),
            worker_source.index("apply_market_price_programs(db)"),
        )


if __name__ == "__main__":
    unittest.main()
