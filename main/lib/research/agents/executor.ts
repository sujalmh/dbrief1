/**
 * Executor Agent
 * ==============
 *
 * Owns tool invocation ONLY. The Executor:
 *   - Resolves task dependencies (topological sort)
 *   - Chains tool outputs via {{task_id.field.path}} template resolution
 *   - Checks memory cache to skip redundant tool calls
 *   - Runs tools in parallel where there are no dependencies
 *   - Handles timeouts and retries
 *
 * The Executor has NO planning logic, NO judgment, and NO reflection.
 * It just runs tools.
 */

import { StructuredTool } from "@langchain/core/tools";
import type { ToolRegistry } from "../tool-registry";
import type { EvidenceStore } from "../evidence-store";
import type { ResearchMemory } from "../memory";
import type { Task, TaskStatus, Evidence } from "../types";
import type { ExecutionResult } from "../evidence-store";
import { executionConfig } from "@/lib/config";

// =============================================================================
// Configuration (live — see lib/config.ts)
// =============================================================================

function stepTimeoutMs(): number {
    return executionConfig.stepTimeoutMs();
}

function retryBudget(): number {
    return executionConfig.maxRetries();
}

function concurrencyLimit(): number {
    return executionConfig.maxConcurrency();
}

function isRetryableError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return !executionConfig.nonRetryableStatusFragments().some((fragment) => msg.includes(fragment));
}

// =============================================================================
// Callback type for progress updates
// =============================================================================

export interface ExecutorUpdate {
    taskId: string;
    status: TaskStatus;
    data?: unknown;
    evidenceId?: string;
    error?: string;
}

export type ExecutorUpdateCallback = (update: ExecutorUpdate) => void;

// =============================================================================
// Executor
// =============================================================================

export class Executor {
    constructor(
        private registry: ToolRegistry,
        private evidenceStore: EvidenceStore,
        private memory: ResearchMemory
    ) { }

