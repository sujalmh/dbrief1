"use client";

/**
 * In-chat visualization gallery (`/viz`)
 * =======================================
 * Dev-check page rendering every chart type inside real `MessageBubble`s
 * so charts can be reviewed exactly as they appear in chat (inline,
 * t3code-style). Covers:
 *
 *   - Every `ChartSpec.type` the dispatcher handles (deep-research path:
 *     pre-planned `chartSpecs` on the message).
 *   - Standard-mode synthesis from raw tool payloads (`visualizationData`
 *     + user query, no `chartSpecs`).
 *   - A multi-chart message (stacked rendering).
 *
 * Charts always render inline — there is no visualization toggle.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { Message } from "@/lib/store";
import type { ChartSpec } from "@/lib/research/types";
import { Button } from "@/components/ui/button";

interface Demo {
    label: string;
    userQuery: string;
    content: string;
    chartSpecs?: ChartSpec[];
    visualizationData?: unknown;
}

function spec(base: ChartSpec): ChartSpec {
    return base;
}

/** Deterministic telemetry trace (no random — stable across reloads). */
function telemetryTrace(points: number, phase: number): Array<{ x: number; speed: number; throttle: number; brake: number }> {
    return Array.from({ length: points }, (_, i) => {
        const x = i * 100;
        const wave = Math.sin(i / 4 + phase);
        const brakingZone = i % 10 >= 7;
        return {
            x,
            speed: Math.round(120 + 140 * (0.5 + 0.5 * wave) * (brakingZone ? 0.45 : 1)),
            throttle: brakingZone ? 0 : 100,
            brake: brakingZone ? 100 : 0,
        };
    });
}

