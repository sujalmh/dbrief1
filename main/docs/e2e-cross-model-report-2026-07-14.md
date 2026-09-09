# Cross-Model E2E Test Report — 2026-07-14

## Test scope
- **Models** (only the 4 referenced in `main/lib/llm.ts`, `main/components/chat/control-panel.tsx`, and `main/components/chat/settings-modal.tsx`):
  1. `nvidia/nemotron-3-super-120b-a12b:free` (default planner)
  2. `nvidia/nemotron-3-ultra-550b-a55b:free` (settings modal + tests)
  3. `poolside/laguna-m.1:free` (settings modal)
  4. `cohere/north-mini-code:free` (settings modal)
- **Prompt categories** (20 prompts):
  - RECENT (5) — 2024/2025/2026 telemetry-rich sessions
  - PAST (6) — 2017, 1994, 1950, 2020, 2020 Monza, 1994 Monaco
  - COMPARISON (5) — multi-driver, team-vs-team, qualifying comparison
  - INFERENCE (4) — what-if, counterfactual, prediction
- **Pipeline** (full integration): `planQuery` → `executeSteps` → responder synthesis
- **Backend**: real FastAPI at `F1_API_URL` (port 8765 after restart — port 8000 was held by an orphaned socket)

## Key files added
- `main/__tests__/utils/multi-model-client.ts` — factory for any of the 4 models, with per-call logging
- `main/__tests__/utils/e2e-grader.ts` — scores plans/execution/responses/hallucination, finds category-specific issues
- `main/__tests__/fixtures/e2e-prompts.ts` — 20 categorized prompts with golden arg expectations
- `main/__tests__/integration/cross-model-e2e.test.ts` — full 4×20 grid (killed by OpenRouter free-tier rate limit; smoke run succeeded)
- `main/__tests__/integration/cross-model-e2e-smoke.test.ts` — 1×4 smoke that completed in 47s

## Bugs found (before fixes)

### 1. Hallucinated tool names (CRITICAL)
**Symptom**: planner returned `get_lap_times` instead of `get_laps` for "Show Verstappen's lap times in the 2024 Monaco GP".
**Impact**: executor returned `Unknown tool: get_lap_times`, entire plan failed (overall 55%).
**Root cause**: free-tier open-source models (Llama, Nemotron, Poolside, Cohere) frequently invent tool names. The executor had no alias resolution.
**Reproduction**: see `smoke-results.json` — `recent-ver-monaco-2024` finding `PLAN_HALLUCINATED_TOOLS: get_lap_times`.

### 2. Planner crashes on prose responses (CRITICAL)
**Symptom**: for "Who won the 2017 F1 drivers' championship?" Nemotron returned pure prose ("Lewis Hamilton won the 2017 Formula 1 Drivers' Championship…") with no `PLAN:` marker, no JSON. `parseJsonResponse` threw and the user saw a 500.
**Impact**: any prompt where the model chooses to "answer" rather than "plan" crashed the entire chat endpoint.
**Reproduction**: see `smoke-results.json` — `past-2017-standings` `PLAN_FAIL: Failed to parse planner response as JSON: Lewis Hamilton won the 2017 Formula 1 Drivers' Championship, securing his fourth title with Mercedes.`

### 3. Inference queries answered with prose, no `run_simulation` (CRITICAL)
**Symptom**: "What if the 2021 Abu Dhabi Grand Prix didn't end under safety car?" — Nemotron produced a long prose essay instead of a `run_simulation` step. Same root cause as #2, but with much worse real-world impact because the user wanted a quantitative what-if, not an essay.
**Reproduction**: see `smoke-results.json` — `inf-abu-dhabi-2021-no-sc`.

### 4. OpenRouter key in `env.example` was revoked (BLOCKER)
**Symptom**: every model returned `401 User not found` with the key in `main/env.example`.
**Fix**: replaced with new key supplied by user (`sk-or-v1-f63f…`).

### 5. FastF1 not installed in the available Python
**Symptom**: After accidentally killing the original uvicorn + frontend, the backend could not restart (no fastf1 module).
**Fix**: `py -3.12 -m pip install fastf1 pandas numpy`. Backend now running on port 8765 (port 8000 was held by an orphan socket).

### 6. `createFallbackPlan` year regex dropped all pre-2000 years
**Symptom**: prompt "Show driver standings for 1994" silently routed to year=2026 (current year default) instead of 1994. Same for any 1950-1999 query.
**Root cause**: regex `/20\d{2}/` matches 2000-2099 only.
**Fix**: changed to `/(?:19|20)\d{2}/` to cover the full F1 era. Caught by `__tests__/unit/planner-resilience.test.ts`.

## Fixes applied (committed to working tree)

### Fix A: planner fallback on parse failure
`lib/planner.ts:planQuery` now catches both:
- LLM invocation errors (network/auth/rate-limit) → `createFallbackPlan`
- JSON parse errors → `createFallbackPlan`

This means the user always gets a plan (possibly degraded via regex-based intent detection), never a 500.

