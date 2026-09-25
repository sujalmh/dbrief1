"use client"

import { useState } from "react"
import { Info, ShieldCheck, FileText } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type InfoSection = "about" | "privacy" | "terms"

const SECTIONS: { id: InfoSection; label: string; icon: typeof Info }[] = [
    { id: "about", label: "About", icon: Info },
    { id: "privacy", label: "Privacy", icon: ShieldCheck },
    { id: "terms", label: "Terms", icon: FileText },
]

function AboutBody() {
    return (
        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
                <span className="font-bold text-foreground">Dbrief1</span> is a
                race-engineering chat for Formula 1. Ask about lap times,
                telemetry, qualifying, race results, strategy, weather, and
                regulations — the assistant plans tool calls, runs them
                against live F1 data, and answers with charts and sources.
            </p>
            <p>
                Modes at the top of the chat (Telemetry, Comparison,
                Strategy, Insights) reflect the current session. Deep
                Research mode runs a multi-step investigation with
                evidence, confidence, and chart specs; the visualization
                panel renders the charts for the active reply.
            </p>
            <p>
                Two AI setups are supported: Managed (the app owner&apos;s
                model, no setup) and BYOK (your own OpenAI-compatible
                endpoint and key, stored in a secure cookie and never in
                local storage).
            </p>
        </div>
    )
}

function PrivacyBody() {
    return (
        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
                Signing in with Google links a stable identity used for
                chat history, usage quotas, and abuse protection. We store
                your display name, email, and avatar URL from the verified
                sign-in, plus the sessions and messages you create.
            </p>
            <p>
                Chat data lives in cloud storage (sessions and message
                traces) and loads per session on demand. Lightweight UI
                preferences (theme, panel size) stay in your browser&apos;s
                local storage. Your BYOK API key, if provided, lives only
                in a secure httpOnly cookie — it is never written to
                local storage or chat history.
            </p>
            <p>
                We do not sell personal data or use chat content for
                advertising. Deleting a session removes its messages and
                stored attachments. Signing out clears the session cookie;
                contact the app owner for full account-data removal.
            </p>
        </div>
    )
}

function TermsBody() {
    return (
        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
                Dbrief1 is provided as-is for analysis and entertainment.
                Race data comes from third-party sources and models can
                misread it — verify safety-critical or betting-relevant
                claims against official timing and FIA documents before
                acting on them.
            </p>
            <p>
                Fair use applies: usage quotas (chats, deep runs, network
                limits) protect shared capacity and may reset on a schedule.
                Do not attempt to bypass quotas, abuse the service, or
                submit unlawful content.
            </p>
            <p>
                In BYOK mode you are responsible for your own provider
                account, key secrecy, and any charges it incurs. Managed
                mode is subject to the app owner&apos;s configured model
                and availability.
            </p>
        </div>
    )
}

export function InfoModal({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [section, setSection] = useState<InfoSection>("about")

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px] max-h-[85dvh] overflow-hidden border-none bg-background/95 backdrop-blur-xl shadow-2xl p-0 gap-0">
                <DialogHeader className="px-6 pt-5 pb-3 text-left border-b border-border/50">
                    <DialogTitle className="text-base font-bold tracking-tight">
                        Information
                    </DialogTitle>
                </DialogHeader>

                <div className="flex min-h-0 flex-col sm:flex-row">
                    {/* Section nav — top tabs on phones, left rail on desktop */}
                    <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border/50 p-3 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
                        {SECTIONS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setSection(id)}
                                className={cn(
                                    "flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap",
                                    section === id
                                        ? "bg-[var(--f1-red)]/15 text-[var(--f1-red)]"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                <Icon className="h-4 w-4 shrink-0" />
                                {label}
                            </button>
                        ))}
                    </nav>

                    {/* Main text panel */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        {section === "about" && <AboutBody />}
                        {section === "privacy" && <PrivacyBody />}
                        {section === "terms" && <TermsBody />}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
