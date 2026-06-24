import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

type Check = { ok: boolean; detail?: string };

// Weekly automated health routine (P5). Invoked by Vercel Cron — see vercel.json.
// Records a dated history doc in Firestore and (best-effort) pings an alert
// webhook when degraded. Returns 503 when degraded so the Vercel cron run is
// marked failed and surfaces in the dashboard.
// Multi-tenant: per-shop Shopify tokens are expiring/refreshed at request time,
// so env + Firestore are the meaningful signals here.

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  return req.headers.get("x-vercel-cron") != null;
}

async function runChecks(): Promise<{ ok: boolean; checks: Record<string, Check>; installedShops: number }> {
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

  return { ok: checks.env.ok && checks.firestore.ok, checks, installedShops };
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok, checks, installedShops } = await runChecks();
  const ts = new Date().toISOString();
  const record = { app: "pitstop-shopify", status: ok ? "ok" : "degraded", installedShops, checks, ts };

  try {
    await adminDb.collection("monitoring").doc(`pitstop-${ts.slice(0, 10)}`).set(record);
  } catch { /* ignore */ }

  if (!ok && process.env.MONITORING_WEBHOOK_URL) {
    try {
      await fetch(process.env.MONITORING_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `⚠️ PitStop (App Store) weekly check DEGRADED — ${JSON.stringify(checks)}` }),
      });
    } catch { /* ignore */ }
  }

  return NextResponse.json(record, { status: ok ? 200 : 503 });
}

export const GET = handle;
export const POST = handle;
