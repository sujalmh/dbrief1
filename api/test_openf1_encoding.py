#!/usr/bin/env python3
"""Test different URL encoding strategies for OpenF1 API."""

import requests
import httpx
import asyncio

SESSION_KEY = 9158
DRIVER = 1

# Test 1: Using requests with different param formats
print("=" * 60)
print("TEST 1: Using requests library")
print("=" * 60)

# Test with URL-encoded key
url1 = f"https://api.openf1.org/v1/car_data?session_key={SESSION_KEY}&driver_number={DRIVER}&speed%3E%3D=300"
print(f"\nTest 1a: URL-encoded >= in key")
print(f"URL: {url1}")
try:
    resp = requests.get(url1)
    print(f"Status: {resp.status_code}")
    if resp.ok:
        data = resp.json()
        print(f"Results: {len(data)}")
    else:
        print(f"Error: {resp.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Test using requests params dict
print(f"\nTest 1b: Using requests params dict")
try:
    resp = requests.get("https://api.openf1.org/v1/car_data", params={
        "session_key": SESSION_KEY,
        "driver_number": DRIVER,
        "speed>=": 300
    })
    print(f"URL: {resp.url}")
    print(f"Status: {resp.status_code}")
    if resp.ok:
        data = resp.json()
        print(f"Results: {len(data)}")
    else:
        print(f"Error: {resp.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Test 2: Using httpx
print("\n" + "=" * 60)
print("TEST 2: Using httpx library synchronously")
print("=" * 60)

print(f"\nTest 2a: Using httpx params dict")
try:
    with httpx.Client() as client:
        resp = client.get("https://api.openf1.org/v1/car_data", params={
            "session_key": SESSION_KEY,
            "driver_number": DRIVER,
            "speed>=": 300
        })
        print(f"URL: {resp.url}")
        print(f"Status: {resp.status_code}")
        if resp.is_success:
            data = resp.json()
            print(f"Results: {len(data)}")
        else:
            print(f"Error: {resp.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Test 3: Manual URL construction
print("\n" + "=" * 60)
print("TEST 3: Manual URL construction")
print("=" * 60)

url3 = f"https://api.openf1.org/v1/car_data?session_key={SESSION_KEY}&driver_number={DRIVER}&speed>=300"
print(f"\nTest 3a: Literal >= in URL")
print(f"URL: {url3}")
try:
    resp = requests.get(url3)
    print(f"Status: {resp.status_code}")
    if resp.ok:
        data = resp.json()
        print(f"Results: {len(data)}")
    else:
        print(f"Error: {resp.text[:200]}")
except Exception as e:
    print(f"Exception: {e}")

# Test without any filter to see what values exist
print("\n" + "=" * 60)
print("TEST 4: Sample data without filter")
print("=" * 60)
try:
    resp = requests.get("https://api.openf1.org/v1/car_data", params={
        "session_key": SESSION_KEY,
        "driver_number": DRIVER
    })
    if resp.ok:
        data = resp.json()
        print(f"Total records: {len(data)}")
        if data:
            speeds = [d.get('speed') for d in data if d.get('speed') is not None]
            if speeds:
                print(f"Speed range: {min(speeds)} - {max(speeds)}")
                high_speeds = [s for s in speeds if s >= 300]
                print(f"Records with speed >= 300: {len(high_speeds)}")
except Exception as e:
    print(f"Exception: {e}")
