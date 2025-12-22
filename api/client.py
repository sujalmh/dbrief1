"""
OpenF1 API Client
=================
An async HTTP client for the OpenF1 API (https://api.openf1.org/v1).
Provides typed methods for all available endpoints.
"""

import asyncio
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx


BASE_URL = "https://api.openf1.org/v1"


class OpenF1Client:
    """Async client for the OpenF1 API."""

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

    async def _request(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Make a GET request to an OpenF1 endpoint."""
        client = await self._get_client()
        
        # Filter out None values from params
        if params:
            params = {k: v for k, v in params.items() if v is not None}
        
        url = f"{BASE_URL}/{endpoint}"
        
        # IMPORTANT: OpenF1 API requires LITERAL >= and <= in query strings (not URL-encoded)
        # Both httpx and requests URL-encode special chars in param keys (>= becomes %3E%3D)
        # which breaks OpenF1's filtering. We must manually construct the query string.
        if params:
            query_parts = []
            for key, value in params.items():
                # For values, we need basic URL encoding (spaces, colons, etc.)
                # but keep the key as-is to preserve >= and <=
                str_value = str(value)
                # Basic URL encoding for common special chars in values
                str_value = str_value.replace(' ', '%20').replace(':', '%3A').replace('+', '%2B')
                
                # If key already contains the operator (>=, <=, >, <), don't add another =
                if key.endswith('>') or key.endswith('<') or key.endswith('='):
                    query_parts.append(f"{key}{str_value}")
                else:
                    query_parts.append(f"{key}={str_value}")
            query_string = "&".join(query_parts)
            url = f"{url}?{query_string}"
            print(f"DEBUG_CLIENT_URL: {url}")
            response = await client.get(url)
        else:
            response = await client.get(url)
        
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # Sessions
    # =========================================================================

    async def get_sessions(
        self,
        session_key: Optional[int] = None,
        session_name: Optional[str] = None,
        year: Optional[int] = None,
        country_name: Optional[str] = None,
        country_code: Optional[str] = None,
        circuit_key: Optional[int] = None,
        circuit_short_name: Optional[str] = None,
        meeting_key: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get session information.
        A session refers to a distinct period of track activity (practice, qualifying, sprint, race).
        """
        return await self._request("sessions", {
            "session_key": session_key,
            "session_name": session_name,
            "year": year,
            "country_name": country_name,
            "country_code": country_code,
            "circuit_key": circuit_key,
            "circuit_short_name": circuit_short_name,
            "meeting_key": meeting_key,
        })

    # =========================================================================
    # Meetings
    # =========================================================================

    async def get_meetings(
        self,
        meeting_key: Optional[int] = None,
        year: Optional[int] = None,
        country_name: Optional[str] = None,
        country_code: Optional[str] = None,
        circuit_key: Optional[int] = None,
        circuit_short_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get meeting (Grand Prix weekend) information.
        A meeting usually includes multiple sessions.
        """
        return await self._request("meetings", {
            "meeting_key": meeting_key,
            "year": year,
            "country_name": country_name,
            "country_code": country_code,
            "circuit_key": circuit_key,
            "circuit_short_name": circuit_short_name,
        })

    # =========================================================================
    # Drivers
    # =========================================================================

    async def get_drivers(
        self,
        session_key: Optional[int] = None,
        meeting_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        name_acronym: Optional[str] = None,
        team_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get driver information for a session."""
        return await self._request("drivers", {
            "session_key": session_key,
            "meeting_key": meeting_key,
            "driver_number": driver_number,
            "name_acronym": name_acronym,
            "team_name": team_name,
        })

    # =========================================================================
    # Laps
    # =========================================================================

    async def get_laps(
        self,
        session_key: Optional[int] = None,
        meeting_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        lap_number: Optional[int] = None,
        is_pit_out_lap: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """Get detailed lap information."""
        return await self._request("laps", {
            "session_key": session_key,
            "meeting_key": meeting_key,
            "driver_number": driver_number,
            "lap_number": lap_number,
            "is_pit_out_lap": is_pit_out_lap,
        })

    # =========================================================================
    # Car Data (Telemetry)
    # =========================================================================

    async def get_car_data(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        date_gte: Optional[str] = None,
        date_lte: Optional[str] = None,
        speed_gte: Optional[int] = None,
        speed_lte: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get car telemetry data (speed, throttle, brake, DRS, gear, RPM).
        Sampled at ~3.7 Hz.
        """
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
        }
        # Handle comparison operators
        if date_gte:
            params["date>="] = date_gte
        if date_lte:
            params["date<="] = date_lte
        if speed_gte:
            params["speed>="] = speed_gte
        if speed_lte:
            params["speed<="] = speed_lte
        return await self._request("car_data", params)

    # =========================================================================
    # Location
    # =========================================================================

    async def get_location(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        date_gte: Optional[str] = None,
        date_lte: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get approximate car location on circuit.
        Sampled at ~3.7 Hz.
        """
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
        }
        if date_gte:
            params["date>="] = date_gte
        if date_lte:
            params["date<="] = date_lte
        return await self._request("location", params)

    # =========================================================================
    # Intervals
    # =========================================================================

    async def get_intervals(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        gap_to_leader_gte: Optional[float] = None,
        gap_to_leader_lte: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """Get interval data between drivers."""
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
        }
        if gap_to_leader_gte is not None:
            params["gap_to_leader>="] = gap_to_leader_gte
        if gap_to_leader_lte is not None:
            params["gap_to_leader<="] = gap_to_leader_lte
        return await self._request("intervals", params)

    # =========================================================================
    # Position
    # =========================================================================

    async def get_position(
        self,
        session_key: Optional[int] = None,
        meeting_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        position_lte: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get driver positions throughout a session."""
        params = {
            "session_key": session_key,
            "meeting_key": meeting_key,
            "driver_number": driver_number,
        }
        if position_lte is not None:
            params["position<="] = position_lte
        return await self._request("position", params)

    # =========================================================================
    # Race Control
    # =========================================================================

    async def get_race_control(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        category: Optional[str] = None,
        flag: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get race control messages (flags, penalties, etc.)."""
        return await self._request("race_control", {
            "session_key": session_key,
            "driver_number": driver_number,
            "category": category,
            "flag": flag,
        })

    # =========================================================================
    # Weather
    # =========================================================================

    async def get_weather(
        self,
        session_key: Optional[int] = None,
        meeting_key: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get weather data for a session."""
        return await self._request("weather", {
            "session_key": session_key,
            "meeting_key": meeting_key,
        })

    # =========================================================================
    # Stints
    # =========================================================================

    async def get_stints(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        stint_number: Optional[int] = None,
        compound: Optional[str] = None,
        tyre_age_at_start_gte: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get stint information (continuous driving periods)."""
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
            "stint_number": stint_number,
            "compound": compound,
        }
        if tyre_age_at_start_gte is not None:
            params["tyre_age_at_start>="] = tyre_age_at_start_gte
        return await self._request("stints", params)

    # =========================================================================
    # Session Result
    # =========================================================================

    async def get_session_result(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        position_lte: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get session standings/results (beta)."""
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
        }
        if position_lte is not None:
            params["position<="] = position_lte
        return await self._request("session_result", params)

    # =========================================================================
    # Starting Grid
    # =========================================================================

    async def get_starting_grid(
        self,
        session_key: Optional[int] = None,
        meeting_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        position_lte: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get starting grid for a race (beta)."""
        params = {
            "session_key": session_key,
            "meeting_key": meeting_key,
            "driver_number": driver_number,
        }
        if position_lte is not None:
            params["position<="] = position_lte
        return await self._request("starting_grid", params)

    # =========================================================================
    # Pit Stops
    # =========================================================================

    async def get_pit(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        pit_duration_gte: Optional[float] = None,
        pit_duration_lte: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """Get pit stop information."""
        params = {
            "session_key": session_key,
            "driver_number": driver_number,
        }
        if pit_duration_gte is not None:
            params["pit_duration>="] = pit_duration_gte
        if pit_duration_lte is not None:
            params["pit_duration<="] = pit_duration_lte
        return await self._request("pit", params)

    # =========================================================================
    # Overtakes
    # =========================================================================

    async def get_overtakes(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
        overtaking_driver_number: Optional[int] = None,
        overtaken_driver_number: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get overtake information (beta, races only)."""
        return await self._request("overtakes", {
            "session_key": session_key,
            "driver_number": driver_number,
            "overtaking_driver_number": overtaking_driver_number,
            "overtaken_driver_number": overtaken_driver_number,
        })

    # =========================================================================
    # Team Radio
    # =========================================================================

    async def get_team_radio(
        self,
        session_key: Optional[int] = None,
        driver_number: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Get team radio communications (limited selection)."""
        return await self._request("team_radio", {
            "session_key": session_key,
            "driver_number": driver_number,
        })


# Singleton instance for convenience
_client: Optional[OpenF1Client] = None


def get_openf1_client() -> OpenF1Client:
    """Get the global OpenF1 client instance."""
    global _client
    if _client is None:
        _client = OpenF1Client()
    return _client
