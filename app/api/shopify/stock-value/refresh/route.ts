import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopify/requireShop";
import {
  startSnapshot,
  SnapshotBusyError,
  SnapshotRateLimitedError,
} from "@/lib/stockValue/snapshot";

export const runtime = "nodejs";
export const maxDuration = 60;

// Refresh button + first-run Calculate. Starts the bulk operation and returns
// immediately; the bulk_operations/finish webhook writes the totals.
// Manual refresh is limited to one per shop per 15 min (spec §7).
export async function POST(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const result = await startSnapshot(shop, { manual: true });
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    if (e instanceof SnapshotRateLimitedError) {
      const retryAfterSec = Math.ceil(e.retryAfterMs / 1000);
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSec },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }
    if (e instanceof SnapshotBusyError) {
      return NextResponse.json({ error: "BULK_OP_BUSY" }, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
