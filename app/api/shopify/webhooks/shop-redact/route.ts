/**
 * POST /api/shopify/webhooks/shop-redact
 * GDPR mandatory webhook — shop deletion request (48h after uninstall).
 * Purges all Firestore data scoped to this merchant.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/webhookVerify";
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

  let shopDomain: string | undefined;
  try {
    const body = JSON.parse(rawBody) as { shop_domain?: string };
    shopDomain = body.shop_domain;
  } catch {
    // malformed body — nothing to purge
  }

  if (shopDomain) {
    console.log(`[webhook] shop/redact — purging data for ${shopDomain}`);
    await purgeShopData(shopDomain);
  } else {
    console.warn("[webhook] shop/redact received without shop_domain:", rawBody);
  }

  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
