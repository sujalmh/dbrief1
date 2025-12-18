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
    '#E10600', // Red (Ferrari)
    '#00D2BE', // Teal (Mercedes)
    '#FF8700', // Orange (McLaren)
    '#0600EF', // Blue (Red Bull)
    '#006F62', // Green (Aston Martin)
    '#2B4562', // Dark Blue (Alpha Tauri)
    '#900000', // Dark Red (Alfa Romeo)
    '#005AFF', // Alpine Blue
    '#B6BABD', // Williams Silver
    '#52E252', // Haas Lime
]

// Corner markers for common circuits (distance in meters)
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
    // Calculate delta to leader for tooltips
    const sortedData = [...data].sort((a, b) => a.value - b.value)
    const leaderValue = sortedData[0]?.value || 0

    const chartData = data.map((d, i) => ({
        ...d,
        delta: d.value - leaderValue,
        color: COMPARISON_COLORS[i % COMPARISON_COLORS.length]
    }))

    return (
        <div className="space-y-2">
            {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
            <ResponsiveContainer width="100%" height={Math.max(300, data.length * 35)}>
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
                        label={{ value: 'Time', position: 'insideBottom', offset: -5, fontSize: 12, fill: 'var(--muted-foreground)' }}
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
                            const d = payload[0].payload
                            return (
                                <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
                                    <p className="font-bold text-sm mb-1">{d.driver}</p>
                                    {d.label && <p className="text-xs text-muted-foreground mb-2">{d.label}</p>}
                                    <div className="space-y-1 text-xs">
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">Time:</span>
                                            <span className="font-medium">{formatLapTime(d.value)}</span>
                                        </div>
                                        {d.delta > 0 && (
                                            <div className="flex justify-between gap-4">
                                                <span className="text-muted-foreground">Gap:</span>
                                                <span className="font-medium text-red-500">+{d.delta.toFixed(3)}s</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        }}
                    />
                    <Legend
                        wrapperStyle={{ paddingTop: 10 }}
                    />
                    <Bar
                        dataKey="value"
                        name="Time"
                        radius={[0, 4, 4, 0]}
                    >
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                    </Bar>
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
}

export function TelemetryChart({ data, title, circuit }: TelemetryChartProps) {
    // Determine which channels are available
    const hasSpeed = data.some(d => d.speed !== undefined)
    const hasThrottle = data.some(d => d.throttle !== undefined)
    const hasBrake = data.some(d => d.brake !== undefined)
    const hasGear = data.some(d => d.gear !== undefined)

    // Check for multi-driver comparison
    const drivers = [...new Set(data.map(d => d.driver).filter(Boolean))] as string[]
    const hasMultipleDrivers = drivers.length > 1

    // Get corner markers (use circuit-specific or default)
    const maxDistance = Math.max(...data.map(d => d.distance))
    const corners = (CIRCUIT_CORNERS[circuit || ''] || CIRCUIT_CORNERS.default)
        .filter(c => c.distance <= maxDistance)

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
                if (point.brake !== undefined) group[`${point.driver}_brake`] = point.brake
            }
        })

        const chartData = Array.from(distanceGroups.values()).sort((a, b) => a.distance - b.distance)

        return (
            <div className="space-y-2">
                {title && <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>}
                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData} margin={{ top: 20, right: 60, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />

                        {/* Turn markers */}
                        {corners.map(c => (
                            <ReferenceLine
                                key={c.corner}
                                x={c.distance}
                                stroke="var(--muted-foreground)"
                                strokeDasharray="2 4"
                                strokeOpacity={0.6}
                                label={{
                                    value: `T${c.corner}`,
                                    position: 'top',
                                    fill: 'var(--muted-foreground)',
                                    fontSize: 9,
                                    fontWeight: 500
                                }}
                            />
                        ))}

                        <XAxis
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
                                stroke={COMPARISON_COLORS[i % COMPARISON_COLORS.length]}
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
                                stroke={COMPARISON_COLORS[i % COMPARISON_COLORS.length]}
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                dot={false}
                                connectNulls
                                opacity={0.7}
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
                <LineChart data={data} margin={{ top: 20, right: 60, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />

                    {/* Turn markers */}
                    {corners.map(c => (
                        <ReferenceLine
                            key={c.corner}
                            x={c.distance}
                            stroke="var(--muted-foreground)"
                            strokeDasharray="2 4"
                            strokeOpacity={0.6}
                            label={{
                                value: `T${c.corner}`,
                                position: 'top',
                                fill: 'var(--muted-foreground)',
                                fontSize: 9,
                                fontWeight: 500
                            }}
                        />
                    ))}

                    <XAxis
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

                    <Tooltip content={<CustomTooltip type="telemetry" />} />
                    <Legend
                        wrapperStyle={{ paddingTop: 15 }}
                    />

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
                </LineChart>
            </ResponsiveContainer>
        </div>
    )
}
