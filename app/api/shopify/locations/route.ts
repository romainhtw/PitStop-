import { NextRequest, NextResponse } from "next/server";
import { fetchActiveLocations } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";

// Returns the calling shop's own active Shopify locations for the PO location
// picker. Per-tenant — never another merchant's locations.
export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const locations = await fetchActiveLocations(shop);
    return NextResponse.json({ locations });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load locations" }, { status: 500 });
  }
}
