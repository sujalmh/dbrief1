import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    serverTimestamp,
    updateDoc,
    setDoc,
    deleteDoc
} from "firebase/firestore";
import { db } from "./client";

export interface ChatMessage {
    id?: string;
    role: "user" | "assistant";
    content: string;
    timestamp: unknown;
    queryType?: "telemetry" | "COMPARISON" | "STRATEGY" | "INSIGHTS";
    citations?: Array<{ source: string; type: string; title?: string | null; url?: string | null; source_url?: string | null }> | null;
}

export interface ChatSession {
    id: string;
    userId: string;
    createdAt: unknown;
    lastMessageAt: unknown;
    title: string;
    type?: "telemetry" | "comparison" | "strategy" | "insights";
    context: Record<string, unknown>;
}

export const sessionsCol = collection(db, "sessions");

/** Convert a Firestore timestamp (or millis) to epoch ms. */
export function firestoreTimestampToMs(value: unknown): number | null {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "object" && value !== null) {
        const record = value as { toMillis?: unknown; seconds?: unknown };
        if (typeof record.toMillis === "function") {
            const ms = (record.toMillis as () => unknown)();
            return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
        }
        if (typeof record.seconds === "number") {
            return record.seconds * 1000;
        }
    }
    return null;
}

export async function createSession(userId: string, title: string = "New Chat", type?: "telemetry" | "comparison" | "strategy" | "insights"): Promise<string> {
    const docRef = await addDoc(sessionsCol, {
        userId,
        title,
        type: type || null,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        context: {}
    });
    return docRef.id;
}

export async function getSessions(userId: string): Promise<ChatSession[]> {
    const q = query(
        sessionsCol,
        where("userId", "==", userId),
        orderBy("lastMessageAt", "desc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as ChatSession));
}

export async function addMessageToSession(
    sessionId: string,
    message: Omit<ChatMessage, "timestamp">
) {
    const messagesCol = collection(db, "sessions", sessionId, "messages");
    const docRef = await addDoc(messagesCol, {
        ...message,
        timestamp: serverTimestamp()
    });

    // Update lastMessageAt in session
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
        lastMessageAt: serverTimestamp()
    });

    return docRef.id;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const messagesCol = collection(db, "sessions", sessionId, "messages");
    const q = query(messagesCol, orderBy("timestamp", "asc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as ChatMessage));
}

export async function updateSessionTitle(sessionId: string, title: string) {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, { title });
}

export async function updateSessionMetadata(
    sessionId: string,
    title: string,
    type: "telemetry" | "comparison" | "strategy" | "insights"
) {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, { title, type });
}

export async function deleteSession(sessionId: string) {
    // Delete all messages in the session first
    const messagesCol = collection(db, "sessions", sessionId, "messages");
    const messagesSnapshot = await getDocs(messagesCol);

    const deletePromises = messagesSnapshot.docs.map(docSnapshot => {
        return deleteDoc(docSnapshot.ref);
    });

    await Promise.all(deletePromises);

    // Then delete the session itself
    const sessionRef = doc(db, "sessions", sessionId);
    await deleteDoc(sessionRef);
}


export async function saveUserProfile(user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
}) {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
        await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp()
        });
    } else {
        await updateDoc(userRef, {
            lastLoginAt: serverTimestamp(),
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
        });
    }
}