const DEMOS: Demo[] = [
    {
        label: "horizontal_bar — 2024 driver standings",
        userQuery: "Final 2024 driver standings",
        content: "Verstappen takes the title with 437 points, ahead of Norris and Leclerc.",
        chartSpecs: [
            spec({
                id: "demo-standings",
                type: "horizontal_bar",
                title: "Final Standings: 2024",
                subtitle: "Total championship points",
                question: "Who won the 2024 championship?",
                insight: "VER outscored NOR by 63 points",
                dataSource: "demo",
                xField: "driver",
                yField: "points",
                config: {
                    data: [
                        { key: "VER", value: 437 },
                        { key: "NOR", value: 374 },
                        { key: "LEC", value: 356 },
                        { key: "PIA", value: 292 },
                        { key: "SAI", value: 290 },
                    ],
                    xAxisLabel: "Championship points",
                    yAxisLabel: "Driver",
                    unit: "pts",
                    highlight: { key: "VER", value: 437 },
                },
            }),
        ],
    },
    {
        label: "bar — constructor points (maps to horizontal bars)",
        userQuery: "Constructor points 2024",
        content: "McLaren edges Ferrari in a tight constructors' fight.",
        chartSpecs: [
            spec({
                id: "demo-constructors",
                type: "bar",
                title: "Constructors: 2024",
                subtitle: "Total points per team",
                dataSource: "demo",
                xField: "team",
                yField: "points",
                config: {
                    data: [
                        { key: "McLaren", value: 666 },
                        { key: "Ferrari", value: 652 },
                        { key: "Red Bull", value: 589 },
                    ],
                    xAxisLabel: "Points",
                    yAxisLabel: "Team",
                    unit: "pts",
                    highlight: { key: "McLaren", value: 666 },
                },
            }),
        ],
    },
    {
        label: "line — VER telemetry at Monza (speed / throttle / brake)",
        userQuery: "VER telemetry at Monza",
        content: "Speed peaks at 340 km/h before the Parabolica braking zone.",
        chartSpecs: [
            spec({
                id: "demo-telemetry-line",
                type: "line",
                title: "Telemetry: 2024 • Monza • VER",
                subtitle: "Speed, throttle, brake across the lap",
                dataSource: "demo",
                xField: "x",
                yField: "speed",
                config: {
                    data: telemetryTrace(40, 0),
                    series: ["speed", "throttle", "brake"],
                    xAxisLabel: "Distance (m)",
                    yAxisLabel: "Speed (km/h) / Throttle / Brake",
                    unit: "km/h",
                    intent: "telemetry_single",
                },
            }),
        ],
    },
    {
        label: "area — championship progression (VER vs NOR)",
        userQuery: "How did the 2024 championship evolve?",
        content: "Norris closed the gap mid-season but Verstappen held on.",
        chartSpecs: [
            spec({
                id: "demo-progression",
                type: "area",
                title: "Championship Progression: 2024",
                subtitle: "Cumulative points per round",
                dataSource: "demo",
                xField: "x",
                yField: "VER",
                config: {
                    data: [1, 2, 3, 4, 5, 6, 7, 8].map((round) => ({
                        x: round,
                        VER: 25 + round * 18,
                        NOR: 18 + round * 16,
                    })),
                    series: ["VER", "NOR"],
                    xAxisLabel: "Round",
                    yAxisLabel: "Points",
                    unit: "pts",
                },
            }),
        ],
    },
    {
        label: "telemetry_multi — deep-research multi-channel trace",
        userQuery: "Compare VER and HAM telemetry",
        content: "Two traces overlaid — the deep planner emits this as telemetry_multi.",
        chartSpecs: [
            spec({
                id: "demo-telemetry-multi",
                type: "telemetry_multi",
                title: "Telemetry Compare: VER vs HAM",
                subtitle: "Speed traces over one lap",
                dataSource: "demo",
                xField: "x",
                yField: "speed",
                config: {
                    data: telemetryTrace(40, 1).map((row, i) => ({
                        x: row.x,
                        VER: row.speed,
                        HAM: Math.round(row.speed * (i % 2 === 0 ? 0.97 : 1.02)),
                    })),
                    series: ["VER", "HAM"],
                    xAxisLabel: "Distance (m)",
                    yAxisLabel: "Speed (km/h)",
                    unit: "km/h",
                },
            }),
        ],
    },
    {
        label: "scatter — grid vs finish (below the line = gained)",
        userQuery: "Who gained positions at Monza 2024?",
        content: "Piastri and Hamilton made the biggest moves forward.",
        chartSpecs: [
            spec({
                id: "demo-grid-finish",
                type: "scatter",
                title: "Grid vs Finish: 2024 • Monza",
                subtitle: "Each point is a driver; below the line = positions gained",
                dataSource: "demo",
                xField: "x",
                yField: "y",
                config: {
                    data: [
                        { key: "LEC", x: 1, y: 1, group: "LEC" },
                        { key: "PIA", x: 2, y: 2, group: "PIA" },
                        { key: "NOR", x: 4, y: 3, group: "NOR" },
                        { key: "HAM", x: 6, y: 4, group: "HAM" },
                        { key: "VER", x: 7, y: 6, group: "VER" },
                    ],
                    xAxisLabel: "Grid position",
                    yAxisLabel: "Finish position",
                    unit: "pos",
                    intent: "qualifying_vs_result",
                },
            }),
        ],
    },
    {
        label: "stacked_bar — tyre strategy per driver",
        userQuery: "Tyre strategy at Bahrain 2024",
        content: "Verstappen split soft/medium while Hamilton went medium/hard.",
        chartSpecs: [
            spec({
                id: "demo-strategy",
                type: "stacked_bar",
                title: "Tyre Strategy: 2024 • Bahrain",
                subtitle: "Stint length by compound per driver",
                dataSource: "demo",
                xField: "category",
                yField: "SOFT",
                config: {
                    data: [
                        { category: "VER", SOFT: 12, MEDIUM: 25, HARD: 20 },
                        { category: "HAM", SOFT: 0, MEDIUM: 20, HARD: 37 },
                        { category: "LEC", SOFT: 10, MEDIUM: 27, HARD: 20 },
                    ],
                    series: ["SOFT", "MEDIUM", "HARD"],
                    xAxisLabel: "Driver",
                    yAxisLabel: "Laps on compound",
                    unit: "laps",
                    intent: "strategy_breakdown",
                },
            }),
        ],
    },
    {
        label: "dumbbell — 2023 vs 2024 qualifying pace",
        userQuery: "Compare 2023 vs 2024 qualifying pace",
        content: "The field closed up — midfield gains outpaced the front.",
        chartSpecs: [
            spec({
                id: "demo-dumbbell",
                type: "dumbbell",
                title: "Qualifying Pace: 2023 vs 2024",
                subtitle: "Average Q3 time per driver (lower is faster)",
                dataSource: "demo",
                xField: "category",
                yField: "left",
                config: {
                    data: [
                        { category: "VER", left: 78.9, right: 79.4, delta: 0.5 },
                        { category: "NOR", left: 79.6, right: 79.2, delta: -0.4 },
                        { category: "LEC", left: 79.5, right: 79.3, delta: -0.2 },
                    ],
                    leftLabel: "2023",
                    rightLabel: "2024",
                    xAxisLabel: "Qualifying time (s)",
                    yAxisLabel: "Driver",
                    unit: "s",
                },
            }),
        ],
    },
    {
        label: "box_plot — lap-time consistency per driver",
        userQuery: "Who was most consistent at Suzuka?",
        content: "Verstappen's stint had the tightest spread; Stroll had outliers.",
        chartSpecs: [
            spec({
                id: "demo-box",
                type: "box_plot",
                title: "Pace Consistency: 2024 • Suzuka",
                subtitle: "Lap-time distribution per driver",
                dataSource: "demo",
                xField: "category",
                yField: "median",
                config: {
                    data: [
                        { category: "VER", min: 92.1, q1: 92.4, median: 92.6, q3: 92.9, max: 93.4 },
                        { category: "NOR", min: 92.3, q1: 92.7, median: 93.0, q3: 93.5, max: 94.1 },
                        { category: "STR", min: 93.0, q1: 93.8, median: 94.2, q3: 94.9, max: 96.5, outliers: [98.2] },
                    ],
                    xAxisLabel: "Lap time",
                    yAxisLabel: "Driver",
                    unit: "s",
                },
            }),
        ],
    },
    {
        label: "swarm — full-race pace distribution (one dot per lap)",
        userQuery: "Compare full race pace for VER, NOR and STR at Suzuka",
        content: "Verstappen's dots stack the tightest; Stroll sprays wide with a late outlier.",
        chartSpecs: [
            spec({
                id: "demo-swarm",
                type: "swarm",
                title: "Pace Distribution: 2024 • Suzuka",
                subtitle: "VER, NOR, STR • every lap plotted",
                question: "Who had the best race pace?",
                insight: "VER median 92.6s — tightest spread of the three",
                dataSource: "demo",
                xField: "driver",
                yField: "lap_time",
                config: {
                    data: [
                        { driver: "VER", lap: 1, value: 94.1 }, { driver: "VER", lap: 2, value: 92.8 },
                        { driver: "VER", lap: 3, value: 92.6 }, { driver: "VER", lap: 4, value: 92.5 },
                        { driver: "VER", lap: 5, value: 92.7 }, { driver: "VER", lap: 6, value: 92.4 },
                        { driver: "VER", lap: 7, value: 92.6 }, { driver: "VER", lap: 8, value: 92.9 },
                        { driver: "VER", lap: 9, value: 93.1 }, { driver: "VER", lap: 10, value: 93.4 },
                        { driver: "NOR", lap: 1, value: 94.5 }, { driver: "NOR", lap: 2, value: 93.2 },
                        { driver: "NOR", lap: 3, value: 93.0 }, { driver: "NOR", lap: 4, value: 92.8 },
                        { driver: "NOR", lap: 5, value: 93.1 }, { driver: "NOR", lap: 6, value: 92.7 },
                        { driver: "NOR", lap: 7, value: 93.3 }, { driver: "NOR", lap: 8, value: 93.0 },
                        { driver: "NOR", lap: 9, value: 93.6 }, { driver: "NOR", lap: 10, value: 94.1 },
                        { driver: "STR", lap: 1, value: 95.8 }, { driver: "STR", lap: 2, value: 94.4 },
                        { driver: "STR", lap: 3, value: 94.0 }, { driver: "STR", lap: 4, value: 94.2 },
                        { driver: "STR", lap: 5, value: 93.8 }, { driver: "STR", lap: 6, value: 94.9 },
                        { driver: "STR", lap: 7, value: 94.1 }, { driver: "STR", lap: 8, value: 95.2 },
                        { driver: "STR", lap: 9, value: 94.5 }, { driver: "STR", lap: 10, value: 98.2 },
                    ],
                    xAxisLabel: "Driver",
                    yAxisLabel: "Lap time",
                    unit: "s",
                    intent: "lap_time_distribution",
                },
            }),
        ],
    },
    {
        label: "histogram — pit-stop time distribution",
        userQuery: "Pit stop spread at Silverstone",
        content: "Most stops clustered 2.4–2.8s with a long tail of slow stops.",
        chartSpecs: [
            spec({
                id: "demo-histogram",
                type: "histogram",
                title: "Pit Stops: 2024 • Silverstone",
                subtitle: "Stop-time distribution",
                dataSource: "demo",
                xField: "bin",
                yField: "count",
                config: {
                    data: [
                        { bin: "2.0–2.4", count: 4 },
                        { bin: "2.4–2.8", count: 18 },
                        { bin: "2.8–3.2", count: 9 },
                        { bin: "3.2+", count: 3 },
                    ],
                    xAxisLabel: "Stop time (s)",
                    yAxisLabel: "Stops",
                    unit: "",
                },
            }),
        ],
    },
    {
        label: "kpi — headline number",
        userQuery: "How many wins did Verstappen have in 2023?",
        content: "A record-breaking season.",
        chartSpecs: [
            spec({
                id: "demo-kpi",
                type: "kpi",
                title: "Season Wins: VER 2023",
                subtitle: "Most wins in a single season",
                dataSource: "demo",
                xField: "key",
                yField: "value",
                config: {
                    data: [{ key: "Wins", value: 19, label: "out of 22 races" }],
                    unit: "",
                },
            }),
        ],
    },
    {
        label: "heatmap — unsupported fallback (EmptyChart)",
        userQuery: "Heatmap demo",
        content: "Heatmaps have no renderer yet, so the dispatcher shows its fallback.",
        chartSpecs: [
            spec({
                id: "demo-heatmap",
                type: "heatmap",
                title: "Track Heatmap (unsupported)",
                dataSource: "demo",
                xField: "x",
                yField: "y",
                config: {},
            }),
        ],
    },
    {
        label: "standard-mode synthesis — raw get_telemetry payload",
        userQuery: "Compare VER and HAM telemetry at Monza",
        content: "Synthesized from the raw tool payload below — no pre-planned specs.",
        visualizationData: [
            {
                tool: "get_telemetry",
                args: { year: 2024, gp: "Monza", driver: "VER" },
                success: true,
                data: {
                    data: [
                        { Distance: 0, Speed: 120, Throttle: 100, Brake: 0 },
                        { Distance: 100, Speed: 280, Throttle: 100, Brake: 0 },
                        { Distance: 200, Speed: 95, Throttle: 0, Brake: 100 },
                        { Distance: 300, Speed: 210, Throttle: 80, Brake: 0 },
                    ],
                },
            },
        ],
    },
    {
        label: "standard-mode synthesis — raw standings payload",
        userQuery: "2024 final standings",
        content: "Same horizontal bars, synthesized from raw standings rows.",
        visualizationData: [
            {
                tool: "get_driver_standings",
                args: { year: 2024 },
                success: true,
                data: {
                    standings: [
                        { driver: "VER", points: 437 },
                        { driver: "NOR", points: 374 },
                        { driver: "LEC", points: 356 },
                    ],
                },
            },
        ],
    },
    {
        label: "bump — championship position by round (P1 on top)",
        userQuery: "How did the 2024 standings evolve round by round?",
        content: "Red Bull led throughout while McLaren climbed past Ferrari.",
        chartSpecs: [
            spec({
                id: "demo-bump",
                type: "bump",
                title: "Position Progression: 2024",
                subtitle: "Championship position by round (P1 at top)",
                question: "When did McLaren take second?",
                dataSource: "demo",
                xField: "x",
                yField: "VER",
                config: {
                    data: [
                        { x: 1, VER: 1, NOR: 3, LEC: 2, PIA: 5 },
                        { x: 2, VER: 1, NOR: 2, LEC: 4, PIA: 5 },
                        { x: 3, VER: 1, NOR: 3, LEC: 2, PIA: 4 },
                        { x: 4, VER: 1, NOR: 2, LEC: 3, PIA: 5 },
                        { x: 5, VER: 1, NOR: 2, LEC: 4, PIA: 3 },
                        { x: 6, VER: 1, NOR: 2, LEC: 3, PIA: 4 },
                    ],
                    series: ["VER", "NOR", "LEC", "PIA"],
                    xAxisLabel: "Round",
                    yAxisLabel: "Position",
                    unit: "pos",
                    intent: "position_progression",
                },
            }),
        ],
    },
    {
        label: "standard-mode synthesis — multi-driver laps (line + swarm)",
        userQuery: "Compare VER and NOR lap times at Suzuka",
        content: "Progression line plus a pace-distribution swarm, synthesized from raw laps.",
        visualizationData: [
            {
                tool: "get_laps",
                args: { year: 2024, gp: "Suzuka" },
                success: true,
                data: {
                    laps: [
                        { lap_number: 1, lap_time: "1:34.100", driver: "VER" },
                        { lap_number: 2, lap_time: "1:32.800", driver: "VER" },
                        { lap_number: 3, lap_time: "1:32.600", driver: "VER" },
                        { lap_number: 4, lap_time: "1:32.500", driver: "VER" },
                        { lap_number: 1, lap_time: "1:34.500", driver: "NOR" },
                        { lap_number: 2, lap_time: "1:33.200", driver: "NOR" },
                        { lap_number: 3, lap_time: "1:33.000", driver: "NOR" },
                        { lap_number: 4, lap_time: "1:32.700", driver: "NOR" },
                    ],
                },
            },
        ],
    },
    {
        label: "standard-mode synthesis — round positions (bump)",
        userQuery: "Standings progression over the first 4 rounds",
        content: "Bump chart synthesized from raw round-by-round positions.",
        visualizationData: [
            {
                tool: "get_race",
                args: { year: 2024 },
                success: true,
                data: {
                    results: [
                        { round: 1, driver: "VER", position: 1 },
                        { round: 1, driver: "NOR", position: 3 },
                        { round: 2, driver: "VER", position: 1 },
                        { round: 2, driver: "NOR", position: 2 },
                        { round: 3, driver: "VER", position: 1 },
                        { round: 3, driver: "NOR", position: 3 },
                        { round: 4, driver: "VER", position: 1 },
                        { round: 4, driver: "NOR", position: 2 },
                    ],
                },
            },
        ],
    },
    {
        label: "multi-chart message — standings + grid vs finish stacked",
        userQuery: "Monza 2024 recap with standings context",
        content: "Two charts stack in one message, newest context first.",
        chartSpecs: [
            spec({
                id: "demo-multi-standings",
                type: "horizontal_bar",
                title: "Points After Monza: 2024",
                dataSource: "demo",
                xField: "driver",
                yField: "points",
                config: {
                    data: [
                        { key: "VER", value: 303 },
                        { key: "NOR", value: 241 },
                        { key: "LEC", value: 217 },
                    ],
                    xAxisLabel: "Championship points",
                    yAxisLabel: "Driver",
                    unit: "pts",
                    highlight: { key: "VER", value: 303 },
                },
            }),
            spec({
                id: "demo-multi-scatter",
                type: "scatter",
                title: "Grid vs Finish: 2024 • Monza",
                dataSource: "demo",
                xField: "x",
                yField: "y",
                config: {
                    data: [
                        { key: "LEC", x: 1, y: 1, group: "LEC" },
                        { key: "HAM", x: 6, y: 4, group: "HAM" },
                    ],
                    xAxisLabel: "Grid position",
                    yAxisLabel: "Finish position",
                    unit: "pos",
                    intent: "qualifying_vs_result",
                },
            }),
        ],
    },
];

