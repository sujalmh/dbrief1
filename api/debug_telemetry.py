
import requests
import datetime
import json

BASE_URL = "http://localhost:8000"

def debug_telemetry():
    # 1. Get Session Key
    print("Fetching sessions...")
    resp = requests.get(f"{BASE_URL}/f1/sessions", params={"year": 2023, "country_name": "Belgium", "session_name": "Race"})
    session_key = resp.json()["sessions"][0]["session_key"]
    print(f"Session Key: {session_key}")

    # 2. Get Lap 5 Data
    print("Fetching Lap 5...")
    resp = requests.post(f"{BASE_URL}/f1/laps", json={"session_key": session_key, "driver_number": 1, "lap_number": 5})
    laps = resp.json()
    print("Laps Response:", json.dumps(laps, indent=2))
    
    if not laps["laps"]:
        print("No lap data found!")
        return

    lap_data = laps["laps"][0]
    date_start = lap_data["date_start"]
    print(f"Lap Start: {date_start}")

    # 3. Try Car Data with exact window
    dt_start = datetime.datetime.fromisoformat(date_start.replace('Z', '+00:00'))
    dt_end = dt_start + datetime.timedelta(seconds=60) # Try 60 seconds
    
    print(f"Requesting Telemetry: {dt_start.isoformat()} to {dt_end.isoformat()}")
    
    payload = {
        "session_key": session_key,
        "driver_number": 1,
        "date_gte": dt_start.isoformat(),
        "date_lte": dt_end.isoformat()
    }
    
    
    # 6. Bulk Check (Belgium 2023)
    print("\n--- Bulk Check Belgium 2023 ---")
    bulk_url = f"https://api.openf1.org/v1/car_data?session_key={session_key}&driver_number=1"
    print(f"Bulk URL: {bulk_url}")
    # We won't run this to avoid massive download unless we use stream or just HEAD?
    # Actually, let's just try obtaining 1 line via date range but a DIFFERENT range
    # Or try a different session that is known to work.
    
    # 7. Bahrain 2024 Check
    print("\n--- Bahrain 2024 Check ---")
    # Bahrain 2024 Race session key?
    # Let's find it 
    try:
        s_resp = requests.get("https://api.openf1.org/v1/sessions?year=2024&country_name=Bahrain&session_name=Race")
        if s_resp.status_code == 200 and len(s_resp.json()) > 0:
            bahrain_key = s_resp.json()[0]["session_key"]
            print(f"Bahrain 2024 Race Key: {bahrain_key}")
            
            # Try speed check there
            b_url = f"https://api.openf1.org/v1/car_data?session_key={bahrain_key}&driver_number=1&speed>=300"
            print(f"Requesting: {b_url}")
            b_resp = requests.get(b_url)
            print(f"Bahrain Status: {b_resp.status_code}")
            print(f"Bahrain Count: {len(b_resp.json())}")
    except Exception as e:
        print(f"Bahrain check failed: {e}")

    # 8. Backend POST Check
    print("\n--- Backend POST Check (Port 8000) ---")
    payload = {
        "session_key": 9472,
        "driver_number": 1,
        "speed_gte": 200
    }
    try:
        r = requests.post(f"{BASE_URL}/f1/car-data", json=payload)
        print(f"Backend POST Status: {r.status_code}")
        d = r.json()
        print(f"Backend POST Count: {d.get('total_points', 'N/A')}")
    except Exception as e:
        print(f"Backend POST failed: {e}")

if __name__ == "__main__":
    debug_telemetry()
