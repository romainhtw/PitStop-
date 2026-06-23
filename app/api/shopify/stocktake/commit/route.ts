import { NextRequest, NextResponse } from "next/server";
import { fetchInventoryLevels, batchAdjustInventory, getPrimaryLocationGid } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
import { hasBillingAccess } from "@/lib/shopify/billing";

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
    if (!(await hasBillingAccess(shop))) return NextResponse.json({ error: "SUBSCRIPTION_REQUIRED" }, { status: 402 });
    const merchantId = shop;

    const { items }: { items: CommitItem[] } = await req.json();

    if (!items?.length) return NextResponse.json({ error: "No items provided" }, { status: 400 });

    // Resolve the location server-side per shop — never trust a client-supplied /
    // bundle-baked location id (it belongs to whatever shop the build was configured
    // for, not necessarily the calling tenant).
    const locationGid = await getPrimaryLocationGid(shop);
    if (!locationGid) return NextResponse.json({ error: "Could not resolve a Shopify location for this shop." }, { status: 400 });
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

    // Baseline above reads on_hand → adjust the on_hand ledger too (a physical
    // count corrects on-hand units, not the derived "available" quantity).
    const { userErrors, groupId } = await batchAdjustInventory(
      shop,
      changes.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: c.locationId, delta: c.delta })),
      "correction",
      referenceDocumentUri,
      "on_hand"
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
