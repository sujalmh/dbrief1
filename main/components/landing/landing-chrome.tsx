"use client";

import { useTheme } from "next-themes";
import { LogIn, Moon, Sun } from "lucide-react";
import {
    AppHeaderShell,
    LogoBadge,
    ModePill,
    SessionBadge,
    type ModeLabel,
} from "@/components/layout/header-shell";
import { Button } from "@/components/ui/button";

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
            {/* Identity */}
            <div className="flex min-w-0 items-center gap-2 md:gap-6">
                <LogoBadge />
                <SessionBadge
                    label="F1 RACE ENGINEERING"
                    className="hidden sm:flex"
                />
            </div>

            {/* The header's mode selector doubles as the demo switcher. */}
            <ModePill active={activeMode} onSelect={onSelectMode} />

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
                <ThemeToggle />
                <Button
                    asChild
                    className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-wider md:h-10 md:px-4"
                >
                    <a href="/api/auth/google">
                        <LogIn className="h-4 w-4" />
                        Sign in
                    </a>
                </Button>
            </div>
        </AppHeaderShell>
    );
}

export function LandingFooter() {
    return (
        <footer className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-border/40 px-2 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            <span>© 2026 Dbrief1</span>
            <a href="/privacy" className="transition-colors hover:text-foreground">
                Privacy
            </a>
            <a href="/terms" className="transition-colors hover:text-foreground">
                Terms
            </a>
        </footer>
    );
}
