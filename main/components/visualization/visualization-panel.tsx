"use client"

import { useState, useMemo, useEffect } from "react"
import { useChatStore } from "@/lib/store"
import { LapTimesChart, ComparisonChart, TelemetryChart } from "./chart-types"
import { BarChart3, X, ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LapDataPoint, TelemetryDataPoint, ComparisonDataPoint } from "@/lib/visualization/data-parser"

export function VisualizationPanel() {
    const { settings, visualizationData, visualizationWidth, updateVisualizationWidth, isVisualizationCollapsed, toggleVisualizationCollapse } = useChatStore()
    const [localWidth, setLocalWidth] = useState(visualizationWidth)
    const [isResizing, setIsResizing] = useState(false)
    const [isHoveringHandle, setIsHoveringHandle] = useState(false)

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
    const { lapData, telemetryData, comparisonData } = useMemo(() => {
        const laps: LapDataPoint[] = []
        const telemetry: TelemetryDataPoint[] = []
        const comparison: ComparisonDataPoint[] = []

        if (!hasData) {
            return { lapData: laps, telemetryData: telemetry, comparisonData: comparison }
        }

        for (const result of visualizationData) {
            if (!result.success || !result.data) continue

            // Handle laps data
            if (result.tool === 'get_laps' && result.data.laps) {
                for (const lap of result.data.laps) {
                    const lapNumber = parseInt(lap.lap_number || lap.LapNumber || '0')
                    const lapTime = parseLapTime(lap.lap_time || lap.LapTime || '0')

                    // Only add if valid numbers
                    if (!isNaN(lapNumber) && !isNaN(lapTime) && lapTime > 0) {
                        laps.push({
                            lap: lapNumber,
                            time: lapTime,
                            driver: lap.driver || lap.Driver || result.data.driver,
                            compound: lap.compound || lap.Compound
                        })
                    }
                }
            }

            // Handle telemetry data
            if (result.tool === 'get_telemetry' && result.data.data) {
                const driverCode = result.data.driver || 'Unknown'
                for (const point of result.data.data) {
                    // Start of fix: Helper for case-insensitive lookup
                    const getVal = (k1: string, k2: string) => point[k1] !== undefined ? point[k1] : point[k2];
                    
                    const distance = parseFloat(getVal('Distance', 'distance') || '0')

                    if (!isNaN(distance)) {
                        telemetry.push({
                            distance,
                            speed: getVal('Speed', 'speed') !== undefined ? parseFloat(getVal('Speed', 'speed')) : undefined,
                            throttle: getVal('Throttle', 'throttle') !== undefined ? parseFloat(getVal('Throttle', 'throttle')) : undefined,
                            brake: getVal('Brake', 'brake') !== undefined ? parseFloat(getVal('Brake', 'brake')) : undefined,
                            gear: getVal('nGear', 'gear') !== undefined ? parseInt(getVal('nGear', 'gear')) : undefined,
                            driver: driverCode
                        })
                    }
                }
            }

            // Handle comparison data (qualifying/race results)
            if ((result.tool === 'get_qualifying' || result.tool === 'get_race') && result.data.results) {
                for (const r of result.data.results) {
                    const driver = r.driver || r.Driver || r.Abbreviation || 'Unknown'
                    const timeOrPos = r.time || r.Time || r.q3 || r.q2 || r.q1 || '0'
                    const value = r.position || r.Position ? parseInt(r.position || r.Position) : parseLapTime(timeOrPos)

                    if (!isNaN(value)) {
                        comparison.push({
                            driver,
                            value,
                            label: r.team || r.TeamName
                        })
                    }
                }
            }
        }

        return { lapData: laps, telemetryData: telemetry, comparisonData: comparison }
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
            return <TelemetryChart data={telemetryData} />
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
        return (
            <div className="fixed right-0 top-14 h-[calc(100vh-3.5rem)] z-30 flex items-center">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleVisualizationCollapse(false)}
                    className="h-12 w-8 rounded-l-lg rounded-r-none bg-muted/50 hover:bg-muted border-l border-y border-border"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </div>
        )
    }

    return (
        <div
            className={cn(
                "fixed right-0 top-14 h-[calc(100vh-3.5rem)] z-30 bg-background/95 border-l border-white/10 flex flex-col shadow-[inset_10px_0_20px_-10px_rgba(0,0,0,0.5)] transition-[width]",
                isResizing ? "duration-0 select-none" : "duration-300"
            )}
            style={{ width: `${localWidth}px` }}
        >
            {/* DRAG HANDLE */}
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
                            {comparisonData.length > 0 && ` • ${comparisonData.length} drivers`}
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
