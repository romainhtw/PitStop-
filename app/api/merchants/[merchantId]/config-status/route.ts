/**
 * GET /api/merchants/[merchantId]/config-status
 *
 * Lightweight check used by the PO Review page before kicking off a Shopify
 * sync. Returns whether the caller's merchant has Shopify creds saved.
 *
 * Security: the URL [merchantId] must match the caller's JWT merchantId.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ merchantId: string }> },
) {
  const { merchantId } = await ctx.params;
  const tokenMerchant  = req.headers.get("x-merchant-id");

  if (!tokenMerchant) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (tokenMerchant !== merchantId) {
    return NextResponse.json({ error: "TENANT_MISMATCH" }, { status: 403 });
  }

  const snap = await adminDb.collection("merchants").doc(merchantId).get();
  if (!snap.exists) {
    return NextResponse.json({ configured: false });
  }
  const data = snap.data() ?? {};
  const configured = Boolean(data.shopifyStoreDomain) && Boolean(data.shopifyAccessToken);
  return NextResponse.json({ configured });
}
