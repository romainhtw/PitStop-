import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { v4 as uuidv4 } from "uuid";
import { requireShop } from "@/lib/shopify/requireShop";
import type { PurchaseOrder } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;
    const url = new URL(req.url);
    const limitParam = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 200);
    // Read the merchant's orders, THEN sort, THEN cut to the limit. Limiting in
    // the query without an orderBy let Firestore return an arbitrary slice
    // (ordered by document id, which is a uuid), so with more orders than the
    // limit, recent invoices went missing from the dashboard at random.
    // Sorting client-side avoids needing a composite index; if this collection
    // ever grows past a few thousand per merchant, switch to an indexed
    // orderBy("createdAt", "desc") query instead.
    const snap = await adminDb
      .collection("purchaseOrders")
      .where("merchantId", "==", merchantId)
      .get();
    const orders = snap.docs
      .map((d) => d.data() as PurchaseOrder)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, limitParam);
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, orders: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;
    const body = (await req.json()) as Partial<PurchaseOrder>;
    const now = new Date().toISOString();
    const id = body.id || uuidv4();

    // Ownership guard: if a doc id was supplied and already exists, it must belong
    // to THIS merchant — otherwise set() would overwrite another merchant's PO.
    if (body.id) {
      const existing = await adminDb.collection("purchaseOrders").doc(id).get();
      if (existing.exists && (existing.data() as PurchaseOrder).merchantId !== merchantId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const po: PurchaseOrder = {
      id,
      merchantId,
      supplier: body.supplier || "",
      invoiceNumber: body.invoiceNumber || "",
      invoiceDate: body.invoiceDate || "",
      orderNumber: body.orderNumber || "",
      location: body.location || "",
      paymentTerms: body.paymentTerms || "",
      lineItems: body.lineItems || [],
      shippingCost: body.shippingCost ?? 0,
      status: "awaiting_review",
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.collection("purchaseOrders").doc(id).set(po);
    return NextResponse.json(po);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
