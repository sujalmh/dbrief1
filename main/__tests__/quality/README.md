# Managed answer-quality suite (P0)

This is a test-only regression harness for the managed flash model. It runs the
real quick pipeline (planner -> executor -> responder) against the local FastAPI
service. It does not add a runtime verifier or a new pipeline layer.

## What it runs

- Managed mode only, via `getPlannerModel` and `getResponderModel`.
- A stable OpenCode session id: `f1-quality-managed-suite`.
- Allowed models: `deepseek-v4.1-flash` and `mimo-v2.6-flash`.
- The normal-path tool registry: FastAPI tools, regulation retrieval, and
  simulation. Web search is unavailable so every fact is grounded in FastAPI.
- The same responder prompt, context aggregation, refusal path, and temporal
  anchoring used by `app/api/chat/route.ts`.

The suite does not start Next dev and does not call the authenticated
`/api/chat` route.

## Run

Start FastAPI from `api/` if it is not already running. For the full 25-prompt
run, cap the in-memory session cache so memory stays bounded:

```powershell
$env:SESSION_CACHE_MAX_SIZE = "1"
S:\f1\api\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Stop the service after the run. The suite does not start or stop it.

Then run from `main/`:

```powershell
npm run test:quality:managed
```

Last full run: 2026-10-26, 23/25 passed. The two failures are the known
items below.

The suite skips with a clear message when `OPENCODE_GO_API_KEY` is not set or
when `F1_API_URL` (default `http://localhost:8000`) is not reachable. It fails
when the configured managed model is outside the allowed flash-only set.

Every case records the prompt, plan, tool calls, answer, expected fact, and
failure list in:

```text
main/.e2e-logs/quality-managed-latest.json
```

## Coverage (25 prompts)

Recency (8):

- Last race winner, team, P2/P3, and P1-P2 gap.
- Last-race anchoring with the phrase "last F1 race".
- Next race and date.
- Current driver standings and constructor standings, including gaps.

Named race (10, stable historical data):

- 2024 British Grand Prix podium, winning time, and P1-P2 gap.
- 2024 British qualifying pole and front row.
- 2024 British fastest lap.
- Every Hamilton lap, including lap 1 and lap 52.
- 2024 British weather.
- 2024 British tyre strategy.
- 2024 Austrian stewards' penalties.

Historical (3):

- 1994 drivers' championship.
- 1950 British Grand Prix.
- Pre-2018 telemetry refusal.

Guardrails and missing data (4):

- Deterministic off-topic refusal.
- Missing sprint session.
- Missing driver lap data.
- Missing pre-2018 tyre compounds.

## Known failures (2026-10-26)

These are real failures, not harness errors. They are intentionally not skipped.

### 1. `historical-1994-champion`

`POST /f1/standings/drivers` returns 500 for 1994 because Ergast returns `NaN`
positions for zero-point rows and `api/main.py` converts the position with
`int(entry.get("position", 0))`. The suite observes:

```text
get_driver_standings({"year":1994}) FAILED: F1 API error 500: Internal server error
```

This blocks historical championship standings until the API handles missing
positions.

### 2. `recency-last-race-f1-phrasing`

`isLastRaceQuery` in `lib/temporal.ts` requires `last` immediately followed by
`race|grand prix|gp|round|event`. The phrase "last F1 race" does not match, so
`classifyRecencyIntent` returns null and the chat route does not append the
anchored `get_race` result. The planner plans `get_events` only (it expects the
server to append the race result), so the responder receives the schedule
without a classification and correctly refuses.

The canonical "last race" prompts pass. The dedicated "last F1 race" case
fails and keeps the matcher gap visible.

## Additional observation

`POST /f1/results` with a session the event did not hold (the 2024 British
Sprint) returns 500 with `Session type 'SessionType.S' does not exist for this
event` instead of a clean 4xx or empty response. The responder sometimes gives
a precise "Data not available" answer and sometimes a generic "service
temporarily unavailable" answer. The suite accepts either as long as no sprint
result is invented, but the backend should return a clean no-session response.

## Files

- `harness.ts`: FastAPI snapshot, pipeline runner, recency anchoring, reporting.
- `cases.ts`: prompts, stable expectations, and per-case assertions.
- `managed-answer-quality.test.ts`: Vitest suite, skip gates, and summary.
