"""
Utility functions for Fast-F1 API.
Handles DataFrame conversion, telemetry downsampling, and data sanitization.
"""

import math
import re
import numpy as np
import pandas as pd
from datetime import timedelta
from typing import Any, Dict, List, Optional, Union


# =============================================================================
# Lap time parsing
# =============================================================================

# Matches strings like "1:23.456" (mm:ss.mmm), "+1.234s", "-0.500",
# "83.456" (bare seconds), or with leading optional sign.
# Note: this is the *mm:ss* form. The hh:mm:ss form is matched by
# _LAP_TIME_HMS_REGEX and disambiguated by counting colons in the
# parse function, since the same regex shape can't reliably tell which is
# which ("1:23:45" could be 1h 23m 45s OR the literal "1:23" with a
# trailing "45" — but colons settle it).
_LAP_TIME_MSS_REGEX = re.compile(
    r"^\s*([+-]?)\s*(\d+):(\d+(?:\.\d+)?)\s*s?\s*$"
)
_LAP_TIME_HMS_REGEX = re.compile(
    r"^\s*([+-]?)\s*(\d+):(\d+):(\d+(?:\.\d+)?)\s*s?\s*$"
)
_LAP_TIME_GAP_REGEX = re.compile(
    r"^\s*([+-]?)\s*(\d+(?:\.\d+)?)\s*s?\s*$"
)


def parse_lap_time(time_val: Any) -> Optional[float]:
    """
    Best-effort parser for a lap time value that may be a ``Timedelta``,
    a numeric seconds value, or a string in one of several common formats:

      - "1:23.456"          -> 83.456  (mm:ss.mmm)
      - "1:23:45.678"       -> 5025.678  (hh:mm:ss.mmm)
      - "+1.234s"           ->  1.234  (gap to leader)
      - "-0.500"            -> -0.500
      - "83.456"            -> 83.456  (bare seconds)
      - 83.456              -> 83.456  (float)
      - timedelta(0, 83, 456000) -> 83.456
      - None / NaN / ""     -> None

    Any input that cannot be interpreted returns ``None`` instead of
    raising, so callers can safely pipe untrusted strings through this
    function without try/except.
    """
    if time_val is None:
        return None

    # NaN / NaT guard for both numpy and pandas sentinels
    try:
        if pd.isna(time_val):
            return None
    except (TypeError, ValueError):
        pass

    # Native / pandas timedelta — preferred path; precise to nanoseconds
    if isinstance(time_val, (timedelta, pd.Timedelta, np.timedelta64)):
        try:
            total = pd.Timedelta(time_val).total_seconds()
        except (ValueError, OverflowError):
            return None
        if math.isnan(total) or math.isinf(total):
            return None
        return float(total)

    # Bare numeric input
    if isinstance(time_val, (int, float, np.integer, np.floating)):
        f = float(time_val)
        if math.isnan(f) or math.isinf(f):
            return None
        return f

    # String input — pick the right regex based on the number of colons
    # to avoid the classic ambiguity (e.g. "1:23:45" being misread as
    # "1 hour, 23 minutes, 45 seconds" when the intended meaning was
    # "1:23 with a trailing literal 45").
    if isinstance(time_val, str):
        s = time_val.strip()
        if not s:
            return None

        colon_count = s.count(":")
        m = None
        if colon_count == 2:
            m = _LAP_TIME_HMS_REGEX.match(s)
            if m:
                sign, hh, mm, ss = m.groups()
                try:
                    seconds = int(hh) * 3600 + int(mm) * 60 + float(ss)
                    if sign == "-":
                        seconds = -seconds
                    return seconds
                except ValueError:
                    return None
        elif colon_count == 1:
            m = _LAP_TIME_MSS_REGEX.match(s)
            if m:
                sign, mm, ss = m.groups()
                try:
                    seconds = int(mm) * 60 + float(ss)
                    if sign == "-":
                        seconds = -seconds
                    return seconds
                except ValueError:
                    return None
        else:
            # No colons — try gap / bare-seconds form first, then fall
            # back to a plain float cast.
            g = _LAP_TIME_GAP_REGEX.match(s)
            if g:
                sign, n = g.groups()
                try:
                    seconds = float(n)
                    if sign == "-":
                        seconds = -seconds
                    return seconds
                except ValueError:
                    return None
            try:
                return float(s)
            except ValueError:
                return None

        # Regex didn't match the chosen form — give up rather than guess.
        return None

    # Unknown type — return None rather than raising
    return None


