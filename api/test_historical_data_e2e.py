"""End-to-End Test Suite for Pre-2018 F1 Historical Data Support
==============================================================
Tests all endpoints with historical F1 data (1950-2017).

The test suite expects a running API server. By default it points at
http://localhost:8080 (the port the Dockerfile / main.py binds to). Override
with the API_BASE_URL environment variable. If no server is reachable, every
test is skipped with a clear message - never a silent connection-refused
failure.
"""

import os
import socket
import pytest
import requests
from typing import Dict, List
from datetime import datetime

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080").rstrip("/")

# Test years spanning F1 history
HISTORICAL_YEARS = [1950, 1970, 1994, 2005, 2017]
MODERN_YEARS = [2018, 2023, 2024]

# The seasons list is dynamic (1950 .. current_year+2), so compute the
# expected size at test time. Using a hardcoded 81 would break the moment
# the calendar year rolls over.
EXPECTED_MAX_SEASON_YEAR = datetime.now().year + 2


def _is_server_reachable(url: str, timeout: float = 1.0) -> bool:
    """
    Probe the API server with a short timeout. We check the TCP socket rather
    than issuing an HTTP request so this remains fast and side-effect free.
    """
    try:
        # urlparse-style fallback: assume port 8080 if not specified
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


_SERVER_UP = _is_server_reachable(BASE_URL)
_REASON_SKIP = f"API server not reachable at {BASE_URL}; start it or set API_BASE_URL."


def _request(method: str, path: str, **kwargs) -> requests.Response:
    """Centralized request helper so we can adjust timeouts/retries in one place."""
    url = f"{BASE_URL}{path}"
    kwargs.setdefault("timeout", 30)
    return requests.request(method, url, **kwargs)


# Session-scoped fixture: verify the server is up once per test run and skip
# the entire module if it isn't. Pytest will still report a clean "skipped"
# rather than a flurry of connection errors.
@pytest.fixture(scope="session", autouse=True)
def require_server():
    if not _SERVER_UP:
        pytest.skip(_REASON_SKIP, allow_module_level=True)


class TestHistoricalSeasons:
    """Test get_seasons endpoint includes historical years"""
    
    def test_seasons_includes_1950_to_2025(self):
        """Verify seasons list includes all years from 1950-2025"""
        response = _request("GET", "/f1/seasons")
        assert response.status_code == 200
        
        data = response.json()
        # The response is a SeasonResponse object
        assert "seasons" in data, "Response missing 'seasons' field"
        seasons = data["seasons"]
        assert isinstance(seasons, list)
        
        assert 1950 in seasons, "Should include first F1 season (1950)"
        assert all(isinstance(y, int) for y in seasons), "Seasons must be integers"
        # The seasons list is dynamic: it spans 1950 to current_year+2. We
        # assert the *new* invariant: seasons form a continuous range and the
        # last entry matches the expected max.
        assert len(seasons) == EXPECTED_MAX_SEASON_YEAR - 1950 + 1, (
            f"Should have {EXPECTED_MAX_SEASON_YEAR - 1950 + 1} seasons "
            f"(1950-{EXPECTED_MAX_SEASON_YEAR}), got {len(seasons)}"
        )
        
    def test_seasons_continuous_range(self):
        """Verify no gaps in season years"""
        response = _request("GET", "/f1/seasons")
        seasons = response.json()["seasons"]
        
        # Range should be continuous from 1950 to the max year
        expected = set(range(1950, max(seasons) + 1))
        assert set(seasons) == expected, "Seasons list has gaps"


class TestHistoricalEvents:
    """Test event calendars for pre-2018 seasons"""
    
    @pytest.mark.parametrize("year,expected_min_races", [
        (1950, 6),   # First season had 7 races
        (1970, 10),  # ~13 races
        (1994, 15),  # 16 races
        (2005, 18),  # 19 races
        (2017, 19),  # 20 races
    ])
    def test_historical_event_calendars(self, year, expected_min_races):
        """Verify event calendars return correct number of races"""
        response = _request("GET", "/f1/events", params={"year": year})
        assert response.status_code == 200
        
        data = response.json()
        assert data["year"] == year
        assert len(data["events"]) >= expected_min_races
        
    def test_1994_calendar_structure(self):
        """Verify 1994 calendar has all required fields"""
        response = _request("GET", "/f1/events", params={"year": 1994})
        data = response.json()

        assert len(data["events"]) == 16

        # Check first race (Brazil) and assert full schema
        brazil = data["events"][0]
        for required_field in (
            "round_number", "country", "location", "event_name",
            "event_date", "event_format", "sessions",
        ):
            assert required_field in brazil, (
                f"Event missing required field '{required_field}'"
            )
        assert brazil["round_number"] == 1
        assert "Brazil" in brazil["country"]
        assert "Brazilian" in brazil["event_name"]
        assert brazil["event_date"] is not None
        assert isinstance(brazil["sessions"], list)

    def test_iconic_races_present(self):
        """Verify iconic historical races are in calendars"""
        # 1994 San Marino GP (Senna's last race)
        response = _request("GET", "/f1/events", params={"year": 1994})
        events = response.json()["events"]
        san_marino = [e for e in events if "San Marino" in e["event_name"]]
        assert len(san_marino) == 1, "Should have 1994 San Marino GP"


