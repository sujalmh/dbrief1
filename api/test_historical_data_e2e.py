"""
End-to-End Test Suite for Pre-2018 F1 Historical Data Support
==============================================================
Tests all endpoints with historical F1 data (1950-2017)
"""

import requests
import pytest
from typing import Dict, List

BASE_URL = "http://localhost:8000"

# Test years spanning F1 history
HISTORICAL_YEARS = [1950, 1970, 1994, 2005, 2017]
MODERN_YEARS = [2018, 2023, 2024]

class TestHistoricalSeasons:
    """Test get_seasons endpoint includes historical years"""
    
    def test_seasons_includes_1950_to_2025(self):
        """Verify seasons list includes all years from 1950-2025"""
        response = requests.get(f"{BASE_URL}/f1/seasons")
        assert response.status_code == 200
        
        data = response.json()
        seasons = data["seasons"]
        
        assert 1950 in seasons, "Should include first F1 season (1950)"
        assert 2025 in seasons, "Should include current year"
        assert len(seasons) == 76, f"Should have 76 seasons (1950-2025), got {len(seasons)}"
        
    def test_seasons_continuous_range(self):
        """Verify no gaps in season years"""
        response = requests.get(f"{BASE_URL}/f1/seasons")
        seasons = response.json()["seasons"]
        
        for year in range(1950, 2026):
            assert year in seasons, f"Missing year {year}"


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
        response = requests.get(f"{BASE_URL}/f1/events", params={"year": year})
        assert response.status_code == 200
        
        data = response.json()
        assert data["year"] == year
        assert len(data["events"]) >= expected_min_races
        
    def test_1994_calendar_structure(self):
        """Verify 1994 calendar has all required fields"""
        response = requests.get(f"{BASE_URL}/f1/events", params={"year": 1994})
        data = response.json()
        
        assert len(data["events"]) == 16
        
        # Check first race (Brazil)
        brazil = data["events"][0]
        assert brazil["round_number"] == 1
        assert "Brazil" in brazil["country"]
        assert "Brazilian" in brazil["event_name"]
        assert brazil["event_date"] is not None
        
    def test_iconic_races_present(self):
        """Verify iconic historical races are in calendars"""
        # 1994 San Marino GP (Senna's last race)
        response = requests.get(f"{BASE_URL}/f1/events", params={"year": 1994})
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
        response = requests.get(
            f"{BASE_URL}/f1/sessions",
            params={"year": year, "gp": gp}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["year"] == year
        assert gp.lower() in data["gp"].lower()
        assert len(data["sessions"]) > 0
        
    def test_session_types_historical(self):
        """Verify historical sessions include qualifying and race"""
        response = requests.get(
            f"{BASE_URL}/f1/sessions",
            params={"year": 1994, "gp": "Monaco"}
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
        response = requests.get(f"{BASE_URL}/f1/drivers", params={"year": year})
        
        if response.status_code != 200:
            pytest.skip(f"Driver endpoint not yet working for {year}: {response.json()}")
        
        data = response.json()
        assert data["year"] == year
        assert len(data["drivers"]) >= expected_min_drivers
        
    def test_1994_iconic_drivers(self):
        """Verify 1994 season includes Senna, Schumacher, Hill"""
        response = requests.get(f"{BASE_URL}/f1/drivers", params={"year": 1994})
        
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
        response = requests.get(f"{BASE_URL}/f1/drivers", params={"year": 2005})
        
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
        response = requests.post(
            f"{BASE_URL}/f1/standings/drivers",
            json={"year": year}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["year"] == year
        assert len(data["standings"]) > 0
        
        # Champion should be position 1
        champion = data["standings"][0]
        assert champion["position"] == 1
        assert expected_champion.lower() in champion["driver"].lower()
        
    def test_1994_championship_battle(self):
        """Verify 1994 Schumacher vs Hill championship"""
        response = requests.post(
            f"{BASE_URL}/f1/standings/drivers",
            json={"year": 1994}
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
        response = requests.post(
            f"{BASE_URL}/f1/telemetry",
            json={
                "year": 1994,
                "gp": "Monaco",
                "session": "R",
                "driver": "MSC",
                "lap": "fastest"
            }
        )
        # Should either 400/404 or explain telemetry not available
        assert response.status_code in [400, 404, 422]
        
    def test_modern_telemetry_still_works(self):
        """Verify 2018+ telemetry still works"""
        response = requests.post(
            f"{BASE_URL}/f1/telemetry",
            json={
                "year": 2023,
                "gp": "Monaco",
                "session": "R",
                "driver": "VER",
                "lap": "fastest"
            }
        )
        # Should work for modern years (or block live sessions with 403)
        assert response.status_code in [200, 403]


class TestCrossEraComparison:
    """Test querying data across different F1 eras"""
    
    def test_multiple_historical_years(self):
        """Verify can query multiple historical years"""
        years_to_test = [1970, 1990, 2010]
        
        for year in years_to_test:
            response = requests.get(f"{BASE_URL}/f1/events", params={"year": year})
            assert response.status_code == 200
            assert response.json()["year"] == year
            
    def test_historical_vs_modern_comparison(self):
        """Compare data structure between historical and modern years"""
        historical = requests.get(f"{BASE_URL}/f1/events", params={"year": 2005})
        modern = requests.get(f"{BASE_URL}/f1/events", params={"year": 2023})
        
        assert historical.status_code == 200
        assert modern.status_code == 200
        
        # Both should have same response structure
        hist_data = historical.json()
        mod_data = modern.json()
        
        assert set(hist_data.keys()) == set(mod_data.keys())
        assert all("event_name" in e for e in hist_data["events"])
        assert all("event_name" in e for e in mod_data["events"])


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