def parse_gap_to_leader(value: Any) -> Optional[float]:
    """
    Parse a "gap to leader" string into seconds. F1 formats this as
    "+1.234" (ahead) or "-0.500" (behind), sometimes with an "s" suffix.
    Returns ``None`` for missing / non-numeric values (e.g. leader has
    no gap, or driver is a lap down / DNF).
    """
    if value is None or value == "":
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, float, np.integer, np.floating)):
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if isinstance(value, str):
        s = value.strip().rstrip("s").strip()
        if not s or s.upper() in {"DNF", "DNS", "DSQ", "NC", "LAP"}:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def df_to_json(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Convert a pandas DataFrame to a JSON-serializable list of dicts.
    Handles NaN, NaT, timedelta, numpy scalars, and other non-serializable types.

    The conversion is defensive: every value passes through ``sanitize_value``
    before reaching the output, so non-JSON-native types (numpy scalars, NaT,
    pd.Timedelta, numpy timedelta64, bytes, ...) are normalized to safe
    primitives or ``None``.
    """
    if df is None or df.empty:
        return []

    # Create a copy to avoid modifying the original
    result = df.copy()

    # Convert timedelta columns to string representation. Doing this *before*
    # the NaN/NaT replace is required because pd.NaT in a timedelta column
    # round-trips through ``replace`` only on the dtype-aware path; converting
    # first sidesteps that and gives a consistent string format.
    for col in result.columns:
        if pd.api.types.is_timedelta64_dtype(result[col]):
            result[col] = result[col].apply(format_timedelta)
        elif pd.api.types.is_datetime64_any_dtype(result[col]):
            result[col] = result[col].apply(
                lambda x: x.isoformat() if pd.notna(x) else None
            )

    # Replace NaN/NaT with None so JSON output is valid (JSON has no NaN/Inf)
    result = result.replace({np.nan: None, pd.NaT: None})

    # Convert to records, then run each value through sanitize_value to catch
    # anything that survived (numpy scalars, nested types, etc.).
    records = result.to_dict(orient="records")
    return [sanitize_dict(record) for record in records]


def sanitize_dict(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively sanitize a dictionary for JSON serialization.
    """
    result = {}
    for key, value in d.items():
        try:
            result[key] = sanitize_value(value)
        except Exception:
            # Defensive: if any value can't be coerced, return its string form
            # (still better than raising during response serialization) and
            # fall back to None for un-coercible cases.
            try:
                result[key] = str(value)
            except Exception:
                result[key] = None
    return result


def sanitize_value(value: Any) -> Any:
    """
    Sanitize a single value for JSON serialization.

    Floats are rounded to 2 decimal places to keep response payloads
    (and downstream LLM token counts) small. ``NaN``/``Inf`` are mapped to
    ``None`` so the response is valid JSON.
    """
    if value is None:
        return None
    # numpy integer / unsigned integer / bool
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    # numpy float: handle NaN/Inf then round
    if isinstance(value, np.floating):
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 2)
    # native Python float
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 2)
    # numpy timedelta64 (must come *before* pd.Timedelta check below for the
    # case where a numpy scalar slipped through a column that wasn't a
    # timedelta64 dtype — e.g. an object-dtype column).
    if isinstance(value, np.timedelta64):
        return format_timedelta(pd.Timedelta(value))
    # pandas Timestamp / datetime
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.isoformat()
    # pandas Timedelta
    if isinstance(value, pd.Timedelta):
        return format_timedelta(value)
    # native datetime.timedelta
    if isinstance(value, timedelta):
        return format_timedelta(pd.Timedelta(value))
    # numpy arrays (e.g. corner Distance/Angle)
    if isinstance(value, np.ndarray):
        return [sanitize_value(v) for v in value.tolist()]
    # bytes -> utf-8 string with lossless fallback
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    # recursive containers
    if isinstance(value, dict):
        return sanitize_dict(value)
    if isinstance(value, (list, tuple, set, frozenset)):
        return [sanitize_value(v) for v in value]
    # Final NaN/NaT guard for anything else (strings, ints, custom objects).
    # ``pd.isna`` returns True for NaN, NaT, None, and pandas nullable NA.
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        # Objects that don't support isna (e.g. arbitrary user types) fall
        # through to a string representation so the response stays serializable.
        try:
            return str(value)
        except Exception:
            return None
    return value


def format_timedelta(td: Optional[Any]) -> Optional[str]:
    """
    Format a timedelta to a lap time string (MM:SS.mmm or SS.mmm).
    Returns None for NaT/None/negative durations.

    Accepts ``pd.Timedelta``, ``datetime.timedelta``, and ``np.timedelta64``
    for ergonomics when handling values pulled from heterogeneous DataFrame
    columns.
    """
    if td is None:
        return None
    # Coerce numpy timedelta64 / datetime.timedelta / pd.Timedelta into
    # a single pd.Timedelta for consistent math.
    if isinstance(td, np.timedelta64):
        try:
            td = pd.Timedelta(td)
        except (ValueError, OverflowError):
            return None
    elif isinstance(td, timedelta) and not isinstance(td, pd.Timedelta):
        td = pd.Timedelta(td)

    if pd.isna(td):
        return None

    try:
        total_seconds = td.total_seconds()
    except (AttributeError, TypeError, ValueError):
        return None
    if total_seconds < 0 or math.isnan(total_seconds) or math.isinf(total_seconds):
        return None

    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60

    if minutes > 0:
        return f"{minutes}:{seconds:06.3f}"
    return f"{seconds:.3f}"


