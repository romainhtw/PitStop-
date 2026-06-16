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
    const snap = await adminDb
      .collection("purchaseOrders")
      .where("merchantId", "==", merchantId)
      .limit(limitParam)
      .get();
    // Sort client-side — avoids needing a composite Firestore index
    const orders = snap.docs
      .map((d) => d.data() as PurchaseOrder)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
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

    const po: PurchaseOrder = {
      id,
      merchantId,
      supplier: body.supplier || "",
      invoiceNumber: body.invoiceNumber || "",
      invoiceDate: body.invoiceDate || "",
      orderNumber: body.orderNumber || "",
      location: body.location || "In-Store Fitzgerald St",
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
