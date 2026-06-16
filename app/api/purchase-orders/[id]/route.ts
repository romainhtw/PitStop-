import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { PurchaseOrder } from "@/lib/types";
import { adjustInventory, updateInventoryItemCost, toLocationGid } from "@/lib/shopify";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
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
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
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
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
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

      if (syncedItems.length > 0 && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
        const rawLocationId =
          po.location === "In-Store Fitzgerald St"
            ? process.env.SHOPIFY_LOCATION_ID_STORE
            : process.env.SHOPIFY_LOCATION_ID_WAREHOUSE;
        const locationGid = toLocationGid(rawLocationId);

        if (locationGid) {
          // 1. Reverse quantities — keep using adjustInventory per synced item
          const qtyReversals = await Promise.allSettled(
            syncedItems.map((r) => adjustInventory(r.inventoryItemId!, locationGid, -(r.delta!)))
          );
          const qtyFailed = qtyReversals.filter((r) => r.status === "rejected");
          if (qtyFailed.length > 0) {
            return NextResponse.json(
              { error: `Stock reversal failed for ${qtyFailed.length} item(s). PO not deleted.` },
              { status: 500 }
            );
          }

          // 2. Restore costs from costSnapshot (product-level reversal).
          //    If snapshot exists, restore exact pre-PO cost for each inventoryItemId.
          //    Wrap in allSettled so a cost failure does not abort the delete.
          if (po.costSnapshot && Object.keys(po.costSnapshot).length > 0) {
            await Promise.allSettled(
              Object.entries(po.costSnapshot).map(([invId, prevCost]) =>
                updateInventoryItemCost(invId, prevCost)
              )
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
