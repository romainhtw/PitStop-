/**
 * POST /api/shopify/webhooks/app-uninstalled
 * Fired by Shopify when the merchant uninstalls the app.
 * Marks the shop token as invalid and purges all stored data.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/webhookVerify";
import { markUninstalled } from "@/lib/shopify/shops";
import { purgeShopData } from "@/lib/shopify/purge";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Resolve shop domain: prefer header, fall back to body fields
  let shop = req.headers.get("x-shopify-shop-domain") ?? "";
  if (!shop) {
    try {
      const body = JSON.parse(rawBody) as { domain?: string; myshopify_domain?: string };
      shop = body.myshopify_domain ?? body.domain ?? "";
    } catch {
      // ignore parse errors
    }
  }

  if (shop) {
    console.log(`[webhook] app/uninstalled — shop: ${shop}`);
    await Promise.all([markUninstalled(shop), purgeShopData(shop)]);
  } else {
    console.warn("[webhook] app/uninstalled received without identifiable shop:", rawBody);
  }

  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
