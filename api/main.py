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
import os
import time
import logging
from collections import OrderedDict
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import secrets

import fastf1
from fastf1.ergast import Ergast
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from schemas import (
    CarDataRequest,
    CarDataResponse,
    DriverLapsRequest,
    DriverLapsResponse,
    DriversResponse,
    DriverStandingsRequest,
    DriverStandingsResponse,
    ErrorResponse,
    EventsResponse,
    EventInfo,
    GpNamesResponse,
    GpNameInfo,
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
    TelemetrySummaryResponse,
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
    sanitize_value,
)

# =============================================================================
# Cost Protection Configuration
# =============================================================================

from datetime import datetime

# Allow a small future window so users can ask about the next scheduled
# race weekend. The actual gate for "live" data is the days_diff check in
# get_session() below, not this bound.
_MAX_YEAR_BUFFER_YEARS = 2

def _get_max_season_year() -> int:
    """Largest year we will accept in API requests.

    We allow the current calendar year plus a small forward buffer so users
    can ask about the next announced season (e.g. user asks in late 2025
    about the 2026 schedule). Telemetry data only exists for completed
    sessions; the live-session gate in get_session() still blocks in-flight
    races, so the buffer is safe.
    """
    return datetime.now().year + _MAX_YEAR_BUFFER_YEARS

# Cost protection: only block sessions that are still in-flight (future or
# within the last 24 hours). Completed sessions from the current year are
# always served from the FastF1 cache.
_LIVE_SESSION_BLOCK_HOURS = 24

MAX_TELEMETRY_POINTS = 5000  # Hard cap on telemetry data points

# =============================================================================
# App Configuration
# =============================================================================

_IS_PRODUCTION = os.getenv("ENV", "development").lower() == "production"

app = FastAPI(
    title="Fast-F1 API",
    description="HTTP API exposing Fast-F1 library functionality",
    version="1.0.0",
    # Hide interactive docs in production (info disclosure + attack surface).
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
)

# =============================================================================
# API-key auth + rate limiting (cost / DoS protection)
# =============================================================================
# Set F1_API_KEY in production and configure the Next.js backend with the same
# value (F1_API_KEY env). When unset, requests are allowed (dev) with a warning.
_F1_API_KEY = os.getenv("F1_API_KEY", "")

# Simple in-process sliding-window limiter per client IP. Suitable for the
# single-worker Cloud Run deployment (workers=1); use a shared store if you
# ever scale beyond one instance.
_RATE_WINDOW_S = 60
_RATE_MAX_REQUESTS = 120
_rate_buckets: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()[:64]
        if first:
            return first
    return request.headers.get("x-real-ip", "")[:64] or (request.client.host if request.client else "anon")


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_S
    bucket = [t for t in _rate_buckets.get(ip, []) if t > cutoff]
    if len(bucket) >= _RATE_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please slow down.")
    bucket.append(now)
    _rate_buckets[ip] = bucket
    if len(_rate_buckets) > 5000:
        # Opportunistic eviction of fully-expired keys.
        expired = [k for k, v in _rate_buckets.items() if not v or v[-1] <= cutoff]
        for k in expired:
            del _rate_buckets[k]


def _check_api_key(request: Request) -> None:
    if request.url.path in ("/health", "/openapi.json"):
        return
    if request.url.path in ("/docs", "/redoc", "/openapi.json"):
        return
    if not _F1_API_KEY:
        return
    provided = request.headers.get("x-api-key", "")
    if not provided:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            provided = auth[7:].strip()
    if not provided or not secrets.compare_digest(provided, _F1_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.middleware("http")
async def _auth_rate_limit_middleware(request: Request, call_next):
    try:
        _check_api_key(request)
        if request.url.path.startswith("/f1/"):
            _check_rate_limit(_client_ip(request))
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
    return await call_next(request)


if _IS_PRODUCTION and not _F1_API_KEY:
    logger.warning("F1_API_KEY is empty in production. The /f1/* API is unauthenticated.")

# CORS middleware for cross-origin requests
# Allow origins are restricted to a configurable allowlist; credentials are not
# combined with "*" (browser-incompatible and a security misconfiguration).
_ALLOWED_ORIGINS_ENV = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _ALLOWED_ORIGINS_ENV.split(",") if o.strip()]
if not ALLOWED_ORIGINS:
    # Safe defaults for local development. In production, set ALLOWED_ORIGINS
    # to a comma-separated list of allowed origins (e.g. "https://app.example.com").
    if os.getenv("ENV", "development").lower() == "production":
        logger.warning(
            "ALLOWED_ORIGINS is empty in production. CORS will reject all "
            "cross-origin browser requests. Set ALLOWED_ORIGINS to a "
            "comma-separated list of allowed origins."
        )
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8080",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# Enable Fast-F1 disk cache (create directory if it doesn't exist)
os.makedirs("cache", exist_ok=True)
fastf1.Cache.enable_cache("cache")

