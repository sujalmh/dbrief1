/**
 * Data Parser Unit Tests
 * ======================
 * Tests for visualization data extraction and parsing
 */

import { describe, it, expect } from 'vitest'
import {
    detectDataType,
    extractLapTimes,
    extractTelemetry,
    extractComparison,
    hasVisualizableData,
    isChartablePayload
} from '@/lib/visualization/data-parser'
import {
    assertVisualizationIntegrity,
    assertDatasetLength
} from '../utils/test-helpers'

// =============================================================================
// Data Type Detection Tests
// =============================================================================

describe('Data Type Detection', () => {
    it('should detect telemetry data', () => {
        const content = `Here's the speed and throttle trace: {"data": [{"Speed": 300}]}`
        expect(detectDataType(content)).toBe('telemetry')
    })

    it('should detect lap times data', () => {
        const content = `Lap times for VER: {"laps": [{"lap_number": 1, "lap_time": "1:23.456"}]}`
        expect(detectDataType(content)).toBe('lap_times')
    })

    it('should detect comparison data', () => {
        const content = `Compare VER versus HAM: {"results": []}`
        expect(detectDataType(content)).toBe('comparison')
    })

    it('should detect weather data', () => {
        const content = `Temperature was 25°C with 40% humidity`
        expect(detectDataType(content)).toBe('weather')
    })

    it('should return unknown for ambiguous content', () => {
        const content = `Hello, how can I help you?`
        expect(detectDataType(content)).toBe('unknown')
    })
})

// =============================================================================
// Lap Time Extraction Tests
// =============================================================================

describe('Lap Time Extraction', () => {
    it('should extract lap times from JSON block', () => {
        const content = `
Here are the lap times:
\`\`\`json
{
  "laps": [
    {"lap_number": 1, "lap_time": "1:23.456", "driver": "VER"},
    {"lap_number": 2, "lap_time": "1:22.789", "driver": "VER"}
  ]
}
\`\`\`
`
        const laps = extractLapTimes(content)

        expect(laps).toHaveLength(2)
        expect(laps[0].lap).toBe(1)
        expect(laps[0].time).toBeCloseTo(83.456, 2)
        expect(laps[0].driver).toBe('VER')
    })

    it('should handle lap time in seconds format', () => {
        const content = `\`\`\`json
{"laps": [{"lap_number": 1, "lap_time": 83.456}]}
\`\`\``
        const laps = extractLapTimes(content)

        expect(laps[0].time).toBeCloseTo(83.456, 2)
    })

    it('should filter out invalid lap times', () => {
        const content = `\`\`\`json
{"laps": [
      {"lap_number": 1, "lap_time": "1:23.456"},
      {"lap_number": 2, "lap_time": "invalid"},
      {"lap_number": 3, "lap_time": "1:24.000"}
    ]}
\`\`\``

        const laps = extractLapTimes(content)
        expect(laps.filter(l => l.time > 0)).toHaveLength(2)
    })

    it('should extract compound information', () => {
        const content = `\`\`\`json
{"laps": [{"lap_number": 1, "lap_time": "1:23.456", "compound": "SOFT"}]}
\`\`\``
        const laps = extractLapTimes(content)

        expect(laps[0].compound).toBe('SOFT')
    })
})

// =============================================================================
// Telemetry Extraction Tests
// =============================================================================

describe('Telemetry Extraction', () => {
    it('should extract telemetry data points', () => {
        const content = `
\`\`\`json
{
  "data": [
    {"Distance": 0, "Speed": 100, "Throttle": 100},
    {"Distance": 10, "Speed": 150, "Throttle": 100},
    {"Distance": 20, "Speed": 200, "Throttle": 80}
  ]
}
\`\`\`
`
        const telemetry = extractTelemetry(content)

        expect(telemetry).toHaveLength(3)
        expect(telemetry[0].distance).toBe(0)
        expect(telemetry[0].speed).toBe(100)
        expect(telemetry[0].throttle).toBe(100)
    })

    it('should handle brake and gear data', () => {
        const content = `\`\`\`json
{"data": [{"Distance": 0, "Brake": 50, "nGear": 5}]}
\`\`\``
        const telemetry = extractTelemetry(content)

        expect(telemetry[0].brake).toBe(50)
        expect(telemetry[0].gear).toBe(5)
    })

    it('should downsample large datasets', () => {
        // Create content with 1000 data points
        const dataPoints = Array(1000).fill(null).map((_, i) => ({
            Distance: i * 10,
            Speed: 200 + Math.random() * 50
        }))
        const content = JSON.stringify({ data: dataPoints })

        const telemetry = extractTelemetry(content)

        // Should be downsampled to ~500 points
        expect(telemetry.length).toBeLessThanOrEqual(500)
    })
})

// =============================================================================
// Comparison Extraction Tests
// =============================================================================

