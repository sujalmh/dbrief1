"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    createShareLink,
    listShareLinks,
    revokeShareLink,
    shareUrl,
    type ShareLinkInfo,
} from "@/lib/cf/client";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionId: string | null;
    sessionTitle?: string;
}

/**
 * Share dialog (session owner).
 * =============================
 * Mints read-only public links (`/share/<token>`) for the current chat.
 * Anyone holding a link can read the messages + sources without signing
 * in; charts, usage stats, and internals are never shared. Revoking a
 * link (or deleting the session) disables it immediately.
 */
export function ShareDialog({ open, onOpenChange, sessionId, sessionTitle }: ShareDialogProps) {
    const [links, setLinks] = React.useState<ShareLinkInfo[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [working, setWorking] = React.useState(false);
    const [error, setError] = React.useState("");
    const [copied, setCopied] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open || !sessionId) return;
        setError("");
        setCopied(null);
        setLoading(true);
        listShareLinks(sessionId)
            .then(setLinks)
            .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : "Couldn't load share links.")
            )
            .finally(() => setLoading(false));
    }, [open, sessionId]);

    const handleCreate = async () => {
        if (!sessionId) return;
        setWorking(true);
        setError("");
        try {
            const link = await createShareLink(sessionId);
            setLinks((prev) => [link, ...prev]);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't create a share link.");
        } finally {
            setWorking(false);
        }
    };

    const handleRevoke = async (token: string) => {
        if (!sessionId) return;
        setWorking(true);
        setError("");
        try {
            await revokeShareLink(sessionId, token);
            setLinks((prev) => prev.filter((l) => l.token !== token));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't revoke the link.");
        } finally {
            setWorking(false);
        }
    };

    const handleCopy = async (token: string) => {
        try {
            await navigator.clipboard.writeText(shareUrl(token));
        } catch {
            // Clipboard API unavailable (permissions) — select fallback.
            const el = document.getElementById(`share-url-${token}`) as HTMLInputElement | null;
            el?.select();
            try {
                document.execCommand("copy");
            } catch {
                // Leave the URL selected so the user can copy manually.
            }
        }
        setCopied(token);
        setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] border-none bg-gradient-to-br from-white/25 via-white/10 to-transparent p-px shadow-[0_8px_32px_rgba(0,0,0,0.5)] gap-0">
                <div className="rounded-[calc(0.5rem-1px)] bg-background/85 backdrop-blur-2xl p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                    <DialogHeader className="mb-4 text-center">
                        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-gradient-to-r from-[var(--f1-purple)] to-[var(--f1-purple)]/40" />
                        <DialogTitle className="text-xl font-black uppercase italic tracking-widest">
                            Share chat
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground/80">
                            {sessionTitle ? (
                                <>
                                    <span className="truncate font-mono">“{sessionTitle}”</span>
                                    <br />
                                </>
                            ) : null}
                            Anyone with the link can read this chat. No sign-in needed.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3 px-2">
                        {loading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : links.length === 0 ? (
                            <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-muted-foreground">
                                No links yet. Shared views are read-only and show messages
                                plus sources only — charts, usage stats, and internals stay
                                private. You can revoke a link at any time.
                            </p>
                        ) : (
                            links.map((l) => (
                                <div
                                    key={l.token}
                                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2 pl-3"
                                >
                                    <Link2 className="h-4 w-4 shrink-0 text-[var(--f1-purple)]" />
                                    <input
                                        id={`share-url-${l.token}`}
                                        readOnly
                                        value={shareUrl(l.token)}
                                        onFocus={(e) => e.target.select()}
                                        className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-foreground/90 outline-none"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleCopy(l.token)}
                                        disabled={working}
                                        className="btn-wheel h-8 w-8 shrink-0"
                                        title="Copy link"
                                    >
                                        {copied === l.token ? (
                                            <Check className="h-3.5 w-3.5 text-green-500" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                        <span className="sr-only">Copy link</span>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleRevoke(l.token)}
                                        disabled={working}
                                        className="h-8 w-8 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-[var(--f1-red)]/10 hover:text-[var(--f1-red)]"
                                        title="Revoke link"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        <span className="sr-only">Revoke link</span>
                                    </Button>
                                </div>
                            ))
                        )}

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        <Button
                            type="button"
                            onClick={handleCreate}
                            disabled={working || loading || !sessionId}
                            className={cn(
                                "btn-wheel h-9 w-full gap-2 px-4 text-xs font-bold uppercase tracking-wide",
                                links.length === 0 && "btn-wheel-green"
                            )}
                        >
                            {working ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Link2 className="h-4 w-4" />
                            )}
                            {links.length === 0 ? "Create share link" : "Create another link"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
