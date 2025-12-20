"""
Fast-F1 API Microservice
========================
A comprehensive FastAPI microservice exposing all Fast-F1 library functionality
as clean, structured HTTP APIs for LangChain JS / Next.js backend consumption.

Features:
- JSON-only responses (no HTML, no natural language)
- Deterministic output with explicit schemas
- Aggressive caching (Fast-F1 disk cache + LRU memory cache)
- Automatic telemetry downsampling
- Cloud Run ready
"""

import asyncio
from functools import lru_cache
from typing import Optional

import fastf1
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from schemas import (
    CarDataRequest,
    CarDataResponse,
    DriverLapsRequest,
    DriversResponse,
    ErrorResponse,
    EventsResponse,
    EventInfo,
    FastestLapRequest,
    FastestLapResponse,
    LapsRequest,
    LapsResponse,
    RaceControlRequest,
    RaceControlResponse,
    ResultsResponse,
    SeasonResponse,
    SectorsRequest,
    SectorsResponse,
    SessionLoadResponse,
    SessionRequest,
    SessionsResponse,
    SessionInfo,
    StintsRequest,
    StintsResponse,
    TeamsResponse,
    TelemetryRequest,
    TelemetryResponse,
    TrackStatusRequest,
    TrackStatusResponse,
    TyresRequest,
    TyresResponse,
    WeatherRequest,
    WeatherResponse,
)
from utils import (
    df_to_json,
    downsample_telemetry,
    filter_telemetry_channels,
    format_lap_data,
    format_session_results,
    format_timedelta,
    get_track_status_description,
    safe_get_attr,
    sanitize_value,
)

# =============================================================================
# Cost Protection Configuration
# =============================================================================

from datetime import datetime

CURRENT_YEAR = datetime.now().year
MAX_TELEMETRY_POINTS = 5000  # Hard cap on telemetry data points

# =============================================================================
# App Configuration
# =============================================================================

