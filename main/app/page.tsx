"use client";

import { Loader2 } from "lucide-react";
import { ChatShell } from "@/components/chat/chat-shell";
import { LandingPage } from "@/components/landing/landing-page";
import { useSession } from "@/lib/cf/session-context";

/**
 * `/` is dual-purpose (no route changes, no broken `/` new-chat links):
 * signed-in visitors get the chat shell, everyone else (incl. crawlers)
 * gets the public landing page.
 */
export default function Home() {
    const { user, loading } = useSession();

    if (loading) {
        return (
            <div className="flex h-dvh w-full items-center justify-center bg-background">
                <Loader2 className="h-7 w-7 animate-spin text-[#E10600]" />
            </div>
        );
    }

    if (user?.google) {
        return <ChatShell routeSessionId={null} />;
    }

    return <LandingPage />;
}
