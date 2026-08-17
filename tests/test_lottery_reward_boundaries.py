import ast
from pathlib import Path
import unittest


APP_SOURCE = Path(__file__).resolve().parents[1].joinpath("app.py").read_text(encoding="utf-8")


def method_source(name: str) -> str:
    tree = ast.parse(APP_SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(APP_SOURCE, node) or ""
    raise AssertionError(f"Method {name} was not found")


class LotteryRewardBoundaryTests(unittest.TestCase):
    def test_reward_points_cannot_purchase_stock(self):
        source = method_source("api_leaderboard_perk")
        self.assertNotIn("stock_share", source)
        self.assertNotIn("market_holdings", source)

    def test_new_scratch_cards_are_cash_only(self):
        source = method_source("api_lottery_scratch")
        self.assertIn('reward_type = "cash"', source)
        self.assertNotIn("market_promo_codes", source)
        self.assertNotIn('reward_type = "stock"', source)


if __name__ == "__main__":
    unittest.main()