app = FastAPI(
    title="Fast-F1 API",
    description="HTTP API exposing Fast-F1 library functionality",
    version="1.0.0",
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

# Enable Fast-F1 disk cache
fastf1.Cache.enable_cache("cache")

# Mutex for session loading (prevent concurrent loads)
session_load_lock = asyncio.Lock()

# =============================================================================
# Session Management
# =============================================================================


@lru_cache(maxsize=32)
def _load_session_sync(year: int, gp: str, session_type: str) -> fastf1.core.Session:
    """
    Load and cache a session synchronously.
    Uses LRU cache to avoid reloading frequently accessed sessions.
    """
    session = fastf1.get_session(year, gp, session_type)
    session.load()
    return session


async def get_session(year: int, gp: str, session_type: str) -> fastf1.core.Session:
    """
    Get a loaded session with mutex protection.
    Blocks live sessions to prevent cost spikes.
    """
    async with session_load_lock:
        # Run the blocking load in a thread pool
        loop = asyncio.get_event_loop()
        session = await loop.run_in_executor(
            None, _load_session_sync, year, gp, session_type
        )
        
        # COST PROTECTION: Block live sessions
        if session.date and session.date.year == CURRENT_YEAR:
            # Check if session is live or upcoming (within 7 days)
            session_datetime = pd.Timestamp(session.date)
            now = pd.Timestamp.now(tz=session_datetime.tz)
            days_diff = (session_datetime - now).total_seconds() / 86400
            
            # Block if session is in the future or within last 24 hours
            if days_diff > -1:
                raise HTTPException(
                    status_code=403,
                    detail=f"Live/recent sessions are disabled for cost protection. Session date: {session.date.isoformat()}"
                )
        
        return session


def get_event_schedule(year: int) -> pd.DataFrame:
    """Get event schedule for a year."""
    return fastf1.get_event_schedule(year)


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
# A. Session Discovery Endpoints
# =============================================================================


@app.get("/f1/seasons", response_model=SeasonResponse)
async def get_seasons():
    """
    Get list of available seasons.
    Fast-F1 supports seasons from 2018 onwards with full telemetry.
    """
    # Fast-F1 supports 2018+ for telemetry data
    seasons = list(range(2018, 2026))
    return {"seasons": seasons}


@app.get("/f1/events", response_model=EventsResponse)
async def get_events(year: int = Query(..., ge=2018, le=2025)):
    """
    Get all events (Grand Prix) for a specific year.
    """
    try:
        schedule = get_event_schedule(year)
        events = []
        
        for _, event in schedule.iterrows():
            # Get session names for this event
            session_names = []
            for i in range(1, 6):
                session_key = f"Session{i}"
                if session_key in event and pd.notna(event[session_key]):
                    session_names.append(str(event[session_key]))
            
            event_info = EventInfo(
                round_number=int(event.get("RoundNumber", 0)),
                country=str(event.get("Country", "")),
                location=str(event.get("Location", "")),
                event_name=str(event.get("EventName", "")),
                event_date=event.get("EventDate").isoformat() if pd.notna(event.get("EventDate")) else None,
                event_format=str(event.get("EventFormat", "conventional")),
                sessions=session_names
            )
            events.append(event_info)
        
        return {"year": year, "events": events}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/sessions", response_model=SessionsResponse)
async def get_sessions(
    year: int = Query(..., ge=2018, le=2025),
    gp: str = Query(..., description="Grand Prix name or round number")
):
    """
    Get available sessions for a specific event.
    """
    try:
        schedule = get_event_schedule(year)
        
        # Find the event
        event = None
        for _, row in schedule.iterrows():
            if (str(row.get("RoundNumber")) == gp or 
                gp.lower() in str(row.get("EventName", "")).lower() or
                gp.lower() in str(row.get("Location", "")).lower() or
                gp.lower() in str(row.get("Country", "")).lower()):
                event = row
                break
        
        if event is None:
            raise HTTPException(status_code=404, detail=f"Event '{gp}' not found")
        
        sessions = []
        session_map = {
            "Session1": "FP1",
            "Session2": "FP2", 
            "Session3": "FP3",
            "Session4": "Q",
            "Session5": "R"
        }
        
        for session_key, session_type in session_map.items():
            if session_key in event and pd.notna(event[session_key]):
                session_name = str(event[session_key])
                date_key = f"{session_key}Date"
                session_date = None
                if date_key in event and pd.notna(event[date_key]):
                    session_date = event[date_key].isoformat()
                
                sessions.append(SessionInfo(
                    session_name=session_name,
                    session_type=session_type,
                    date=session_date,
                    available=True
                ))
        
        return {
            "year": year,
            "gp": str(event.get("EventName", gp)),
            "sessions": sessions
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# B. Session Loading Endpoint
# =============================================================================


@app.post("/f1/session/load", response_model=SessionLoadResponse)
async def load_session(request: SessionRequest):
    """
    Load a session and return metadata.
    Does NOT return full session data - just metadata for confirmation.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        return SessionLoadResponse(
            session_name=session.name,
            event_name=session.event.EventName if session.event is not None else "",
            date=session.date.isoformat() if session.date else None,
            drivers=list(session.drivers) if session.drivers else [],
            total_laps=session.total_laps if hasattr(session, 'total_laps') else None,
            f1_api_support=session.f1_api_support if hasattr(session, 'f1_api_support') else True
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# C. Results & Classification Endpoints
# =============================================================================


@app.post("/f1/results", response_model=ResultsResponse)
async def get_results(request: SessionRequest):
    """
    Get session results with driver information.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        results = format_session_results(session.results)
        
        return {
            "session_name": session.name,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/qualifying")
async def get_qualifying(request: SessionRequest):
    """
    Get qualifying results with Q1, Q2, Q3 times.
    """
    try:
        # Force session type to Qualifying
        session = await get_session(request.year, request.gp, "Q")
        results = format_session_results(session.results)
        
        return {
            "session_name": session.name,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/race")
async def get_race(request: SessionRequest):
    """
    Get race results with grid position, status, fastest lap.
    """
    try:
        # Force session type to Race
        session = await get_session(request.year, request.gp, "R")
        results = format_session_results(session.results)
        
        return {
            "session_name": session.name,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# D. Lap Data Endpoints
# =============================================================================


@app.post("/f1/laps", response_model=LapsResponse)
async def get_laps(request: LapsRequest):
    """
    Get lap data with optional filters.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        laps = session.laps
        
        # Apply filters
        if request.driver:
            laps = laps.pick_drivers(request.driver)
        
        if request.lap_start:
            laps = laps[laps["LapNumber"] >= request.lap_start]
        
        if request.lap_end:
            laps = laps[laps["LapNumber"] <= request.lap_end]
        
        if request.compound:
            laps = laps[laps["Compound"] == request.compound.upper()]
        
        if request.stint:
            laps = laps[laps["Stint"] == request.stint]
        
        lap_data = format_lap_data(laps)
        
        return {
            "session_name": session.name,
            "total_laps": len(lap_data),
            "laps": lap_data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/laps/driver")
async def get_driver_laps(request: DriverLapsRequest):
    """
    Get all laps for a specific driver.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        laps = session.laps.pick_drivers(request.driver)
        
        if request.lap_start:
            laps = laps[laps["LapNumber"] >= request.lap_start]
        
        if request.lap_end:
            laps = laps[laps["LapNumber"] <= request.lap_end]
        
        lap_data = format_lap_data(laps)
        
        return {
            "session_name": session.name,
            "driver": request.driver,
            "total_laps": len(lap_data),
            "laps": lap_data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/laps/fastest", response_model=FastestLapResponse)
async def get_fastest_lap(request: FastestLapRequest):
    """
    Get the fastest lap in a session (optionally for a specific driver).
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        if request.driver:
            laps = session.laps.pick_drivers(request.driver)
        else:
            laps = session.laps
        
        fastest = laps.pick_fastest()
        
        if fastest is None or fastest.empty:
            raise HTTPException(status_code=404, detail="No valid fastest lap found")
        
        return FastestLapResponse(
            session_name=session.name,
            driver=str(fastest.get("Driver", "")),
            lap_number=int(fastest.get("LapNumber", 0)),
            lap_time=format_timedelta(fastest.get("LapTime")),
            sector1=format_timedelta(fastest.get("Sector1Time")),
            sector2=format_timedelta(fastest.get("Sector2Time")),
            sector3=format_timedelta(fastest.get("Sector3Time")),
            compound=str(fastest.get("Compound", "")) if pd.notna(fastest.get("Compound")) else None,
            tyre_life=int(fastest.get("TyreLife", 0)) if pd.notna(fastest.get("TyreLife")) else None
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# E. Sector Times Endpoint
# =============================================================================


@app.post("/f1/sectors", response_model=SectorsResponse)
async def get_sectors(request: SectorsRequest):
    """
    Get sector times for laps in a session.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        laps = session.laps
        
        if request.driver:
            laps = laps.pick_drivers(request.driver)
        
        if request.lap:
            laps = laps[laps["LapNumber"] == request.lap]
        
        sectors = []
        for _, lap in laps.iterrows():
            sector_data = {
                "driver": sanitize_value(lap.get("Driver")),
                "lap_number": sanitize_value(lap.get("LapNumber")),
                "sector1": format_timedelta(lap.get("Sector1Time")),
                "sector2": format_timedelta(lap.get("Sector2Time")),
                "sector3": format_timedelta(lap.get("Sector3Time")),
                "is_personal_best": sanitize_value(lap.get("IsPersonalBest")),
                "speed_i1": sanitize_value(lap.get("SpeedI1")),
                "speed_i2": sanitize_value(lap.get("SpeedI2")),
                "speed_fl": sanitize_value(lap.get("SpeedFL")),
                "speed_st": sanitize_value(lap.get("SpeedST")),
            }
            sectors.append(sector_data)
        
        return {
            "session_name": session.name,
            "sectors": sectors
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# F. Telemetry Endpoint (Core Feature)
# =============================================================================


@app.post("/f1/telemetry", response_model=TelemetryResponse)
async def get_telemetry(request: TelemetryRequest):
    """
    Get telemetry data for a specific driver and lap.
    Automatically downsamples large datasets.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        # Get driver's laps
        driver_laps = session.laps.pick_drivers(request.driver)
        
        if driver_laps.empty:
            raise HTTPException(status_code=404, detail=f"No laps found for driver {request.driver}")
        
        # Get the specific lap
        if request.lap == "fastest":
            lap = driver_laps.pick_fastest()
        else:
            try:
                lap_number = int(request.lap)
                lap_df = driver_laps[driver_laps["LapNumber"] == lap_number]
                if lap_df.empty:
                    raise HTTPException(status_code=404, detail=f"Lap {lap_number} not found for driver {request.driver}")
                lap = lap_df.iloc[0]
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid lap identifier: {request.lap}")
        
        if lap is None or (hasattr(lap, 'empty') and lap.empty):
            raise HTTPException(status_code=404, detail="No valid lap found")
        
        # Get telemetry for the lap
        telemetry = lap.get_telemetry()
        
        if telemetry is None or telemetry.empty:
            raise HTTPException(status_code=404, detail="No telemetry data available for this lap")

        # Get Circuit Info (Corners)
        corners_data = []
        try:
            circuit_info = session.get_circuit_info()
            if circuit_info is not None and hasattr(circuit_info, 'corners'):
                corners_df = circuit_info.corners
                if corners_df is not None and not corners_df.empty:
                    # Select relevant columns
                    corners_df = corners_df[['Number', 'Distance', 'Letter', 'Angle']]
                    corners_data = df_to_json(corners_df)
        except Exception as e:
            print(f"Warning: Failed to fetch circuit info: {e}")
            # Non-critical, continue without corners
        
        # Filter channels
        telemetry = filter_telemetry_channels(telemetry, request.channels)
        
        # Downsample
        telemetry, original_count = downsample_telemetry(telemetry, request.downsample)
        
        # COST PROTECTION: Enforce hard cap on telemetry points
        if len(telemetry) > MAX_TELEMETRY_POINTS:
            # Further downsample to meet hard cap
            reduction_factor = int(np.ceil(len(telemetry) / MAX_TELEMETRY_POINTS))
            telemetry = telemetry.iloc[::reduction_factor].copy()
        
        # Convert to JSON
        data = df_to_json(telemetry)
        
        return TelemetryResponse(
            driver=request.driver,
            lap_number=int(lap.get("LapNumber", 0)) if hasattr(lap, 'get') else int(lap["LapNumber"]),
            lap_time=format_timedelta(lap.get("LapTime") if hasattr(lap, 'get') else lap["LapTime"]),
            data=data,
            corners=corners_data,
            total_points=len(data),
            downsampled_from=original_count
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# G. Car Data Endpoint
# =============================================================================


@app.post("/f1/car-data", response_model=CarDataResponse)
async def get_car_data(request: CarDataRequest):
    """
    Get car data (speed, gear, DRS, RPM, throttle, brake) for a driver.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        # Get driver number
        driver_info = session.get_driver(request.driver)
        if driver_info is None:
            raise HTTPException(status_code=404, detail=f"Driver {request.driver} not found")
        
        driver_number = str(driver_info.get("DriverNumber", request.driver))
        
        # Get car data from session
        if session.car_data is None or driver_number not in session.car_data:
            raise HTTPException(status_code=404, detail=f"No car data available for driver {request.driver}")
        
        car_data = session.car_data[driver_number]
        
        # If a specific lap is requested, filter to that lap
        lap_number = None
        if request.lap:
            driver_laps = session.laps.pick_drivers(request.driver)
            
            if request.lap == "fastest":
                lap = driver_laps.pick_fastest()
            else:
                lap_number = int(request.lap)
                lap_df = driver_laps[driver_laps["LapNumber"] == lap_number]
                if lap_df.empty:
                    raise HTTPException(status_code=404, detail=f"Lap {lap_number} not found")
                lap = lap_df.iloc[0]
            
            if lap is not None and not (hasattr(lap, 'empty') and lap.empty):
                lap_number = int(lap.get("LapNumber", 0) if hasattr(lap, 'get') else lap["LapNumber"])
                telemetry = lap.get_car_data()
                if telemetry is not None and not telemetry.empty:
                    car_data = telemetry
        
        # Downsample
        car_data, original_count = downsample_telemetry(car_data, 10)
        
        # Convert to JSON
        data = df_to_json(car_data)
        
        return CarDataResponse(
            driver=request.driver,
            lap_number=lap_number,
            data=data,
            total_points=len(data)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# H. Weather Data Endpoint
# =============================================================================


@app.post("/f1/weather", response_model=WeatherResponse)
async def get_weather(request: WeatherRequest):
    """
    Get weather data for a session.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        if session.weather_data is None or session.weather_data.empty:
            return {
                "session_name": session.name,
                "data": []
            }
        
        weather = session.weather_data.copy()
        
        # Rename columns to more friendly names
        column_map = {
            "Time": "time",
            "AirTemp": "air_temp",
            "TrackTemp": "track_temp",
            "Humidity": "humidity",
            "Pressure": "pressure",
            "WindSpeed": "wind_speed",
            "WindDirection": "wind_direction",
            "Rainfall": "rainfall"
        }
        
        # Only rename columns that exist
        rename_cols = {k: v for k, v in column_map.items() if k in weather.columns}
        weather = weather.rename(columns=rename_cols)
        
        data = df_to_json(weather)
        
        return {
            "session_name": session.name,
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# I. Race Control & Track Status Endpoints
# =============================================================================


@app.post("/f1/race-control", response_model=RaceControlResponse)
async def get_race_control(request: RaceControlRequest):
    """
    Get race control messages (flags, penalties, etc.).
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        if session.race_control_messages is None or session.race_control_messages.empty:
            return {
                "session_name": session.name,
                "messages": []
            }
        
        messages = df_to_json(session.race_control_messages)
        
        return {
            "session_name": session.name,
            "messages": messages
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/track-status", response_model=TrackStatusResponse)
async def get_track_status(request: TrackStatusRequest):
    """
    Get track status data (flags, SC, VSC, etc.).
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        
        if session.track_status is None or session.track_status.empty:
            return {
                "session_name": session.name,
                "status": []
            }
        
        status_data = session.track_status.copy()
        
        # Add human-readable status description
        if "Status" in status_data.columns:
            status_data["StatusDescription"] = status_data["Status"].apply(get_track_status_description)
        
        data = df_to_json(status_data)
        
        return {
            "session_name": session.name,
            "status": data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# J. Tyre & Strategy Endpoints
# =============================================================================


@app.post("/f1/tyres", response_model=TyresResponse)
async def get_tyres(request: TyresRequest):
    """
    Get tyre information for the session.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        laps = session.laps
        
        if request.driver:
            laps = laps.pick_drivers(request.driver)
        
        # Get unique tyre info per driver per stint
        tyre_data = []
        if not laps.empty:
            grouped = laps.groupby(["Driver", "Stint"])
            
            for (driver, stint), group in grouped:
                first_lap = group.iloc[0]
                tyre_info = {
                    "driver": sanitize_value(driver),
                    "stint": sanitize_value(stint),
                    "compound": sanitize_value(first_lap.get("Compound")),
                    "tyre_life_start": sanitize_value(first_lap.get("TyreLife")),
                    "fresh_tyre": sanitize_value(first_lap.get("FreshTyre")),
                    "laps_in_stint": len(group),
                    "first_lap": sanitize_value(group["LapNumber"].min()),
                    "last_lap": sanitize_value(group["LapNumber"].max()),
                }
                tyre_data.append(tyre_info)
        
        return {
            "session_name": session.name,
            "tyres": tyre_data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/f1/stints", response_model=StintsResponse)
async def get_stints(request: StintsRequest):
    """
    Get stint data including compound, length, and pit stops.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        laps = session.laps
        
        if request.driver:
            laps = laps.pick_drivers(request.driver)
        
        stint_data = []
        if not laps.empty:
            grouped = laps.groupby(["Driver", "Stint"])
            
            for (driver, stint), group in grouped:
                first_lap = group.iloc[0]
                last_lap = group.iloc[-1]
                
                # Get lap times (excluding pit laps)
                lap_times = group[group["PitInTime"].isna() & group["PitOutTime"].isna()]["LapTime"]
                avg_lap_time = lap_times.mean() if not lap_times.empty else None
                
                stint_info = {
                    "driver": sanitize_value(driver),
                    "stint_number": sanitize_value(stint),
                    "compound": sanitize_value(first_lap.get("Compound")),
                    "fresh_tyre": sanitize_value(first_lap.get("FreshTyre")),
                    "tyre_age_at_start": sanitize_value(first_lap.get("TyreLife")),
                    "laps_completed": len(group),
                    "first_lap_number": sanitize_value(group["LapNumber"].min()),
                    "last_lap_number": sanitize_value(group["LapNumber"].max()),
                    "pit_out_time": format_timedelta(first_lap.get("PitOutTime")),
                    "pit_in_time": format_timedelta(last_lap.get("PitInTime")),
                    "average_lap_time": format_timedelta(avg_lap_time),
                }
                stint_data.append(stint_info)
        
        return {
            "session_name": session.name,
            "stints": stint_data
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# K. Driver & Team Info Endpoints
# =============================================================================


@app.get("/f1/drivers", response_model=DriversResponse)
async def get_drivers(
    year: int = Query(..., ge=2018, le=2025),
    gp: Optional[str] = Query(None, description="Grand Prix name (optional, defaults to first race)")
):
    """
    Get list of drivers for a season/event.
    """
    try:
        # Get the first event if no GP specified
        if gp is None:
            schedule = get_event_schedule(year)
            if schedule.empty:
                raise HTTPException(status_code=404, detail=f"No events found for {year}")
            gp = schedule.iloc[0]["EventName"]
        
        session = await get_session(year, gp, "R")
        
        drivers = []
        for _, driver in session.results.iterrows():
            driver_info = {
                "driver_number": sanitize_value(driver.get("DriverNumber")),
                "broadcast_name": sanitize_value(driver.get("BroadcastName")),
                "abbreviation": sanitize_value(driver.get("Abbreviation")),
                "team_name": sanitize_value(driver.get("TeamName")),
                "team_color": sanitize_value(driver.get("TeamColor")),
                "first_name": sanitize_value(driver.get("FirstName")),
                "last_name": sanitize_value(driver.get("LastName")),
                "full_name": sanitize_value(driver.get("FullName")),
                "country_code": sanitize_value(driver.get("CountryCode")),
            }
            drivers.append(driver_info)
        
        return {
            "year": year,
            "gp": gp,
            "drivers": drivers
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/f1/teams", response_model=TeamsResponse)
async def get_teams(
    year: int = Query(..., ge=2018, le=2025),
    gp: Optional[str] = Query(None, description="Grand Prix name (optional, defaults to first race)")
):
    """
    Get list of teams for a season/event.
    """
    try:
        # Get the first event if no GP specified
        if gp is None:
            schedule = get_event_schedule(year)
            if schedule.empty:
                raise HTTPException(status_code=404, detail=f"No events found for {year}")
            gp = schedule.iloc[0]["EventName"]
        
        session = await get_session(year, gp, "R")
        
        # Group drivers by team
        teams_dict = {}
        for _, driver in session.results.iterrows():
            team_name = str(driver.get("TeamName", "Unknown"))
            if team_name not in teams_dict:
                teams_dict[team_name] = {
                    "team_name": team_name,
                    "team_color": sanitize_value(driver.get("TeamColor")),
                    "drivers": []
                }
            teams_dict[team_name]["drivers"].append(sanitize_value(driver.get("Abbreviation")))
        
        teams = list(teams_dict.values())
        
        return {
            "year": year,
            "gp": gp,
            "teams": teams
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
