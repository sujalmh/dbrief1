/**
 * Data Parser for F1 Visualization
 * ==================================
 * Extracts and transforms F1 data from message content for charting
 */

export interface LapDataPoint {
    lap: number
    time: number
    driver?: string
    compound?: string
}

export interface TelemetryDataPoint {
    distance: number
    speed?: number
    throttle?: number
    brake?: number
    gear?: number
    rpm?: number
    drs?: number
    driver?: string   // Driver code for multi-driver comparison
    lapId?: string    // e.g., "VER_L23" for multi-lap comparison
}

export interface ComparisonDataPoint {
    driver: string
    value: number
    label?: string
}

export type ChartDataType = 'lap_times' | 'telemetry' | 'comparison' | 'weather' | 'unknown'

/**
 * Detect the type of F1 data in the content
 */
export function detectDataType(content: string): ChartDataType {
    const lowerContent = content.toLowerCase()

    // Check for telemetry indicators
    if (lowerContent.includes('speed') && lowerContent.includes('throttle')) {
        return 'telemetry'
    }

    // Check for lap time indicators
    if (lowerContent.includes('lap_time') || lowerContent.includes('laptime') ||
        (lowerContent.includes('lap') && lowerContent.includes('time'))) {
        return 'lap_times'
    }

    // Check for comparison indicators
    if (lowerContent.includes('compare') || lowerContent.includes('versus')) {
        return 'comparison'
    }

    // Check for multiple driver codes (3-letter codes)
    const driverCodes = content.match(/\b[A-Z]{3}\b/g)
    if (driverCodes && driverCodes.length >= 2 && lowerContent.includes('driver')) {
        return 'comparison'
    }

    // Check for weather
    if (lowerContent.includes('temperature') || lowerContent.includes('humidity') ||
        lowerContent.includes('rainfall')) {
        return 'weather'
    }

    return 'unknown'
}

/**
 * Extract JSON blocks from markdown content
 */
function extractJsonBlocks(content: string): any[] {
    const jsonBlocks: any[] = []

    // First, try to extract from markdown code blocks
    const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g

    let match
    while ((match = codeBlockRegex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1])
            jsonBlocks.push(parsed)
        } catch {
            // Ignore invalid JSON
        }
    }

    // If no code blocks found, try to find raw JSON objects
    if (jsonBlocks.length === 0) {
        // Look for JSON objects in the content
        const jsonObjectRegex = /\{[\s\S]*?\}/g
        const matches = content.match(jsonObjectRegex)

        if (matches) {
            for (const jsonStr of matches) {
                try {
                    const parsed = JSON.parse(jsonStr)
                    // Only add if it looks like F1 data
                    if (parsed.laps || parsed.data || parsed.results ||
                        Array.isArray(parsed) || parsed.lap_number || parsed.driver) {
                        jsonBlocks.push(parsed)
                    }
                } catch {
                    // Ignore invalid JSON
                }
            }
        }
    }

    return jsonBlocks
}

/**
 * Parse lap times data from content
 */
export function extractLapTimes(content: string): LapDataPoint[] {
    const jsonBlocks = extractJsonBlocks(content)
    const lapData: LapDataPoint[] = []

    for (const block of jsonBlocks) {
        // Handle array of laps
        if (Array.isArray(block)) {
            for (const item of block) {
                if (item.lap_number !== undefined && item.lap_time !== undefined) {
                    lapData.push({
                        lap: parseInt(item.lap_number),
                        time: parseLapTime(item.lap_time),
                        driver: item.driver || undefined,
                        compound: item.compound || undefined
                    })
                }
            }
        }

        // Handle laps object
        if (block.laps && Array.isArray(block.laps)) {
            for (const lap of block.laps) {
                if (lap.lap_number !== undefined && lap.lap_time !== undefined) {
                    lapData.push({
                        lap: parseInt(lap.lap_number),
                        time: parseLapTime(lap.lap_time),
                        driver: lap.driver || undefined,
                        compound: lap.compound || undefined
                    })
                }
            }
        }
    }

    return lapData.filter(d => !isNaN(d.time) && d.time > 0)
}

/**
 * Parse telemetry data from content
 */
export function extractTelemetry(content: string): TelemetryDataPoint[] {
    const jsonBlocks = extractJsonBlocks(content)
    const telemetryData: TelemetryDataPoint[] = []

    for (const block of jsonBlocks) {
        // Handle telemetry data array
        if (block.data && Array.isArray(block.data)) {
            for (const point of block.data) {
                telemetryData.push({
                    distance: parseFloat(point.Distance || point.distance || 0),
                    speed: point.Speed !== undefined ? parseFloat(point.Speed) : undefined,
                    throttle: point.Throttle !== undefined ? parseFloat(point.Throttle) : undefined,
                    brake: point.Brake !== undefined ? parseFloat(point.Brake) : undefined,
                    gear: point.nGear || point.gear !== undefined ? parseInt(point.nGear || point.gear) : undefined,
                    rpm: point.RPM || point.rpm !== undefined ? parseInt(point.RPM || point.rpm) : undefined,
                    drs: point.DRS || point.drs !== undefined ? parseInt(point.DRS || point.drs) : undefined
                })
            }
        }
    }

    // Downsample if too many points
    if (telemetryData.length > 500) {
        const step = Math.ceil(telemetryData.length / 500)
        return telemetryData.filter((_, i) => i % step === 0)
    }

    return telemetryData
}

/**
 * Parse comparison data from content
 */
export function extractComparison(content: string): ComparisonDataPoint[] {
    const jsonBlocks = extractJsonBlocks(content)
    const comparisonData: ComparisonDataPoint[] = []

    for (const block of jsonBlocks) {
        // Handle results array
        if (block.results && Array.isArray(block.results)) {
            for (const result of block.results) {
                if (result.driver && (result.time || result.position)) {
                    comparisonData.push({
                        driver: result.driver,
                        value: result.time ? parseLapTime(result.time) : parseInt(result.position),
                        label: result.q3 || result.q2 || result.q1 || undefined
                    })
                }
            }
        }

        // Handle direct array of driver data
        if (Array.isArray(block) && block.length > 0 && block[0].driver) {
            for (const item of block) {
                if (item.driver && (item.time || item.lap_time || item.position)) {
                    comparisonData.push({
                        driver: item.driver,
                        value: item.time ? parseLapTime(item.time) :
                            item.lap_time ? parseLapTime(item.lap_time) :
                                parseInt(item.position),
                        label: item.compound || undefined
                    })
                }
            }
        }
    }

    return comparisonData.filter(d => !isNaN(d.value))
}

/**
 * Parse lap time string to seconds
 */
function parseLapTime(timeStr: string | number): number {
    if (typeof timeStr === 'number') return timeStr

    // Format: "1:23.456" or "83.456"
    if (timeStr.includes(':')) {
        const [min, sec] = timeStr.split(':')
        return parseInt(min) * 60 + parseFloat(sec)
    }

    return parseFloat(timeStr)
}

/**
 * Check if content has visualizable data
 */
export function hasVisualizableData(content: string): boolean {
    const dataType = detectDataType(content)
    if (dataType === 'unknown') return false

    const jsonBlocks = extractJsonBlocks(content)
    return jsonBlocks.length > 0
}
