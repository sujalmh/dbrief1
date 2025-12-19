"""
Test script to verify historical F1 data availability before 2018.
Tests both FastF1's Ergast module and direct jolpica-f1 API access.
"""

import fastf1
from fastf1.ergast import Ergast
import requests
from datetime import datetime

# Enable cache
fastf1.Cache.enable_cache("cache")

def test_ergast_module(years):
    """Test FastF1's Ergast module for historical data."""
    print("\n" + "="*60)
    print("Testing FastF1 Ergast Module")
    print("="*60)
    
    ergast = Ergast()
    
    for year in years:
        print(f"\n📅 Testing Year: {year}")
        print("-" * 40)
        
        try:
            # Test driver standings
            standings = ergast.get_driver_standings(season=year)
            if standings and standings.content:
                table = standings.content[0]
                print(f"✅ Driver Standings: Found {len(table)} drivers")
                
                # Show top 3
                for idx, (_, row) in enumerate(table.head(3).iterrows()):
                    print(f"   {idx+1}. {row.get('givenName', '')} {row.get('familyName', '')} - {row.get('points', 0)} pts")
            else:
                print(f"❌ Driver Standings: No data")
                
        except Exception as e:
            print(f"❌ Driver Standings Error: {e}")
        
        try:
            # Test race results
            results = ergast.get_race_results(season=year, round=1)
            if results and results.content:
                print(f"✅ Race Results: Round 1 data available")
                race_data = results.content[0]
                print(f"   Race: {race_data.iloc[0].get('raceName', 'Unknown')}")
                print(f"   Winner: {race_data.iloc[0].get('givenName', '')} {race_data.iloc[0].get('familyName', '')}")
            else:
                print(f"❌ Race Results: No data")
        except Exception as e:
            print(f"❌ Race Results Error: {e}")

def test_jolpica_api(years):
    """Test jolpica-f1 API directly."""
    print("\n" + "="*60)
    print("Testing jolpica-f1 API Directly")
    print("="*60)
    
    base_url = "https://api.jolpi.ca/ergast/f1"
    
    for year in years:
        print(f"\n📅 Testing Year: {year}")
        print("-" * 40)
        
        # Test drivers endpoint
        try:
            response = requests.get(f"{base_url}/{year}/drivers.json", timeout=10)
            if response.status_code == 200:
                data = response.json()
                driver_count = data['MRData']['DriverTable']['total']
                print(f"✅ Drivers: {driver_count} drivers found")
            else:
                print(f"❌ Drivers: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Drivers Error: {e}")
        
        # Test standings endpoint
        try:
            response = requests.get(f"{base_url}/{year}/driverStandings.json", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data['MRData']['StandingsTable']['StandingsLists']:
                    standings = data['MRData']['StandingsTable']['StandingsLists'][0]['DriverStandings']
                    print(f"✅ Standings: {len(standings)} entries")
                    # Show champion
                    if standings:
                        champion = standings[0]
                        print(f"   Champion: {champion['Driver']['givenName']} {champion['Driver']['familyName']} ({champion['points']} pts)")
                else:
                    print(f"❌ Standings: No data")
            else:
                print(f"❌ Standings: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Standings Error: {e}")
        
        # Test race results
        try:
            response = requests.get(f"{base_url}/{year}/1/results.json", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data['MRData']['RaceTable']['Races']:
                    race = data['MRData']['RaceTable']['Races'][0]
                    print(f"✅ Race Results: {race['raceName']}")
                    winner = race['Results'][0]
                    print(f"   Winner: {winner['Driver']['givenName']} {winner['Driver']['familyName']}")
                else:
                    print(f"❌ Race Results: No data")
            else:
                print(f"❌ Race Results: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Race Results Error: {e}")

def main():
    print("\n" + "="*60)
    print("F1 Historical Data Availability Test")
    print(f"Testing pre-2018 seasons with jolpica-f1 API")
    print(f"Run at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    
    # Test various years before 2018
    test_years = [2017, 2015, 2010, 2005, 2000, 1995, 1990, 1985, 1980, 1975, 1970, 1960, 1950]
    
    # Test FastF1's Ergast module
    test_ergast_module(test_years)
    
    # Test jolpica-f1 API directly
    test_jolpica_api(test_years)
    
    print("\n" + "="*60)
    print("Test Complete!")
    print("="*60)

if __name__ == "__main__":
    main()
