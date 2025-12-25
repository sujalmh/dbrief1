/**
 * Step Executor Module
 * ====================
 * Executes planned steps sequentially with timeout and error handling.
 * Aggregates results from all tool executions.
 */

import { StructuredTool } from "@langchain/core/tools";
import { Step } from "./planner";

// =============================================================================
// Types
// =============================================================================

export interface ExecutionResult {
    step: number;
    tool: string;
    args: any; // Input arguments used for the tool
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs: number;
}

// =============================================================================
// Configuration
// =============================================================================


const STEP_TIMEOUT_MS = 60000;

export interface ExecutionContext {
    results: ExecutionResult[];
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
}

async function executeStep(
    step: Step,
    stepIndex: number,
    tools: Record<string, StructuredTool>
): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check if tool exists
    const tool = tools[step.tool];
    if (!tool) {
        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: false,
            error: `Unknown tool: ${step.tool}`,
            durationMs: Date.now() - startTime,
        };
    }

    try {
        // Execute with timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Tool execution timeout")), STEP_TIMEOUT_MS);
        });

        const resultPromise = tool.invoke(step.args);
        const result = await Promise.race([resultPromise, timeoutPromise]);

        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: true,
            data: typeof result === "string" ? JSON.parse(result) : result,
            durationMs: Date.now() - startTime,
        };
    } catch (error) {
        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: false,
            error: error instanceof Error ? error.message : "Tool execution failed",
            durationMs: Date.now() - startTime,
        };
    }
}

/**
 * Execute all steps sequentially
 *
 * @param steps - Array of steps from the planner
 * @param tools - Map of available tools
 * @returns Execution context with all results
 */
export async function executeSteps(
    steps: Step[],
    tools: Record<string, StructuredTool>,
    onUpdate?: (step: number, status: 'pending' | 'running' | 'success' | 'failed', additional?: string) => void
): Promise<ExecutionContext> {
    const startTime = Date.now();

    // Limit to max steps provided by planner
    const stepsToExecute = steps;

    // Initial pending state
    stepsToExecute.forEach((_, index) => {
        onUpdate?.(index + 1, 'pending');
    });

    // Execute in parallel for speed optimization
    const resultPromises = stepsToExecute.map(async (step, index) => {
        const stepNum = index + 1;
        onUpdate?.(stepNum, 'running');

        const result = await executeStep(step, stepNum, tools);

        onUpdate?.(
            stepNum,
            result.success ? 'success' : 'failed',
            result.success ? undefined : result.error
        );

        return result;
    });

    const results = await Promise.all(resultPromises);

    // Log execution (for debugging)
    if (process.env.NODE_ENV === "development") {
        results.forEach(result => {
            console.log(
                `[Executor] Step ${result.step}: ${result.tool} - ${result.success ? "SUCCESS" : "FAILED"} (${result.durationMs}ms)`
            );
            if (!result.success && result.error) {
                console.error(`[Executor] Error details for Step ${result.step}:`, result.error);
            }
        });
    }

    return {
        results,
        successCount: results.filter((r) => r.success).length,
        failureCount: results.filter((r) => !r.success).length,
        totalDurationMs: Date.now() - startTime,
    };
}

// =============================================================================
// Context Budgeting Configuration
// =============================================================================

const MAX_CONTEXT_TOKENS = 150_000; // Safe limit below 262k
const CHARS_PER_TOKEN = 4; // Rough estimate: 1 token ≈ 4 characters

/**
 * Estimate token count from a string
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if data is telemetry-like (has 'data' array with many points)
 */
function isTelemetryData(data: unknown): data is { data: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "data" in data &&
        Array.isArray((data as { data: unknown[] }).data) &&
        (data as { data: unknown[] }).data.length > 50
    );
}

/**
 * Check if data is laps-like (has 'laps' array with many entries)
 */
function isLapsData(data: unknown): data is { laps: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "laps" in data &&
        Array.isArray((data as { laps: unknown[] }).laps) &&
        (data as { laps: unknown[] }).laps.length > 20
    );
}

/**
 * Summarize telemetry data for LLM consumption
 * Replaces raw data array with statistical summary
 */
