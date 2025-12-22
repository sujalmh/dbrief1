"""
OpenF1 API Microservice
=======================
A comprehensive FastAPI microservice exposing OpenF1 API functionality
as clean, structured HTTP APIs for LangChain JS / Next.js backend consumption.

Features:
- JSON-only responses (no HTML, no natural language)
- Deterministic output with explicit schemas
- Direct OpenF1 API integration
- Cloud Run ready
"""

from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from client import OpenF1Client, get_openf1_client
from ergast import ErgastClient, get_ergast_client


# =============================================================================
# App Configuration
# =============================================================================

app = FastAPI(
    title="OpenF1 API",
    description="HTTP API exposing OpenF1 functionality",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware for cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Request Models
# =============================================================================


class SessionKeyRequest(BaseModel):
    """Request requiring a session_key."""
    session_key: int = Field(..., description="OpenF1 session key")


class SessionLookupRequest(BaseModel):
    """Request that looks up session by year/country/session_name."""
    year: int = Field(..., ge=2023, le=2025, description="Season year (OpenF1 supports 2023+)")
    country_name: Optional[str] = Field(None, description="Country name (e.g., 'Belgium')")
    session_name: Optional[str] = Field(None, description="Session name (e.g., 'Race', 'Qualifying')")


class LapsRequest(SessionKeyRequest):
    """Request for lap data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")
    lap_number: Optional[int] = Field(None, ge=1, description="Specific lap number")


class TelemetryRequest(SessionKeyRequest):
    """Request for car telemetry data."""
    driver_number: int = Field(..., description="Driver number")
    date_gte: Optional[str] = Field(None, description="Start datetime (ISO format)")
    date_lte: Optional[str] = Field(None, description="End datetime (ISO format)")
    speed_gte: Optional[int] = Field(None, description="Minimum speed filter")
    speed_lte: Optional[int] = Field(None, description="Maximum speed filter")


class LocationRequest(SessionKeyRequest):
    """Request for car location data."""
    driver_number: int = Field(..., description="Driver number")
    date_gte: Optional[str] = Field(None, description="Start datetime (ISO format)")
    date_lte: Optional[str] = Field(None, description="End datetime (ISO format)")


class IntervalsRequest(SessionKeyRequest):
    """Request for interval data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")


class PositionRequest(SessionKeyRequest):
    """Request for position data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")
    position_lte: Optional[int] = Field(None, description="Maximum position filter")


class RaceControlRequest(SessionKeyRequest):
    """Request for race control messages."""
    category: Optional[str] = Field(None, description="Category filter")
    flag: Optional[str] = Field(None, description="Flag filter")


class WeatherRequest(SessionKeyRequest):
    """Request for weather data."""
    pass


class StintsRequest(SessionKeyRequest):
    """Request for stint data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")
    compound: Optional[str] = Field(None, description="Compound filter (SOFT, MEDIUM, HARD)")


class PitRequest(SessionKeyRequest):
    """Request for pit stop data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")


class OvertakesRequest(SessionKeyRequest):
    """Request for overtake data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")


class TeamRadioRequest(SessionKeyRequest):
    """Request for team radio data."""
    driver_number: Optional[int] = Field(None, description="Driver number filter")


class StandingsRequest(BaseModel):
    """Request for driver standings."""
    year: int = Field(..., ge=1950, le=2025, description="Season year")
    round: Optional[int] = Field(None, ge=1, description="Round number (optional)")


class CumulativeStatsRequest(BaseModel):
    """Request for aggregated statistics over a range of years/rounds."""
    year_gte: int = Field(..., ge=1950, description="Start year")
    year_lte: int = Field(..., ge=1950, description="End year")
    round_gte: Optional[int] = Field(None, ge=1, description="Start round (inclusive)")
    round_lte: Optional[int] = Field(None, ge=1, description="End round (inclusive)")
    driver_number: Optional[int] = Field(None, description="Driver number filter (optional)")



# =============================================================================
# Error Handlers
# =============================================================================


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    """Handle all uncaught exceptions with clean JSON response."""
    error_message = str(exc) if str(exc) else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"error": error_message}
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions with clean JSON response."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail}
    )


# =============================================================================
# Health Check
# =============================================================================


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "healthy"}


# =============================================================================
# Session Discovery Endpoints
# =============================================================================


@app.get("/f1/seasons")
async def get_seasons():
    """
    Get list of available seasons.
    OpenF1 supports seasons from 2023 onwards.
    """
    # OpenF1 currently supports 2023-2025
    seasons = list(range(2023, 2026))
    return {"seasons": seasons}


