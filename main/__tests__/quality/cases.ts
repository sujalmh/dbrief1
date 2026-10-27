/**
 * P0 managed answer-quality cases.
 *
 * Every prompt becomes one full planner -> executor -> responder turn against
 * the local FastAPI service. Recency expectations are derived from the live
 * data snapshot; named-race expectations are stable historical facts.
 */

import type { CaseContext, PipelineResult, QualityCase } from "./harness";
import {
    countLapTimes,
    hasCode,
    hasEvent,
    hasNumber,
    includesAny,
    mentionsDate,
} from "./harness";

const BRITISH_2024 = {
    event: "2024 British Grand Prix",
    winner: "Lewis Hamilton",
    winnerCode: "HAM",
    second: "Max Verstappen",
    secondCode: "VER",
    third: "Lando Norris",
    thirdCode: "NOR",
    winnerTeam: "Mercedes",
    winningTime: "1:22:27.059",
    secondGap: "1.465",
    poleSitter: "George Russell",
    poleCode: "RUS",
    poleTime: "1:25.819",
    frontRow: "Lewis Hamilton",
    frontRowCode: "HAM",
    fastestLapDriver: "Carlos Sainz",
    fastestLapCode: "SAI",
    fastestLapTime: "1:28.293",
    firstLapTime: "1:36.034",
    lastLapTime: "1:30.146",
} as const;

function baseFailures(result: PipelineResult): string[] {
    const failures: string[] = [];
    if (result.error) failures.push(`pipeline error: ${result.error}`);
    if (!result.answer.trim()) failures.push("answer is empty");
    return failures;
}

function requireSnapshot(context: CaseContext, failures: string[]) {
    if (!context.recency) {
        failures.push(`recency snapshot unavailable: ${context.recencyError ?? "unknown error"}`);
    }
    return context.recency;
}

function hasDriver(answer: string, name: string, code: string): boolean {
    const lastName = name.trim().split(/\s+/).pop() ?? name;
    return includesAny(answer, [name, lastName]) || hasCode(answer, code);
}

function checkLastRacePodium(result: PipelineResult, context: CaseContext): string[] {
    const failures = baseFailures(result);
    const snapshot = requireSnapshot(context, failures);
    if (!snapshot) return failures;
    if (!hasDriver(result.answer, snapshot.latestSecondName, snapshot.latestSecondCode)) {
        failures.push(`answer does not name second place: ${snapshot.latestSecondName} (${snapshot.latestSecondCode})`);
    }
    if (!hasDriver(result.answer, snapshot.latestThirdName, snapshot.latestThirdCode)) {
        failures.push(`answer does not name third place: ${snapshot.latestThirdName} (${snapshot.latestThirdCode})`);
    }
    return failures;
}

function checkLastRaceMargin(result: PipelineResult, context: CaseContext): string[] {
    const failures = baseFailures(result);
    const snapshot = requireSnapshot(context, failures);
    if (!snapshot) return failures;
    if (!hasNumber(result.answer, snapshot.latestSecondGap)) {
        failures.push(`answer does not quote the second-place gap: ${snapshot.latestSecondGap}`);
    }
    return failures;
}