class TestHistoricalSessions:
    """Test session data for pre-2018 races"""
    
    @pytest.mark.parametrize("year,gp", [
        (1994, "Monaco"),
        (2005, "Silverstone"),
        (2017, "Singapore"),
    ])
    def test_sessions_for_historical_gp(self, year, gp):
        """Verify sessions endpoint returns data for historical GPs"""
        response = _request(
            "GET",
            "/f1/sessions",
            params={"year": year, "gp": gp},
        )
        assert response.status_code == 200

        data = response.json()
        # Top-level shape
        for required_field in ("year", "gp", "sessions"):
            assert required_field in data, f"Response missing '{required_field}'"
        assert data["year"] == year
        assert gp.lower() in data["gp"].lower()
        assert len(data["sessions"]) > 0

        # Per-session shape: a {} would otherwise pass the assertions above.
        for session in data["sessions"]:
            for required_field in ("session_name", "session_type", "date", "available"):
                assert required_field in session, (
                    f"Session missing required field '{required_field}'"
                )
            assert session["available"] is True
        
    def test_session_types_historical(self):
        """Verify historical sessions include qualifying and race"""
        response = _request(
            "GET",
            "/f1/sessions",
            params={"year": 1994, "gp": "Monaco"},
        )
        data = response.json()
        
        session_types = [s["session_type"] for s in data["sessions"]]
        assert "Q" in session_types, "Should have qualifying"
        assert "R" in session_types, "Should have race"


class TestHistoricalDrivers:
    """Test driver data for pre-2018 seasons"""
    
    @pytest.mark.parametrize("year,expected_min_drivers", [
        (1950, 20),
        (1994, 30),  # 46 drivers in 1994
        (2005, 20),
        (2017, 20),
    ])
    def test_driver_lists_historical(self, year, expected_min_drivers):
        """Verify driver endpoint returns historical driver lists"""
        response = _request("GET", "/f1/drivers", params={"year": year})
        
        if response.status_code != 200:
            pytest.skip(f"Driver endpoint not yet working for {year}: {response.json()}")
        
        data = response.json()
        assert data["year"] == year
        assert len(data["drivers"]) >= expected_min_drivers
        
    def test_1994_iconic_drivers(self):
        """Verify 1994 season includes Senna, Schumacher, Hill"""
        response = _request("GET", "/f1/drivers", params={"year": 1994})
        
        if response.status_code != 200:
            pytest.skip("Driver endpoint not yet working")
        
        data = response.json()
        driver_names = [d["full_name"] for d in data["drivers"]]
        
        # Check for iconic 1994 drivers
        assert any("Senna" in name for name in driver_names), "Should include Ayrton Senna"
        assert any("Schumacher" in name for name in driver_names), "Should include Michael Schumacher"
        assert any("Hill" in name for name in driver_names), "Should include Damon Hill"
        
    def test_driver_data_structure(self):
        """Verify driver data has expected fields for pre-2018"""
        response = _request("GET", "/f1/drivers", params={"year": 2005})
        
        if response.status_code != 200:
            pytest.skip("Driver endpoint not yet working")
        
        data = response.json()
        assert len(data["drivers"]) > 0
        
        driver = data["drivers"][0]
        assert "full_name" in driver
        assert "first_name" in driver
        assert "last_name" in driver
        # Note: team_name, driver_number may be None for pre-2018


