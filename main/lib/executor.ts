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
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs: number;
}

export interface ExecutionContext {
    results: ExecutionResult[];
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
}

// =============================================================================
// Configuration
// =============================================================================

const MAX_STEPS = 5;
const STEP_TIMEOUT_MS = 60000;

// =============================================================================
// Executor Functions
// =============================================================================

/**
 * Execute a single step with timeout handling
 */
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
            success: true,
            data: typeof result === "string" ? JSON.parse(result) : result,
            durationMs: Date.now() - startTime,
        };
    } catch (error) {
        return {
            step: stepIndex,
            tool: step.tool,
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