def _env_int(name: str, fallback: int) -> int:
    import os
    try:
        raw = os.getenv(name)
        if raw is None or raw == "":
            return fallback
        return int(raw)
    except (TypeError, ValueError):
        return fallback


def downsample_telemetry(
    df: pd.DataFrame,
    factor: int = 10,
    max_rows: int | None = None
) -> tuple[pd.DataFrame, int]:
    """
    Downsample telemetry data to reduce response size.

    Args:
        df: Telemetry DataFrame
        factor: Downsample factor (take every Nth row)
        max_rows: Maximum number of rows in output (default from
            F1_DOWNSAMPLE_MAX_ROWS env, historically 5000)

    Returns:
        Tuple of (downsampled DataFrame, original row count)
    """
    if max_rows is None:
        max_rows = _env_int("F1_DOWNSAMPLE_MAX_ROWS", 5000)
    if df is None or df.empty:
        return df, 0

    original_count = len(df)

    # Adjust factor if result would exceed max_rows
    if original_count / factor > max_rows:
        factor = max(factor, int(np.ceil(original_count / max_rows)))

    # Downsample by taking every Nth row
    downsampled = df.iloc[::factor].copy()

    return downsampled, original_count


def filter_telemetry_channels(
    df: pd.DataFrame,
    channels: Optional[List[str]] = None
) -> pd.DataFrame:
    """
    Filter telemetry DataFrame to only include specified channels.
    Always includes Distance/Time columns if present.
    """
    if df is None or df.empty:
        return df

    if channels is None:
        return df

    # Always keep these columns if they exist
    keep_columns = ["Distance", "Time", "SessionTime", "Date"]

    # Add requested channels
    for channel in channels:
        if channel not in keep_columns:
            keep_columns.append(channel)

    # Filter to columns that actually exist
    available_columns = [col for col in keep_columns if col in df.columns]

    return df[available_columns].copy()


def format_session_results(results_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Format session results DataFrame with proper column handling.
    """
    if results_df is None or results_df.empty:
        return []

    # Select relevant columns if they exist
    columns_to_include = [
        "Position", "ClassifiedPosition", "GridPosition",
        "DriverNumber", "BroadcastName", "Abbreviation", "DriverId",
        "TeamName", "TeamColor", "TeamId",
        "FirstName", "LastName", "FullName", "HeadshotUrl", "CountryCode",
        "Q1", "Q2", "Q3", "Time", "Status", "Points"
    ]

    available_columns = [col for col in columns_to_include if col in results_df.columns]
    result = results_df[available_columns].copy()

    return df_to_json(result)


def format_lap_data(laps_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Format laps DataFrame with proper column handling.
    """
    if laps_df is None or laps_df.empty:
        return []

    # Select relevant columns if they exist
    columns_to_include = [
        "Time", "Driver", "DriverNumber", "LapTime", "LapNumber",
        "Stint", "PitOutTime", "PitInTime",
        "Sector1Time", "Sector2Time", "Sector3Time",
        "Sector1SessionTime", "Sector2SessionTime", "Sector3SessionTime",
        "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST",
        "IsPersonalBest", "Compound", "TyreLife", "FreshTyre",
        "Team", "LapStartTime", "LapStartDate", "TrackStatus",
        "Position", "Deleted", "DeletedReason"
    ]

    available_columns = [col for col in columns_to_include if col in laps_df.columns]
    result = laps_df[available_columns].copy()

    return df_to_json(result)


def get_track_status_description(status_code: str) -> str:
    """
    Get human-readable description for track status code.
    """
    status_map = {
        "1": "Track Clear",
        "2": "Yellow Flag",
        "3": "Unknown",
        "4": "Safety Car",
        "5": "Red Flag",
        "6": "Virtual Safety Car",
        "7": "VSC Ending"
    }
    return status_map.get(str(status_code), f"Unknown ({status_code})")


def safe_get_attr(obj: Any, attr: str, default: Any = None) -> Any:
    """
    Safely get an attribute from an object, returning default if not found.
    """
    try:
        value = getattr(obj, attr, default)
        return sanitize_value(value)
    except Exception:
        return default
