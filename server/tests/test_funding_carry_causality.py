import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "genesis" / "runFundingCarryLab.py"
spec = importlib.util.spec_from_file_location("funding_carry_lab", MODULE_PATH)
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class FundingCarryCausalityTests(unittest.TestCase):
    def test_kline_close_is_available_only_at_close_time(self):
        open_ms = 1_700_000_000_000
        close_ms = open_ms + 3_599_999
        row = [str(open_ms), "100", "110", "90", "105", "1", str(close_ms)]
        parsed = lab.parse_kline_rows([row])
        self.assertEqual(parsed, [(close_ms, 105.0)])
        self.assertIsNone(lab.latest_price_at(parsed, open_ms))
        self.assertEqual(lab.latest_price_at(parsed, close_ms), 105.0)

    def test_missing_close_timestamp_fails_closed(self):
        row = ["1700000000000", "100", "110", "90", "105"]
        self.assertEqual(lab.parse_kline_rows([row]), [])

    def test_invalid_noncausal_close_timestamp_fails_closed(self):
        open_ms = 1_700_000_000_000
        row = [str(open_ms), "100", "110", "90", "105", "1", str(open_ms)]
        self.assertEqual(lab.parse_kline_rows([row]), [])


if __name__ == "__main__":
    unittest.main()