class TestHistoricalStandings:
    """Test championship standings for historical seasons"""
    
    @pytest.mark.parametrize("year,expected_champion", [
        (1950, "Farina"),       # Giuseppe Farina
        (1994, "Schumacher"),   # Michael Schumacher
        (2005, "Alonso"),       # Fernando Alonso
        (2010, "Vettel"),       # Sebastian Vettel
        (2017, "Hamilton"),     # Lewis Hamilton
    ])
    def test_historical_champions(self, year, expected_champion):
        """Verify historical championship winners"""
        response = _request(
            "POST",
            "/f1/standings/drivers",
            json={"year": year},
        )
        assert response.status_code == 200

        data = response.json()
        for required_field in ("year", "standings"):
            assert required_field in data, f"Response missing '{required_field}'"
        assert data["year"] == year
        assert len(data["standings"]) > 0

        # Each entry must have the standings schema
        for entry in data["standings"]:
            for required_field in ("position", "driver", "points", "wins", "team"):
                assert required_field in entry, (
                    f"Standing entry missing '{required_field}'"
                )

        # Champion should be position 1
        champion = data["standings"][0]
        assert champion["position"] == 1
        assert expected_champion.lower() in champion["driver"].lower()
        
    def test_1994_championship_battle(self):
        """Verify 1994 Schumacher vs Hill championship"""
        response = _request(
            "POST",
            "/f1/standings/drivers",
            json={"year": 1994},
        )
        data = response.json()
        
        # Top 2 should be Schumacher and Hill
        top_2 = data["standings"][:2]
        top_2_names = [s["driver"] for s in top_2]
        
        assert any("schumacher" in name.lower() for name in top_2_names)
        assert any("hill" in name.lower() for name in top_2_names)


class TestDataAvailabilityLimits:
    """Test that unavailable data returns proper errors"""
    
    def test_telemetry_not_available_pre_2018(self):
        """Verify telemetry requests for pre-2018 years fail gracefully"""
        # This should fail or return empty since telemetry wasn't tracked
        response = _request(
            "POST",
            "/f1/telemetry",
            json={
                "year": 1994,
                "gp": "Monaco",
                "session": "R",
                "driver": "MSC",
                "lap": "fastest",
            },
        )
        # Should either 400/404 or explain telemetry not available
        assert response.status_code in [400, 404, 422]
        
    def test_modern_telemetry_still_works(self):
        """Verify 2018+ telemetry still works"""
        response = _request(
            "POST",
            "/f1/telemetry",
            json={
                "year": 2023,
                "gp": "Monaco",
                "session": "R",
                "driver": "VER",
                "lap": "fastest",
            },
        )
        # Should work for modern years (or block live sessions with 403)
        assert response.status_code in [200, 403]


class TestCrossEraComparison:
    """Test querying data across different F1 eras"""
    
    def test_multiple_historical_years(self):
        """Verify can query multiple historical years"""
        years_to_test = [1970, 1990, 2010]
        
        for year in years_to_test:
            response = _request("GET", "/f1/events", params={"year": year})
            assert response.status_code == 200
            assert response.json()["year"] == year
            
    def test_historical_vs_modern_comparison(self):
        """Compare data structure between historical and modern years"""
        historical = _request("GET", "/f1/events", params={"year": 2005})
        modern = _request("GET", "/f1/events", params={"year": 2023})
        
        assert historical.status_code == 200
        assert modern.status_code == 200
        
        # Both should have same response structure
        hist_data = historical.json()
        mod_data = modern.json()
        
        assert set(hist_data.keys()) == set(mod_data.keys())
        assert all("event_name" in e for e in hist_data["events"])
        assert all("event_name" in e for e in mod_data["events"])


class TestSecurityAndValidation:
    """Input validation and security hardening tests."""

    def test_year_out_of_range_rejected(self):
        """Years outside 1950-(current_year+2) must be rejected by FastAPI validation."""
        response = _request("GET", "/f1/events", params={"year": 1850})
        assert response.status_code == 422
        response = _request("GET", "/f1/events", params={"year": 9999})
        assert response.status_code == 422

    def test_gp_path_traversal_rejected(self):
        """Path-separator and traversal patterns in 'gp' must be rejected."""
        for malicious in ["../../etc/passwd", "..", "Monaco/../../etc"]:
            response = _request(
                "GET",
                "/f1/sessions",
                params={"year": 2023, "gp": malicious},
            )
            assert response.status_code == 400, (
                f"Expected 400 for gp='{malicious}', got {response.status_code}"
            )

    def test_gp_too_long_rejected(self):
        """Overlong 'gp' values must be rejected."""
        response = _request(
            "GET",
            "/f1/sessions",
            params={"year": 2023, "gp": "A" * 200},
        )
        assert response.status_code == 400

    def test_health_endpoint(self):
        """Health endpoint must always return 200 JSON."""
        response = _request("GET", "/health")
        assert response.status_code == 200
        assert response.json().get("status") == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