function summarizeTelemetryForLLM(data: { data: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const points = data.data as Array<Record<string, number>>;

    if (points.length === 0) {
        return { ...data, data: [], summary: "No telemetry data available" };
    }

    // Extract numeric channels
    const channels = Object.keys(points[0]).filter(
        (key) => typeof points[0][key] === "number" && key !== "Time" && key !== "Distance"
    );

    const summary: Record<string, { min: number; max: number; avg: number }> = {};

    for (const channel of channels) {
        const values = points.map((p) => p[channel]).filter((v) => typeof v === "number" && !isNaN(v));
        if (values.length > 0) {
            summary[channel] = {
                min: Math.round(Math.min(...values) * 100) / 100,
                max: Math.round(Math.max(...values) * 100) / 100,
                avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
            };
        }
    }

    // Keep only essential metadata + summary
    return {
        driver: data.driver,
        lap_number: data.lap_number,
        lap_time: data.lap_time,
        total_points: points.length,
        telemetry_summary: summary,
        note: "Raw telemetry data replaced with statistical summary for LLM context efficiency",
    };
}


/**
 * Helper to parse various lap time formats into seconds
 * Handles: numbers, "MM:SS.mmm", "HH:MM:SS.mmm"
 */
function parseLapTimeToSeconds(lapTime: unknown): number | null {
    if (typeof lapTime === 'number') return lapTime;
    
    if (typeof lapTime === 'string') {
        // Clean potential "0 days " prefix (common in Python timedelta stringification)
        const cleanTime = lapTime.replace("0 days ", "").trim();
        
        const parts = cleanTime.split(':');
        
        // Handle HH:MM:SS.mmm
        if (parts.length === 3) {
            return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
        }
        // Handle MM:SS.mmm
        if (parts.length === 2) {
            return (+parts[0]) * 60 + (+parts[1]);
        }
        
        // Handle raw seconds string
        const num = parseFloat(cleanTime);
        return isNaN(num) ? null : num;
    }
    
    return null;
}

/**
 * Summarize laps data for LLM consumption
 * Keeps only key laps (fastest, first, last) and aggregates the rest
 */
function summarizeLapsForLLM(data: { laps: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const laps = data.laps as Array<Record<string, unknown>>;

    if (laps.length === 0) {
        return { ...data, summary: "No lap data available" };
    }

    // Find fastest lap (lexical comparison works for standard time strings)
    const fastestLap = laps.reduce((fastest, lap) => {
        const currentSec = parseLapTimeToSeconds(lap.LapTime);
        const fastestSec = parseLapTimeToSeconds(fastest.LapTime);
    
        if (currentSec === null) return fastest;
        if (fastestSec === null) return lap;
    
        return currentSec < fastestSec ? lap : fastest;
    }, laps[0]);

    // Calculate Average Lap Time
    const validLapSeconds = laps
        .map((l) => parseLapTimeToSeconds(l.LapTime))
        .filter((t): t is number => t !== null && t > 0);

    let averageLapTimeStr = "N/A";
    
    if (validLapSeconds.length > 0) {
        const totalSeconds = validLapSeconds.reduce((a, b) => a + b, 0);
        const avgSeconds = totalSeconds / validLapSeconds.length;
        
        // Format back to MM:SS.mmm for readability
        const mins = Math.floor(avgSeconds / 60);
        const secs = (avgSeconds % 60).toFixed(3);
        averageLapTimeStr = `${mins}:${secs.padStart(6, '0')}`;
    }

    // Get first and last lap
    const firstLap = laps[0];
    const lastLap = laps[laps.length - 1];

    return {
        session_name: data.session_name,
        total_laps: laps.length,
        average_lap_time: averageLapTimeStr,
        key_laps: {
            fastest: fastestLap,
            first: firstLap,
            last: lastLap,
        },
        laps_with_times: validLapSeconds.length,
        note: "Full lap table replaced with key laps and average summary for LLM context efficiency",
    };
}

/**
 * Reduce a single result's data if it's too large
 */
function reduceResultData(result: ExecutionResult): ExecutionResult {
    if (!result.success || !result.data) {
        return result;
    }

    // Check if it's telemetry data and summarize
    if (isTelemetryData(result.data)) {
        return {
            ...result,
            data: summarizeTelemetryForLLM(result.data),
        };
    }

    // Check if it's laps data and summarize
    if (isLapsData(result.data)) {
        return {
            ...result,
            data: summarizeLapsForLLM(result.data),
        };
    }

    return result;
}

/**
 * Aggregate execution results into a context string for the LLM
 * WITH CONTEXT BUDGETING - prevents token overflow
 *
 * @param context - Execution context with results
 * @returns Formatted string for LLM context (budget-safe)
 */
export function aggregateContext(context: ExecutionContext): string {
    if (context.results.length === 0) {
        return "No data was retrieved from F1 tools.";
    }

    // Step 1: Reduce large data structures (telemetry, laps)
    const reducedResults = context.results.map(reduceResultData);

    const sections: string[] = [];

    for (const result of reducedResults) {
        if (result.success && result.data) {
            sections.push(
                `### ${result.tool} (Step ${result.step})\n\`\`\`json\n${JSON.stringify(result.data, null, 2)}\n\`\`\``
            );
        } else if (!result.success) {
            sections.push(
                `### ${result.tool} (Step ${result.step}) - FAILED\nError: ${result.error}`
            );
        }
    }

    const summary = `**Execution Summary**: ${context.successCount}/${context.results.length} steps succeeded in ${context.totalDurationMs}ms`;

    let aggregated = `${summary}\n\n${sections.join("\n\n")}`;

    // Step 2: Check token budget and truncate if needed
    const estimatedTokens = estimateTokens(aggregated);

    if (estimatedTokens > MAX_CONTEXT_TOKENS) {
        console.warn(`[Executor] Context too large (${estimatedTokens} tokens), truncating...`);

        // Truncate to fit budget (keep beginning which has summary)
        const maxChars = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
        aggregated = aggregated.substring(0, maxChars);
        aggregated += "\n\n**[Context truncated due to size limits]**";
    }

    return aggregated;
}

/**
 * Create a simplified context object for the LLM (less verbose)
 *
 * @param context - Execution context with results
 * @returns Simplified data object
 */
export function simplifyContext(context: ExecutionContext): Record<string, unknown> {
    const simplified: Record<string, unknown> = {};

    for (const result of context.results) {
        if (result.success && result.data) {
            // Use tool name as key, add index if duplicate
            const key = simplified[result.tool] ? `${result.tool}_${result.step}` : result.tool;
            simplified[key] = result.data;
        }
    }

    return simplified;
}
