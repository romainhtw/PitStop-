import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 30;

type Check = { ok: boolean; detail?: string };

// Public liveness/health endpoint (no auth — needs no shop context).
// Pinged by the weekly routine to confirm the app + its dependencies are healthy.
// Note: per-shop Shopify tokens are expiring and refreshed at request time, so a
// live Shopify ping isn't meaningful here — env + Firestore are the real signals.
export async function GET() {
  const checks: Record<string, Check> = {};

  const requiredEnv = [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "NEXT_PUBLIC_SHOPIFY_API_KEY",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
  ];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  checks.env = missing.length ? { ok: false, detail: `missing: ${missing.join(", ")}` } : { ok: true };

  let installedShops = 0;
  try {
    const snap = await adminDb.collection("shops").where("uninstalledAt", "==", null).limit(50).get();
    installedShops = snap.size;
    checks.firestore = { ok: true, detail: `${installedShops} installed shop(s)` };
  } catch (e) {
    checks.firestore = { ok: false, detail: e instanceof Error ? e.message : "error" };
  }

  // Overall status reflects what the app itself controls (env + Firestore).
  const ok = checks.env.ok && checks.firestore.ok;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", app: "pitstop-shopify", installedShops, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