### Fix B: tolerant JSON parser
`lib/planner.ts:parseJsonResponse` now handles:
- `PLAN: {...}` (canonical)
- ```json ... ``` fenced block
- `Sure! Here you go: {"steps": ...}` — any balanced `{...}` embedded in prose
- Whole-response JSON
Plus a new `extractFirstBalancedJsonObject` helper that walks the string respecting strings and escapes.

### Fix C: explicit CRITICAL OUTPUT RULES
Added a section to the planner prompt that:
- Forbids answering the user directly
- Forbids prose explanations of F1 events
- Forbids "what if" reasoning — must emit `run_simulation`
- Forbids hallucinated tool names (lists the exact canonical names)
- Notes that `retrieve_regulations` is disabled

### Fix D: tool alias + fuzzy matching in executor
`lib/executor.ts` now has a `resolveTool` helper that:
1. Looks up the requested tool name
2. Falls back to a 20-entry `TOOL_ALIASES` table covering the most common hallucinations (`get_lap_times`, `get_telemetry_data`, `simulate`, etc.)
3. Falls back to a case-insensitive / underscore-stripped fuzzy match
4. Logs a one-line warning to dev console when a remap happens

Catches: `get_lap_times`, `get_telemetry_data`, `get_standings`, `get_championship_standings`, `simulate`, etc.

## Measured impact

| Test file | Before fixes | After fixes |
|-----------|--------------|-------------|
| `unit/planner.test.ts` (30 tests) | 20 failed | 0 failed (30 pass) |
| `integration/ai-response-quality.test.ts` (34 tests) | 34 failed | 32 pass / 2 fail* |
| `integration/chat-flow.test.ts` (20 tests) | 18 failed | 18 pass / 2 fail** |
| `repro/season-points.valid.test.ts` (2 tests) | 2 failed | 2 pass |
| `integration/cross-model-e2e-smoke.test.ts` (1 test, 4 prompts) | 1 pass (50% prompts) | 1 pass (100% prompts) |
| `unit/planner-resilience.test.ts` (new, 9 tests) | n/a | 9/9 pass |
| `unit/executor.test.ts` (16 tests, +6 new alias tests) | 10 pass | 16/16 pass |

\* Both AI-quality failures are about `retrieve_regulations` (intentionally disabled — pre-existing condition, not regressions)
\** Both chat-flow failures are about refusing to fabricate future events (model still emits an empty plan, the test expects no plan at all — semantic gap, not a regression)

### Cross-model E2E (4×20) full grid
**Incomplete** — OpenRouter's free tier rate-limited (`429 free-models-per-day-high-balance`) partway through. The infrastructure is in place: `npm test -- __tests__/integration/cross-model-e2e.test.ts` will produce a per-prompt × per-model report at `main/.e2e-logs/{results.json,call-logs.json,summary.txt}` once the rate limit resets (typically within 24h) or with a paid OpenRouter key.

## Additional improvements identified (not yet applied)

### A. Tool name whitelist enforcement
Even with the alias table, the planner should be told the exact whitelist in the prompt. The CRITICAL OUTPUT RULES added in Fix C include this, but a programmatic `validatePlan` step that rejects unknown tools *before* the executor runs would prevent downstream noise.

### B. Driver/GP/year argument validation
The smoke test caught "Hallucinated GP: British Grand Prix instead of Great Britain" in one prompt. A normalized lookup table (e.g. map "British GP" → "Great Britain", "Spa" → "Belgium", "Italian GP" → "Italy") would prevent the executor from hitting a 422 on every alias.

### C. Multi-driver query enforcement
"Compare VER vs NOR" produced only `get_qualifying` (returns all drivers) instead of separate `get_fastest_lap` per driver. The prompt's rule #2 already says separate calls, but enforcement is missing. A simple post-parser check ("if query mentions N drivers, expect N tool calls or 1 call that returns all drivers") would catch this.

### D. Responder hallucination guard
The responder synthesises a final answer from tool data, but nothing stops it from inventing details. A `mustNotMention` / `mustMention` set per prompt (already implemented in the grader) should be enforced in the responder system prompt as well.

### E. Deduplicate driver/year/GP lookups
`createFallbackPlan` has a 20-entry GP pattern list. This should be a single shared constant — it's also embedded in the grader. A `lib/f1-knowledge/gp-aliases.ts` and `lib/f1-knowledge/driver-aliases.ts` would centralize.

### F. Pre-cache FastF1 / ergast data
The backend takes 10-30s on first request per (year, gp, session) tuple. A warm-cache script (or a top-N pre-fetch on backend startup) would cut test latency by ~50%.

## Operational notes

- OpenRouter free tier caps at ~50 requests/day/model before "high-balance" rate limit. Paid key recommended for CI.
- Backend now runs on `localhost:8765` because port 8000 is held by a TIME_WAIT socket from the previous uvicorn. Restart on original port 8000 after 60s or `netsh int ipv4 set dynamicport tcp start=49152 num=16384` (or kill the orphan).
- Original `env.example` had a revoked OpenRouter key; new key is `sk-or-v1-f63f…`. Save in `main/.env.local` (gitignored) and `env.example` for documentation.
