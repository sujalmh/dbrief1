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
import { exportConversation } from "@/lib/utils/export-conversation";
import { useChatStore } from "@/lib/store";
import { Check, Copy, Download, FileJson, FileText, Link2, Loader2, Share2, Trash2 } from "lucide-react";

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
            // Clipboard API unavailable: select fallback.
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

    const handleDownload = (format: "markdown" | "json") => {
        const st = useChatStore.getState();
        exportConversation(st.messages, format, {
            title: sessionTitle || st.sessions.find((s) => s.id === st.currentSessionId)?.title,
        });
    };
    const hasMessages = useChatStore((s) => s.messages.length > 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Flat liquid-glass surface; blur picks up the background. */}
            <DialogContent className="sm:max-w-[440px] border-none bg-transparent p-0 shadow-none gap-0">
                <div className="modal-glass rounded-xl p-5">
                    <DialogHeader className="mb-4 text-left">
                        <div className="flex items-center gap-3">
                            <span className="btn-wheel btn-wheel-purple h-9 w-9 shrink-0">
                                <Share2 className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <DialogTitle className="text-sm font-bold uppercase tracking-wider">
                                    Share
                                </DialogTitle>
                                <DialogDescription className="truncate text-xs text-muted-foreground">
                                    {sessionTitle ? (
                                        <span className="font-mono">{sessionTitle}</span>
                                    ) : (
                                        "Read-only link. No sign-in needed."
                                    )}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="grid gap-3">
                        {loading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : links.length === 0 ? (
                            <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/60 dark:bg-black/30 px-3 py-2.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-semibold">No links yet</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        Read-only. Shows messages and sources.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            links.map((l) => (
                                <div
                                    key={l.token}
                                    className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/60 dark:bg-black/30 px-2 py-1.5 pl-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
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
                                        className="btn-wheel btn-wheel-blue h-8 w-8 shrink-0"
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
                            className="btn-wheel btn-wheel-green h-9 w-full gap-2 px-4 text-xs font-bold uppercase tracking-wide"
                        >
                            {working ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Link2 className="h-4 w-4" />
                            )}
                            {links.length === 0 ? "Create share link" : "Create another link"}
                        </Button>

                        <div className="rounded-xl border border-white/15 bg-white/60 dark:bg-black/30 p-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                                <Download className="h-3.5 w-3.5" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">
                                    Download
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDownload("markdown")}
                                    disabled={!hasMessages}
                                    className="btn-wheel btn-wheel-blue h-8 gap-1.5 text-xs"
                                >
                                    <FileText className="h-3.5 w-3.5" />
                                    Markdown
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDownload("json")}
                                    disabled={!hasMessages}
                                    className="btn-wheel btn-wheel-blue h-8 gap-1.5 text-xs"
                                >
                                    <FileJson className="h-3.5 w-3.5" />
                                    JSON
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
