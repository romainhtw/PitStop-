/**
 * POST /api/shopify/webhooks/bulk-operations-finish
 * Fired by Shopify when any bulk operation for this app finishes on a shop.
 * If it is the stock snapshot's operation, stream-aggregate the result and
 * write the totals; foreign operations are acknowledged and ignored.
 *
 * Registered app-wide in shopify.app.toml (topic bulk_operations/finish) —
 * takes effect on the next `shopify app deploy`.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/webhookVerify";
import { completeSnapshot } from "@/lib/stockValue/snapshot";

export const runtime = "nodejs";
// Large catalogues stream a multi-MB JSONL here; give it headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  let opGid = "";
  try {
    const body = JSON.parse(rawBody) as { admin_graphql_api_id?: string };
    opGid = body.admin_graphql_api_id ?? "";
  } catch {
    // ignore — completeSnapshot matches against the stored bulkOpId anyway
  }

  if (shop) {
    try {
      await completeSnapshot(shop, opGid || undefined);
    } catch (err) {
      // completeSnapshot already recorded status:"failed" + lastError on the
      // doc; ack the webhook so Shopify doesn't retry into the same failure.
      console.error(`[webhook] bulk_operations/finish — ${shop}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
