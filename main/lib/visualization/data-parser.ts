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
    season?: string | number
}

export type ChartDataType = 'lap_times' | 'telemetry' | 'comparison' | 'weather' | 'unknown'

/** A loose JSON object row (tool payloads mix snake_case and PascalCase keys). */
export type DataRow = Record<string, unknown>;

const asRow = (value: unknown): DataRow | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as DataRow)
        : null;

/** First usable value for any of the keys (numbers stringified). */
function rowText(row: DataRow, ...keys: string[]): string {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
}

/** Parse an unknown value with parseFloat/parseInt, or undefined when absent. */
function numOrUndefined(value: unknown, parse: (v: string) => number): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = parse(String(value));
    return isNaN(parsed) ? undefined : parsed;
}

/** First value for any of the keys, or undefined. */
function rowValue(row: DataRow, ...keys: string[]): unknown {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
}

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
function extractJsonBlocks(content: string): unknown[] {
    const jsonBlocks: unknown[] = []

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
                        Array.isArray(parsed) || parsed.lap_number || parsed.driver || parsed.Driver) {
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
                const row = asRow(item);
                if (!row) continue;
                const lapNumber = rowValue(row, 'lap_number', 'LapNumber');
                const lapTime = rowValue(row, 'lap_time', 'LapTime');

                if (lapNumber !== undefined && lapTime !== undefined) {
                    lapData.push({
                        lap: parseInt(String(lapNumber)),
                        time: parseLapTime(typeof lapTime === "number" ? lapTime : String(lapTime)),
                        driver: rowText(row, 'driver', 'Driver') || undefined,
                        compound: rowText(row, 'compound', 'Compound') || undefined
                    })
                }
            }
        }

        // Handle laps object
        const lapsRow = asRow(block);
        const laps = lapsRow?.['laps'];
        if (Array.isArray(laps)) {
            for (const entry of laps) {
                const lap = asRow(entry);
                if (!lap) continue;
                const lapNumber = rowValue(lap, 'lap_number', 'LapNumber');
                const lapTime = rowValue(lap, 'lap_time', 'LapTime');

                if (lapNumber !== undefined && lapTime !== undefined) {
                    lapData.push({
                        lap: parseInt(String(lapNumber)),
                        time: parseLapTime(typeof lapTime === "number" ? lapTime : String(lapTime)),
                        driver: rowText(lap, 'driver', 'Driver') || undefined,
                        compound: rowText(lap, 'compound', 'Compound') || undefined
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
        const row = asRow(block);
        const points = row?.['data'];
        if (Array.isArray(points)) {
            for (const entry of points) {
                const point = asRow(entry);
                if (!point) continue;
                // Support both snake_case and PascalCase
                const getVal = (key1: string, key2: string): unknown =>
                    rowValue(point, key1, key2);

                telemetryData.push({
                    distance: parseFloat(rowText(point, 'Distance', 'distance') || '0'),
                    speed: numOrUndefined(getVal('Speed', 'speed'), parseFloat),
                    throttle: numOrUndefined(getVal('Throttle', 'throttle'), parseFloat),
                    brake: numOrUndefined(getVal('Brake', 'brake'), parseFloat),
                    gear: numOrUndefined(getVal('nGear', 'gear'), parseInt),
                    rpm: numOrUndefined(getVal('RPM', 'rpm'), parseInt),
                    drs: numOrUndefined(getVal('DRS', 'drs'), parseInt),
                    driver: rowText(point, 'driver', 'Driver') || undefined
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
        const row = asRow(block);
        const results = row?.['results'];
        if (Array.isArray(results)) {
            for (const entry of results) {
                const result = asRow(entry);
                if (!result) continue;
                const driver = rowText(result, 'driver', 'Driver');
                const time = rowText(result, 'time', 'Time');
                const position = rowText(result, 'position', 'Position');

                if (driver && (time || position)) {
                    comparisonData.push({
                        driver: driver,
                        value: time ? parseLapTime(time) : parseInt(position),
                        label: rowText(result, 'q3', 'q2', 'q1') || undefined
                    })
                }
            }
        }

        // Handle direct array of driver data
        if (Array.isArray(block) && block.length > 0) {
            const first = asRow(block[0]);
            if (first && (first['driver'] || first['Driver'])) {
                for (const entry of block) {
                    const item = asRow(entry);
                    if (!item) continue;
                    const driver = rowText(item, 'driver', 'Driver');
                    const time = rowText(item, 'time', 'lap_time', 'Time');
                    const position = rowText(item, 'position', 'Position');

                    if (driver && (time || position)) {
                        comparisonData.push({
                            driver: driver,
                            value: time ? parseLapTime(time) : parseInt(position),
                            label: rowText(item, 'compound', 'Compound') || undefined
                        })
                    }
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
    if (!timeStr) return 0

    // Format: "1:23.456" or "83.456"
    if (typeof timeStr === 'string' && timeStr.includes(':')) {
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

/**
 * Tools whose successful output is time-series data worth charting
 * without being asked. Tables (standings, results, weather) stay
 * manual — the panel can't do much with a bare P1-P20 list, and
 * popping it open on every results answer would be noise.
 */
const CHARTABLE_TOOLS = new Set(["get_telemetry", "get_laps"]);

/** True when data holds at least one non-empty array (series points). */
function hasSeriesPoints(data: unknown): boolean {
    if (Array.isArray(data)) return data.length > 0;
    if (typeof data === "object" && data !== null) {
        return Object.values(data).some((v) => Array.isArray(v) && v.length > 0);
    }
    return false;
}

/**
 * Auto-decide input for the visualization toggle: true when a
 * `visualization` SSE payload carries successful time-series output.
 * Shape mirrors the route's visualization event items
 * ({tool, args, success, data}).
 */
export function isChartablePayload(payload: unknown): boolean {
    if (!Array.isArray(payload)) return false;
    return payload.some((item) => {
        if (typeof item !== "object" || item === null) return false;
        const row = item as { tool?: unknown; success?: unknown; data?: unknown };
        return (
            typeof row.tool === "string" &&
            CHARTABLE_TOOLS.has(row.tool) &&
            row.success === true &&
            hasSeriesPoints(row.data)
        );
    });
}
