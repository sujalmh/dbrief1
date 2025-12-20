/**
 * Test Helper Utilities
 * =====================
 * Assertion helpers for F1 chatbot testing
 */

import { Plan, Step } from '@/lib/planner'
import {
    TOOL_SCHEMAS,
    VALID_YEARS,
    VALID_DRIVER_CODES,
    VALID_SESSIONS,
    VALID_GP_NAMES
} from '../fixtures/golden-outputs'

// =============================================================================
// Plan Assertions
// =============================================================================

/**
 * Assert that a plan contains a specific tool
 */
export function assertPlanContainsTool(plan: Plan, toolName: string): Step | undefined {
    const step = plan.steps.find(s => s.tool === toolName)
    if (!step) {
        throw new Error(`Expected plan to contain tool "${toolName}", but got: [${plan.steps.map(s => s.tool).join(', ')}]`)
    }
    return step
}

/**
 * Assert that a plan does NOT contain a specific tool
 */
export function assertPlanDoesNotContainTool(plan: Plan, toolName: string): void {
    const step = plan.steps.find(s => s.tool === toolName)
    if (step) {
        throw new Error(`Expected plan to NOT contain tool "${toolName}", but it was found`)
    }
}

/**
 * Assert that plan arguments match expected values
 */
export function assertPlanArgs(
    step: Step,
    expected: Record<string, unknown>,
    strictMatch: boolean = false
): void {
    for (const [key, value] of Object.entries(expected)) {
        const actualValue = step.args[key]

        // Handle case-insensitive string matching for GP names
        if (typeof value === 'string' && typeof actualValue === 'string') {
            if (value.toLowerCase() !== actualValue.toLowerCase()) {
                throw new Error(
                    `Expected arg "${key}" to be "${value}", but got "${actualValue}"`
                )
            }
        } else if (actualValue !== value) {
            throw new Error(
                `Expected arg "${key}" to be ${JSON.stringify(value)}, but got ${JSON.stringify(actualValue)}`
            )
        }
    }

    if (strictMatch) {
        const extraKeys = Object.keys(step.args).filter(k => !(k in expected))
        if (extraKeys.length > 0) {
            throw new Error(`Unexpected extra arguments: ${extraKeys.join(', ')}`)
        }
    }
}

/**
 * Validate that plan arguments match the tool schema
 */
export function validatePlanSchema(plan: Plan): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const step of plan.steps) {
        const schema = TOOL_SCHEMAS[step.tool as keyof typeof TOOL_SCHEMAS]
        if (!schema) {
            errors.push(`Unknown tool: ${step.tool}`)
            continue
        }

        // Check required args
        for (const required of schema.required) {
            if (!(required in step.args)) {
                errors.push(`Missing required arg "${required}" for tool "${step.tool}"`)
            }
        }

        // Validate year if present
        if ('year' in step.args) {
            const year = step.args.year as number
            if (!VALID_YEARS.includes(year)) {
                errors.push(`Invalid year ${year} for tool "${step.tool}"`)
            }
        }

        // Validate driver if present
        if ('driver' in step.args) {
            const driver = step.args.driver as string
            if (!VALID_DRIVER_CODES.includes(driver.toUpperCase())) {
                errors.push(`Invalid driver code "${driver}" for tool "${step.tool}"`)
            }
        }

        // Validate session if present
        if ('session' in step.args) {
            const session = step.args.session as string
            if (!VALID_SESSIONS.includes(session.toUpperCase())) {
                errors.push(`Invalid session "${session}" for tool "${step.tool}"`)
            }
        }
    }

    return { valid: errors.length === 0, errors }
}

// =============================================================================
// Response Assertions
// =============================================================================

/**
 * Check for hallucinated data in response
 */
