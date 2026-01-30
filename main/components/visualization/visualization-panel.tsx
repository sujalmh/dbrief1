"use client"

import { useState, useMemo, useEffect } from "react"
import { useChatStore } from "@/lib/store"
import { LapTimesChart, ComparisonChart, TelemetryChart } from "./chart-types"
import { BarChart3, X, ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"

import type { LapDataPoint, TelemetryDataPoint, ComparisonDataPoint } from "@/lib/visualization/data-parser"
import { useMediaQuery } from "@/lib/hooks/use-media-query"

// Chart Item Interface
interface ChartItem {
    id: string
    type: 'lap_times' | 'telemetry' | 'comparison'
    data: any
    title: string
    description?: string
}

export function VisualizationPanel() {
    const { settings, visualizationData, visualizationWidth, updateVisualizationWidth, isVisualizationCollapsed, toggleVisualizationCollapse } = useChatStore()
    const [localWidth, setLocalWidth] = useState(visualizationWidth)
    const [isResizing, setIsResizing] = useState(false)
    const [isHoveringHandle, setIsHoveringHandle] = useState(false)
    const [currentChartIndex, setCurrentChartIndex] = useState(0)
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

    // Process all available charts into ChartItem array
    const charts = useMemo(() => {
        const chartItems: ChartItem[] = []

        if (!hasData) {
            return chartItems
        }

        console.log("[VizPanel] Raw Visualization Data:", visualizationData)

        // Use Maps for deduplication per chart type
        const lapsByDriver = new Map<string, { data: LapDataPoint[], args: any }>()
        const telemetryByDriver = new Map<string, { data: TelemetryDataPoint[], corners: any[], args: any }>()
        const comparisonBySession = new Map<string, { data: ComparisonDataPoint[], args: any }>()

        // First pass: Collect and deduplicate data
        for (const result of visualizationData) {
            if (!result.success || !result.data) continue

            // Handle laps data
            if (result.tool === 'get_laps' && result.data.laps) {
                const driver = result.data.driver || result.args?.driver_number || 'Unknown'
                const lapMap = new Map<string, LapDataPoint>()

                for (const lap of result.data.laps) {
                    const lapNumber = parseInt(lap.lap_number || lap.LapNumber || '0')
                    const lapTime = parseLapTime(lap.lap_time || lap.LapTime || '0')
                    const driverCode = lap.driver || lap.Driver || driver

                    if (!isNaN(lapNumber) && !isNaN(lapTime) && lapTime > 0) {
                        const key = `${driverCode}-${lapNumber}`
                        if (!lapMap.has(key)) {
                            lapMap.set(key, {
                                lap: lapNumber,
                                time: lapTime,
                                driver: driverCode,
                                compound: lap.compound || lap.Compound
                            })
                        }
                    }
                }

                if (lapMap.size > 0) {
                    const existing = lapsByDriver.get(driver) || { data: [], args: result.args }
                    existing.data.push(...Array.from(lapMap.values()))
                    lapsByDriver.set(driver, existing)
                }
            }

            // Handle telemetry data
            if (result.tool === 'get_telemetry' && result.data.data) {
                const driver = result.data.driver || result.args?.driver_number || 'Unknown'
                const telemetryMap = new Map<string, TelemetryDataPoint>()

                for (const point of result.data.data) {
                    const getVal = (k1: string, k2: string) => point[k1] !== undefined ? point[k1] : point[k2]
                    const distance = parseFloat(getVal('Distance', 'distance') || '0')

                    if (!isNaN(distance)) {
                        const key = `${driver}-${distance.toFixed(1)}`
                        if (!telemetryMap.has(key)) {
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
                                driver
                            })
                        }
                    }
                }

                if (telemetryMap.size > 0) {
                    const existing = telemetryByDriver.get(driver) || {
                        data: [] as TelemetryDataPoint[],
                        corners: result.data?.corners || [],
                        args: result.args
                    }
                    existing.data.push(...Array.from(telemetryMap.values()))
                    if (result.data?.corners && result.data.corners.length > 0) {
                        existing.corners = result.data.corners
                    }
                    telemetryByDriver.set(driver, existing)
                }
            }

            // Handle comparison data (qualifying/race results)
            if ((result.tool === 'get_qualifying' || result.tool === 'get_race') && result.data.results) {
                let season = result.args?.year?.toString()

                if (!season) {
                    const sessionName = result.data.session_name || ''
                    const yearMatch = sessionName.match(/\b(20\d{2})\b/)
                    season = yearMatch ? yearMatch[1] : undefined
                }

                let sessionType = 'Race'
                if (result.tool === 'get_qualifying') sessionType = 'Qualifying'
                else if (result.args?.session === 'Q' || result.args?.session === 'Qualifying') sessionType = 'Qualifying'

                const sessionLabel = season ? `${season} (${sessionType})` : sessionType
                const comparisonMap = new Map<string, ComparisonDataPoint>()

                for (const r of result.data.results) {
                    const driver = r.driver || r.Driver || r.Abbreviation || 'Unknown'
                    const timeOrPos = r.time || r.Time || r.q3 || r.q2 || r.q1 || '0'
                    const value = r.position || r.Position ? parseInt(r.position || r.Position) : parseLapTime(timeOrPos)
                    const label = r.team || r.TeamName || ''

                    if (!isNaN(value)) {
                        const key = `${driver}-${sessionLabel}-${value}`
                        if (!comparisonMap.has(key)) {
                            comparisonMap.set(key, {
                                driver,
                                value,
                                label,
                                season: sessionLabel
                            })
                        }
                    }
                }

                if (comparisonMap.size > 0) {
                    const existing = comparisonBySession.get(sessionLabel) || { data: [], args: result.args }
                    existing.data.push(...Array.from(comparisonMap.values()))
                    comparisonBySession.set(sessionLabel, existing)
                }
            }
        }

        // Second pass: Create ChartItem objects with titles
        let chartId = 0

        // Create Lap Times charts (one per driver or combined)
        lapsByDriver.forEach((lapInfo, driver) => {
            const drivers = Array.from(new Set(lapInfo.data.map(d => d.driver)))
            const lapRange = lapInfo.data.length > 0
                ? `${Math.min(...lapInfo.data.map(d => d.lap))}-${Math.max(...lapInfo.data.map(d => d.lap))}`
                : 'N/A'

            const title = drivers.length > 1
                ? `Lap Times: ${drivers.join(', ')} (Laps ${lapRange})`
                : `Lap Times: ${driver} (Laps ${lapRange})`

            chartItems.push({
                id: `lap-${chartId++}`,
                type: 'lap_times',
                data: lapInfo.data,
                title,
                description: `${lapInfo.data.length} laps`
            })
        })

        // Create Telemetry charts (one per driver)
        telemetryByDriver.forEach((telemetryInfo, driver) => {
            const lapNumber = telemetryInfo.args?.lap_number || 'N/A'
            const title = `Telemetry: ${driver} - Lap ${lapNumber}`

            chartItems.push({
                id: `telemetry-${chartId++}`,
                type: 'telemetry',
                data: { telemetry: telemetryInfo.data, corners: telemetryInfo.corners },
                title,
                description: `${telemetryInfo.data.length} data points`
            })
        })

        // Create Comparison charts (one per session)
        comparisonBySession.forEach((comparisonInfo, session) => {
            const drivers = Array.from(new Set(comparisonInfo.data.map(d => d.driver)))
            const title = `Comparison: ${session}`

            chartItems.push({
                id: `comparison-${chartId++}`,
                type: 'comparison',
                data: comparisonInfo.data,
                title,
                description: `${drivers.length} drivers`
            })
        })

        console.log("[VizPanel] Generated Charts:", chartItems)
        return chartItems
    }, [visualizationData, hasData])

    // Reset chart index when charts change
    useEffect(() => {
        if (currentChartIndex >= charts.length && charts.length > 0) {
            setCurrentChartIndex(0)
        }
    }, [charts, currentChartIndex])

    // NOW we can do conditional returns - after all hooks are called
    if (!settings.visualizeEnabled) {
        return null
    }

    // Carousel navigation handlers
    const handlePrevChart = () => {
        setCurrentChartIndex(prev => (prev > 0 ? prev - 1 : charts.length - 1))
    }

    const handleNextChart = () => {
        setCurrentChartIndex(prev => (prev < charts.length - 1 ? prev + 1 : 0))
    }

    const renderChart = () => {
        if (charts.length === 0) {
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

        const currentChart = charts[currentChartIndex]

        if (!currentChart) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                    <X className="h-12 w-12 mb-2 opacity-50" />
                    <p className="text-sm">No visualizable data in results</p>
                    <p className="text-xs mt-1 opacity-50">Try queries about laps, telemetry, or results</p>
                </div>
            )
        }

        return (
            <div className="flex flex-col h-full">
                {/* Chart Title */}
                <div className="px-4 pb-3 border-b border-border/50">
                    <h3 className="font-bold text-base uppercase tracking-wide text-foreground">
                        {currentChart.title}
                    </h3>
                    {currentChart.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                            {currentChart.description}
                        </p>
                    )}
                </div>

                {/* Chart Content */}
                <div className="flex-1 overflow-auto">
                    {currentChart.type === 'lap_times' && (
                        <LapTimesChart data={currentChart.data} />
                    )}
                    {currentChart.type === 'telemetry' && (
                        <TelemetryChart
                            data={currentChart.data.telemetry}
                            corners={currentChart.data.corners || []}
                        />
                    )}
                    {currentChart.type === 'comparison' && (
                        <ComparisonChart data={currentChart.data} />
                    )}
                </div>

                {/* Carousel Navigation - Only show if multiple charts */}
                {charts.length > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/5">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handlePrevChart}
                                    className="h-9 w-9"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                    <span className="sr-only">Previous Chart</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Previous Chart</p>
                            </TooltipContent>
                        </Tooltip>

                        {/* Dots Indicator */}
                        <div className="flex items-center gap-2">
                            {charts.map((_, index) => (
                                <button
                                    key={index}
                                    onClick={() => setCurrentChartIndex(index)}
                                    className={cn(
                                        "h-2 w-2 rounded-full transition-all duration-200",
                                        index === currentChartIndex
                                            ? "bg-[var(--f1-red)] w-6"
                                            : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                                    )}
                                    aria-label={`Go to chart ${index + 1}`}
                                />
                            ))}
                        </div>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleNextChart}
                                    className="h-9 w-9"
                                >
                                    <ChevronRight className="h-5 w-5" />
                                    <span className="sr-only">Next Chart</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Next Chart</p>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                )}
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
                <Tooltip>
                    <TooltipTrigger asChild>
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
                            <span className="sr-only">Expand Visualization</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                        <p>Expand Visualization</p>
                    </TooltipContent>
                </Tooltip>
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
                    {/* Research Mode Indicator */}
                    {settings.deepResearchMode && (
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Deep Research
                        </span>
                    )}
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleVisualizationCollapse(true)}
                            className="h-8 w-8"
                        >
                            <ChevronRight className="h-4 w-4" />
                            <span className="sr-only">Collapse Visualization</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Collapse Visualization</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {/* Chart Area */}
            <div className={cn(
                "flex-1 overflow-auto p-4 custom-scrollbar",
                isResizing && "pointer-events-none opacity-80"
            )}>
                {renderChart()}
            </div>

            {/* Footer Info */}
            {charts.length > 0 && (
                <div className="p-3 border-t border-border bg-muted/10 shrink-0">
                    <div className="text-xs text-muted-foreground flex justify-between items-center">
                        <div>
                            {charts.length === 1 ? '1 chart' : `${charts.length} charts`}
                            {charts.length > 1 && ` • ${currentChartIndex + 1}/${charts.length}`}
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
