"""
Unit tests for utils.format_timedelta.

Run as:
    python tests/format_timedelta_check.py

Exits 0 on success, 1 on failure.
"""
import sys
from datetime import timedelta

sys.path.insert(0, ".")

import pandas as pd

from utils import format_timedelta  # noqa: E402


def check(actual, expected, label):
    if actual != expected:
        print(f"FAIL {label}: expected {expected!r}, got {actual!r}")
        return False
    print(f"PASS {label}")
    return True


def main() -> int:
    ok = True
    ok &= check(format_timedelta(pd.Timedelta(seconds=83.456)), "1:23.456", "lap time MM:SS.mmm")
    ok &= check(format_timedelta(pd.Timedelta(seconds=35.2)), "35.200", "sub-minute time")
    ok &= check(
        format_timedelta(pd.Timedelta(hours=1, minutes=35, seconds=16.65)),
        "1:35:16.650",
        "race total HH:MM:SS.mmm",
    )
    ok &= check(
        format_timedelta(pd.Timedelta(hours=2, minutes=0, seconds=3.5)),
        "2:00:03.500",
        "multi-hour total",
    )
    ok &= check(format_timedelta(None), None, "None")
    ok &= check(format_timedelta(pd.NaT), None, "NaT")
    ok &= check(format_timedelta(timedelta(seconds=-1)), None, "negative duration")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

