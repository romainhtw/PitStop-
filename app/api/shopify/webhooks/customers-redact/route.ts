/**
 * POST /api/shopify/webhooks/customers-redact
 * GDPR mandatory webhook — customer deletion request.
 * PitStop holds NO customer PII (product/inventory data only), so we log and acknowledge.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/webhookVerify";

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

  // PitStop stores no customer PII — log the request and return 200.
  console.log("[webhook] customers/redact received:", rawBody);

  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
