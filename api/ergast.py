"""
Ergast API Client
=================
Async client for the Ergast Developer API (http://ergast.com/mrd).
Used for historical data (pre-2023) and aggregated stats which OpenF1 does not support.
"""

import asyncio
from typing import Any, Dict, List, Optional
import httpx


BASE_URL = "http://api.jolpi.ca/ergast/f1"  # Using Jolpi mirror for better uptime/https support if needed, or stick to official
# Official: http://ergast.com/api/f1
# We will use the official one but with careful limit handling, or a reliable mirror if known.
# api.jolpi.ca is a common mirror but sometimes lags. Let's stick to ergast.com for generic usage
# or allow override. using ergast.com/api/f1 for now.
ERGAST_BASE_URL = "https://api.jolpi.ca/ergast/f1"

class ErgastClient:
    """Async client for Ergast API."""

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a GET request to Ergast API."""
        client = await self._get_client()
        url = f"{ERGAST_BASE_URL}/{endpoint}.json"
        
        # Ergast uses limit/offset for pagination. Default limit is 30, max 1000.
        # We usually want all results for stats, so we set a high limit.
        default_params = {"limit": 100} 
        if params:
            default_params.update(params)

        response = await client.get(url, params=default_params)
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # Seasons / Races
    # =========================================================================

    async def get_seasons(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get list of historical seasons."""
        data = await self._request("seasons", {"limit": limit, "offset": offset})
        return data.get("MRData", {}).get("SeasonTable", {}).get("Seasons", [])

    # =========================================================================
    # Standings
    # =========================================================================

    async def get_driver_standings(self, year: int, round: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get driver standings for a specific year.
        If round is specified, gets standings AFTER that round.
        """
        endpoint = f"{year}"
        if round:
            endpoint += f"/{round}"
        endpoint += "/driverStandings"

        data = await self._request(endpoint, {"limit": 100}) # Max drivers usually ~20-30
        
        # Parse nested response
        try:
            standings_lists = data["MRData"]["StandingsTable"]["StandingsLists"]
            if not standings_lists:
                return []
            return standings_lists[0]["DriverStandings"]
        except (KeyError, IndexError):
            return []

    # =========================================================================
    # Race Results (for granular stats)
    # =========================================================================

    async def get_race_results(self, year: int, round: int) -> List[Dict[str, Any]]:
        """Get full race results for a specific round."""
        endpoint = f"{year}/{round}/results"
        data = await self._request(endpoint, {"limit": 100})
        
        try:
            races = data["MRData"]["RaceTable"]["Races"]
            if not races:
                return []
            return races[0]["Results"]
        except (KeyError, IndexError):
            return []

# Singleton
_ergast_client: Optional[ErgastClient] = None

def get_ergast_client() -> ErgastClient:
    global _ergast_client
    if _ergast_client is None:
        _ergast_client = ErgastClient()
    return _ergast_client