function demoMessage(demo: Demo, index: number): Message {
    return {
        id: `viz_demo_${index}`,
        role: "assistant",
        content: demo.content,
        timestamp: Date.now(),
        ...(demo.chartSpecs ? { chartSpecs: demo.chartSpecs } : {}),
        ...(demo.visualizationData !== undefined ? { visualizationData: demo.visualizationData } : {}),
    };
}

export default function VizGalleryPage() {
    return (
        <div className="h-dvh w-full overflow-y-auto bg-carbon text-foreground">
            <div className="mx-auto w-full min-w-0 max-w-3xl px-3 py-6 sm:px-4">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                    <Button variant="ghost" size="sm" asChild className="h-8 gap-2 text-xs">
                        <Link href="/">
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to chat
                        </Link>
                    </Button>
                    <div className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-[var(--f1-yellow)]" />
                        <h1 className="text-base font-bold uppercase tracking-wider">
                            In-chat visualizations
                        </h1>
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {DEMOS.length} demos · every chart type
                    </span>
                </div>

                <div className="flex flex-col gap-8 pb-16">
                    {DEMOS.map((demo, i) => (
                        <section key={demo.label} id={`demo-${i + 1}`} aria-label={demo.label} className="scroll-mt-6">
                            <p className="mb-2 px-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:px-4">
                                {i + 1}. {demo.label}
                            </p>
                            <div className="rounded-xl border border-border/40 bg-background/60">
                                <MessageBubble
                                    message={demoMessage(demo, i)}
                                    readOnly
                                    userQuery={demo.userQuery}
                                />
                            </div>
                            <p className="mt-1 px-3 font-mono text-[10px] text-muted-foreground/70 md:px-4">
                                Q: {demo.userQuery}
                            </p>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
