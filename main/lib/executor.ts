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

const MAX_STEPS = 5;
const STEP_TIMEOUT_MS = 60000;

export interface ExecutionContext {
    results: ExecutionResult[];
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
}

/**
 * Resolve dependencies in step arguments
 * Replaces placeholders like "USE_FROM_STEP_1" with actual values from previous results
 */
function resolveDependencies(
    step: Step,
    previousResults: ExecutionResult[]
): Step {
    const resolvedArgs = { ...step.args };

    // Check each argument for dependency placeholders
    for (const [key, value] of Object.entries(resolvedArgs)) {
        if (typeof value === 'string' && value.startsWith('USE_FROM_STEP_')) {
            // Extract step number from placeholder (e.g., "USE_FROM_STEP_1" -> 1)
            const stepMatch = value.match(/USE_FROM_STEP_(\d+)/);
            if (stepMatch) {
                const stepNum = parseInt(stepMatch[1]);
                const previousResult = previousResults.find(r => r.step === stepNum);

                if (previousResult && previousResult.success && previousResult.data) {
                    // Extract session_key from the previous result
                    const data = previousResult.data as any;

                    // Handle different response formats from OpenF1 API
                    // Format 1: {sessions: [{session_key: 123, ...}]} - Most common from get_sessions
                    if (data.sessions && Array.isArray(data.sessions) && data.sessions.length > 0 && data.sessions[0].session_key) {
                        resolvedArgs[key] = data.sessions[0].session_key;
                    }
                    // Format 2: [{session_key: 123, ...}]
                    else if (Array.isArray(data) && data.length > 0 && data[0].session_key) {
                        resolvedArgs[key] = data[0].session_key;
                    }
                    // Format 3: {session_key: 123, ...}
                    else if (data.session_key) {
                        resolvedArgs[key] = data.session_key;
                    }
                    // Format 4: {data: {sessions: [...]}}
                    else if (data.data && data.data.sessions && Array.isArray(data.data.sessions) && data.data.sessions.length > 0) {
                        resolvedArgs[key] = data.data.sessions[0].session_key;
                    }
                    // Format 5: {data: [{session_key: 123, ...}]}
                    else if (data.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].session_key) {
                        resolvedArgs[key] = data.data[0].session_key;
                    }
                    else {
                        console.warn(`[Executor] Could not extract session_key from step ${stepNum} result`);
                        console.warn(`[Executor] Data structure:`, JSON.stringify(data, null, 2));
                    }
                }
            }
        }
    }

    return {
        ...step,
        args: resolvedArgs
    };
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

    // Limit to max steps
    const stepsToExecute = steps.slice(0, MAX_STEPS);

    // Initial pending state
    stepsToExecute.forEach((_, index) => {
        onUpdate?.(index + 1, 'pending');
    });

    // Execute sequentially to resolve dependencies
    const results: ExecutionResult[] = [];

    for (let index = 0; index < stepsToExecute.length; index++) {
        const step = stepsToExecute[index];
        const stepNum = index + 1;

        // Resolve dependencies from previous results
        const resolvedStep = resolveDependencies(step, results);

        // Log dependency resolution in development
        if (process.env.NODE_ENV === "development") {
            const hasPlaceholder = Object.values(step.args).some(
                v => typeof v === 'string' && v.startsWith('USE_FROM_STEP_')
            );
            if (hasPlaceholder) {
                console.log(`[Executor] Step ${stepNum}: Resolved dependencies`);
                console.log(`[Executor]   Original args:`, step.args);
                console.log(`[Executor]   Resolved args:`, resolvedStep.args);
            }
        }

        onUpdate?.(stepNum, 'running');

        const result = await executeStep(resolvedStep, stepNum, tools);

        onUpdate?.(
            stepNum,
            result.success ? 'success' : 'failed',
            result.success ? undefined : result.error
        );

        results.push(result);

        // Log execution (for debugging)
        if (process.env.NODE_ENV === "development") {
            console.log(
                `[Executor] Step ${result.step}: ${result.tool} - ${result.success ? "SUCCESS" : "FAILED"} (${result.durationMs}ms)`
            );
            if (!result.success && result.error) {
                console.error(`[Executor] Error details for Step ${result.step}:`, result.error);
            }
        }
    }

    return {
        results,
        successCount: results.filter((r) => r.success).length,
        failureCount: results.filter((r) => !r.success).length,
        totalDurationMs: Date.now() - startTime,
    };
}


/**
 * Aggregate execution results into a context string for the LLM
 *
 * @param context - Execution context with results
 * @returns Formatted string for LLM context
 */
export function aggregateContext(context: ExecutionContext): string {
    if (context.results.length === 0) {
        return "No data was retrieved from F1 tools.";
    }

    const sections: string[] = [];

    for (const result of context.results) {
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

    return `${summary}\n\n${sections.join("\n\n")}`;
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
