"""
Utility functions for Fast-F1 API.
Handles DataFrame conversion, telemetry downsampling, and data sanitization.
"""

import numpy as np
import pandas as pd
from datetime import timedelta
from typing import Any, Dict, List, Optional, Union


def df_to_json(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Convert a pandas DataFrame to a JSON-serializable list of dicts.
    Handles NaN, NaT, timedelta, and other non-serializable types.
    """
    if df is None or df.empty:
        return []
    
    # Create a copy to avoid modifying the original
    result = df.copy()
    
    # Convert timedelta columns to string representation
    for col in result.columns:
        if pd.api.types.is_timedelta64_dtype(result[col]):
            result[col] = result[col].apply(format_timedelta)
        elif pd.api.types.is_datetime64_any_dtype(result[col]):
            result[col] = result[col].apply(lambda x: x.isoformat() if pd.notna(x) else None)
    
    # Replace NaN/NaT with None
    result = result.replace({np.nan: None, pd.NaT: None})
    
    # Convert to records
    records = result.to_dict(orient="records")
    
    # Final sanitization pass
    return [sanitize_dict(record) for record in records]


def sanitize_dict(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively sanitize a dictionary for JSON serialization.
    """
    result = {}
    for key, value in d.items():
        result[key] = sanitize_value(value)
    return result


def sanitize_value(value: Any) -> Any:
    """
    Sanitize a single value for JSON serialization.
    Includes precision reduction for floats (2 decimal places) to reduce token usage.
    """
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value) or np.isinf(value):
            return None
        # Precision reduction: round to 2 decimal places for token efficiency
        return round(float(value), 2)
    if isinstance(value, float):
        if np.isnan(value) or np.isinf(value):
            return None
        # Precision reduction for native Python floats too
        return round(value, 2)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, pd.Timedelta):
        return format_timedelta(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat() if pd.notna(value) else None
    if isinstance(value, timedelta):
        return format_timedelta(pd.Timedelta(value))
    if isinstance(value, dict):
        return sanitize_dict(value)
    if isinstance(value, (list, tuple)):
        return [sanitize_value(v) for v in value]
    if pd.isna(value):
        return None
    return value


def format_timedelta(td: Optional[pd.Timedelta]) -> Optional[str]:
    """
    Format a timedelta to a lap time string (MM:SS.mmm or SS.mmm).
    Returns None for NaT/None values.
    """
    if td is None or pd.isna(td):
        return None
    
    total_seconds = td.total_seconds()
    if total_seconds < 0:
        return None
    
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    
    if minutes > 0:
        return f"{minutes}:{seconds:06.3f}"
    else:
        return f"{seconds:.3f}"


def downsample_telemetry(
    df: pd.DataFrame,
    factor: int = 10,
    max_rows: int = 5000
) -> tuple[pd.DataFrame, int]:
    """
    Downsample telemetry data to reduce response size.
    
    Args:
        df: Telemetry DataFrame
        factor: Downsample factor (take every Nth row)
        max_rows: Maximum number of rows in output
        
    Returns:
        Tuple of (downsampled DataFrame, original row count)
    """
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