# Mutex for session loading (prevent concurrent loads)
session_load_lock = asyncio.Lock()

# Bounded in-memory cache of loaded sessions to avoid repeated expensive loads.
# FastF1 session objects can each consume hundreds of MB, so we cap the cache
# size and evict the least-recently-used entry when the cap is exceeded.
_SESSION_CACHE_MAX_SIZE = int(os.getenv("SESSION_CACHE_MAX_SIZE", "8"))


def _session_cache_key(year: int, gp: str, session_type: str) -> tuple:
    return (year, str(gp).lower().strip(), str(session_type).upper().strip())


_session_cache: "OrderedDict[tuple, fastf1.core.Session]" = OrderedDict()
_session_cache_lock = asyncio.Lock()


async def _session_cache_get(key: tuple):
    async with _session_cache_lock:
        if key in _session_cache:
            _session_cache.move_to_end(key)
            return _session_cache[key]
    return None


async def _session_cache_put(key: tuple, session) -> None:
    async with _session_cache_lock:
        if key in _session_cache:
            _session_cache.move_to_end(key)
            _session_cache[key] = session
            return
        _session_cache[key] = session
        while len(_session_cache) > _SESSION_CACHE_MAX_SIZE:
            evicted_key, evicted_session = _session_cache.popitem(last=False)
            _release_session(evicted_session)
            logger.info("Evicted cached session %s (cache size=%d)", evicted_key, len(_session_cache))


def _release_session(session) -> None:
    """
    Best-effort cleanup of a FastF1 session object to free memory.

    FastF1 sessions can each hold hundreds of MB (telemetry, weather, laps,
    car data). When we evict one from the in-memory cache we drop references
    to the heavy sub-DataFrames and call gc.collect() so the OS can reclaim
    the pages.
    """
    if session is None:
        return
    try:
        # Drop heavy DataFrame attributes if present
        for attr in ("laps", "results", "weather_data", "race_control_messages",
                     "track_status", "car_data", "pos_data", "session_status"):
            try:
                if hasattr(session, attr):
                    setattr(session, attr, None)
            except Exception:
                pass
        import gc
        gc.collect()
    except Exception as cleanup_exc:  # pragma: no cover - defensive
        logger.warning("Failed to release session cleanly: %s", cleanup_exc)