export function assertNoHallucination(
    response: string,
    validDrivers: string[] = VALID_DRIVER_CODES,
    validYear: number = 2024
): { hasHallucination: boolean; issues: string[] } {
    const issues: string[] = []

    // Check for future years mentioned as past
    const futureYearMatch = response.match(/in (\d{4})/gi)
    if (futureYearMatch) {
        for (const match of futureYearMatch) {
            const year = parseInt(match.replace(/\D/g, ''))
            if (year > validYear) {
                issues.push(`Potential hallucination: mentions future year ${year}`)
            }
        }
    }

    // Check for fabricated lap times (unrealistic values)
    const lapTimeMatch = response.match(/(\d+):(\d{2}\.\d{3})/g)
    if (lapTimeMatch) {
        for (const time of lapTimeMatch) {
            const [min, sec] = time.split(':')
            const totalSeconds = parseInt(min) * 60 + parseFloat(sec)
            // F1 lap times are typically 60-120 seconds
            if (totalSeconds < 50 || totalSeconds > 180) {
                issues.push(`Potentially fabricated lap time: ${time}`)
            }
        }
    }

    return { hasHallucination: issues.length > 0, issues }
}

/**
 * Check if response is a refusal/correction
 */
export function isRefusalResponse(response: string): boolean {
    const refusalPatterns = [
        /i can't|i cannot|i'm unable|i am unable/i,
        /i don't have|i do not have/i,
        /that data is not available/i,
        /invalid|not valid/i,
        /please provide|could you clarify/i,
        /i need more information/i,
        /that request is not possible/i
    ]

    return refusalPatterns.some(pattern => pattern.test(response))
}

/**
 * Check if response contains a clarifying question
 */
export function hasClarifyingQuestion(response: string): boolean {
    const questionPatterns = [
        /which (year|race|session|driver)/i,
        /what (year|race|session|driver)/i,
        /please specify/i,
        /could you clarify/i,
        /do you mean/i,
        /\?$/m
    ]

    return questionPatterns.some(pattern => pattern.test(response))
}

// =============================================================================
// Visualization Assertions
// =============================================================================

export interface ChartData {
    data: Array<Record<string, unknown>>
    xKey?: string
    yKey?: string
    chartType?: string
}

/**
 * Validate visualization data integrity
 */
export function assertVisualizationIntegrity(
    chartData: ChartData,
    expectedType: 'lap_times' | 'telemetry' | 'comparison'
): { valid: boolean; issues: string[] } {
    const issues: string[] = []

    // Check data is not empty
    if (!chartData.data || chartData.data.length === 0) {
        issues.push('Chart data is empty')
        return { valid: false, issues }
    }

    // Check for lap time charts
    if (expectedType === 'lap_times') {
        // X-axis should be lap number
        const hasLapKey = chartData.data[0] && ('lap' in chartData.data[0] || 'lap_number' in chartData.data[0])
        if (!hasLapKey) {
            issues.push('Lap time chart missing lap number on X-axis')
        }

        // Check for monotonic lap index
        const laps = chartData.data.map(d => d.lap || d.lap_number) as number[]
        for (let i = 1; i < laps.length; i++) {
            if (laps[i] < laps[i - 1]) {
                issues.push('Lap numbers are not monotonically increasing')
                break
            }
        }

        // Y-axis should be time
        const hasTimeKey = chartData.data[0] && ('time' in chartData.data[0] || 'lap_time' in chartData.data[0])
        if (!hasTimeKey) {
            issues.push('Lap time chart missing time value on Y-axis')
        }
    }

    // Check for telemetry charts
    if (expectedType === 'telemetry') {
        // X-axis should be distance
        const hasDistanceKey = chartData.data[0] && 'distance' in chartData.data[0]
        if (!hasDistanceKey) {
            issues.push('Telemetry chart missing distance on X-axis')
        }

        // Should have speed or throttle
        const hasDataChannel = chartData.data[0] && (
            'speed' in chartData.data[0] ||
            'throttle' in chartData.data[0] ||
            'brake' in chartData.data[0]
        )
        if (!hasDataChannel) {
            issues.push('Telemetry chart missing speed/throttle/brake data')
        }
    }

    return { valid: issues.length === 0, issues }
}

/**
 * Check that dataset lengths match expected
 */
export function assertDatasetLength(
    data: unknown[],
    minLength: number,
    maxLength?: number
): void {
    if (data.length < minLength) {
        throw new Error(`Expected at least ${minLength} data points, got ${data.length}`)
    }
    if (maxLength && data.length > maxLength) {
        throw new Error(`Expected at most ${maxLength} data points, got ${data.length}`)
    }
}
