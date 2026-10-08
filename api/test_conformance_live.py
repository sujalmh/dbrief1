"""Live backend conformance (needs a running API + F1_API_KEY).
==========================================================
Guards the whole GP-resolution chain end to end, self-maintained:
event names come from the backend's own schedule, so new seasons
(and relocated rounds like 2026 Bahrain-in-Malaysia) are covered
without hand-listed aliases.

Skipped unless API_BASE_URL is reachable and F1_API_KEY is set —
never a silent failure. Reads are schedule/cache backed and cheap.
"""

import os
import socket
from urllib.parse import urlparse

import pytest
import requests

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080").rstrip("/")
API_KEY = os.getenv("F1_API_KEY", "")


def _reachable() -> bool:
    try:
        host = urlparse(BASE_URL).hostname or "localhost"
        port = urlparse(BASE_URL).port or 80
        socket.create_connection((host, port), timeout=3).close()
        return True
    except OSError:
        return False


requires_backend = pytest.mark.skipif(
    not _reachable() or not API_KEY, reason="needs reachable API_BASE_URL + F1_API_KEY"
)


def _get(path: str, **params):
    r = requests.get(
        f"{BASE_URL}{path}", params=params, headers={"x-api-key": API_KEY}, timeout=60
    )
    assert r.status_code == 200, f"{path} {params} -> {r.status_code}: {r.text[:200]}"
    return r.json()


def _post(path: str, body: dict):
    r = requests.post(
        f"{BASE_URL}{path}", json=body, headers={"x-api-key": API_KEY}, timeout=120
    )
    assert r.status_code == 200, f"{path} {body} -> {r.status_code}: {r.text[:200]}"
    return r.json()


@requires_backend
def test_every_2026_event_resolves_by_name_and_location():
    """Every scheduled round resolves through /f1/sessions by its own
    EventName AND Location, and echoes the same event back."""
    sched = _get("/f1/events", year=2026)["events"]
    assert len(sched) > 15
    seen: set[str] = set()
    for ev in sched:
        for gp in (ev["event_name"], ev["location"]):
            if not gp or gp in seen:
                continue
            seen.add(gp)
            # Testing rows share their host's name; only the event name
            # itself is canonical there.
            if ev["round_number"] == 0 and gp != ev["event_name"]:
                continue
            got = _get("/f1/sessions", year=2026, gp=gp)
            assert got["gp"] == ev["event_name"], f"{gp} resolved to {got['gp']}"


@requires_backend
def test_collision_aliases_resolve_to_race_weekends():
    """Bare aliases that substring-matching gets wrong: testing rows
    share host names/locations, and short names sit inside longer ones.
    Proven live failures, pinned here."""
    for gp, expected in {
        "Bahrain": "Bahrain Grand Prix",
        "Spa": "Belgian Grand Prix",
        "Monza": "Italian Grand Prix",
        "Baku": "Azerbaijan Grand Prix",
        "Austin": "United States Grand Prix",
    }.items():
        got = _get("/f1/sessions", year=2026, gp=gp)
        assert got["gp"] == expected, f"{gp} resolved to {got['gp']}"


@requires_backend
def test_relocated_bahrain_round_loads_october_race():
    """2026 Bahrain GP (run in Malaysia, Oct 4) must load — not 404, not a
    future event. Regression: testing rows shadowed it into a 403."""
    got = _post("/f1/race", {"year": 2026, "gp": "Bahrain", "session": "R"})
    assert got["session_name"] == "Race"
    assert got["results"][0]["Abbreviation"] == "VER"


@requires_backend
def test_pinned_historical_winners():
    """Stable ground truth that must never drift with model changes."""
    abu24 = _post("/f1/race", {"year": 2024, "gp": "Abu Dhabi", "session": "R"})
    assert abu24["results"][0]["Abbreviation"] == "NOR"
    baku26 = _post("/f1/race", {"year": 2026, "gp": "Azerbaijan", "session": "R"})
    assert baku26["results"][0]["Abbreviation"] == "RUS"
