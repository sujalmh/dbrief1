# Fast-F1 API Microservice

A comprehensive FastAPI microservice exposing all Fast-F1 library functionality as clean, structured HTTP APIs.

## Features

- **JSON-only responses** - No HTML, no natural language
- **Deterministic output** - Explicit schemas with Pydantic
- **Aggressive caching** - Fast-F1 disk cache + LRU memory cache
- **Automatic telemetry downsampling** - Prevents large responses
- **Cloud Run ready** - Dockerfile included

## Quick Start

### Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --reload
```

### Docker

```bash
# Build
docker build -t f1-api .

# Run
docker run -p 8080:8080 f1-api
```

## API Endpoints

### Session Discovery
- `GET /f1/seasons` - List available seasons
- `GET /f1/events?year=2024` - List events for a year
- `GET /f1/sessions?year=2024&gp=Monaco` - List sessions for an event

### Session Loading
- `POST /f1/session/load` - Load session metadata

### Results
- `POST /f1/results` - Session results
- `POST /f1/qualifying` - Qualifying results
- `POST /f1/race` - Race results

### Lap Data
- `POST /f1/laps` - All laps with filters
- `POST /f1/laps/driver` - Driver-specific laps
- `POST /f1/laps/fastest` - Fastest lap

### Telemetry
- `POST /f1/telemetry` - Telemetry data (auto-downsampled)
- `POST /f1/car-data` - Car data
- `POST /f1/sectors` - Sector times

### Weather & Track
- `POST /f1/weather` - Weather data
- `POST /f1/race-control` - Race control messages
- `POST /f1/track-status` - Track status

### Strategy
- `POST /f1/tyres` - Tyre information
- `POST /f1/stints` - Stint data

### Info
- `GET /f1/drivers?year=2024` - Driver list
- `GET /f1/teams?year=2024` - Team list

## Example Usage

```bash
# Get seasons
curl http://localhost:8000/f1/seasons

# Get events for 2024
curl "http://localhost:8000/f1/events?year=2024"

# Get telemetry for Verstappen's fastest lap in Monaco Q
curl -X POST http://localhost:8000/f1/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2024,
    "gp": "Monaco",
    "session": "Q",
    "driver": "VER",
    "lap": "fastest"
  }'
```

## License

MIT
