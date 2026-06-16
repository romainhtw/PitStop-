import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireShop } from "@/lib/shopify/requireShop";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const merchantId = shop;

  const snap = await adminDb
    .collection("shopifyProducts")
    .where("merchantId", "==", merchantId)
    .get();

  const products = snap.docs.map((d) => d.data() as ShopifyProduct);
  return NextResponse.json(products);
}
