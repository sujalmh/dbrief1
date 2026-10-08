"""Unit tests for GP-name resolution (no server needed).
====================================================
resolve_gp_name() maps user/LLM-supplied identifiers to canonical
schedule EventNames. Regression coverage for two live bugs:

- "Bahrain" resolved to Pre-Season Testing (Location substring hit on
  round-0 rows), which FastF1 then "corrected" to a future event and
  tripped the live-session cost gate for a completed race.
- "Spa" resolved to the Spanish Grand Prix (substring of "Spanish").
"""

import pandas as pd
import pytest
from fastapi import HTTPException

import main


@pytest.fixture()
def schedule_2026():
    return pd.DataFrame(
        [
            {"RoundNumber": 0, "EventName": "Pre-Season Testing", "Location": "Bahrain", "Country": "Bahrain"},
            {"RoundNumber": 9, "EventName": "British Grand Prix", "Location": "Silverstone", "Country": "United Kingdom"},
            {"RoundNumber": 10, "EventName": "Belgian Grand Prix", "Location": "Spa-Francorchamps", "Country": "Belgium"},
            {"RoundNumber": 14, "EventName": "Spanish Grand Prix", "Location": "Madrid", "Country": "Spain"},
            {"RoundNumber": 16, "EventName": "Bahrain Grand Prix", "Location": "Kuala Lumpur", "Country": "Bahrain"},
            {"RoundNumber": 5, "EventName": "Canadian Grand Prix", "Location": "Montréal", "Country": "Canada"},
        ]
    )


@pytest.fixture()
def patched_schedule(monkeypatch, schedule_2026):
    monkeypatch.setattr(main, "get_event_schedule", lambda year: schedule_2026)


@pytest.mark.parametrize(
    "given,expected",
    [
        ("Bahrain", "Bahrain Grand Prix"),
        ("bahrain grand prix", "Bahrain Grand Prix"),
        ("16", "Bahrain Grand Prix"),
        ("Silverstone", "British Grand Prix"),
        ("Spa", "Belgian Grand Prix"),
        ("Madrid", "Spanish Grand Prix"),
        ("Montreal", "Canadian Grand Prix"),
    ],
)
def test_canonical_resolution(patched_schedule, given, expected):
    assert main.resolve_gp_name(2026, given) == expected


def test_unknown_gp_raises_404(patched_schedule):
    with pytest.raises(HTTPException) as exc:
        main.resolve_gp_name(2026, "Nowhere XYZ")
    assert exc.value.status_code == 404


def test_empty_gp_raises_404(patched_schedule):
    with pytest.raises(HTTPException) as exc:
        main.resolve_gp_name(2026, "   ")
    assert exc.value.status_code == 404