    /**
     * Execute a batch of tasks. Tasks with no unmet dependencies run in
     * parallel; dependent tasks wait for their dependencies to complete.
     */
    async executeBatch(
        tasks: Task[],
        onUpdate?: ExecutorUpdateCallback
    ): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];
        const completedTasks = new Map<string, Task>();
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        // Mark all as pending
        for (const task of tasks) {
            onUpdate?.({ taskId: task.id, status: "pending" });
        }

        // Process tasks in dependency order
        const remaining = new Set(tasks.map((t) => t.id));

        while (remaining.size > 0) {
            // Find tasks whose dependencies are all satisfied
            const ready: Task[] = [];
            for (const taskId of remaining) {
                const task = taskMap.get(taskId)!;
                const deps = task.dependsOn || [];
                const allDepsComplete = deps.every((depId) => completedTasks.has(depId));
                if (allDepsComplete) {
                    ready.push(task);
                }
            }

            if (ready.length === 0) {
                // No tasks are ready — remaining tasks have unresolvable dependencies
                // Mark them as skipped
                for (const taskId of remaining) {
                    const task = taskMap.get(taskId)!;
                    onUpdate?.({ taskId, status: "skipped", error: "Unresolvable dependency" });
                    results.push({
                        taskId,
                        tool: task.tool,
                        args: task.args,
                        success: false,
                        error: "Unresolvable dependency",
                        durationMs: 0,
                    });
                }
                break;
            }

            // Execute ready tasks in parallel with the configured concurrency
            // limit (tool calls are I/O-bound; higher fan-out cuts wall time).
            const batchResults: ExecutionResult[] = new Array(ready.length);
            let currentIndex = 0;

            const worker = async () => {
                while (currentIndex < ready.length) {
                    const index = currentIndex++;
                    const task = ready[index];
                    batchResults[index] = await this.executeTask(task, completedTasks, onUpdate);
                }
            };

            const workers = Array.from(
                { length: Math.min(concurrencyLimit(), ready.length) },
                () => worker()
            );
            await Promise.all(workers);

            for (let i = 0; i < ready.length; i++) {
                const task = ready[i];
                const result = batchResults[i];
                results.push(result);
                completedTasks.set(task.id, { ...task, result: result.data });
                remaining.delete(task.id);
            }
        }

        return results;
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Execute a single task with dependency resolution, memory cache check,
     * template chaining, timeout, and retry.
     */
    private async executeTask(
        task: Task,
        completedTasks: Map<string, Task>,
        onUpdate?: ExecutorUpdateCallback
    ): Promise<ExecutionResult> {
        const startTime = Date.now();

        // Resolve template references in args
        let resolvedArgs = this.resolveTemplateArgs(task.args, completedTasks);

        // Check memory cache — skip if we already called this tool with these args
        if (this.memory.hasToolCall(task.tool, resolvedArgs)) {
            const cachedEvidenceId = this.memory.getCachedEvidenceId(task.tool, resolvedArgs);
            onUpdate?.({
                taskId: task.id,
                status: "skipped",
                evidenceId: cachedEvidenceId,
            });
            return {
                taskId: task.id,
                tool: task.tool,
                args: resolvedArgs,
                success: true,
                data: this.evidenceStore.getById(cachedEvidenceId || "")?.data,
                durationMs: Date.now() - startTime,
            };
        }

        // Get the tool from the registry
        const tool = this.registry.getTool(task.tool);
        if (!tool) {
            onUpdate?.({ taskId: task.id, status: "failed", error: `Unknown tool: ${task.tool}` });
            return {
                taskId: task.id,
                tool: task.tool,
                args: resolvedArgs,
                success: false,
                error: `Unknown tool: ${task.tool}`,
                durationMs: Date.now() - startTime,
            };
        }

        onUpdate?.({ taskId: task.id, status: "running" });

        // Validate args against tool schema. Some tool schemas are
        // JSON-schema objects without a parse method, so guard with a
        // capability check before calling parseAsync.
        if (tool.schema) {
            try {
                const schema = tool.schema as { parseAsync?: (input: unknown) => Promise<unknown>; parse?: (input: unknown) => unknown };
                if (typeof schema.parseAsync === "function") {
                    resolvedArgs = await schema.parseAsync(resolvedArgs) as Record<string, unknown>;
                } else if (typeof schema.parse === "function") {
                    resolvedArgs = schema.parse(resolvedArgs) as Record<string, unknown>;
                }
                // JSON-schema tool — let the tool validate and surface errors.
            } catch (e) {
                const errorMsg = `Schema validation failed: ${e instanceof Error ? e.message : String(e)}`;
                onUpdate?.({ taskId: task.id, status: "failed", error: errorMsg });
                return {
                    taskId: task.id,
                    tool: task.tool,
                    args: resolvedArgs,
                    success: false,
                    error: errorMsg,
                    durationMs: Date.now() - startTime,
                };
            }
        }

        // Execute with retry
        let lastError: string | undefined;
        const retries = retryBudget();
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const data = await this.invokeWithTimeout(tool, resolvedArgs);

                // Add to evidence store
                const toolMetadata = this.registry.getToolMetadata(task.tool);
                let evidence: Evidence | null = null;
                if (toolMetadata) {
                    const result: ExecutionResult = {
                        taskId: task.id,
                        tool: task.tool,
                        args: resolvedArgs,
                        success: true,
                        data,
                        durationMs: Date.now() - startTime,
                    };
                    evidence = this.evidenceStore.add(result, toolMetadata);
                }

                onUpdate?.({
                    taskId: task.id,
                    status: "success",
                    data,
                    evidenceId: evidence?.id,
                });

                return {
                    taskId: task.id,
                    tool: task.tool,
                    args: resolvedArgs,
                    success: true,
                    data,
                    durationMs: Date.now() - startTime,
                    evidenceId: evidence?.id,
                };
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                console.warn(
                    `[Executor] Tool "${task.tool}" attempt ${attempt + 1}/${retries + 1} failed for task ${task.id}: ${lastError}`
                );
                if (attempt < retries && isRetryableError(error)) {
                    // Short backoff: fail fast for responsiveness.
                    const delay = Math.pow(2, attempt) * executionConfig.retryBackoffBaseMs();
                    await new Promise((r) => setTimeout(r, delay));
                } else {
                    break; // Skip further retries for non-retryable errors
                }
            }
        }

        // All retries failed
        onUpdate?.({ taskId: task.id, status: "failed", error: lastError });
        return {
            taskId: task.id,
            tool: task.tool,
            args: resolvedArgs,
            success: false,
            error: lastError,
            durationMs: Date.now() - startTime,
        };
    }

    /**
     * Invoke a tool with a timeout. The timer is always cleared so we never
     * leak handles on the server.
     */
    private async invokeWithTimeout(tool: StructuredTool, args: Record<string, unknown>): Promise<unknown> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("Tool execution timed out")), stepTimeoutMs());
        });

        const invokePromise = tool.invoke(args);

        try {
            return await Promise.race([invokePromise, timeoutPromise]);
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
    }

    /**
     * Resolve {{task_id.field.path}} template references in task args using
     * completed tasks' results.
     *
     * Example: { "gp": "{{task_1_1.events[2].event_name}}" }
     *   → resolves to the event_name of the 3rd event from task_1_1's output
     */
    private resolveTemplateArgs(
        args: Record<string, unknown>,
        completedTasks: Map<string, Task>
    ): Record<string, unknown> {
        const resolved: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(args)) {
            resolved[key] = this.resolveTemplateValue(value, completedTasks);
        }

        return resolved;
    }

    private resolveTemplateValue(
        value: unknown,
        completedTasks: Map<string, Task>
    ): unknown {
        if (typeof value === "string") {
            return this.resolveTemplateString(value, completedTasks);
        }
        if (Array.isArray(value)) {
            return value.map((v) => this.resolveTemplateValue(v, completedTasks));
        }
        if (value !== null && typeof value === "object") {
            const resolved: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) {
                resolved[k] = this.resolveTemplateValue(v, completedTasks);
            }
            return resolved;
        }
        return value;
    }

    private resolveTemplateString(
        str: string,
        completedTasks: Map<string, Task>
    ): unknown {
        // Match {{task_id.field.path}} patterns
        const match = str.match(/^\{\{([^}]+)\}\}$/);
        if (match) {
            // Entire string is a template — return the resolved value (preserves type)
            return this.resolveReference(match[1].trim(), completedTasks);
        }

        // Replace inline templates — return string with substitutions
        return str.replace(/\{\{([^}]+)\}\}/g, (fullMatch, ref) => {
            const resolved = this.resolveReference(ref.trim(), completedTasks);
            return resolved != null ? String(resolved) : fullMatch;
        });
    }

    /**
     * Resolve a dotted reference like "task_1_1.events[2].event_name"
     * against completed task results.
     */
    private resolveReference(ref: string, completedTasks: Map<string, Task>): unknown {
        const parts = ref.split(".");
        const taskId = parts[0];
        const task = completedTasks.get(taskId);

        if (!task || task.result == null) {
            return undefined;
        }

        let current: unknown = task.result;

        // Parse string JSON if needed
        if (typeof current === "string") {
            try {
                current = JSON.parse(current);
            } catch {
                return current;
            }
        }

        // Walk the path
        for (let i = 1; i < parts.length; i++) {
            if (current == null) return undefined;

            const part = parts[i];
            // Handle array index: field[2]
            const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/);
            if (arrayMatch) {
                const field = arrayMatch[1];
                const index = parseInt(arrayMatch[2], 10);
                current = (current as Record<string, unknown>)[field];
                if (Array.isArray(current)) {
                    current = current[index];
                } else {
                    return undefined;
                }
            } else {
                current = (current as Record<string, unknown>)[part];
            }
        }

        return current;
    }
}
