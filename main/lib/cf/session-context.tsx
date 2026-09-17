"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface CfUser {
    uid: string;
    displayName: string;
    google?: { email: string; name: string | null; avatarUrl: string | null } | null;
}

interface SessionContextType {
    user: CfUser | null;
    loading: boolean;
    /** Cloud sync available (false when CF_API_TOKEN is missing server-side). */
    cloudReady: boolean;
    /** Direct Google OAuth is configured on this deployment. */
    googleLoginAvailable: boolean;
    signOut: () => Promise<void>;
    refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<CfUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [cloudReady, setCloudReady] = useState(true);
    const [googleLoginAvailable, setGoogleLoginAvailable] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/cf/me", { credentials: "same-origin" });
            if (!res.ok) {
                // Cloud storage unavailable — run local-only.
                if (res.status === 503) setCloudReady(false);
                setUser(null);
                return;
            }
            const data = (await res.json()) as { user?: CfUser; googleLoginAvailable?: boolean };
            if (data.user) {
                setUser(data.user);
                setCloudReady(true);
            } else {
                setUser(null);
            }
            setGoogleLoginAvailable(data.googleLoginAvailable === true);
        } catch {
            setUser(null);
            setCloudReady(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const signOut = useCallback(async () => {
        try {
            await fetch("/api/cf/signout", { method: "POST", credentials: "same-origin" });
        } catch {
            // Best-effort; a fresh identity is provisioned on next refresh.
        }
        setUser(null);
        await refresh();
    }, [refresh]);

    return (
        <SessionContext.Provider value={{ user, loading, cloudReady, googleLoginAvailable, signOut, refresh }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
