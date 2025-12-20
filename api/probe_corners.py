
import fastf1
import pandas as pd

# Enable cache
fastf1.Cache.enable_cache('cache')

try:
    print("Loading 2023 Bahrain Qualifying...")
    session = fastf1.get_session(2023, 'Bahrain', 'Q')
    session.load(telemetry=True, weather=False, messages=False) # Load telemetry for corner mapping
    
    print("\nFetching Circuit Info...")
    circuit_info = session.get_circuit_info()
    
    if circuit_info:
        print("\nCircuit Info Found!")
        if hasattr(circuit_info, 'corners'):
            print("\nCorners Data:")
            print(circuit_info.corners.head())
            print(f"\nColumns: {circuit_info.corners.columns.tolist()}")
        else:
            print("\nNo 'corners' attribute found on circuit_info")
    else:
        print("\nNo circuit info returned")

except Exception as e:
    print(f"\nError: {e}")
