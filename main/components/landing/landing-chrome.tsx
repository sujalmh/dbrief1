"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Github } from "lucide-react";
import {
    AppHeaderShell,
    LogoBadge,
    ModePill,
    type ModeLabel,
} from "@/components/layout/header-shell";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/site";

/**
 * Public chrome.
 * ==============
 * The landing wears the same top bar as the signed-in app — same carbon
 * weave, same logo plate, same session pill, same mode selector — so the
 * pitch and the product are visibly one surface. Only the controls to the
 * right differ (theme switch + a single sign-in action).
 */

function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
            suppressHydrationWarning
            className="btn-wheel h-9 w-9 md:h-10 md:w-10"
        >
            <span suppressHydrationWarning className="inline-flex">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </span>
        </Button>
    );
}

export function LandingHeader({
    activeMode,
    onSelectMode,
}: {
    activeMode: ModeLabel;
    onSelectMode: (mode: ModeLabel) => void;
}) {
    return (
        <AppHeaderShell>
            {/* Identity — no plate on landing so the mark sits on the page
                background; `onBackground` swaps in the white-line artwork
                on the dark carbon header. */}
            <div className="flex min-w-0 items-center gap-2 md:gap-6">
                <LogoBadge onBackground className="bg-transparent shadow-none" />
            </div>

            {/* The header's mode selector doubles as the demo switcher. */}
            <ModePill active={activeMode} onSelect={onSelectMode} />

            {/* Actions — theme + GitHub + sign-in. The navbar carries its
                own conversion point; the composer below is the second. */}
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
                <ThemeToggle />
                <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Dbrief1 on GitHub"
                    title="Dbrief1 on GitHub"
                    className="btn-wheel inline-flex h-9 w-9 items-center justify-center md:h-10 md:w-10"
                >
                    <Github className="h-5 w-5" />
                </a>
                <a
                    href="/api/auth/google"
                    className="btn-wheel btn-wheel-red inline-flex h-9 items-center px-3 text-[11px] font-bold uppercase tracking-wider text-white no-underline md:h-10 md:px-4 md:text-xs"
                >
                    Sign in
                </a>
            </div>
        </AppHeaderShell>
    );
}
