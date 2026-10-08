"use client"

import { useState } from "react"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useChatStore } from "@/lib/store"
import { saveFeedback } from "@/lib/cf/client"

/**
 * Contact form (shared).
 * ========================
 * Message-the-team form stored in the cloud feedback store. Lives in
 * the profile modal (phone + desktop) — not in Settings.
 */
export function ContactForm() {
    const [subject, setSubject] = useState("")
    const [message, setMessage] = useState("")
    const [sending, setSending] = useState(false)
    const [sent, setSent] = useState(false)
    const [errorMsg, setErrorMsg] = useState("")

    async function handleSend() {
        if (sending) return
        const text = message.trim()
        if (!text) {
            setErrorMsg("Write a message first.")
            return
        }
        setSending(true)
        setErrorMsg("")
        const saved = await saveFeedback({
            kind: "contact",
            subject: subject.trim() ? subject.trim() : null,
            message: text,
            sessionId: useChatStore.getState().currentSessionId,
        })
        setSending(false)
        if (!saved) {
            setErrorMsg("Could not send — check your connection and try again.")
            return
        }
        setSent(true)
        setSubject("")
        setMessage("")
    }

    if (sent) {
        return (
            <p className="px-1 py-1 text-xs font-bold text-green-500">
                Message sent — the team will read it.
            </p>
        )
    }

    return (
        <div className="grid gap-2">
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span>Bug, question, or feature idea — goes straight to the team.</span>
            </div>
            <Input
                value={subject}
                onChange={(e) => {
                    setSubject(e.target.value.slice(0, 120))
                    if (errorMsg) setErrorMsg("")
                }}
                placeholder="Subject (optional)"
                aria-label="Contact subject"
                className="text-sm bg-background/60 border-white/10"
            />
            <Textarea
                value={message}
                onChange={(e) => {
                    setMessage(e.target.value.slice(0, 2000))
                    if (errorMsg) setErrorMsg("")
                }}
                placeholder="What's on your mind?"
                aria-label="Contact message"
                className="min-h-[80px] text-sm bg-background/60 border-white/10"
            />
            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
            <div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={sending}
                    className="btn-wheel btn-wheel-green h-8 px-4 text-xs"
                >
                    {sending ? "Sending..." : "Send message"}
                </Button>
            </div>
        </div>
    )
}
