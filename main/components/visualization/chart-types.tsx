"use client"

import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell,
    ReferenceLine
} from 'recharts'
import type { LapDataPoint, TelemetryDataPoint, ComparisonDataPoint } from '@/lib/visualization/data-parser'

// F1 Color scheme
const F1_COLORS = {
    red: '#E10600',
    green: '#00D26A',
    yellow: '#FFD700',
    purple: '#A855F7',
    teal: '#00D2BE',
    orange: '#FF8700',
    blue: '#0600EF',
    darkGreen: '#006F62',
    darkBlue: '#2B4562',
    silver: '#B6BABD'
}

// Color palette for multi-entity comparison
const COMPARISON_COLORS = [
    '#F2059F', // Pink (High contrast)
    '#00D2BE', // Cyan/Teal
    '#FFEA00', // Yellow
    '#52E252', // Lime
    '#FF8700', // Orange
    '#A855F7', // Purple
    '#E10600', // Red
    '#0600EF', // Blue
    '#B6BABD', // Grey
    '#006F62', // Dark Green
]


const CIRCUIT_CORNERS: Record<string, { distance: number; corner: number; name?: string }[]> = {
    default: [
        { distance: 200, corner: 1 },
        { distance: 600, corner: 2 },
        { distance: 1000, corner: 3 },
        { distance: 1500, corner: 4 },
        { distance: 2000, corner: 5 },
        { distance: 2500, corner: 6 },
        { distance: 3000, corner: 7 },
        { distance: 3500, corner: 8 },
        { distance: 4000, corner: 9 },
        { distance: 4500, corner: 10 },
    ]
}

// Helper: Format lap time from seconds to mm:ss.sss
function formatLapTime(seconds: number): string {
    if (seconds <= 0 || isNaN(seconds)) return '--:--.---'
    const mins = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(3).padStart(6, '0')
    return `${mins}:${secs}`
}

