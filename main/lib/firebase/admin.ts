import * as admin from "firebase-admin";

if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } else {
            // Fallback for development if using ADC or local emulator
            admin.initializeApp({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            });
        }
    } catch (error) {
        console.error("Firebase admin initialization error", error);
    }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
