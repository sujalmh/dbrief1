"use client"

import { useState, useMemo } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
    extractLapTimes,
    extractTelemetry,
    extractComparison,
    detectDataType,
    type ChartDataType
} from '@/lib/visualization/data-parser'
import { LapTimesChart, ComparisonChart, TelemetryChart } from './chart-types'
import { BarChart3, X } from 'lucide-react'

interface VisualizeModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    content: string
}

export function VisualizeModal({ open, onOpenChange, content }: VisualizeModalProps) {
    const dataType: ChartDataType = useMemo(() => detectDataType(content), [content])
    const [selectedType, setSelectedType] = useState<ChartDataType>(dataType)

    // Extract data based on type
    const lapData = useMemo(() => extractLapTimes(content), [content])
    const telemetryData = useMemo(() => extractTelemetry(content), [content])
    const comparisonData = useMemo(() => extractComparison(content), [content])

    // Determine available chart types
    const availableTypes: ChartDataType[] = []
    if (lapData.length > 0) availableTypes.push('lap_times')
    if (telemetryData.length > 0) availableTypes.push('telemetry')
    if (comparisonData.length > 0) availableTypes.push('comparison')

    // Auto-select first available type
    const activeType = availableTypes.includes(selectedType) ? selectedType : availableTypes[0]

    const renderChart = () => {
        switch (activeType) {
            case 'lap_times':
                if (lapData.length === 0) return <EmptyState />
                return <LapTimesChart data={lapData} />

            case 'telemetry':
                if (telemetryData.length === 0) return <EmptyState />
                return <TelemetryChart data={telemetryData} />

            case 'comparison':
                if (comparisonData.length === 0) return <EmptyState />
                return <ComparisonChart data={comparisonData} />

            default:
                return <EmptyState />
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-[var(--f1-red)]" />
                        Data Visualization
                    </DialogTitle>
                    <DialogDescription>
                        Interactive charts from F1 data
                    </DialogDescription>
                </DialogHeader>

                {/* Chart Type Selector */}
                {availableTypes.length > 1 && (
                    <div className="flex gap-2 pb-4 border-b border-border">
                        {availableTypes.map(type => (
                            <Button
                                key={type}
                                variant={activeType === type ? "default" : "outline"}
                                size="sm"
                                onClick={() => setSelectedType(type)}
                                className={activeType === type ? "bg-[var(--f1-red)] hover:bg-[var(--f1-red)]/90" : ""}
                            >
                                {formatChartType(type)}
                            </Button>
                        ))}
                    </div>
                )}

                {/* Chart Container */}
                <div className="py-4">
                    {renderChart()}
                </div>

                {/* Data Info */}
                <div className="text-xs text-muted-foreground border-t border-border pt-2">
                    {activeType === 'lap_times' && `${lapData.length} lap${lapData.length !== 1 ? 's' : ''}`}
                    {activeType === 'telemetry' && `${telemetryData.length} data points`}
                    {activeType === 'comparison' && `${comparisonData.length} driver${comparisonData.length !== 1 ? 's' : ''}`}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <X className="h-12 w-12 mb-2 opacity-50" />
            <p className="text-sm">No visualizable data found for this chart type</p>
        </div>
    )
}

function formatChartType(type: ChartDataType): string {
    switch (type) {
        case 'lap_times': return 'Lap Times'
        case 'telemetry': return 'Telemetry'
        case 'comparison': return 'Comparison'
        case 'weather': return 'Weather'
        default: return 'Data'
    }
}
