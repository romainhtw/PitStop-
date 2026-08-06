import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  startSnapshot,
  completeSnapshot,
  getSnapshot,
  SnapshotBusyError,
  STALE_RUNNING_MS,
} from "@/lib/stockValue/snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

// Nightly stock snapshot fan-out (spec §4) — Vercel Cron, see vercel.json.
// Shops are processed SEQUENTIALLY with a gap: Shopify rate limits are per
// shop, but a Promise.all over the install list would still burst this
// function's own egress and Firestore writes; sequential keeps it boring.
// Each shop only STARTS its bulk operation here — aggregation happens in the
// bulk_operations/finish webhook, so wall time stays flat as installs grow.

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  return req.headers.get("x-vercel-cron") != null;
}

const GAP_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopsSnap = await adminDb
    .collection("shops")
    .where("uninstalledAt", "==", null)
    .get();

  const results: Record<string, string> = {};
  for (const doc of shopsSnap.docs) {
    const shop = doc.id;
    try {
      const existing = await getSnapshot(shop);
      if (existing?.status === "running" && existing.bulkOpId) {
        const startedAgo = Date.now() - Date.parse(existing.startedAt ?? "");
        if (Number.isFinite(startedAgo) && startedAgo < STALE_RUNNING_MS) {
          results[shop] = "still-running";
          continue;
        }
        // Presumed missed finish webhook — try to complete from the stored op.
        await completeSnapshot(shop);
        results[shop] = "repaired-stale-run";
        continue;
      }
      const { started, alreadyRunning } = await startSnapshot(shop);
      results[shop] = started ? "started" : alreadyRunning ? "already-running" : "skipped";
    } catch (err) {
      // startSnapshot/completeSnapshot already wrote status "failed" on the doc.
      results[shop] = err instanceof SnapshotBusyError
        ? "busy-backoff"
        : `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    await sleep(GAP_MS);
  }

  const ok = !Object.values(results).some((r) => r.startsWith("error"));
  return NextResponse.json({ ok, shops: results }, { status: ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
