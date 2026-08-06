import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopify/requireShop";
import { getSnapshot } from "@/lib/stockValue/snapshot";

export const runtime = "nodejs";

// Returns the shop's stock value snapshot doc (or null before the first run).
// Read-only — never triggers Shopify calls; the panel decides whether to offer
// Calculate (no doc) or Refresh.
export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const snapshot = await getSnapshot(shop);
    return NextResponse.json({ snapshot });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load snapshot" },
      { status: 500 }
    );
  }
}
