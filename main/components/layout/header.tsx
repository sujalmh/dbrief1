"use client"

import { Flag, Settings } from "lucide-react"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"

export function Header() {
    const { setSettingsOpen } = useChatStore()

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="w-full max-w-screen-2xl mx-auto flex h-14 items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center rounded-sm bg-[var(--f1-red)] p-1">
                        <Flag className="h-5 w-5 text-white fill-current" />
                    </div>
                    <span className="hidden font-bold sm:inline-block font-mono tracking-tighter">
                        F1 TELEM.AI
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSettingsOpen(true)}>
                        <Settings className="h-5 w-5" />
                        <span className="sr-only">Settings</span>
                    </Button>
                    <ModeToggle />
                </div>
            </div>
        </header>
    )
}