// Helper: Custom tooltip content
function CustomTooltip({ active, payload, label, type }: any) {
    if (!active || !payload || !payload.length) return null

    return (
        <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
            <p className="font-semibold text-sm mb-2 text-foreground">
                {type === 'telemetry' ? `Distance: ${label}m` :
                    type === 'lap' ? `Lap ${label}` : label}
            </p>
            <div className="space-y-1">
                {payload.map((entry: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">{entry.name}:</span>
                        <span className="font-medium text-foreground">
                            {type === 'lap' && entry.name.includes('Time')
                                ? formatLapTime(entry.value)
                                : typeof entry.value === 'number'
                                    ? entry.value.toFixed(entry.name.includes('Speed') ? 0 : 1)
                                    : entry.value}
                            {entry.name.includes('Speed') && ' km/h'}
                            {(entry.name.includes('Throttle') || entry.name.includes('Brake')) && '%'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ============================================================================
// LAP TIMES CHART
// ============================================================================

interface LapTimesChartProps {
    data: LapDataPoint[]
    title?: string
}

export function LapTimesChart({ data, title }: LapTimesChartProps) {
    // Group by driver if multiple drivers
    const drivers = [...new Set(data.map(d => d.driver).filter(Boolean))] as string[]
    const hasMultipleDrivers = drivers.length > 1

    // Calculate Y-axis domain based on data
    const times = data.map(d => d.time).filter(t => t > 0)
    const minTime = Math.floor(Math.min(...times) - 1)
    const maxTime = Math.ceil(Math.max(...times) + 1)

    if (hasMultipleDrivers) {
        // Restructure data for multi-driver comparison
        // Group by lap number
        const laps = [...new Set(data.map(d => d.lap))].sort((a, b) => a - b)
        const chartData = laps.map(lap => {
            const point: any = { lap }
            drivers.forEach(driver => {
                const lapData = data.find(d => d.lap === lap && d.driver === driver)
                if (lapData) point[driver] = lapData.time
            })
            return point
        })

        return (
            <div className="space-y-2">
                {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
                <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                        <XAxis
                            dataKey="lap"
                            stroke="var(--muted-foreground)"
                            tick={{ fontSize: 11 }}
                            label={{ value: 'Lap Number', position: 'insideBottom', offset: -15, fontSize: 12, fill: 'var(--muted-foreground)' }}
                        />
                        <YAxis
                            stroke="var(--muted-foreground)"
                            tick={{ fontSize: 11 }}
                            domain={[minTime, maxTime]}
                            tickFormatter={(value) => formatLapTime(value)}
                            label={{ value: 'Lap Time', angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }}
                        />
                        <Tooltip content={<CustomTooltip type="lap" />} />
                        <Legend
                            wrapperStyle={{ paddingTop: 10 }}
                            formatter={(value) => <span className="text-xs font-medium">{value}</span>}
                        />
                        {drivers.map((driver, i) => (
                            <Line
                                key={driver}
                                type="monotone"
                                dataKey={driver}
                                name={`${driver} Time`}
                                stroke={COMPARISON_COLORS[i % COMPARISON_COLORS.length]}
                                strokeWidth={2}
                                dot={{ r: 3, fill: COMPARISON_COLORS[i % COMPARISON_COLORS.length] }}
                                activeDot={{ r: 5, strokeWidth: 2 }}
                                connectNulls
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        )
    }

    // Single driver lap progression
    const driverName = drivers[0] || 'Driver'
    return (
        <div className="space-y-2">
            {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
            <ResponsiveContainer width="100%" height={350}>
                <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                    <XAxis
                        dataKey="lap"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 11 }}
                        label={{ value: 'Lap Number', position: 'insideBottom', offset: -15, fontSize: 12, fill: 'var(--muted-foreground)' }}
                    />
                    <YAxis
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 11 }}
                        domain={[minTime, maxTime]}
                        tickFormatter={(value) => formatLapTime(value)}
                        label={{ value: 'Lap Time', angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }}
                    />
                    <Tooltip content={<CustomTooltip type="lap" />} />
                    <Legend
                        wrapperStyle={{ paddingTop: 10 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="time"
                        name={`${driverName} Time`}
                        stroke={F1_COLORS.red}
                        strokeWidth={2}
                        dot={(props: any) => {
                            const compound = data.find(d => d.lap === props.payload.lap)?.compound
                            const compoundColor = compound === 'SOFT' ? F1_COLORS.red :
                                compound === 'MEDIUM' ? F1_COLORS.yellow :
                                    compound === 'HARD' ? F1_COLORS.silver : F1_COLORS.red
                            return (
                                <circle
                                    cx={props.cx}
                                    cy={props.cy}
                                    r={4}
                                    fill={compoundColor}
                                    stroke={F1_COLORS.red}
                                    strokeWidth={1}
                                />
                            )
                        }}
                        activeDot={{ r: 6, strokeWidth: 2 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    )
}

// ============================================================================
// COMPARISON CHART (Qualifying, Race Results)
// ============================================================================

interface ComparisonChartProps {
    data: ComparisonDataPoint[]
    title?: string
}

export function ComparisonChart({ data, title }: ComparisonChartProps) {
    // 1. Identify distinct seasons (if any)
    const seasons = Array.from(new Set(data.map(d => d.season).filter(Boolean))).sort()
    const hasMultipleSeasons = seasons.length > 1

    // 2. Prepare Chart Data
    let chartData: any[] = []
    let bars: React.ReactNode[] = []

    if (hasMultipleSeasons) {
        // GROUPED BAR CHART LOGIC
        // Transform: [{driver: VER, season: 2022, value: 1}, {driver: VER, season: 2023, value: 1}]
        // To: [{driver: VER, 2022: 1, 2023: 1}]
        
        const grouped = new Map<string, any>()
        
        data.forEach(d => {
            if (!grouped.has(d.driver)) {
                grouped.set(d.driver, { driver: d.driver, label: d.label })
            }
            const entry = grouped.get(d.driver)
            if (d.season) {
                entry[d.season] = d.value
            } else {
                entry['value'] = d.value // Fallback
            }
        })
        
        chartData = Array.from(grouped.values())

        // Create a Bar for each season
        bars = seasons.map((season, i) => (
            <Bar
                key={season}
                dataKey={String(season)}
                name={String(season)}
                fill={COMPARISON_COLORS[i % COMPARISON_COLORS.length]}
                radius={[0, 4, 4, 0]}
            >
                {/* No individual Cell colors in grouped mode, use series color */}
            </Bar>
        ))

    } else {
        // STANDARD FLAT CHART LOGIC (Single Season / No Season)
        // Calculate delta to leader for tooltips
        const sortedData = [...data].sort((a, b) => a.value - b.value)
        const leaderValue = sortedData[0]?.value || 0

        chartData = data.map((d, i) => ({
            ...d,
            delta: d.value - leaderValue,
            color: COMPARISON_COLORS[i % COMPARISON_COLORS.length]
        }))

        bars = [
            <Bar
                key="value"
                dataKey="value"
                name="Value"
                radius={[0, 4, 4, 0]}
            >
                {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
            </Bar>
        ]
    }

    return (
        <div className="space-y-2">
            {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
            <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * (hasMultipleSeasons ? 50 : 35))}>
                <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} horizontal={false} />
                    <XAxis
                        type="number"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatLapTime(value)}
                        label={{ value: 'Time / Position', position: 'insideBottom', offset: -5, fontSize: 12, fill: 'var(--muted-foreground)' }}
                    />
                    <YAxis
                        type="category"
                        dataKey="driver"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 11, fontWeight: 500 }}
                        width={50}
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null
                            // In grouped mode, payload has multiple items
                            const d = payload[0].payload // The row data {driver: VER, 2022: 1, 2023: 1}
                            
                            return (
                                <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
                                    <p className="font-bold text-sm mb-1">{d.driver}</p>
                                    {d.label && <p className="text-xs text-muted-foreground mb-2">{d.label}</p>}
                                    <div className="space-y-1 text-xs">
                                        {payload.map((p: any) => (
                                             <div key={p.name} className="flex justify-between gap-4 items-center">
                                                <span className="flex items-center gap-1">
                                                    <div className="w-2 h-2 rounded-full" style={{backgroundColor: p.color}}></div>
                                                    <span className="text-muted-foreground">{p.name}:</span>
                                                </span>
                                                <span className="font-medium">
                                                    {p.name === 'Value' || !isNaN(Number(p.name)) ? formatLapTime(p.value) : p.value}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 10 }} />
                    {bars}
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

// ============================================================================
// TELEMETRY CHART
// ============================================================================

interface TelemetryChartProps {
    data: TelemetryDataPoint[]
    title?: string
    circuit?: string
    corners?: any[]
}

export function TelemetryChart({ data, title, circuit, corners: apiCorners }: TelemetryChartProps) {
    // Determine which channels are available
    const hasSpeed = data.some(d => d.speed !== undefined)
    const hasThrottle = data.some(d => d.throttle !== undefined)
    const hasBrake = data.some(d => d.brake !== undefined)
    const hasGear = data.some(d => d.gear !== undefined)

    // Check for multi-driver comparison
    const drivers = [...new Set(data.map(d => d.driver).filter(Boolean))] as string[]
    const hasMultipleDrivers = drivers.length > 1

    // Get corner markers (use API data if available, else fallback)
    const maxDistance = Math.max(...data.map(d => d.distance))
    
    let corners = (CIRCUIT_CORNERS[circuit || ''] || CIRCUIT_CORNERS.default)
        .filter(c => c.distance <= maxDistance)

    if (apiCorners && apiCorners.length > 0) {
        // Map API format (Number, Distance) to internal format (corner, distance)
        corners = apiCorners
            .filter(c => c.Distance !== undefined && c.Distance <= maxDistance)
            .map(c => ({
                corner: c.Number,
                distance: c.Distance,
                name: c.Letter
            }))
    }

    console.log("[TelemetryChart] Debug:", {
        hasApiCorners: !!(apiCorners && apiCorners.length),
        apiCornersCount: apiCorners?.length,
        finalCornersCount: corners.length,
        maxDistance,
        firstCorner: corners[0]
    })

    // For multi-driver, restructure data
    if (hasMultipleDrivers) {
        // Group by distance (rounded to nearest 10m for alignment)
        const distanceGroups = new Map<number, any>()

        data.forEach(point => {
            const roundedDist = Math.round(point.distance / 10) * 10
            if (!distanceGroups.has(roundedDist)) {
                distanceGroups.set(roundedDist, { distance: roundedDist })
            }
            const group = distanceGroups.get(roundedDist)!
            if (point.driver) {
                if (point.speed !== undefined) group[`${point.driver}_speed`] = point.speed
                if (point.throttle !== undefined) group[`${point.driver}_throttle`] = point.throttle
                if (point.gear !== undefined) group[`${point.driver}_gear`] = point.gear
                if (point.brake !== undefined) {
                    group[`${point.driver}_brake`] = point.brake
                    // Log first few detections of non-zero brake to confirm data presence
                    if (point.brake > 0 && Math.random() < 0.01) {
                         console.log("[VizDebug] Found brake data:", point.driver, point.brake, roundedDist)
                    }
                }
            }
        })

        const chartData = Array.from(distanceGroups.values()).sort((a, b) => a.distance - b.distance)

        return (
            <div className="space-y-2">
                {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData} margin={{ top: 20, right: 15, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />



                        <XAxis
                            type="number"
                            domain={['dataMin', 'dataMax']}
                            dataKey="distance"
                            stroke="var(--muted-foreground)"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v) => `${(v / 1000).toFixed(1)}km`}
                            label={{ value: 'Distance (km)', position: 'insideBottom', offset: -15, fontSize: 11, fill: 'var(--muted-foreground)' }}
                        />

                        {/* Left Y-axis for Speed */}
                        <YAxis
                            yAxisId="left"
                            stroke={F1_COLORS.red}
                            tick={{ fontSize: 10 }}
                            domain={[0, 400]}
                            label={{ value: 'Speed (km/h)', angle: -90, position: 'insideLeft', fontSize: 11, fill: F1_COLORS.red }}
                        />

                        {/* Right Y-axis for Throttle/Brake % */}
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke={F1_COLORS.green}
                            tick={{ fontSize: 10 }}
                            domain={[0, 100]}
                            label={{ value: 'Throttle/Brake (%)', angle: 90, position: 'insideRight', fontSize: 11, fill: F1_COLORS.green }}
                        />

                        {/* Hidden Y-axis for Gear (1-8) */}
                        <YAxis
                            yAxisId="gear"
                            orientation="right"
                            domain={[0, 9]}
                            hide
                            width={0}
                        />

                        <Tooltip content={<CustomTooltip type="telemetry" />} />
                        <Legend
                            wrapperStyle={{ paddingTop: 15 }}
                        />

                        {/* Speed lines for each driver */}
                        {hasSpeed && drivers.map((driver, i) => (
                            <Line
                                key={`${driver}-speed`}
                                yAxisId="left"
                                type="monotone"
                                dataKey={`${driver}_speed`}
                                name={`${driver} Speed`}
                                stroke={COMPARISON_COLORS[(i * 4 + 0) % COMPARISON_COLORS.length]}
                                strokeWidth={2}
                                dot={false}
                                connectNulls
                            />
                        ))}

                        {/* Throttle lines (dashed) for each driver */}
                        {hasThrottle && drivers.map((driver, i) => (
                            <Line
                                key={`${driver}-throttle`}
                                yAxisId="right"
                                type="monotone"
                                dataKey={`${driver}_throttle`}
                                name={`${driver} Throttle`}
                                stroke={COMPARISON_COLORS[(i * 4 + 1) % COMPARISON_COLORS.length]}
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                dot={false}
                                connectNulls
                                opacity={0.9}
                            />
                        ))}

                        {/* Brake lines (dotted) for each driver */}
                        {hasBrake && drivers.map((driver, i) => (
                            <Line
                                key={`${driver}-brake`}
                                yAxisId="right"
                                type="monotone"
                                dataKey={`${driver}_brake`}
                                name={`${driver} Brake`}
                                stroke={COMPARISON_COLORS[(i * 4 + 2) % COMPARISON_COLORS.length]}
                                strokeWidth={1.5}
                                strokeDasharray="1 1"
                                dot={false}
                                connectNulls
                                opacity={1}
                            />
                        ))}

                        {/* Gear lines (step) for each driver */}
                        {hasGear && drivers.map((driver, i) => (
                            <Line
                                key={`${driver}-gear`}
                                yAxisId="gear"
                                type="stepAfter"
                                dataKey={`${driver}_gear`}
                                name={`${driver} Gear`}
                                stroke={COMPARISON_COLORS[(i * 4 + 3) % COMPARISON_COLORS.length]}
                                strokeWidth={2}
                                strokeDasharray="5 2"
                                dot={false}
                                connectNulls
                                opacity={1}
                            />
                        ))}

                        {/* Turn markers - Rendered LAST to be ON TOP */}
                        {corners.map(c => (
                            <ReferenceLine
                                key={c.corner}
                                x={c.distance}
                                yAxisId="left"
                                stroke="white"
                                strokeDasharray="3 3"
                                strokeOpacity={0.5}
                                label={{
                                    value: `T${c.corner}`,
                                    position: 'insideTop',
                                    fill: 'white',
                                    fontSize: 10,
                                    fontWeight: 'bold'
                                }}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        )
    }

    // Single driver telemetry
    return (
        <div className="space-y-2">
            {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
            <ResponsiveContainer width="100%" height={400}>
                <LineChart data={data} margin={{ top: 20, right: 15, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />

                    <XAxis
                        type="number" 
                        domain={['dataMin', 'dataMax']}
                        dataKey="distance"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(1)}km`}
                        label={{ value: 'Distance (km)', position: 'insideBottom', offset: -15, fontSize: 11, fill: 'var(--muted-foreground)' }}
                    />
                    
                    <YAxis
                        yAxisId="left"
                        stroke={F1_COLORS.red}
                        tick={{ fontSize: 10 }}
                        domain={[0, 400]}
                        label={{ value: 'Speed (km/h)', angle: -90, position: 'insideLeft', fontSize: 11, fill: F1_COLORS.red }}
                    />

                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke={F1_COLORS.green}
                        tick={{ fontSize: 10 }}
                        domain={[0, 100]}
                        label={{ value: 'Throttle/Brake (%)', angle: 90, position: 'insideRight', fontSize: 11, fill: F1_COLORS.green }}
                    />

                    <Tooltip content={<CustomTooltip type="telemetry" />} />
                    <Legend wrapperStyle={{ paddingTop: 15 }} />

                    {/* Data Lines */}
                    {hasSpeed && (
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="speed"
                            name="Speed"
                            stroke={F1_COLORS.red}
                            strokeWidth={2}
                            dot={false}
                        />
                    )}

                    {hasThrottle && (
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="throttle"
                            name="Throttle"
                            stroke={F1_COLORS.green}
                            strokeWidth={1.5}
                            dot={false}
                        />
                    )}

                    {hasBrake && (
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="brake"
                            name="Brake"
                            stroke={F1_COLORS.yellow}
                            strokeWidth={1.5}
                            dot={false}
                        />
                    )}

                    {hasGear && (
                        <Line
                            yAxisId="right"
                            type="stepAfter"
                            dataKey="gear"
                            name="Gear"
                            stroke={F1_COLORS.purple}
                            strokeWidth={1.5}
                            strokeDasharray="3 2"
                            dot={false}
                        />
                    )}

                    {/* Turn markers - Rendered LAST to be ON TOP */}
                    {corners.map(c => (
                        <ReferenceLine
                            key={c.corner}
                            x={c.distance}
                            yAxisId="left"
                            stroke="white"
                            strokeDasharray="3 3"
                            strokeOpacity={0.5}
                            label={{
                                value: `T${c.corner}`,
                                position: 'insideTop',
                                fill: 'white',
                                fontSize: 10,
                                fontWeight: 'bold'
                            }}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    )
}
