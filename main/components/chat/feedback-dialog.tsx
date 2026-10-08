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
            <DialogContent className="sm:max-w-[420px] border-none bg-gradient-to-r from-white/40 via-white/10 to-white/40 dark:from-white/25 dark:via-white/5 dark:to-white/25 p-px shadow-[0_8px_32px_rgba(0,0,0,0.5)] gap-0">
                <div className="rounded-[calc(0.5rem-1px)] bg-white/75 dark:bg-black/45 backdrop-blur-xl p-6">
                    <DialogHeader className="mb-4 text-center">
                        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-gradient-to-r from-[var(--f1-red)] to-[var(--f1-red)]/40" />
                        <DialogTitle className="text-lg font-black uppercase italic tracking-widest">
                            How was that answer?
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground/80">
                            Your first response just landed — rate it to help tune the race engineer.
                        </DialogDescription>
                    </DialogHeader>

                    {sent ? (
                        <p className="py-4 text-center text-sm font-bold text-green-500">
                            Thanks — feedback received.
                        </p>
                    ) : (
                        <div className="grid gap-4">
                            <div className="flex items-center justify-center gap-1.5" role="radiogroup" aria-label="Star rating">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                        key={star}
                                        type="button"
                                        role="radio"
                                        aria-checked={rating === star}
                                        aria-label={`${star} star${star > 1 ? "s" : ""}`}
                                        onClick={() => setRating(star)}
                                        className="rounded-sm p-1 transition-transform hover:scale-110"
                                    >
                                        <Star
                                            className={cn(
                                                "h-7 w-7 transition-colors",
                                                rating !== null && star <= rating
                                                    ? "fill-[var(--f1-yellow)] text-[var(--f1-yellow)]"
                                                    : "text-muted-foreground/40"
                                            )}
                                        />
                                    </button>
                                ))}
                            </div>

                            <Textarea
                                value={comment}
                                onChange={(e) => setComment(e.target.value.slice(0, 2000))}
                                placeholder="What worked or missed? (optional)"
                                className="min-h-[80px] bg-background/60 text-sm"
                            />

                            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

                            <div className="flex items-center justify-between">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={close}
                                    className="h-9 px-4 text-xs uppercase tracking-wide text-muted-foreground"
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
                                    className="btn-wheel btn-wheel-green h-9 px-5 text-xs font-bold tracking-wide"
                                >
                                    {sending ? "Sending..." : "Send feedback"}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
