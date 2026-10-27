"""
Checks for the quote-ready race-result fields.

Run as:
    python tests/format_results_check.py

Exits 0 on success, 1 on failure.
"""
import sys

sys.path.insert(0, ".")

import pandas as pd

from utils import format_session_results  # noqa: E402


def check(actual, expected, label):
    if actual != expected:
        print(f"FAIL {label}: expected {expected!r}, got {actual!r}")
        return False
    print(f"PASS {label}")
    return True


def main() -> int:
    df = pd.DataFrame(
        [
            {
                "Position": 1,
                "GridPosition": 1,
                "Abbreviation": "ANT",
                "Time": pd.Timedelta(seconds=5716.650),
                "Status": "Finished",
                "Points": 25,
            },
            {
                "Position": 2,
                "GridPosition": 4,
                "Abbreviation": "LEC",
                "Time": pd.Timedelta(seconds=13.078),
                "Status": "Finished",
                "Points": 18,
            },
            {
                "Position": 12,
                "GridPosition": 14,
                "Abbreviation": "LIN",
                "Time": pd.Timedelta(seconds=6.344),
                "Status": "Lapped",
                "Points": 0,
            },
        ]
    )
    rows = format_session_results(df)
    ok = True
    ok &= check(rows[0]["GapToLeader"], "0.000", "winner gap")
    ok &= check(rows[0]["PositionsGained"], 0, "winner positions gained")
    ok &= check(rows[1]["GapToLeader"], "+13.078", "P2 gap")
    ok &= check(rows[1]["PositionsGained"], 2, "P2 positions gained")
    ok &= check(rows[2]["GapToLeader"], None, "lapped gap is not a race gap")
    ok &= check(rows[2]["PositionsGained"], 2, "lapped positions gained")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