describe('Comparison Extraction', () => {
    it('should extract comparison from results array', () => {
        const content = `
\`\`\`json
{
  "results": [
    {"driver": "VER", "time": "1:23.456"},
    {"driver": "HAM", "time": "1:24.000"}
  ]
}
\`\`\`
`
        const comparison = extractComparison(content)

        expect(comparison).toHaveLength(2)
        expect(comparison[0].driver).toBe('VER')
        expect(comparison[0].value).toBeCloseTo(83.456, 2)
    })

    it('should handle position-based comparison', () => {
        const content = `\`\`\`json
{"results": [{"driver": "VER", "position": 1}, {"driver": "HAM", "position": 2}]}
\`\`\``
        const comparison = extractComparison(content)

        expect(comparison[0].value).toBe(1)
        expect(comparison[1].value).toBe(2)
    })

    it('should filter invalid values', () => {
        const content = `\`\`\`json
{"results": [
      {"driver": "VER", "time": "1:23.456"},
      {"driver": "HAM", "time": "invalid"}
    ]}
\`\`\``

        const comparison = extractComparison(content)
        expect(comparison.filter(c => !isNaN(c.value))).toHaveLength(1)
    })
})

// =============================================================================
// Visualization Integrity Tests
// =============================================================================

describe('6️⃣ Visualization Integrity', () => {
    it('should validate lap time chart structure', () => {
        const chartData = {
            data: [
                { lap: 1, time: 83.5 },
                { lap: 2, time: 82.9 },
                { lap: 3, time: 83.1 }
            ]
        }

        const result = assertVisualizationIntegrity(chartData, 'lap_times')
        expect(result.valid).toBe(true)
    })

    it('should detect missing lap key', () => {
        const chartData = {
            data: [
                { time: 83.5 },
                { time: 82.9 }
            ]
        }

        const result = assertVisualizationIntegrity(chartData, 'lap_times')
        expect(result.valid).toBe(false)
        expect(result.issues).toContain('Lap time chart missing lap number on X-axis')
    })

    it('should detect non-monotonic lap numbers', () => {
        const chartData = {
            data: [
                { lap: 1, time: 83.5 },
                { lap: 3, time: 82.9 },
                { lap: 2, time: 83.1 }  // Out of order
            ]
        }

        const result = assertVisualizationIntegrity(chartData, 'lap_times')
        expect(result.valid).toBe(false)
        expect(result.issues.some(i => i.includes('monotonically'))).toBe(true)
    })

    it('should validate telemetry chart structure', () => {
        const chartData = {
            data: [
                { distance: 0, speed: 100 },
                { distance: 10, speed: 150 }
            ]
        }

        const result = assertVisualizationIntegrity(chartData, 'telemetry')
        expect(result.valid).toBe(true)
    })

    it('should detect missing distance in telemetry', () => {
        const chartData = {
            data: [
                { speed: 100 },
                { speed: 150 }
            ]
        }

        const result = assertVisualizationIntegrity(chartData, 'telemetry')
        expect(result.valid).toBe(false)
        expect(result.issues).toContain('Telemetry chart missing distance on X-axis')
    })

    it('should validate dataset length constraints', () => {
        const data = Array(100).fill({ lap: 1, time: 80 })

        // Should pass with valid range
        expect(() => assertDatasetLength(data, 50, 200)).not.toThrow()

        // Should fail when too short
        expect(() => assertDatasetLength(data, 150)).toThrow()
    })
})

// =============================================================================
// Has Visualizable Data Tests
// =============================================================================

describe('Has Visualizable Data', () => {
    it('should return true for lap time data', () => {
        const content = `\`\`\`json
{"laps": [{"lap_number": 1, "lap_time": "1:23.456"}]}
\`\`\``
        expect(hasVisualizableData(content)).toBe(true)
    })

    it('should return false for plain text', () => {
        const content = `Hello, I cannot help with that request.`
        expect(hasVisualizableData(content)).toBe(false)
    })

    it('should return true for telemetry data', () => {
        const content = `Speed trace: \`\`\`json
{"data": [{"Speed": 300, "throttle": 100, "Distance": 0}]}
\`\`\``
        expect(hasVisualizableData(content)).toBe(true)
    })
})

// =============================================================================
// Is Chartable Payload Tests (visualization auto-decide)
// =============================================================================

describe('Is Chartable Payload', () => {
    it('should return true for successful telemetry series', () => {
        expect(isChartablePayload([
            { tool: 'get_telemetry', success: true, data: { data: [{ Speed: 300 }] } },
        ])).toBe(true)
    })

    it('should return true for successful lap series', () => {
        expect(isChartablePayload([
            { tool: 'get_race', success: true, data: { results: [{ position: 1 }] } },
            { tool: 'get_laps', success: true, data: { laps: [{ LapNumber: 1 }] } },
        ])).toBe(true)
    })

    it('should return false for tables alone', () => {
        expect(isChartablePayload([
            { tool: 'get_driver_standings', success: true, data: { standings: [{ position: 1 }] } },
        ])).toBe(false)
    })

    it('should return false when series are empty or failed', () => {
        expect(isChartablePayload([
            { tool: 'get_telemetry', success: true, data: { data: [] } },
            { tool: 'get_laps', success: false, data: { laps: [{ LapNumber: 1 }] } },
        ])).toBe(false)
    })

    it('should return false for non-array payloads', () => {
        expect(isChartablePayload(null)).toBe(false)
        expect(isChartablePayload({})).toBe(false)
        expect(isChartablePayload([])).toBe(false)
    })
})
