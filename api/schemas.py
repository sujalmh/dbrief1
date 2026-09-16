"""
Pydantic schemas for Fast-F1 API request/response models.
All models are designed for JSON-only, LLM-safe responses.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Any
from enum import Enum


# Static upper bound for OpenAPI/docs. The authoritative dynamic check
# (current year + buffer) lives in main._validate_year and runs per-request
# so long-lived processes never go stale after New Year.
_MAX_YEAR = 2100


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
    year: int = Field(..., ge=1950, le=_MAX_YEAR, description="Season year (1950-2017: ergast data, 2018+: full telemetry)")
    gp: str = Field(..., pattern=r'^[\w\-\s]+$', description="Grand Prix name or round number")
    session: SessionType = Field(..., description="Session identifier (FP1, FP2, FP3, Q, SQ, S, R)")


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


class DriverStandingsRequest(BaseModel):
    """Request for driver standings."""
    year: int = Field(..., ge=1950, le=_MAX_YEAR, description="Season year")
    driver: Optional[str] = Field(None, description="Filter by specific driver")


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
    round_number: int = Field(..., ge=0, le=99, description="Round number in the season (1-based)")
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


class GpNameInfo(BaseModel):
    """Canonical GP name information for LLM tool consumption."""
    round: int = Field(..., ge=0, le=99, description="Round number in the season (1-based)")
    event_name: str = Field(..., description="Full event name from FastF1 schedule (e.g., 'Monaco Grand Prix')")
    location: str = Field(..., description="City/location of the event")
    country: str = Field(..., description="Country of the event")
    canonical: str = Field(..., description="Canonical name accepted by get_session (same as event_name)")


class GpNamesResponse(BaseModel):
    """Response for canonical GP names in a season."""
    year: int
    grand_prix: List[GpNameInfo]


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


class DriverLapsResponse(BaseModel):
    """Response for a single driver's lap data.

    Extends LapsResponse with the driver identifier so the client can confirm
    whose laps they received without re-parsing the request.
    """
    session_name: str
    driver: str
    total_laps: int
    laps: List[dict]


class FastestLapResponse(BaseModel):
    """Response for fastest lap."""
    session_name: str
    driver: str
    lap_number: int = Field(..., ge=1, description="Lap number (1-based)")
    lap_time: Optional[str]
    sector1: Optional[str]
    sector2: Optional[str]
    sector3: Optional[str]
    compound: Optional[str]
    tyre_life: Optional[int] = Field(None, ge=0)


class SectorsResponse(BaseModel):
    """Response for sector times."""
    session_name: str
    sectors: List[dict]


class CornerData(BaseModel):
    """Single corner information."""
    Number: int = Field(..., ge=1)
    Distance: float = Field(..., ge=0)
    Letter: str
    Angle: float

class TelemetryResponse(BaseModel):
    """Response for telemetry data."""
    driver: str
    lap_number: int = Field(..., ge=1)
    lap_time: Optional[str]
    data: List[dict]
    corners: Optional[List[dict]] = None
    total_points: int = Field(..., ge=0)
    downsampled_from: int = Field(..., ge=0)


class ChannelSummary(BaseModel):
    """Statistical summary for a telemetry channel.

    Fields are Optional so a channel with no usable samples (empty list,
    all-NaN) returns None instead of misleading zeros.
    """
    min: Optional[float] = None
    max: Optional[float] = None
    avg: Optional[float] = None


class TelemetrySummaryResponse(BaseModel):
    """LLM-optimized telemetry summary response (no raw data)."""
    driver: str
    lap_number: int = Field(..., ge=1)
    lap_time: Optional[str]
    compound: Optional[str]
    tyre_life: Optional[int] = Field(None, ge=0)
    speed_summary: ChannelSummary
    throttle_summary: ChannelSummary
    brake_summary: ChannelSummary
    corner_min_speeds: Optional[List[dict]] = None
    sector_speeds: Optional[dict] = None
    total_points_analyzed: int = Field(..., ge=0)


class CarDataResponse(BaseModel):
    """Response for car data."""
    driver: str
    lap_number: Optional[int] = Field(None, ge=1)
    data: List[dict]
    total_points: int = Field(..., ge=0)


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


class StandingsEntry(BaseModel):
    """Single driver standing entry."""
    position: int = Field(..., ge=1)
    driver: str
    points: float = Field(..., ge=0)
    wins: int = Field(..., ge=0)
    team: str


class DriverStandingsResponse(BaseModel):
    """Response for driver standings."""
    year: int
    standings: List[dict]

class CornerMinSpeed(BaseModel):
    """Minimum speed at a corner."""
    corner: int = Field(..., ge=1)
    letter: str
    min_speed: float = Field(..., ge=0)

class SectorSpeeds(BaseModel):
    """Average speeds per sector.

    Fields are Optional because the underlying telemetry may not contain
    a Distance channel (e.g., older sessions).
    """
    sector1_avg_speed: Optional[float] = None
    sector2_avg_speed: Optional[float] = None
    sector3_avg_speed: Optional[float] = None
