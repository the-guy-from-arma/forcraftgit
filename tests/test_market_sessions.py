import unittest

from market_math import ravenhood_security_session_open


class RavenhoodSecuritySessionTests(unittest.TestCase):
    def test_core_session_allows_every_security(self):
        self.assertTrue(ravenhood_security_session_open(True, "FCXS", False))
        self.assertTrue(ravenhood_security_session_open(True, "FNN", False))

    def test_fcxv_is_continuous_only_when_enabled(self):
        self.assertTrue(ravenhood_security_session_open(False, "fcxv", True))
        self.assertFalse(ravenhood_security_session_open(False, "FCXV", False))

    def test_other_securities_remain_closed_after_hours(self):
        self.assertFalse(ravenhood_security_session_open(False, "FCXS", True))
        self.assertFalse(ravenhood_security_session_open(False, "FNN", True))


if __name__ == "__main__":
    unittest.main()
