/**
 * Confidence Calculator
 * =====================
 *
 * Computes confidence algorithmically — never LLM-guessed. Factors:
 *   - sourceCount: number of distinct evidence pieces
 *   - completeness: % of expected evidence types for the research type
 *   - conflicts: count of contradictory evidence
 *   - missingData: list of expected-but-missing evidence types
 *   - dataQuality: weighted by evidence source quality
 *
 * Formula: overall = 0.3*sourceCountFactor + 0.3*completeness + 0.2*(1-conflictFactor) + 0.2*dataQuality
 */

import type { ConfidenceScore, ConfidenceFactors, ResearchType } from "./types";
import { RESEARCH_TYPE_EXPECTATIONS } from "./types";
import type { EvidenceStore } from "./evidence-store";
import { researchConfig } from "@/lib/config";

// =============================================================================
// Confidence Calculator
// =============================================================================

export class ConfidenceCalculator {
    /**
     * Compute confidence from the evidence store and research type.
     */
    compute(
        evidenceStore: EvidenceStore,
        researchType: ResearchType,
        _objective: string
    ): ConfidenceScore {
        void _objective;
        const allEvidence = evidenceStore.getAll();
        const sourceCount = allEvidence.length;

        // --- Completeness: % of expected evidence types present ---
        const expectedTypes = RESEARCH_TYPE_EXPECTATIONS[researchType] || [];
        const presentTypes = Array.from(evidenceStore.getEvidenceTypes());
        const missingData = expectedTypes.filter(
            (t) => !presentTypes.includes(t as (typeof presentTypes)[number])
        ) as string[];
        const weights = researchConfig.confidence();
        const completeness =
            expectedTypes.length > 0
                ? (expectedTypes.length - missingData.length) / expectedTypes.length
                : weights.defaultCompleteness; // Default if no expectations defined

        // --- Conflicts: count contradictory evidence ---
        const conflicts = this.countConflicts(allEvidence);

        // --- Data quality: weighted average of evidence confidence ---
        const dataQuality = this.computeDataQuality(allEvidence);

        // --- Source count factor: diminishing returns ---
        const sourceCountFactor = Math.min(1, sourceCount / weights.fullScoreSourceCount);

        // --- Conflict factor: fewer conflicts = higher score ---
        const conflictFactor = Math.min(1, conflicts / weights.maxConflictPenalty);

        // --- Overall weighted formula (weights are config-driven) ---
        const overall =
            weights.weightSourceCount * sourceCountFactor +
            weights.weightCompleteness * completeness +
            weights.weightConflicts * (1 - conflictFactor) +
            weights.weightDataQuality * dataQuality;

        const factors: ConfidenceFactors = {
            sourceCount,
            completeness,
            conflicts,
            missingData,
            dataQuality,
        };

        return {
            overall: Math.round(overall * 100) / 100,
            factors,
        };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Count contradictory evidence. Heuristic: if two evidence pieces of the
     * same type reference the same race/season but have different key values
     * (e.g., different winners), that's a conflict.
     */
    private countConflicts(evidence: { type: string; race?: string; season?: number; data: unknown; source: { tool: string; args: Record<string, unknown> } }[]): number {
        let conflicts = 0;

        // Group by (type, race, season)
        const groups = new Map<string, typeof evidence>();
        for (const e of evidence) {
            const key = `${e.type}:${e.race || ""}:${e.season || ""}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }

        // Check for conflicting winners in race results
        for (const group of groups.values()) {
            if (group.length < 2) continue;
            if (group[0].type === "race") {
                const winners = new Set<string>();
                for (const e of group) {
                    const winner = this.extractWinner(e.data);
                    if (winner) winners.add(winner);
                }
                if (winners.size > 1) conflicts++;
            }
        }

        return conflicts;
    }

    /**
     * Compute data quality as weighted average of evidence confidence.
     */
    private computeDataQuality(
        evidence: { confidence: number }[]
    ): number {
        if (evidence.length === 0) return 0;
        const sum = evidence.reduce((acc, e) => acc + e.confidence, 0);
        return sum / evidence.length;
    }

    /**
     * Extract the winner from race result data.
     */
    private extractWinner(data: unknown): string | null {
        let parsed = data;
        if (typeof parsed === "string") {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                return null;
            }
        }
        if (typeof parsed !== "object" || parsed === null) return null;
        const obj = parsed as Record<string, unknown>;
        if (!Array.isArray(obj.results)) return null;
        const results = obj.results as Record<string, unknown>[];
        const winner = results.find(
            (r) => Number(r.position) === 1 || r.position === "1"
        );
        return winner?.driver ? String(winner.driver) : null;
    }
}
