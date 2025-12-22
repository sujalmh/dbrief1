"use client"

import { useState, useMemo, useEffect } from "react"
import { useChatStore } from "@/lib/store"
import { LapTimesChart, ComparisonChart, TelemetryChart } from "./chart-types"
import { BarChart3, X, ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { LapDataPoint, TelemetryDataPoint, ComparisonDataPoint } from "@/lib/visualization/data-parser"
import { useMediaQuery } from "@/lib/hooks/use-media-query"

export function VisualizationPanel() {
    const { settings, visualizationData, visualizationWidth, updateVisualizationWidth, isVisualizationCollapsed, toggleVisualizationCollapse } = useChatStore()
    const [localWidth, setLocalWidth] = useState(visualizationWidth)
    const [isResizing, setIsResizing] = useState(false)
    const [isHoveringHandle, setIsHoveringHandle] = useState(false)
    const isDesktop = useMediaQuery("(min-width: 768px)")

    // Sync local width with store width when not resizing
    useEffect(() => {
        if (!isResizing) {
            setLocalWidth(visualizationWidth)
        }
    }, [visualizationWidth, isResizing])

    // DRAG LOGIC
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizing(true)
    }

    useEffect(() => {
        if (!isResizing) return

        let frameId: number
        const handleMouseMove = (e: MouseEvent) => {
            if (frameId) cancelAnimationFrame(frameId)

            frameId = requestAnimationFrame(() => {
                const newWidth = window.innerWidth - e.clientX
                if (newWidth >= 300 && newWidth <= window.innerWidth * 0.8) {
                    setLocalWidth(newWidth)
                }
            })
        }

        const handleMouseUp = () => {
            setIsResizing(false)
            updateVisualizationWidth(localWidth)
            if (frameId) cancelAnimationFrame(frameId)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            if (frameId) cancelAnimationFrame(frameId)
        }
    }, [isResizing, updateVisualizationWidth, localWidth])

    // Process visualization data from store - MEMOIZED to prevent infinite loops
    const hasData = visualizationData && visualizationData.length > 0
    // IMPORTANT: All hooks must be called before any conditional returns
    // IMPORTANT: All hooks must be called before any conditional returns
    const { lapData, telemetryData, comparisonData, corners } = useMemo(() => {
        // Use Maps for deduplication
        const lapMap = new Map<string, LapDataPoint>()
        const telemetryMap = new Map<string, TelemetryDataPoint>()
        const comparisonMap = new Map<string, ComparisonDataPoint>()

        const laps: LapDataPoint[] = []
        const telemetry: TelemetryDataPoint[] = []
        const comparison: ComparisonDataPoint[] = []

        if (!hasData) {
            return { lapData: laps, telemetryData: telemetry, comparisonData: comparison, corners: [] }
        }

        console.log("[VizPanel] Raw Visualization Data:", visualizationData)

        for (const result of visualizationData) {
            if (!result.success || !result.data) continue

            // Handle laps data
            if (result.tool === 'get_laps' && result.data.laps) {
                // ... (existing lap logic)
                for (const lap of result.data.laps) {
                    const lapNumber = parseInt(lap.lap_number || lap.LapNumber || '0')
                    const lapTime = parseLapTime(lap.lap_time || lap.LapTime || '0')
                    const driver = lap.driver || lap.Driver || result.data.driver

                    // Only add if valid numbers
                    if (!isNaN(lapNumber) && !isNaN(lapTime) && lapTime > 0) {
                        // Key: Driver + Lap (e.g. "VER-1")
                        const key = `${driver}-${lapNumber}`
                        if (!lapMap.has(key)) {
                            lapMap.set(key, {
                                lap: lapNumber,
                                time: lapTime,
                                driver,
                                compound: lap.compound || lap.Compound
                            })
                        }
                    }
                }
            }

            // Handle telemetry data
            if (result.tool === 'get_telemetry' && result.data.data) {
                // ... (existing telemetry logic)
                const driverCode = result.data.driver || 'Unknown'
                for (const point of result.data.data) {
                    // Start of fix: Helper for case-insensitive lookup
                    const getVal = (k1: string, k2: string) => point[k1] !== undefined ? point[k1] : point[k2];

                    const distance = parseFloat(getVal('Distance', 'distance') || '0')

                    if (!isNaN(distance)) {
                        // Key: Driver + Distance (e.g. "VER-100.5")
                        const key = `${driverCode}-${distance.toFixed(1)}`
                        if (!telemetryMap.has(key)) {
                            // Helper for safe parsing
                            const parseTelemetryValue = (val: any) => {
                                if (val === true) return 100
                                if (val === false) return 0
                                if (val === null || val === undefined) return 0
                                return parseFloat(val) || 0
                            }

                            telemetryMap.set(key, {
                                distance,
                                speed: parseTelemetryValue(getVal('Speed', 'speed')),
                                throttle: parseTelemetryValue(getVal('Throttle', 'throttle')),
                                brake: parseTelemetryValue(getVal('Brake', 'brake')),
                                gear: parseInt(getVal('nGear', 'gear') || '0') || 0,
                                driver: driverCode
                            })
                        }
                    }
                }
            }

            // Handle comparison data (qualifying/race results)
            if ((result.tool === 'get_qualifying' || result.tool === 'get_race') && result.data.results) {
                // Priority 1: Use explicit 'year' argument from tool call (most robust)
                // Priority 2: Extract from session name
                let season = result.args?.year?.toString()

                if (!season) {
                    const sessionName = result.data.session_name || ''
                    const yearMatch = sessionName.match(/\b(20\d{2})\b/)
                    season = yearMatch ? yearMatch[1] : undefined
                }

                // Determine session type for clearer labeling
                let sessionType = 'Race'
                if (result.tool === 'get_qualifying') sessionType = 'Qualifying'
                else if (result.args?.session === 'Q' || result.args?.session === 'Qualifying') sessionType = 'Qualifying'

                // Construct a unique season label (e.g. "2024 (Race)", "2024 (Qualifying)")
                // This ensures that if we have both race and quali data, they don't overwrite each other in the chart
                const seasonLabel = season ? `${season} (${sessionType})` : sessionType

                console.log(`[VizPanel] Processing results for: ${seasonLabel}`, {
                    args: result.args,
                    sessionName: result.data.session_name
                })

                for (const r of result.data.results) {
                    const driver = r.driver || r.Driver || r.Abbreviation || 'Unknown'
                    const timeOrPos = r.time || r.Time || r.q3 || r.q2 || r.q1 || '0'
                    const value = r.position || r.Position ? parseInt(r.position || r.Position) : parseLapTime(timeOrPos)
                    const label = r.team || r.TeamName || ''

                    if (!isNaN(value)) {
                        // Key: Driver + SeasonLabel + Value
                        // This allows same driver to appear for multiple seasons AND multiple session types
                        const key = `${driver}-${seasonLabel}-${value}`
                        if (!comparisonMap.has(key)) {
                            comparisonMap.set(key, {
                                driver,
                                value,
                                label,
                                season: seasonLabel
                            })
                        }
                    }
                }
            }
        }

        const stats = {
            lapData: Array.from(lapMap.values()),
            telemetryData: Array.from(telemetryMap.values()),
            comparisonData: Array.from(comparisonMap.values()),
            corners: [] as any[] // Start with empty array
        }

        // Second pass: Find first valid corners data from telemetry results
        // We do this after the loop or inside, but doing it here ensures we just grab one valid set
        for (const result of visualizationData) {
            if (result.tool === 'get_telemetry' && result.data?.corners && result.data.corners.length > 0) {
                stats.corners = result.data.corners
                break // Only need one set of corners for the track
            }
        }

        console.log("[VizPanel] Processed Data:", stats)
        return stats
    }, [visualizationData, hasData])

    // NOW we can do conditional returns - after all hooks are called
    if (!settings.visualizeEnabled) {
        return null
    }

    const renderChart = () => {
        if (!hasData) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                    <BarChart3 className="h-16 w-16 mb-4 opacity-20" />
                    <p className="text-sm text-center">
                        Ask about F1 data to see charts here
                    </p>
                    <p className="text-xs text-center mt-2 opacity-50">
                        (Waiting for data...)
                    </p>
                </div>
            )
        }

        // Try to render based on available data
        if (lapData.length > 0) {
            return <LapTimesChart data={lapData} />
        }

        if (telemetryData.length > 0) {
            return <TelemetryChart data={telemetryData} corners={corners} />
        }

        if (comparisonData.length > 0) {
            return <ComparisonChart data={comparisonData} />
        }

        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <X className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">No visualizable data in results</p>
                <p className="text-xs mt-1 opacity-50">Try queries about laps, telemetry, or results</p>
            </div>
        )
    }

    if (isVisualizationCollapsed) {
        // Mobile: Show a floating button at bottom right or similar? Or just keep it hidden until requested?
        // Current design: fixed button on right side.
        return (
            <div className={cn(
                "fixed z-30 flex items-center transition-all duration-300",
                isDesktop ? "right-0 top-14 h-[calc(100vh-3.5rem)]" : "bottom-6 right-4"
            )}>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleVisualizationCollapse(false)}
                    className={cn(
                        "bg-muted/50 hover:bg-muted border-border shadow-lg backdrop-blur-sm",
                        isDesktop ? "h-12 w-8 rounded-l-lg rounded-r-none border-l border-y" : "h-12 w-12 rounded-full border"
                    )}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </div>
        )
    }

    return (
        <div
            className={cn(
                "fixed z-30 bg-background/95 flex flex-col shadow-[inset_10px_0_20px_-10px_rgba(0,0,0,0.5)] transition-[width,transform,opacity]",
                // Desktop: Sidebar mode
                isDesktop && "right-0 top-14 h-[calc(100vh-3.5rem)] border-l border-white/10",
                isDesktop && (isResizing ? "duration-0 select-none" : "duration-300"),
                // Mobile: Full screen overlay mode
                !isDesktop && "inset-0 top-14 w-full h-[calc(100vh-3.5rem)]"
            )}
            style={{ width: isDesktop ? `${localWidth}px` : '100%' }}
        >
            {/* DRAG HANDLE - Desktop Only */}
            {isDesktop && (
                <div
                    className={cn(
                        "absolute left-0 top-0 w-2 h-full -ml-1 cursor-ew-resize z-40 transition-colors group",
                        isResizing && "bg-[var(--f1-red)]/50"
                    )}
                    onMouseDown={handleMouseDown}
                    onMouseEnter={() => setIsHoveringHandle(true)}
                    onMouseLeave={() => setIsHoveringHandle(false)}
                >
                    <div className={cn(
                        "w-[2px] h-full mx-auto transition-colors",
                        (isResizing || isHoveringHandle) ? "bg-[var(--f1-red)]" : "bg-transparent group-hover:bg-[var(--f1-red)]/50"
                    )} />
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20 shrink-0">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-[var(--f1-yellow)]" />
                    <h2 className="font-bold text-sm uppercase tracking-wider">Visualization</h2>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleVisualizationCollapse(true)}
                    className="h-8 w-8"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            {/* Chart Area */}
            <div className={cn(
                "flex-1 overflow-auto p-4 custom-scrollbar",
                isResizing && "pointer-events-none opacity-80"
            )}>
                {renderChart()}
            </div>

            {/* Footer Info */}
            {hasData && (
                <div className="p-3 border-t border-border bg-muted/10 shrink-0">
                    <div className="text-xs text-muted-foreground flex justify-between items-center">
                        <div>
                            {lapData.length > 0 && `${lapData.length} laps`}
                            {telemetryData.length > 0 && ` • ${telemetryData.length} telemetry points`}
                            {comparisonData.length > 0 && ` • ${new Set(comparisonData.map(d => d.driver)).size} drivers`}
                        </div>
                        <div className="text-[10px] opacity-40">
                            {Math.round(localWidth)}px
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Helper function
function parseLapTime(timeStr: string | number): number {
    if (typeof timeStr === 'number') return timeStr
    if (!timeStr) return 0

    // Format: "1:23.456" or "83.456"
    if (typeof timeStr === 'string' && timeStr.includes(':')) {
        const [min, sec] = timeStr.split(':')
        return parseInt(min) * 60 + parseFloat(sec)
    }

    return parseFloat(String(timeStr)) || 0
}
