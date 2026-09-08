"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/firebase/auth-context";
import { Flag, Loader2 } from "lucide-react";

export function LoginPage() {
    const { signInWithGoogle } = useAuth();
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async () => {
        setIsLoading(true);
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error("Login failed:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-carbon relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-f1-red/5 rounded-full blur-[120px] animate-pulse" />
            </div>

            <div className="relative z-10 w-full max-w-md p-8 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col items-center text-center space-y-8">
                {/* Logo */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center h-16 w-16 rounded-xl bg-f1-red text-white shadow-[0_0_30px_rgba(225,6,0,0.4)]">
                        <Flag className="h-8 w-8 fill-current" />
                    </div>
                </div>

                <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tighter text-white">
                        F1 TELEMETRY<span className="text-f1-red">.AI</span>
                    </h1>
                    <p className="text-muted-foreground text-sm font-medium tracking-wide">
                        ADVANCED RACE ANALYTICS & STRATEGY
                    </p>
                </div>

                <div className="w-full space-y-4">
                    <Button
                        onClick={handleLogin}
                        disabled={isLoading}
                        className="w-full h-12 bg-white text-black hover:bg-gray-100 font-bold tracking-wide shadow-lg transition-all active:scale-95"
                    >
                        {isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element -- 20px remote favicon; next/image buys nothing here
                            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 mr-3" />
                        )}
                        CONTINUE WITH GOOGLE
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-white/10" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-transparent px-2 text-muted-foreground">
                                Access Restricted
                            </span>
                        </div>
                    </div>
                </div>

                <div className="text-[10px] text-zinc-500 font-mono">
                    SECURE ACCESS • END-TO-END ENCRYPTED • PRO TIER
                </div>
            </div>
        </div>
    );
}
