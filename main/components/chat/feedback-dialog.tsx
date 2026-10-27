"use client"

import { useState } from "react"
import { Star } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { saveFeedback } from "@/lib/cf/client"

/**
 * First-response feedback popup.
 * ===============================
 * Opens exactly once per browser, right after the first assistant answer
 * completes (see shouldPromptFirstFeedback in the chat handler). Star
 * rating is required; the comment is optional. Best-effort cloud save —
 * closing always works even when the store is unreachable.
 */
export function FeedbackDialog() {
    const isFeedbackOpen = useChatStore((s) => s.isFeedbackOpen)
    const setFeedbackOpen = useChatStore((s) => s.setFeedbackOpen)
    const [rating, setRating] = useState<number | null>(null)
    const [comment, setComment] = useState("")
    const [sending, setSending] = useState(false)
    const [sent, setSent] = useState(false)
    const [errorMsg, setErrorMsg] = useState("")

    function close() {
        setFeedbackOpen(false)
        // Reset for cleanliness (the prompted flag keeps it one-time).
        setRating(null)
        setComment("")
        setErrorMsg("")
        setSent(false)
    }

    async function handleSubmit() {
        if (rating === null || sending) return
        setSending(true)
        setErrorMsg("")
        const state = useChatStore.getState()
        const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant")
        await saveFeedback({
            kind: "first_response",
            rating,
            message: comment.trim() ? comment.trim() : null,
            sessionId: state.currentSessionId,
            messageId: lastAssistant?.id ?? null,
        })
        // Best-effort: a failed save still closes — nagging again would
        // be worse than losing one rating.
        setSending(false)
        setSent(true)
        setTimeout(close, 900)
    }

    return (
        <Dialog open={isFeedbackOpen} onOpenChange={setFeedbackOpen}>
            <DialogContent className="sm:max-w-[420px] border-none bg-transparent p-0 shadow-none gap-0">
                {/* Solid surface: the glass panel let chart colours bleed
                    through the copy. */}
                <div className="rounded-xl border border-border bg-background p-6 shadow-2xl">
                    <DialogHeader className="mb-4 text-center">
                        <DialogTitle className="text-base font-semibold tracking-tight">
                            How was that answer?
                        </DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground">
                            Rate this first response to help tune the race engineer.
                        </DialogDescription>
                    </DialogHeader>

                    {sent ? (
                        <p className="py-4 text-center text-sm font-medium text-emerald-700 dark:text-[var(--f1-green)]">
                            Thanks — feedback received.
                        </p>
                    ) : (
                        <div className="grid gap-4">
                            <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="Star rating">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                        key={star}
                                        type="button"
                                        role="radio"
                                        aria-checked={rating === star}
                                        aria-label={`${star} star${star > 1 ? "s" : ""}`}
                                        onClick={() => setRating(star)}
                                        className="flex h-10 w-10 items-center justify-center rounded-md transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    >
                                        <Star
                                            className={cn(
                                                "h-6 w-6 transition-colors",
                                                rating !== null && star <= rating
                                                    ? "fill-[var(--f1-yellow)] text-[var(--f1-yellow)]"
                                                    : "text-muted-foreground/50"
                                            )}
                                        />
                                    </button>
                                ))}
                            </div>

                            <div className="grid gap-1.5">
                                <label htmlFor="feedback-comment" className="text-xs font-medium text-muted-foreground">
                                    What worked or missed? <span className="font-normal">(optional)</span>
                                </label>
                                <Textarea
                                    id="feedback-comment"
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value.slice(0, 2000))}
                                    placeholder="Anything specific helps…"
                                    className="min-h-[80px] bg-background/60 text-sm"
                                />
                            </div>

                            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={close}
                                    className="h-9 px-4 text-xs font-medium"
                                >
                                    Skip
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                        if (rating === null) {
                                            setErrorMsg("Pick a star rating first.")
                                            return
                                        }
                                        void handleSubmit().catch(() => {
                                            setErrorMsg("Could not send — try again or skip.")
                                            setSending(false)
                                        })
                                    }}
                                    disabled={sending || rating === null}
                                    className="btn-wheel btn-wheel-red h-9 px-4 text-xs font-semibold text-white"
                                >
                                    {sending ? "Sending…" : "Send feedback"}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
