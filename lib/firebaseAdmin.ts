/**
 * Firebase Admin SDK — server-side only.
 *
 * Uses the FIREBASE_SERVICE_ACCOUNT_JSON environment variable (full JSON string).
 * Vercel: paste the service account JSON as a single-line value in your project settings.
 * Local dev: set the env var or use GOOGLE_APPLICATION_CREDENTIALS pointing to the JSON file.
 */
import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initAdmin() {
  if (getApps().length > 0) return getApp();

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    return initializeApp({
      credential: cert(JSON.parse(saJson) as Parameters<typeof cert>[0]),
    });
  }

  // Fallback: Application Default Credentials (works in Google Cloud / local gcloud auth)
  return initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

initAdmin();

export const adminDb = getFirestore();

// Drop `undefined` fields on writes instead of throwing.
// Firestore rejects undefined values; this makes all writes resilient to optional
// fields that weren't set (e.g. previousUnitCost when a product has no prior cost).
// settings() must run once before any other Firestore operation.
try {
  adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
  // already initialised elsewhere — safe to ignore
}