# =============================================================================
# Session Management
# =============================================================================


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
    Uses a bounded in-memory cache to avoid reloading frequently used sessions
    while keeping memory usage bounded.
    """
    _validate_year(year)
    validate_gp_param(gp)
    # Fail closed on unknown GP names (see resolve_gp_name): FastF1 would
    # otherwise fuzzy-match placeholders/typos to the wrong event.
    gp = resolve_gp_name(year, gp)
    cache_key = _session_cache_key(year, gp, session_type)

    # Fast path: cache hit
    cached = await _session_cache_get(cache_key)
    if cached is not None:
        return cached

    async with session_load_lock:
        # Double-checked: another coroutine may have populated the cache while
        # we were waiting for the lock.
        cached = await _session_cache_get(cache_key)
        if cached is not None:
            return cached

        # Run the blocking load in a thread pool
        loop = asyncio.get_running_loop()
        session = await loop.run_in_executor(
            None, _load_session_sync, year, gp, session_type
        )

        # COST PROTECTION: Block only in-flight (live / future) sessions
        # for the current calendar year. Sessions that have already finished
        # are served from the FastF1 cache and cost nothing extra, so they
        # are always allowed regardless of year.
        if session.date:
            session_datetime = pd.Timestamp(session.date)
            now = pd.Timestamp.now(tz=session_datetime.tz)
            hours_diff = (session_datetime - now).total_seconds() / 3600

            # Block if session is in the future or within the last
            # _LIVE_SESSION_BLOCK_HOURS hours (i.e. still in progress / just
            # ended, where live timing data is volatile and expensive to
            # refetch).
            if hours_diff > -_LIVE_SESSION_BLOCK_HOURS:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        f"Live/in-progress sessions are disabled for cost "
                        f"protection. Session date: "
                        f"{session.date.isoformat()}"
                    ),
                )

        await _session_cache_put(cache_key, session)
        return session


_SCHEDULE_CACHE: dict[int, tuple[float, pd.DataFrame]] = {}
_SCHEDULE_TTL_S = 3600


def get_event_schedule(year: int) -> pd.DataFrame:
    """Get event schedule for a year (cached 1h to avoid upstream hammering)."""
    _validate_year(year)
    now = time.monotonic()
    cached = _SCHEDULE_CACHE.get(year)
    if cached and now - cached[0] < _SCHEDULE_TTL_S:
        return cached[1]
    schedule = fastf1.get_event_schedule(year)
    _SCHEDULE_CACHE[year] = (now, schedule)
    # Bound memory: schedules are small, but never grow without limit.
    if len(_SCHEDULE_CACHE) > 64:
        oldest = min(_SCHEDULE_CACHE, key=lambda k: _SCHEDULE_CACHE[k][0])
        del _SCHEDULE_CACHE[oldest]
    return schedule


def validate_gp_param(gp: str) -> str:
    """
    Validate a Grand Prix identifier to prevent path traversal and SQL-injection-style
    abuse. The FastF1 library treats this as a string label, but we still need to
    ensure the value cannot escape the cache directory or trigger unexpected lookups.
    """
    if not gp or not isinstance(gp, str):
        raise HTTPException(status_code=400, detail="Invalid Grand Prix identifier")
    # Reject path separators and traversal patterns
    if "/" in gp or "\\" in gp or ".." in gp or "\x00" in gp:
        raise HTTPException(
            status_code=400,
            detail="Invalid Grand Prix identifier: path separators are not allowed",
        )
    # Cap length to keep downstream lookups bounded
    if len(gp) > 128:
        raise HTTPException(status_code=400, detail="Grand Prix identifier too long")
    return gp


def _validate_year(year: int) -> int:
    """Runtime year guard (Query le=2100 is static; enforce dynamic
    current-year+buffer policy here so long processes never go stale)."""
    max_year = _get_max_season_year()
    if year < 1950 or year > max_year:
        raise HTTPException(
            status_code=422,
            detail=f"Year must be between 1950 and {max_year}",
        )
    return year


def resolve_gp_name(year: int, gp: str) -> str:
    """Resolve a user-supplied Grand Prix identifier to its canonical
    schedule EventName, or raise 404 when nothing matches.

    FastF1's get_session() fuzzy-matches unknown strings to *some* event
    instead of failing, which used to turn LLM placeholder args (e.g.
    gp="LAST_COMPLETED_GP") into confidently-wrong race data. Every
    session-loading path goes through get_session(), so validating here
    fails closed for all of them. Matching mirrors the /f1/sessions
    lookup (round number, EventName, Location, Country substrings) so
    anything that works there keeps working here.
    """
    schedule = get_event_schedule(year)
    needle = str(gp).strip().lower()
    for _, row in schedule.iterrows():
        if (
            str(row.get("RoundNumber")) == str(gp).strip()
            or (needle and needle in str(row.get("EventName", "")).lower())
            or (needle and needle in str(row.get("Location", "")).lower())
            or (needle and needle in str(row.get("Country", "")).lower())
        ):
            return str(row.get("EventName", gp))
    raise HTTPException(
        status_code=404,
        detail=(
            f"Event '{gp}' not found in the {year} schedule. "
            f"Use /f1/gp-names?year={year} to discover valid Grand Prix names."
        ),
    )

async def get_driver_lap(session: fastf1.core.Session, driver: str, lap_identifier: str):
    """
    Get a specific lap for a driver from a session.
    
    Args:
        session: Loaded F1 session
        driver: Driver code (e.g., 'VER', 'HAM')
        lap_identifier: Either 'fastest' or a lap number as string
        
    Returns:
        The requested lap (Series object)
        
    Raises:
        HTTPException: If driver or lap not found
    """
    driver_laps = session.laps.pick_drivers(driver)
    
    if driver_laps.empty:
        raise HTTPException(status_code=404, detail=f"No laps found for driver {driver}")
    
    # Get the specific lap
    if lap_identifier == "fastest":
        lap = driver_laps.pick_fastest()
    else:
        try:
            lap_number = int(lap_identifier)
            lap_df = driver_laps[driver_laps["LapNumber"] == lap_number]
            if lap_df.empty:
                raise HTTPException(status_code=404, detail=f"Lap {lap_number} not found for driver {driver}")
            lap = lap_df.iloc[0]
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid lap identifier: {lap_identifier}")
    
    if lap is None or (hasattr(lap, 'empty') and lap.empty):
        raise HTTPException(status_code=404, detail="No valid lap found")
    
    return lap
    
# =============================================================================
# K. Standings Endpoint
# =============================================================================


@app.post("/f1/standings/drivers", response_model=DriverStandingsResponse)
async def get_driver_standings(request: DriverStandingsRequest):
    """
    Get driver standings for a specific year.
    Returns the final standings for the season.
    """
    try:
        ergast = Ergast()
        # Get standings for the specified season
        # round=None implies the latest standings for that season (final if past season)
        standings = ergast.get_driver_standings(season=request.year)
        
        data = []
        if standings and standings.content:
            # content is a list of StandingsLists
            # We usually want the first one (should be only one for a season query)
            table = standings.content[0]
            
            for row in table.iterrows():
                # row is (index, Series)
                entry = row[1]
                data.append({
                    "position": int(entry.get("position", 0)),
                    "driver": str(entry.get("driverId", "")),
                    "points": float(entry.get("points", 0.0)),
                    "wins": int(entry.get("wins", 0)),
                    "team": str(entry.get("constructorId", ""))
                })
        
        if not data:
            raise HTTPException(status_code=404, detail=f"No standings found for year {request.year}")

        return {
            "year": request.year,
            "standings": data
        }
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error") from e


# =============================================================================
# Error Handlers
# =============================================================================


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    """Handle all uncaught exceptions with a safe, generic JSON response.

    The full exception details are logged server-side for debugging, but the
    client only receives a generic message so internal paths, library
    versions, and stack frames never leak through HTTP responses.
    """
    logger.error(
        "Unhandled exception for %s %s: %s",
        request.method if hasattr(request, "method") else "?",
        request.url.path if hasattr(request, "url") else "?",
        exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
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
    # The list is dynamic: 1950 (earliest season in the Ergast/FastF1
    # records) up to the current calendar year plus a small forward
    # buffer. This way the seasons list never goes stale and the LLM
    # planner never thinks the current year is "unavailable".
    end_year = _get_max_season_year()
    seasons = list(range(1950, end_year + 1))
    return {"seasons": seasons}


@app.get("/f1/events", response_model=EventsResponse)
async def get_events(year: int = Query(..., ge=1950, le=2100)):
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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/f1/gp-names", response_model=GpNamesResponse)
async def get_gp_names(year: int = Query(..., ge=1950, le=2100)):
    """
    Get canonical Grand Prix names for a specific season year.
    Returns round number, event name, location, country, and the canonical
    name accepted by get_session(). This endpoint is designed for LLM tool
    consumption — it lets the planner discover valid GP names before calling
    session-specific tools.
    """
    try:
        schedule = get_event_schedule(year)
        grand_prix = []

        for _, event in schedule.iterrows():
            event_name = str(event.get("EventName", ""))
            gp_info = GpNameInfo(
                round=int(event.get("RoundNumber", 0)),
                event_name=event_name,
                location=str(event.get("Location", "")),
                country=str(event.get("Country", "")),
                canonical=event_name,
            )
            grand_prix.append(gp_info)

        return {"year": year, "grand_prix": grand_prix}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/f1/sessions", response_model=SessionsResponse)
async def get_sessions(
    year: int = Query(..., ge=1950, le=2100),
    gp: str = Query(..., description="Grand Prix name or round number")
):
    """
    Get available sessions for a specific event.
    """
    try:
        gp = validate_gp_param(gp)
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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/f1/qualifying", response_model=ResultsResponse)
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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/f1/race", response_model=ResultsResponse)
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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/f1/laps/driver", response_model=DriverLapsResponse)
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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
        lap = await get_driver_lap(session, request.driver, request.lap)
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
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Failed to fetch circuit info: %s", e)
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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


# =============================================================================
# F2. Telemetry Summary Endpoint (LLM-Optimized)
# =============================================================================


def calculate_channel_summary(values: list) -> dict:
    """
    Calculate min/max/avg for a list of numeric values.

    NaN and None entries are filtered out before aggregation. If no usable
    values remain (empty list, all-NaN, all-None) the summary returns None
    for each field so the client can distinguish "no data" from "all zero".
    """
    clean_values: list = []
    for v in values:
        if v is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if np.isnan(fv) or np.isinf(fv):
            continue
        clean_values.append(fv)

    if not clean_values:
        return {"min": None, "max": None, "avg": None}

    return {
        "min": round(min(clean_values), 2),
        "max": round(max(clean_values), 2),
        "avg": round(sum(clean_values) / len(clean_values), 2),
    }


@app.post("/f1/telemetry/summary", response_model=TelemetrySummaryResponse)
async def get_telemetry_summary(request: TelemetryRequest):
    """
    Get a statistical summary of telemetry data for LLM consumption.
    Returns aggregated stats instead of raw data points.
    Much more token-efficient for LLM context.
    """
    try:
        session = await get_session(request.year, request.gp, request.session)
        lap = await get_driver_lap(session, request.driver, request.lap)
        telemetry = lap.get_telemetry()
        
        if telemetry is None or telemetry.empty:
            raise HTTPException(status_code=404, detail="No telemetry data available for this lap")
        
        # Extract lap metadata
        lap_number = int(lap.get("LapNumber", 0)) if hasattr(lap, 'get') else int(lap["LapNumber"])
        lap_time = format_timedelta(lap.get("LapTime") if hasattr(lap, 'get') else lap["LapTime"])
        compound = str(lap.get("Compound", "")) if pd.notna(lap.get("Compound")) else None
        tyre_life = int(lap.get("TyreLife", 0)) if pd.notna(lap.get("TyreLife")) else None
        
        # Calculate speed summary
        speed_values = telemetry["Speed"].tolist() if "Speed" in telemetry.columns else []
        speed_summary = calculate_channel_summary(speed_values)
        
        # Calculate throttle summary
        throttle_values = telemetry["Throttle"].tolist() if "Throttle" in telemetry.columns else []
        throttle_summary = calculate_channel_summary(throttle_values)
        
        # Calculate brake summary
        brake_values = telemetry["Brake"].tolist() if "Brake" in telemetry.columns else []
        brake_summary = calculate_channel_summary(brake_values)
        
        # Get corner minimum speeds (if corners data available)
        corner_min_speeds = None
        try:
            circuit_info = session.get_circuit_info()
            if circuit_info is not None and hasattr(circuit_info, 'corners'):
                corners_df = circuit_info.corners
                if corners_df is not None and not corners_df.empty and "Distance" in telemetry.columns:
                    corner_speeds = []
                    distances = telemetry["Distance"].values
                    speeds = telemetry["Speed"].values if "Speed" in telemetry.columns else None
                    
                    if speeds is not None:
                        for _, corner in corners_df.iterrows():
                            corner_dist = corner.get("Distance", 0)
                            # Find speed at corner (within 20m)
                            mask = np.abs(distances - corner_dist) < 20
                            if np.any(mask):
                                corner_speed = float(np.min(speeds[mask]))
                                corner_speeds.append({
                                    "corner": int(corner.get("Number", 0)),
                                    "letter": str(corner.get("Letter", "")),
                                    "min_speed": round(corner_speed, 1)
                                })
                    corner_min_speeds = corner_speeds
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Failed to calculate corner speeds: %s", e)
            # Non-critical, continue without corners
        
        # Not real sector formula used in F1, consider changing in future
        sector_speeds = None
        if "Distance" in telemetry.columns and "Speed" in telemetry.columns:
            max_dist = telemetry["Distance"].max()
            if max_dist > 0:
                s1_mask = telemetry["Distance"] <= max_dist / 3
                s2_mask = (telemetry["Distance"] > max_dist / 3) & (telemetry["Distance"] <= 2 * max_dist / 3)
                s3_mask = telemetry["Distance"] > 2 * max_dist / 3
                
                sector_speeds = {
                    "sector1_avg_speed": round(float(telemetry.loc[s1_mask, "Speed"].mean()), 1) if s1_mask.any() else 0,
                    "sector2_avg_speed": round(float(telemetry.loc[s2_mask, "Speed"].mean()), 1) if s2_mask.any() else 0,
                    "sector3_avg_speed": round(float(telemetry.loc[s3_mask, "Speed"].mean()), 1) if s3_mask.any() else 0,
                }
        
        return TelemetrySummaryResponse(
            driver=request.driver,
            lap_number=lap_number,
            lap_time=lap_time,
            compound=compound,
            tyre_life=tyre_life,
            speed_summary=speed_summary,
            throttle_summary=throttle_summary,
            brake_summary=brake_summary,
            corner_min_speeds=corner_min_speeds,
            sector_speeds=sector_speeds,
            total_points_analyzed=len(telemetry)
        )
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
                try:
                    lap_number = int(request.lap)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Invalid lap identifier: {request.lap}")
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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


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
    except HTTPException:
        raise
    except Exception as e:

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


# =============================================================================
# K. Driver & Team Info Endpoints
# =============================================================================


@app.get("/f1/drivers", response_model=DriversResponse)
async def get_drivers(
    year: int = Query(..., ge=1950, le=2100),
    gp: Optional[str] = Query(None, description="Grand Prix name (optional, defaults to first race)")
):
    """
    Get list of drivers for a season/event.
    For pre-2018 years, uses Ergast API.
    """
    try:
        # For pre-2018, use Ergast API
        if year < 2018:
            ergast = Ergast()
            if gp is not None:
                gp = validate_gp_param(gp)
            
            # Get drivers for the season
            try:
                drivers_data = ergast.get_driver_info(season=year)
                
                drivers = []
                if drivers_data is not None and hasattr(drivers_data, 'content'):
                    for _, driver_row in drivers_data.content[0].iterrows():
                        driver_info = {
                            "driver_number": None,  # Not available in Ergast
                            "broadcast_name": f"{driver_row.get('givenName', '')} {driver_row.get('familyName', '')}",
                            "abbreviation": driver_row.get('code', driver_row.get('driverId', '')[:3].upper()),
                            "team_name": None,  # Would need race results to get team
                            "team_color": None,
                            "first_name": driver_row.get('givenName', ''),
                            "last_name": driver_row.get('familyName', ''),
                            "full_name": f"{driver_row.get('givenName', '')} {driver_row.get('familyName', '')}",
                            "country_code": driver_row.get('nationality', '')[:3].upper() if pd.notna(driver_row.get('nationality')) else None,
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

                logger.error(f"An unexpected error occurred: {e}", exc_info=True)

                raise HTTPException(status_code=500, detail="Internal server error")
        
        # For 2018+, use FastF1 (original logic)
        # Get the first event if no GP specified
        if gp is None:
            schedule = get_event_schedule(year)
            if schedule.empty:
                raise HTTPException(status_code=404, detail=f"No events found for {year}")
            gp = schedule.iloc[0]["EventName"]
        else:
            gp = validate_gp_param(gp)

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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/f1/teams", response_model=TeamsResponse)
async def get_teams(
    year: int = Query(..., ge=1950, le=2100),
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
        else:
            gp = validate_gp_param(gp)

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

        logger.error(f"An unexpected error occurred: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail="Internal server error")


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
