import { NextRequest, NextResponse } from "next/server";
import { fetchInventoryLevels, batchAdjustInventory, toLocationGid } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CommitItem {
  inventoryItemId: string;
  counted: number;
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;

    const { items, locationId }: { items: CommitItem[]; locationId: string } = await req.json();

    if (!items?.length) return NextResponse.json({ error: "No items provided" }, { status: 400 });
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });

    const locationGid = toLocationGid(locationId);
    const inventoryItemIds = items.map((i) => i.inventoryItemId);

    // Fetch LATEST live quantities from Shopify right before committing
    const CHUNK = 250;
    const currentQtyMap = new Map<string, number>();
    for (let i = 0; i < inventoryItemIds.length; i += CHUNK) {
      const chunk = inventoryItemIds.slice(i, i + CHUNK);
      const levels = await fetchInventoryLevels(shop, chunk, locationGid);
      for (const l of levels) {
        currentQtyMap.set(l.inventoryItemId, l.onHandQty);
      }
    }

    const changes: Array<{ inventoryItemId: string; locationId: string; delta: number; counted: number; previousQty: number }> = [];
    for (const item of items) {
      const previousQty = currentQtyMap.get(item.inventoryItemId) ?? 0;
      const delta = item.counted - previousQty;
      if (delta !== 0) {
        changes.push({ inventoryItemId: item.inventoryItemId, locationId: locationGid, delta, counted: item.counted, previousQty });
      }
    }

    if (changes.length === 0) {
      return NextResponse.json({ skipped: true, message: "All counts match current Shopify levels — nothing to update." });
    }

    const referenceDocumentUri = `gid://${merchantId}/Stocktake/ST-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

    const { userErrors, groupId } = await batchAdjustInventory(
      shop,
      changes.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: c.locationId, delta: c.delta })),
      "cycle_count_available",
      referenceDocumentUri
    );

    if (userErrors.length > 0) {
      return NextResponse.json({ error: "Some adjustments failed", userErrors }, { status: 207 });
    }

    return NextResponse.json({
      success: true,
      adjustedCount: changes.length,
      groupId,
      referenceDocumentUri,
      changes: changes.map((c) => ({ inventoryItemId: c.inventoryItemId, delta: c.delta, counted: c.counted, previousQty: c.previousQty })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