export const QUALITY_CASES: QualityCase[] = [
    // =========================================================================
    // Recency: expectations come from the current FastAPI snapshot
    // =========================================================================
    {
        id: "recency-last-race-winner",
        category: "Recency",
        prompt: "Who won the last F1 race?",
        expected: "The latest completed event, its winner, and the winner's team from the current FastAPI snapshot.",
        check: (result, context) => {
            const failures = baseFailures(result);
            const snapshot = requireSnapshot(context, failures);
            if (!snapshot) return failures;
            if (!hasEvent(result.answer, snapshot.latestEvent)) {
                failures.push(`answer does not name the latest event: ${snapshot.latestEvent}`);
            }
            if (!hasDriver(result.answer, snapshot.latestWinnerName, snapshot.latestWinnerCode)) {
                failures.push(`answer does not name the latest winner: ${snapshot.latestWinnerName} (${snapshot.latestWinnerCode})`);
            }
            if (!includesAny(result.answer, [snapshot.latestWinnerTeam])) {
                failures.push(`answer does not name the winning team: ${snapshot.latestWinnerTeam}`);
            }
            return failures;
        },
    },
    {
        id: "recency-last-race-podium",
        category: "Recency",
        prompt: "Who finished second and third at the last race?",
        expected: "Second and third place from the latest completed event in the current FastAPI snapshot.",
        check: checkLastRacePodium,
    },
    {
        id: "recency-last-race-margin",
        category: "Recency",
        prompt: "What was the gap between first and second at the last race?",
        expected: "The second-place GapToLeader value from the latest completed event in the current FastAPI snapshot.",
        check: checkLastRaceMargin,
    },
    {
        id: "recency-last-race-f1-phrasing",
        category: "Recency",
        prompt: "Who finished second and third at the last F1 race?",
        expected: "The latest-race anchor must also work when the user says 'last F1 race' instead of 'last race'.",
        check: checkLastRacePodium,
    },
    {
        id: "recency-next-race",
        category: "Recency",
        prompt: "When is the next F1 race, and which Grand Prix is it?",
        expected: "The next scheduled event and its date from the current FastAPI snapshot.",
        check: (result, context) => {
            const failures = baseFailures(result);
            const snapshot = requireSnapshot(context, failures);
            if (!snapshot) return failures;
            if (!hasEvent(result.answer, snapshot.nextEvent)) {
                failures.push(`answer does not name the next event: ${snapshot.nextEvent}`);
            }
            if (!mentionsDate(result.answer, snapshot.nextEventDate)) {
                failures.push(`answer does not give the next event date: ${snapshot.nextEventDate}`);
            }
            return failures;
        },
    },
    {
        id: "recency-driver-standings",
        category: "Recency",
        prompt: "What are the current F1 drivers standings?",
        expected: "The current driver standings leader and top-three points from the FastAPI snapshot.",
        check: (result, context) => {
            const failures = baseFailures(result);
            const snapshot = requireSnapshot(context, failures);
            if (!snapshot) return failures;
            if (!hasDriver(result.answer, snapshot.driverLeaderName, snapshot.driverLeaderCode)) {
                failures.push(`answer does not name the standings leader: ${snapshot.driverLeaderName} (${snapshot.driverLeaderCode})`);
            }
            if (!hasNumber(result.answer, snapshot.driverLeaderPoints)) {
                failures.push(`answer does not quote the leader's points: ${snapshot.driverLeaderPoints}`);
            }
            if (!hasDriver(result.answer, snapshot.driverSecondName, snapshot.driverSecondCode)) {
                failures.push(`answer does not name second place: ${snapshot.driverSecondName} (${snapshot.driverSecondCode})`);
            }
            if (!hasNumber(result.answer, snapshot.driverSecondPoints)) {
                failures.push(`answer does not quote second-place points: ${snapshot.driverSecondPoints}`);
            }
            return failures;
        },
    },
    {
        id: "recency-constructor-leader",
        category: "Recency",
        prompt: "Who leads the current F1 constructors championship, and how many points do they have?",
        expected: "The current constructor standings leader and points from the FastAPI snapshot.",
        check: (result, context) => {
            const failures = baseFailures(result);
            const snapshot = requireSnapshot(context, failures);
            if (!snapshot) return failures;
            if (!includesAny(result.answer, [snapshot.constructorLeader])) {
                failures.push(`answer does not name the constructor leader: ${snapshot.constructorLeader}`);
            }
            if (!hasNumber(result.answer, snapshot.constructorLeaderPoints)) {
                failures.push(`answer does not quote the leader's points: ${snapshot.constructorLeaderPoints}`);
            }
            return failures;
        },
    },
    {
        id: "recency-constructor-gap",
        category: "Recency",
        prompt: "How many points separate the top two constructors in the current championship?",
        expected: "The points gap between the top two constructors in the FastAPI snapshot.",
        check: (result, context) => {
            const failures = baseFailures(result);
            const snapshot = requireSnapshot(context, failures);
            if (!snapshot) return failures;
            if (!hasNumber(result.answer, snapshot.constructorGap)) {
                failures.push(`answer does not quote the top-two constructor gap: ${snapshot.constructorGap}`);
            }
            return failures;
        },
    },

    // =========================================================================
    // Named race: stable historical facts
    // =========================================================================
    {
        id: "named-race-podium",
        category: "Named race",
        prompt: "Who won the 2024 British Grand Prix, and who finished second and third?",
        expected: "Hamilton wins from Verstappen and Norris in the 2024 British Grand Prix.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!hasEvent(result.answer, BRITISH_2024.event)) {
                failures.push(`answer does not name the event: ${BRITISH_2024.event}`);
            }
            if (!hasDriver(result.answer, BRITISH_2024.winner, BRITISH_2024.winnerCode)) {
                failures.push(`answer does not name the winner: ${BRITISH_2024.winner}`);
            }
            if (!hasDriver(result.answer, BRITISH_2024.second, BRITISH_2024.secondCode)) {
                failures.push(`answer does not name second place: ${BRITISH_2024.second}`);
            }
            if (!hasDriver(result.answer, BRITISH_2024.third, BRITISH_2024.thirdCode)) {
                failures.push(`answer does not name third place: ${BRITISH_2024.third}`);
            }
            return failures;
        },
    },
    {
        id: "named-race-winning-time",
        category: "Named race",
        prompt: "What was Lewis Hamilton's winning time at the 2024 British Grand Prix?",
        expected: `Hamilton's winning time is ${BRITISH_2024.winningTime}.`,
        check: (result) => {
            const failures = baseFailures(result);
            if (!includesAny(result.answer, [BRITISH_2024.winningTime])) {
                failures.push(`answer does not quote the winning time: ${BRITISH_2024.winningTime}`);
            }
            return failures;
        },
    },
    {
        id: "named-race-second-gap",
        category: "Named race",
        prompt: "What was the gap between first and second at the 2024 British Grand Prix?",
        expected: `Second place was ${BRITISH_2024.secondGap} behind the winner.`,
        check: (result) => {
            const failures = baseFailures(result);
            if (!hasNumber(result.answer, BRITISH_2024.secondGap)) {
                failures.push(`answer does not quote the second-place gap: ${BRITISH_2024.secondGap}`);
            }
            return failures;
        },
    },
    {
        id: "named-qualifying-pole",
        category: "Named race",
        prompt: "Who took pole position for the 2024 British Grand Prix, and what was the pole time?",
        expected: `Russell took pole with ${BRITISH_2024.poleTime}.`,
        check: (result) => {
            const failures = baseFailures(result);
            if (!hasDriver(result.answer, BRITISH_2024.poleSitter, BRITISH_2024.poleCode)) {
                failures.push(`answer does not name the pole sitter: ${BRITISH_2024.poleSitter}`);
            }
            if (!includesAny(result.answer, [BRITISH_2024.poleTime])) {
                failures.push(`answer does not quote the pole time: ${BRITISH_2024.poleTime}`);
            }
            return failures;
        },
    },
    {
        id: "named-qualifying-front-row",
        category: "Named race",
        prompt: "Who joined George Russell on the front row for the 2024 British Grand Prix?",
        expected: "Hamilton qualified second alongside Russell.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!hasDriver(result.answer, BRITISH_2024.frontRow, BRITISH_2024.frontRowCode)) {
                failures.push(`answer does not name the second qualifier: ${BRITISH_2024.frontRow}`);
            }
            return failures;
        },
    },
    {
        id: "named-fastest-lap",
        category: "Named race",
        prompt: "Who set the fastest lap at the 2024 British Grand Prix, and what was the time?",
        expected: `Sainz set the fastest lap at ${BRITISH_2024.fastestLapTime}.`,
        check: (result) => {
            const failures = baseFailures(result);
            if (!hasDriver(result.answer, BRITISH_2024.fastestLapDriver, BRITISH_2024.fastestLapCode)) {
                failures.push(`answer does not name the fastest-lap driver: ${BRITISH_2024.fastestLapDriver}`);
            }
            if (!includesAny(result.answer, [BRITISH_2024.fastestLapTime])) {
                failures.push(`answer does not quote the fastest lap: ${BRITISH_2024.fastestLapTime}`);
            }
            return failures;
        },
    },
    {
        id: "named-every-lap",
        category: "Named race",
        prompt: "List every lap time for Lewis Hamilton at the 2024 British Grand Prix. Include lap 1 and lap 52.",
        expected: `All 52 Hamilton laps, including lap 1 (${BRITISH_2024.firstLapTime}) and lap 52 (${BRITISH_2024.lastLapTime}).`,
        check: (result) => {
            const failures = baseFailures(result);
            const lapTimes = countLapTimes(result.answer);
            if (lapTimes < 45) {
                failures.push(`answer contains only ${lapTimes} lap times; expected the full 52-lap set`);
            }
            if (!includesAny(result.answer, [BRITISH_2024.firstLapTime])) {
                failures.push(`answer is missing lap 1: ${BRITISH_2024.firstLapTime}`);
            }
            if (!includesAny(result.answer, [BRITISH_2024.lastLapTime])) {
                failures.push(`answer is missing lap 52: ${BRITISH_2024.lastLapTime}`);
            }
            return failures;
        },
    },
    {
        id: "named-weather",
        category: "Named race",
        prompt: "What were the weather conditions during the 2024 British Grand Prix?",
        expected: "Rainfall was recorded and the answer gives air or track temperature from the weather data.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/\b(rain|rainfall|wet)\b/i.test(result.answer)) {
                failures.push("answer does not mention the rain/wet conditions present in the weather data");
            }
            if (!/\b(air|track|temperature|temp)\b/i.test(result.answer)) {
                failures.push("answer does not give air or track temperature detail");
            }
            return failures;
        },
    },
    {
        id: "named-tyre-strategy",
        category: "Named race",
        prompt: "What tyre strategy did Lewis Hamilton use at the 2024 British Grand Prix?",
        expected: "Hamilton used medium, intermediate, and soft compounds.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/\bmedium\b/i.test(result.answer)) {
                failures.push("answer does not mention the medium compound");
            }
            if (!/\bintermediate\b/i.test(result.answer)) {
                failures.push("answer does not mention the intermediate compound");
            }
            if (!/\bsoft\b/i.test(result.answer)) {
                failures.push("answer does not mention the soft compound");
            }
            if (!hasDriver(result.answer, BRITISH_2024.winner, BRITISH_2024.winnerCode)) {
                failures.push("answer does not name Hamilton as the driver");
            }
            return failures;
        },
    },
    {
        id: "named-penalties",
        category: "Named race",
        prompt: "What penalties did the stewards issue at the 2024 Austrian Grand Prix?",
        expected: "Verstappen received a 10-second time penalty for causing a collision.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/\b10[\s-]?second\b/i.test(result.answer)) {
                failures.push("answer does not quote the 10-second penalty");
            }
            if (!hasDriver(result.answer, "Max Verstappen", "VER") && !/\bcar\s*1\b/i.test(result.answer)) {
                failures.push("answer does not identify Verstappen (or car 1) as the penalised driver");
            }
            if (!/\bcollision\b/i.test(result.answer)) {
                failures.push("answer does not mention the collision offence");
            }
            return failures;
        },
    },

    // =========================================================================
    // Historical
    // =========================================================================
    {
        id: "historical-1994-champion",
        category: "Historical",
        prompt: "Who won the 1994 Formula 1 drivers championship, and how many points did they score?",
        expected: "Michael Schumacher won the 1994 championship with 92 points.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/schumacher/i.test(result.answer)) {
                failures.push("answer does not name Michael Schumacher");
            }
            if (!hasNumber(result.answer, 92)) {
                failures.push("answer does not quote the champion's 92 points");
            }
            return failures;
        },
    },
    {
        id: "historical-1950-british-gp",
        category: "Historical",
        prompt: "Who won the first Formula 1 World Championship race, the 1950 British Grand Prix?",
        expected: "Nino Farina won the 1950 British Grand Prix for Alfa Romeo.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/farina/i.test(result.answer)) {
                failures.push("answer does not name Nino Farina");
            }
            if (!/alfa\s*romeo/i.test(result.answer)) {
                failures.push("answer does not name Alfa Romeo");
            }
            return failures;
        },
    },
    {
        id: "historical-pre-2018-telemetry-refusal",
        category: "Historical",
        prompt: "Show me Ayrton Senna's telemetry from the 1994 Monaco Grand Prix.",
        expected: "A clear refusal explaining that telemetry is unavailable before 2018, with no invented telemetry values.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/\btelemetry\b/i.test(result.answer)) {
                failures.push("answer does not mention telemetry");
            }
            if (!/\b(2018|not available|unavailable|cannot|can't|only available)\b/i.test(result.answer)) {
                failures.push("answer does not explain the pre-2018 data limit");
            }
            if (/\b\d{3}\s*(km\/h|kph)\b/i.test(result.answer)) {
                failures.push("answer contains a speed value, which would be invented pre-2018 telemetry");
            }
            return failures;
        },
    },

    // =========================================================================
    // Guardrails and missing data
    // =========================================================================
    {
        id: "guardrail-off-topic",
        category: "Guardrails",
        prompt: "Write a poem about the 2024 season.",
        expected: "A deterministic off-topic refusal with no F1 tool plan and no fabricated F1 facts.",
        check: (result) => {
            const failures = baseFailures(result);
            if (result.answerSource !== "guard") {
                failures.push(`expected the deterministic off-topic guard, got "${result.answerSource}"`);
            }
            if (result.toolCalls.length > 0) {
                failures.push(`off-topic prompt ran ${result.toolCalls.length} tool calls`);
            }
            if (!/\b(f1-only|can't help|cannot help|not able|unable)\b/i.test(result.answer)) {
                failures.push("answer is not a clear off-topic refusal");
            }
            if (/\b\d:\d{2}\.\d{3}\b/.test(result.answer)) {
                failures.push("off-topic answer contains a lap time");
            }
            return failures;
        },
    },
    {
        id: "missing-sprint-session",
        category: "Guardrails",
        prompt: "What were the Sprint results at the 2024 British Grand Prix?",
        expected: "A clear unavailable response; no invented sprint classification.",
        check: (result) => {
            const failures = baseFailures(result);
            const unavailable = /\b(unable|not available|unavailable|invalid|could not|cannot|can't|no data)\b/i.test(result.answer);
            const claimsSprintResult =
                /\b(won|winner|victory|p1|1st)\b/i.test(result.answer) &&
                !/\b(unable|not available|unavailable|could not|cannot|can't|no data)\b/i.test(result.answer);
            if (!unavailable) {
                failures.push("answer does not clearly say the data is unavailable");
            }
            if (claimsSprintResult) {
                failures.push("answer appears to claim a sprint result that was never held");
            }
            if (countLapTimes(result.answer) > 0) {
                failures.push("answer contains lap times for a session that was not held");
            }
            return failures;
        },
    },
    {
        id: "missing-driver-laps",
        category: "Guardrails",
        prompt: "Show every lap time for Ayrton Senna at the 2024 British Grand Prix.",
        expected: "A clear no-data response for Senna, with no invented lap times.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/senna|\bSEN\b/i.test(result.answer)) {
                failures.push("answer does not name Senna or the SEN driver code");
            }
            if (!/no\b.{0,60}\blap|not available|isn't available|aren't available|unavailable|no data|could not|never raced|did not (race|compete|take part)|not part/i.test(result.answer)) {
                failures.push("answer does not clearly say Senna's lap data is unavailable");
            }
            if (countLapTimes(result.answer) > 0) {
                failures.push("answer contains lap times for a driver who did not race");
            }
            return failures;
        },
    },
    {
        id: "missing-pre-2018-tyres",
        category: "Guardrails",
        prompt: "What tyre compounds were used at the 1955 British Grand Prix?",
        expected: "A clear refusal explaining that tyre compound data is unavailable for 1955.",
        check: (result) => {
            const failures = baseFailures(result);
            if (!/\b(tyre|tire|compound)\b/i.test(result.answer)) {
                failures.push("answer does not mention tyre compounds");
            }
            if (!/no\b.{0,80}\bdata|not available|isn't available|aren't available|unavailable|cannot|can't|only available|only goes back|only covers 2018|from 2018|since 2018|2018 onward|before 2018|pre-?2018/i.test(result.answer)) {
                failures.push("answer does not explain that the tyre data is unavailable");
            }
            if (/\b(soft|medium|hard|intermediate)\b/i.test(result.answer)) {
                failures.push("answer states a compound, which would be invented for 1955");
            }
            return failures;
        },
    },
];
