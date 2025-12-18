"""
Pydantic schemas for Fast-F1 API request/response models.
All models are designed for JSON-only, LLM-safe responses.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Any
from enum import Enum


# =============================================================================
# Enums
# =============================================================================

class SessionType(str, Enum):
    FP1 = "FP1"
    FP2 = "FP2"
    FP3 = "FP3"
    Q = "Q"
    SQ = "SQ"
    SS = "SS"
    S = "S"
    R = "R"


class TyreCompound(str, Enum):
    SOFT = "SOFT"
    MEDIUM = "MEDIUM"
    HARD = "HARD"
    INTERMEDIATE = "INTERMEDIATE"
    WET = "WET"


# =============================================================================
# Request Models
# =============================================================================

class SessionRequest(BaseModel):
    """Base request for session-related endpoints."""
    year: int = Field(..., ge=2018, le=2025, description="Season year")
    gp: str = Field(..., description="Grand Prix name or round number")
    session: str = Field(..., description="Session identifier (FP1, FP2, FP3, Q, SQ, S, R)")


class LapsRequest(SessionRequest):
    """Request for lap data with optional filters."""
    driver: Optional[str] = Field(None, description="Driver code (e.g., 'VER', 'HAM')")
    lap_start: Optional[int] = Field(None, ge=1, description="Starting lap number filter")
    lap_end: Optional[int] = Field(None, ge=1, description="Ending lap number filter")
    compound: Optional[str] = Field(None, description="Tyre compound filter")
    stint: Optional[int] = Field(None, ge=1, description="Stint number filter")


class DriverLapsRequest(SessionRequest):
    """Request for a specific driver's laps."""
    driver: str = Field(..., description="Driver code (e.g., 'VER', 'HAM')")
    lap_start: Optional[int] = Field(None, ge=1, description="Starting lap number filter")
    lap_end: Optional[int] = Field(None, ge=1, description="Ending lap number filter")


class FastestLapRequest(SessionRequest):
    """Request for fastest lap data."""
    driver: Optional[str] = Field(None, description="Driver code for driver-specific fastest lap")


class SectorsRequest(SessionRequest):
    """Request for sector time data."""
    driver: Optional[str] = Field(None, description="Driver code filter")
    lap: Optional[int] = Field(None, ge=1, description="Specific lap number")


class TelemetryRequest(SessionRequest):
    """Request for telemetry data."""
    driver: str = Field(..., description="Driver code (e.g., 'VER', 'HAM')")
    lap: str = Field("fastest", description="Lap identifier: 'fastest' or lap number")
    channels: Optional[List[str]] = Field(
        default=["Speed", "Throttle", "Brake", "RPM", "nGear", "DRS"],
        description="Telemetry channels to include"
    )
    downsample: int = Field(default=10, ge=1, le=100, description="Downsample factor")


class CarDataRequest(SessionRequest):
    """Request for car data."""
    driver: str = Field(..., description="Driver code (e.g., 'VER', 'HAM')")
    lap: Optional[str] = Field(None, description="Lap identifier: 'fastest' or lap number")


class WeatherRequest(SessionRequest):
    """Request for weather data."""
    pass


class RaceControlRequest(SessionRequest):
    """Request for race control messages."""
    pass


class TrackStatusRequest(SessionRequest):
    """Request for track status data."""
    pass


class TyresRequest(SessionRequest):
    """Request for tyre data."""
    driver: Optional[str] = Field(None, description="Driver code filter")


class StintsRequest(SessionRequest):
    """Request for stint data."""
    driver: Optional[str] = Field(None, description="Driver code filter")


# =============================================================================
# Response Models
# =============================================================================

class ErrorResponse(BaseModel):
    """Standard error response."""
    error: str


class SeasonResponse(BaseModel):
    """Response for available seasons."""
    seasons: List[int]


class EventInfo(BaseModel):
    """Single event information."""
    round_number: int
    country: str
    location: str
    event_name: str
    event_date: Optional[str]
    event_format: str
    sessions: List[str]


class EventsResponse(BaseModel):
    """Response for events in a season."""
    year: int
    events: List[EventInfo]


class SessionInfo(BaseModel):
    """Single session information."""
    session_name: str
    session_type: str
    date: Optional[str]
    available: bool


class SessionsResponse(BaseModel):
    """Response for sessions in an event."""
    year: int
    gp: str
    sessions: List[SessionInfo]


class SessionLoadResponse(BaseModel):
    """Response for session load metadata."""
    session_name: str
    event_name: str
    date: Optional[str]
    drivers: List[str]
    total_laps: Optional[int]
    f1_api_support: bool


class ResultsResponse(BaseModel):
    """Response for session results."""
    session_name: str
    results: List[dict]


class LapsResponse(BaseModel):
    """Response for lap data."""
    session_name: str
    total_laps: int
    laps: List[dict]


class FastestLapResponse(BaseModel):
    """Response for fastest lap."""
    session_name: str
    driver: str
    lap_number: int
    lap_time: Optional[str]
    sector1: Optional[str]
    sector2: Optional[str]
    sector3: Optional[str]
    compound: Optional[str]
    tyre_life: Optional[int]


class SectorsResponse(BaseModel):
    """Response for sector times."""
    session_name: str
    sectors: List[dict]


class TelemetryResponse(BaseModel):
    """Response for telemetry data."""
    driver: str
    lap_number: int
    lap_time: Optional[str]
    data: List[dict]
    total_points: int
    downsampled_from: int


class CarDataResponse(BaseModel):
    """Response for car data."""
    driver: str
    lap_number: Optional[int]
    data: List[dict]
    total_points: int


class WeatherDataPoint(BaseModel):
    """Single weather data point."""
    time: str
    air_temp: Optional[float]
    track_temp: Optional[float]
    humidity: Optional[float]
    pressure: Optional[float]
    wind_speed: Optional[float]
    wind_direction: Optional[int]
    rainfall: bool


class WeatherResponse(BaseModel):
    """Response for weather data."""
    session_name: str
    data: List[dict]


class RaceControlMessage(BaseModel):
    """Single race control message."""
    time: str
    category: str
    message: str
    flag: Optional[str]
    scope: Optional[str]
    driver: Optional[str]


class RaceControlResponse(BaseModel):
    """Response for race control messages."""
    session_name: str
    messages: List[dict]


class TrackStatusEntry(BaseModel):
    """Single track status entry."""
    time: str
    status: str
    message: str


class TrackStatusResponse(BaseModel):
    """Response for track status."""
    session_name: str
    status: List[dict]


class TyresResponse(BaseModel):
    """Response for tyre data."""
    session_name: str
    tyres: List[dict]


class StintsResponse(BaseModel):
    """Response for stint data."""
    session_name: str
    stints: List[dict]


class DriverInfo(BaseModel):
    """Single driver information."""
    driver_number: str
    broadcast_name: str
    abbreviation: str
    team_name: str
    team_color: Optional[str]
    first_name: str
    last_name: str
    full_name: str
    country_code: Optional[str]


class DriversResponse(BaseModel):
    """Response for drivers list."""
    year: int
    gp: Optional[str]
    drivers: List[dict]


class TeamInfo(BaseModel):
    """Single team information."""
    team_name: str
    team_color: Optional[str]
    drivers: List[str]


class TeamsResponse(BaseModel):
    """Response for teams list."""
    year: int
    gp: Optional[str]
    teams: List[dict]
