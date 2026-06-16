import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { moveInventory, toLocationGid } from "@/lib/shopify";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 30;

export type TransferLocation = "In-Store Fitzgerald St" | "Warehouse";

export interface TransferItem {
  inventoryItemId: string;
  sku: string;
  name: string;
  qty: number;
}

export interface TransferRecord {
  id: string;
  merchantId?: string;
  fromLocation: TransferLocation;
  toLocation: TransferLocation;
  items: TransferItem[];
  executedAt: string;
  shopifyGroupId?: string;
  status: "done" | "error";
  error?: string;
}

function locationGid(loc: TransferLocation): string {
  if (loc === "In-Store Fitzgerald St") {
    return toLocationGid(process.env.SHOPIFY_LOCATION_ID_STORE);
  }
  return toLocationGid(process.env.SHOPIFY_LOCATION_ID_WAREHOUSE);
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const snap = await adminDb
      .collection("transfers")
      .where("merchantId", "==", merchantId)
      .orderBy("executedAt", "desc")
      .limit(100)
      .get();
    const records = snap.docs.map((d) => d.data() as TransferRecord);
    return NextResponse.json(records);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await req.json() as {
      fromLocation: TransferLocation;
      toLocation: TransferLocation;
      items: TransferItem[];
    };

    const { fromLocation, toLocation, items } = body;

    if (!fromLocation || !toLocation || fromLocation === toLocation) {
      return NextResponse.json({ error: "Invalid locations" }, { status: 400 });
    }
    if (!items?.length) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    const fromGid = locationGid(fromLocation);
    const toGid = locationGid(toLocation);

    if (!fromGid || !toGid) {
      return NextResponse.json(
        { error: "Location IDs not configured. Set SHOPIFY_LOCATION_ID_STORE and SHOPIFY_LOCATION_ID_WAREHOUSE." },
        { status: 500 }
      );
    }

    const changes = items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      fromLocationId: fromGid,
      toLocationId: toGid,
      quantity: item.qty,
    }));

    const { userErrors, groupId } = await moveInventory(changes);

    const id = uuidv4();
    const now = new Date().toISOString();

    if (userErrors.length > 0) {
      const record: TransferRecord = {
        id,
        merchantId,
        fromLocation,
        toLocation,
        items,
        executedAt: now,
        status: "error",
        error: userErrors.map((e) => e.message).join("; "),
      };
      await adminDb.collection("transfers").doc(id).set(record);
      return NextResponse.json({ error: record.error, userErrors }, { status: 422 });
    }

    const record: TransferRecord = {
      id,
      merchantId,
      fromLocation,
      toLocation,
      items,
      executedAt: now,
      shopifyGroupId: groupId,
      status: "done",
    };
    await adminDb.collection("transfers").doc(id).set(record);

    return NextResponse.json({ ok: true, transferId: id, shopifyGroupId: groupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
