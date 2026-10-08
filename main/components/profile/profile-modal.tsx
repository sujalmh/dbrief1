"use client"

import { useState } from "react"
import { Settings, Mail, LogOut, ChevronDown } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { useSession } from "@/lib/cf/session-context"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ContactForm } from "./contact-form"

/**
 * Profile modal (phone + desktop).
 * ================================
 * Opened from the navbar avatar. One place for identity (avatar, name,
 * email), Settings, Contact, and Logout — so phones get the full
 * account surface without the sidebar drawer, and desktop keeps Contact
 * out of the AI Setup modal.
 */
export function ProfileModal({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const { user, signOut } = useSession()
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const [showContact, setShowContact] = useState(false)

    if (!user) return null

    const initials = (user.displayName || "DRV").slice(0, 3).toUpperCase()

    function openSettings() {
        onOpenChange(false)
        setSettingsOpen(true)
    }

    async function handleLogout() {
        onOpenChange(false)
        await signOut()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px] border-none bg-gradient-to-r from-white/40 via-white/10 to-white/40 dark:from-white/25 dark:via-white/5 dark:to-white/25 p-px shadow-[0_8px_32px_rgba(0,0,0,0.5)] gap-0">
                <div className="rounded-[calc(0.5rem-1px)] bg-white/75 dark:bg-black/45 backdrop-blur-xl p-6">
                    <DialogHeader className="mb-4">
                        <div className="flex items-center gap-3">
                            {user.google?.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- Google avatar from verified ID-token claim
                                <img
                                    src={user.google.avatarUrl}
                                    alt=""
                                    referrerPolicy="no-referrer"
                                    className="h-11 w-11 rounded-full border border-white/20 object-cover"
                                />
                            ) : (
                                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-muted/50 text-sm font-bold">
                                    {initials}
                                </div>
                            )}
                            <div className="min-w-0">
                                <DialogTitle className="truncate text-base font-bold">
                                    {user.displayName || "Driver"}
                                </DialogTitle>
                                {user.google?.email && (
                                    <p className="truncate text-xs text-muted-foreground" title={user.google.email}>
                                        {user.google.email}
                                    </p>
                                )}
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="grid gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={openSettings}
                            className="btn-wheel h-10 justify-start gap-3 px-3 text-xs font-bold uppercase tracking-wide"
                        >
                            <Settings className="h-4 w-4" />
                            Settings
                        </Button>

                        <div className="rounded-xl border border-white/15 bg-white/60 dark:bg-black/30 backdrop-blur-md">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setShowContact((v) => !v)}
                                aria-expanded={showContact}
                                className="h-10 w-full justify-start gap-3 px-3 text-xs font-bold uppercase tracking-wide hover:bg-transparent"
                            >
                                <Mail className="h-4 w-4" />
                                Contact
                                <ChevronDown
                                    className={cn(
                                        "ml-auto h-3.5 w-3.5 transition-transform",
                                        showContact && "rotate-180"
                                    )}
                                />
                            </Button>
                            {showContact && (
                                <div className="px-3 pb-3">
                                    <ContactForm />
                                </div>
                            )}
                        </div>

                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void handleLogout()}
                            className="btn-wheel h-10 justify-start gap-3 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-[var(--f1-red)]"
                        >
                            <LogOut className="h-4 w-4" />
                            Logout
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
