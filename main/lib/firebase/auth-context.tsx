"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
    onIdTokenChanged,
    User,
    GoogleAuthProvider,
    signInWithPopup,
    signOut
} from "firebase/auth";
import { auth } from "./client";
import { setCookie, deleteCookie } from "cookies-next";
import { saveUserProfile } from "./firestore";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const unsubscribe = onIdTokenChanged(auth, async (user) => {
            if (!isMounted) return;

            if (user) {
                if (isMounted) setUser(user);
                
                try {
                    const token = await user.getIdToken();
                    if (isMounted) {
                        setCookie("firebaseToken", token, { maxAge: 60 * 60 * 24 }); // 1 day
                    }

                    // Save/Update user profile via Client SDK
                    await saveUserProfile({
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL
                    });
                } catch (err) {
                    console.error("Error saving user profile or getting token:", err);
                }
            } else {
                if (isMounted) {
                    setUser(null);
                    deleteCookie("firebaseToken");
                }
            }
            if (isMounted) setLoading(false);
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    };

    const logout = async () => {
        await signOut(auth);
    };

    return (
        <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
