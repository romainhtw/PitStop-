import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { PurchaseOrder } from "@/lib/types";
import { adjustInventory, updateInventoryItemCost, getPrimaryLocationGid } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;

    const snap = await adminDb.collection("purchaseOrders").doc(params.id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data() as PurchaseOrder;
    if (data.merchantId && data.merchantId !== merchantId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;

    const body = (await req.json()) as Partial<PurchaseOrder>;
    const ref = adminDb.collection("purchaseOrders").doc(params.id);
    const existing = await ref.get();

    if (!existing.exists) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const existingData = existing.data() as PurchaseOrder;
    if (existingData.merchantId && existingData.merchantId !== merchantId) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const merged: PurchaseOrder = {
      ...existingData,
      ...body,
      id: params.id,
      merchantId,
      updatedAt: now,
    };

    await ref.set(merged);
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;

    const ref = adminDb.collection("purchaseOrders").doc(params.id);
    const snap = await ref.get();

    if (snap.exists) {
      const po = snap.data() as PurchaseOrder;
      if (po.merchantId && po.merchantId !== merchantId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const syncedItems = (po.syncResult?.results ?? []).filter(
        (r) => r.status === "synced" && r.inventoryItemId && r.delta
      );

      if (syncedItems.length > 0) {
        // Resolve the shop's primary location for reversal
        const locationGid = await getPrimaryLocationGid(shop);

        if (locationGid) {
          // 1. Reverse quantities
          const qtyReversals = await Promise.allSettled(
            syncedItems.map((r) => adjustInventory(shop, r.inventoryItemId!, locationGid, -(r.delta!)))
          );
          // adjustInventory resolves with { userErrors } rather than throwing, so a
          // Shopify-refused reversal (not stocked, stale GID, GraphQL error) would
          // otherwise pass as "fulfilled". Count both a rejection AND any userErrors
          // as a failure so we never delete a PO whose stock wasn't actually reversed.
          const qtyFailed = qtyReversals.filter(
            (r) => r.status === "rejected" || (r.status === "fulfilled" && (r.value?.userErrors?.length ?? 0) > 0)
          );
          if (qtyFailed.length > 0) {
            return NextResponse.json(
              { error: `Stock reversal failed for ${qtyFailed.length} item(s). PO not deleted.` },
              { status: 500 }
            );
          }

          // 2. Restore costs from costSnapshot — only positive prior costs.
          // A snapshot of 0 means "no prior cost on record"; pushing 0 would
          // overwrite the item cost with a real $0.00 instead of leaving it.
          if (po.costSnapshot && Object.keys(po.costSnapshot).length > 0) {
            await Promise.allSettled(
              Object.entries(po.costSnapshot)
                .filter(([, prevCost]) => typeof prevCost === "number" && prevCost > 0)
                .map(([invId, prevCost]) => updateInventoryItemCost(shop, invId, prevCost))
            );
          }
        }
      }
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
