"use client";

import React from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Chrome } from "lucide-react";

export function LoginModal() {
    const { user, loading, signInWithGoogle } = useAuth();
    const [isOpen, setIsOpen] = React.useState(false);

    React.useEffect(() => {
        if (!loading && !user) {
            setIsOpen(true);
        } else {
            setIsOpen(false);
        }
    }, [user, loading]);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold text-center">F1 AI Companion</DialogTitle>
                    <DialogDescription className="text-center">
                        Sign in to save your chat sessions and access advanced analysis.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-8">
                    <Button
                        onClick={signInWithGoogle}
                        variant="outline"
                        className="flex items-center gap-2 h-12 text-lg"
                    >
                        <Chrome className="h-5 w-5" />
                        Continue with Google
                    </Button>
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">
                                Or use email (Coming Soon)
                            </span>
                        </div>
                    </div>
                    <Button disabled variant="secondary" className="h-12 text-lg">
                        Continue with Email
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
