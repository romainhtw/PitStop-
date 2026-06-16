import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const snap = await adminDb
    .collection("shopifyProducts")
    .where("merchantId", "==", merchantId)
    .get();

  const products = snap.docs.map((d) => d.data() as ShopifyProduct);
  return NextResponse.json(products);
}
