import pytest
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.mark.asyncio
async def test_get_driver_standings_historical():
    """Test fetching standings for a historical year (e.g. 2012)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/f1/standings", params={"year": 2012})
    assert response.status_code == 200, f"Error: {response.text}"
    data = response.json()
    assert data["year"] == 2012
    standings = data["standings"]
    assert len(standings) > 0
    assert standings[0]["Driver"]["familyName"] == "Vettel"

@pytest.mark.asyncio
async def test_get_cumulative_stats_simple():
    """Test aggregation over a range of years (e.g. 2021-2022)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "year_gte": 2021,
            "year_lte": 2022
        }
        response = await ac.post("/f1/stats/cumulative", json=payload)
    
    assert response.status_code == 200, f"Error: {response.text}"
    data = response.json()
    stats = data["stats"]
    assert len(stats) > 0
    
    top_driver = stats[0]
    assert top_driver["familyName"] == "Verstappen"
    assert top_driver["seasons"] == 2
    assert top_driver["points"] > 800

@pytest.mark.asyncio
async def test_get_cumulative_stats_round_filter():
    """Test 'after 5 rounds' query pattern."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "year_gte": 2023,
            "year_lte": 2023,
            "round_lte": 5  # First 5 rounds of 2023
        }
        response = await ac.post("/f1/stats/cumulative", json=payload)

    assert response.status_code == 200, f"Error: {response.text}"
    data = response.json()
    stats = data["stats"]
    
    assert stats[0]["familyName"] == "Verstappen"
    assert stats[0]["points"] < 200

@pytest.mark.asyncio
async def test_get_cumulative_stats_range_filter():
    """Test 'between round 12 and 16' query pattern."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "year_gte": 2023,
            "year_lte": 2023,
            "round_gte": 12,
            "round_lte": 13 
        }
        response = await ac.post("/f1/stats/cumulative", json=payload)

    assert response.status_code == 200, f"Error: {response.text}"
    data = response.json()
    stats = data["stats"]
    assert len(stats) > 0