@app.get("/f1/meetings")
async def get_meetings(
    year: int = Query(..., ge=2023, le=2025, description="Season year"),
    country_name: Optional[str] = Query(None, description="Country name filter"),
):
    """
    Get all meetings (Grand Prix weekends) for a specific year.
    """
    try:
        client = get_openf1_client()
        meetings = await client.get_meetings(year=year, country_name=country_name)
        return {"year": year, "meetings": meetings}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/sessions")
async def get_sessions(
    year: Optional[int] = Query(None, ge=2023, le=2025, description="Season year"),
    country_name: Optional[str] = Query(None, description="Country name filter"),
    session_name: Optional[str] = Query(None, description="Session name filter (Race, Qualifying, etc.)"),
    meeting_key: Optional[int] = Query(None, description="Meeting key filter"),
):
    """
    Get sessions with optional filters.
    """
    try:
        client = get_openf1_client()
        sessions = await client.get_sessions(
            year=year,
            country_name=country_name,
            session_name=session_name,
            meeting_key=meeting_key,
        )
        return {"sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Driver Endpoints
# =============================================================================


@app.get("/f1/drivers")
async def get_drivers(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number filter"),
    name_acronym: Optional[str] = Query(None, description="Driver acronym filter (e.g., VER)"),
):
    """
    Get driver information for a session.
    """
    try:
        client = get_openf1_client()
        drivers = await client.get_drivers(
            session_key=session_key,
            driver_number=driver_number,
            name_acronym=name_acronym,
        )
        return {"session_key": session_key, "drivers": drivers}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Lap Data Endpoints
# =============================================================================


@app.post("/f1/laps")
async def get_laps(request: LapsRequest):
    """
    Get detailed lap information.
    """
    try:
        client = get_openf1_client()
        laps = await client.get_laps(
            session_key=request.session_key,
            driver_number=request.driver_number,
            lap_number=request.lap_number,
        )
        return {
            "session_key": request.session_key,
            "total_laps": len(laps),
            "laps": laps
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/laps")
async def get_laps_query(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
    lap_number: Optional[int] = Query(None, description="Lap number"),
):
    """
    Get detailed lap information (GET version).
    """
    try:
        client = get_openf1_client()
        laps = await client.get_laps(
            session_key=session_key,
            driver_number=driver_number,
            lap_number=lap_number,
        )
        return {
            "session_key": session_key,
            "total_laps": len(laps),
            "laps": laps
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Car Data (Telemetry) Endpoints
# =============================================================================


@app.post("/f1/car-data")
async def get_car_data(request: TelemetryRequest):
    """
    Get car telemetry data (speed, throttle, brake, DRS, gear, RPM).
    Sampled at ~3.7 Hz.
    """
    try:
        client = get_openf1_client()
        data = await client.get_car_data(
            session_key=request.session_key,
            driver_number=request.driver_number,
            date_gte=request.date_gte,
            date_lte=request.date_lte,
            speed_gte=request.speed_gte,
            speed_lte=request.speed_lte,
        )
        return {
            "session_key": request.session_key,
            "driver_number": request.driver_number,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/car-data")
async def get_car_data_query(
    session_key: int = Query(..., description="Session key"),
    driver_number: int = Query(..., description="Driver number"),
    date_gte: Optional[str] = Query(None, description="Start datetime"),
    date_lte: Optional[str] = Query(None, description="End datetime"),
    speed_gte: Optional[int] = Query(None, description="Min speed"),
    speed_lte: Optional[int] = Query(None, description="Max speed"),
):
    """
    Get car telemetry data (GET version).
    """
    try:
        client = get_openf1_client()
        data = await client.get_car_data(
            session_key=session_key,
            driver_number=driver_number,
            date_gte=date_gte,
            date_lte=date_lte,
            speed_gte=speed_gte,
            speed_lte=speed_lte,
        )
        return {
            "session_key": session_key,
            "driver_number": driver_number,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Location Endpoints
# =============================================================================


@app.post("/f1/location")
async def get_location(request: LocationRequest):
    """
    Get approximate car location on circuit.
    Sampled at ~3.7 Hz.
    """
    try:
        client = get_openf1_client()
        data = await client.get_location(
            session_key=request.session_key,
            driver_number=request.driver_number,
            date_gte=request.date_gte,
            date_lte=request.date_lte,
        )
        return {
            "session_key": request.session_key,
            "driver_number": request.driver_number,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/location")
async def get_location_query(
    session_key: int = Query(..., description="Session key"),
    driver_number: int = Query(..., description="Driver number"),
    date_gte: Optional[str] = Query(None, description="Start datetime"),
    date_lte: Optional[str] = Query(None, description="End datetime"),
):
    """
    Get car location data (GET version).
    """
    try:
        client = get_openf1_client()
        data = await client.get_location(
            session_key=session_key,
            driver_number=driver_number,
            date_gte=date_gte,
            date_lte=date_lte,
        )
        return {
            "session_key": session_key,
            "driver_number": driver_number,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Intervals Endpoints
# =============================================================================


@app.get("/f1/intervals")
async def get_intervals(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
):
    """
    Get interval data between drivers.
    """
    try:
        client = get_openf1_client()
        data = await client.get_intervals(
            session_key=session_key,
            driver_number=driver_number,
        )
        return {
            "session_key": session_key,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Position Endpoints
# =============================================================================


@app.get("/f1/position")
async def get_position(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
    position_lte: Optional[int] = Query(None, description="Max position filter"),
):
    """
    Get driver positions throughout a session.
    """
    try:
        client = get_openf1_client()
        data = await client.get_position(
            session_key=session_key,
            driver_number=driver_number,
            position_lte=position_lte,
        )
        return {
            "session_key": session_key,
            "total_points": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Race Control Endpoints
# =============================================================================


@app.get("/f1/race-control")
async def get_race_control(
    session_key: int = Query(..., description="Session key"),
    category: Optional[str] = Query(None, description="Category filter"),
    flag: Optional[str] = Query(None, description="Flag filter"),
):
    """
    Get race control messages (flags, penalties, etc.).
    """
    try:
        client = get_openf1_client()
        messages = await client.get_race_control(
            session_key=session_key,
            category=category,
            flag=flag,
        )
        return {
            "session_key": session_key,
            "messages": messages
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Weather Endpoints
# =============================================================================


@app.get("/f1/weather")
async def get_weather(
    session_key: int = Query(..., description="Session key"),
):
    """
    Get weather data for a session.
    """
    try:
        client = get_openf1_client()
        data = await client.get_weather(session_key=session_key)
        return {
            "session_key": session_key,
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Stints Endpoints
# =============================================================================


@app.get("/f1/stints")
async def get_stints(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
    compound: Optional[str] = Query(None, description="Compound filter"),
):
    """
    Get stint information (continuous driving periods).
    """
    try:
        client = get_openf1_client()
        stints = await client.get_stints(
            session_key=session_key,
            driver_number=driver_number,
            compound=compound,
        )
        return {
            "session_key": session_key,
            "stints": stints
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Session Results Endpoints
# =============================================================================


@app.get("/f1/results")
async def get_session_result(
    session_key: int = Query(..., description="Session key"),
    position_lte: Optional[int] = Query(None, description="Max position filter"),
):
    """
    Get session standings/results (beta).
    """
    try:
        client = get_openf1_client()
        results = await client.get_session_result(
            session_key=session_key,
            position_lte=position_lte,
        )
        return {
            "session_key": session_key,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Starting Grid Endpoints
# =============================================================================


@app.get("/f1/starting-grid")
async def get_starting_grid(
    session_key: int = Query(..., description="Session key"),
    position_lte: Optional[int] = Query(None, description="Max position filter"),
):
    """
    Get starting grid for a race (beta).
    """
    try:
        client = get_openf1_client()
        grid = await client.get_starting_grid(
            session_key=session_key,
            position_lte=position_lte,
        )
        return {
            "session_key": session_key,
            "grid": grid
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Pit Stop Endpoints
# =============================================================================


@app.get("/f1/pit")
async def get_pit(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
):
    """
    Get pit stop information.
    """
    try:
        client = get_openf1_client()
        pits = await client.get_pit(
            session_key=session_key,
            driver_number=driver_number,
        )
        return {
            "session_key": session_key,
            "pits": pits
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Overtakes Endpoints
# =============================================================================


@app.get("/f1/overtakes")
async def get_overtakes(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
):
    """
    Get overtake information (beta, races only).
    """
    try:
        client = get_openf1_client()
        overtakes = await client.get_overtakes(
            session_key=session_key,
            driver_number=driver_number,
        )
        return {
            "session_key": session_key,
            "overtakes": overtakes
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Team Radio Endpoints
# =============================================================================


@app.get("/f1/team-radio")
async def get_team_radio(
    session_key: int = Query(..., description="Session key"),
    driver_number: Optional[int] = Query(None, description="Driver number"),
):
    """
    Get team radio communications (limited selection).
    """
    try:
        client = get_openf1_client()
        radio = await client.get_team_radio(
            session_key=session_key,
            driver_number=driver_number,
        )
        return {
            "session_key": session_key,
            "radio": radio
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Entry Point
# =============================================================================

# =============================================================================
# Historical & Aggregated Stats (Ergast)
# =============================================================================


@app.get("/f1/standings")
async def get_driver_standings_query(
    year: int = Query(..., ge=1950, le=2025, description="Season year"),
    round: Optional[int] = Query(None, ge=1, description="Round number"),
):
    """
    Get driver standings for a specific year (Ergast).
    Supports historical data (pre-2023).
    """
    try:
        client = get_ergast_client()
        standings = await client.get_driver_standings(year=year, round=round)
        return {
            "year": year,
            "round": round,
            "standings": standings
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/stats/cumulative")
async def get_cumulative_stats(request: CumulativeStatsRequest):
    """
    Get aggregated stats (points, wins, podiums) over a range of years/rounds.
    Useful for "since 2015" or "first 5 rounds of 2024" queries.
    """
    try:
        client = get_ergast_client()
        stats = {}  # DriverID -> {points: 0, wins: 0, podiums: 0, name: "", team: ""}
        
        # Loop through years
        for year in range(request.year_gte, request.year_lte + 1):
            
            # CASE A: Full Season (no round filters or full range)
            if request.round_gte is None and request.round_lte is None:
                # Fetch final standings for the year
                standings = await client.get_driver_standings(year)
                for driver in standings:
                    d_id = driver["Driver"]["driverId"]
                    points = float(driver["points"])
                    wins = int(driver["wins"])
                    
                    if d_id not in stats:
                        stats[d_id] = {
                            "driverId": d_id,
                            "code": driver["Driver"].get("code", "UNK"),
                            "givenName": driver["Driver"]["givenName"],
                            "familyName": driver["Driver"]["familyName"],
                            "points": 0.0,
                            "wins": 0,
                            "seasons": 0
                        }
                    stats[d_id]["points"] += points
                    stats[d_id]["wins"] += wins
                    stats[d_id]["seasons"] += 1
            
            # CASE B: Partial Season (Round Filters Active) 
            else:
                # We need to fetch specific race results for the valid round range
                
                start_r = request.round_gte if request.round_gte else 1
                end_r = request.round_lte if request.round_lte else 24 # Cap at reasonable max
                
                # Check if it's "First N rounds" or "After N rounds" type query which can be optimized
                # "After 10 rounds" actually means "Standings AFTER round 10" which includes 1-10.
                
                use_standings_snapshot = (request.round_gte is None or request.round_gte == 1) and request.round_lte is not None
                
                if use_standings_snapshot:
                     # Fetch standings at specific round
                     standings = await client.get_driver_standings(year=year, round=request.round_lte)
                     for driver in standings:
                        d_id = driver["Driver"]["driverId"]
                        points = float(driver["points"])
                        wins = int(driver["wins"])
                        
                        if d_id not in stats:
                            stats[d_id] = {
                                "driverId": d_id,
                                "code": driver["Driver"].get("code", "UNK"),
                                "givenName": driver["Driver"]["givenName"],
                                "familyName": driver["Driver"]["familyName"],
                                "points": 0.0,
                                "wins": 0,
                                "seasons": 0
                            }
                        stats[d_id]["points"] += points
                        stats[d_id]["wins"] += wins
                        stats[d_id]["seasons"] += 1
                
                else:
                    # Complex range: e.g. Round 12 to 16. Must sum race results.
                    # Prevent abuse: cap range/years? 
                    
                    for r in range(start_r, end_r + 1):
                        results = await client.get_race_results(year, r)
                        if not results:
                            break # End of season
                            
                        for res in results:
                            d_id = res["Driver"]["driverId"]
                            points = float(res["points"])
                            position = int(res["positionText"]) if res["positionText"].isdigit() else 99
                            win = 1 if position == 1 else 0
                            
                            if d_id not in stats:
                                stats[d_id] = {
                                    "driverId": d_id,
                                    "code": res["Driver"].get("code", "UNK"),
                                    "givenName": res["Driver"]["givenName"],
                                    "familyName": res["Driver"]["familyName"],
                                    "points": 0.0,
                                    "wins": 0,
                                    "seasons": 0
                                }
                            stats[d_id]["points"] += points
                            stats[d_id]["wins"] += win
                            # Don't increment seasons per race

        # Sort by points descending
        sorted_stats = sorted(stats.values(), key=lambda x: x["points"], reverse=True)
        return {
            "request": request.model_dump(),
            "stats": sorted_stats
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
