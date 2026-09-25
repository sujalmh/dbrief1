/**
 * Research Memory
 * ===============
 *
 * Session-scoped memory that tracks discoveries during a research session.
 * Prevents redundant tool calls (if we already retrieved Monaco 2024 results,
 * don't call get_race again with the same args) and redundant claims (if we
 * already know Ferrari won Monaco, don't re-derive it).
 *
 * Memory is scoped to a single research session (one user message). Cross-
 * session memory is out of scope for now.
 */

import type { Discovery, ToolCallRecord } from "./types";
import type { ExecutionResult } from "./evidence-store";

// =============================================================================
// Research Memory
// =============================================================================

export class ResearchMemory {
    private discoveries: Map<string, Discovery> = new Map();
    private toolCallCache: Map<string, ToolCallRecord> = new Map();

    /**
     * Record a factual discovery linked to evidence.
     * The claim is normalized (lowercased, trimmed) for deduplication.
     */
    recordDiscovery(claim: string, evidenceId: string): void {
        const normalized = this.normalizeClaim(claim);
        if (!this.discoveries.has(normalized)) {
            this.discoveries.set(normalized, {
                claim: normalized,
                evidenceId,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Get all discoveries.
     */
    getDiscoveries(): Discovery[] {
        return Array.from(this.discoveries.values());
    }

    /**
     * Record a tool call to prevent redundant re-execution.
     */
    recordToolCall(
        tool: string,
        args: Record<string, unknown>,
        resultHash: string,
        evidenceId: string
    ): void {
        const key = this.toolCallKey(tool, args);
        this.toolCallCache.set(key, {
            tool,
            argsHash: key,
            resultHash,
            evidenceId,
            timestamp: Date.now(),
        });
    }

    /**
     * Check if a tool was already called with the same args.
     */
    hasToolCall(tool: string, args: Record<string, unknown>): boolean {
        return this.toolCallCache.has(this.toolCallKey(tool, args));
    }

    /**
     * Get the cached evidence ID for a tool call, if it exists.
     */
    getCachedEvidenceId(tool: string, args: Record<string, unknown>): string | undefined {
        return this.toolCallCache.get(this.toolCallKey(tool, args))?.evidenceId;
    }

    /**
     * Render discoveries as a context string for the Reasoner/Planner/Synthesizer.
     */
    toContextString(): string {
        const discoveries = this.getDiscoveries();
        if (discoveries.length === 0) {
            return "No prior discoveries in this session.";
        }

        return `## Research Memory (${discoveries.length} discoveries)\n\n${discoveries
            .map((d) => `- [${d.evidenceId}] ${d.claim}`)
            .join("\n")}`;
    }

    /**
     * Update memory from a batch of execution results.
     * Extracts simple factual claims from tool outputs.
     */
    updateFromResults(results: ExecutionResult[], evidenceMap: Map<string, string>): void {
        for (const result of results) {
            if (!result.success) continue;
            const evidenceId = evidenceMap.get(result.taskId);
            if (!evidenceId) continue;

            // Extract simple claims from the result data
            const claims = this.extractClaims(result);
            for (const claim of claims) {
                this.recordDiscovery(claim, evidenceId);
            }

            // Record the tool call
            this.recordToolCall(
                result.tool,
                result.args,
                this.hashResult(result.data),
                evidenceId
            );
        }
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private normalizeClaim(claim: string): string {
        return claim.trim().toLowerCase().replace(/\s+/g, " ");
    }

    private toolCallKey(tool: string, args: Record<string, unknown>): string {
        // Sort keys for deterministic hashing
        const sortedArgs = Object.keys(args)
            .sort()
            .map((k) => `${k}:${String(args[k])}`)
            .join("|");
        return `${tool}:${sortedArgs}`;
    }

    private hashResult(data: unknown): string {
        const str = typeof data === "string" ? data : JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0;
        }
        return hash.toString(36);
    }

    /**
     * Extract simple factual claims from a tool result.
     * Heuristic — looks for winner, fastest lap, pole position, etc.
     */
    private extractClaims(result: ExecutionResult): string[] {
        const claims: string[] = [];
        let data = result.data;

        if (typeof data === "string") {
            try {
                data = JSON.parse(data);
            } catch {
                return claims;
            }
        }

        if (typeof data !== "object" || data === null) return claims;
        const obj = data as Record<string, unknown>;

        // Race results — extract winner
        if (Array.isArray(obj.results)) {
            const results = obj.results as Record<string, unknown>[];
            const winner = results.find((r) => Number(r.position) === 1 || r.position === "1");
            if (winner?.driver) {
                const race = result.args.gp || result.args.event_name || "race";
                const year = result.args.year || "";
                claims.push(`${winner.driver} won ${race} ${year}`);
            }
        }

        // Standings — extract championship leader
        if (Array.isArray(obj.standings)) {
            const standings = obj.standings as Record<string, unknown>[];
            const leader = standings.find((s) => Number(s.position) === 1 || s.position === "1");
            if (leader?.driver) {
                const year = result.args.year || "";
                claims.push(`${leader.driver} leads the championship in ${year} with ${leader.points} points`);
            }
        }

        // Qualifying — extract pole sitter
        if (Array.isArray(obj.results) && result.tool === "get_qualifying") {
            const results = obj.results as Record<string, unknown>[];
            const pole = results.find((r) => Number(r.position) === 1 || r.position === "1");
            if (pole?.driver) {
                const race = result.args.gp || "GP";
                const year = result.args.year || "";
                claims.push(`${pole.driver} took pole at ${race} ${year}`);
            }
        }

        return claims;
    }
}
