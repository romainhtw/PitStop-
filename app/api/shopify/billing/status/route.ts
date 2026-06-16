import { type NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest, verifyShopifySessionToken } from "@/lib/shopify/sessionToken";
import { getShop, saveShop } from "@/lib/shopify/shops";
import { exchangeSessionToken } from "@/lib/shopify/tokenExchange";
import { getActiveSubscription, createSubscription } from "@/lib/shopify/billing";

export const runtime = "nodejs";

// Returns 200 always with a `debug` field so the cause is visible in the UI while we validate billing.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const tok = getSessionTokenFromRequest(req);
  if (!tok) return NextResponse.json({ active: false, confirmationUrl: null, debug: "NO_SESSION_TOKEN" });

  const shop = await verifyShopifySessionToken(tok);
  if (!shop) return NextResponse.json({ active: false, confirmationUrl: null, debug: "VERIFY_FAILED" });

  const existing = await getShop(shop);
  const fresh = !!existing?.accessToken && !!existing.expiresAt && existing.expiresAt > Date.now() + 60_000;
  if (!fresh) {
    const ex = await exchangeSessionToken(shop, tok);
    if (ex) {
      await saveShop(shop, ex.accessToken, ex.scope, ex.expiresAt);
    } else if (!existing?.accessToken) {
      return NextResponse.json({ active: false, confirmationUrl: null, debug: "EXCHANGE_FAILED_NO_TOKEN" });
    } else {
      return NextResponse.json({ active: false, confirmationUrl: null, debug: "EXCHANGE_FAILED_STALE_TOKEN" });
    }
  }

  const sub = await getActiveSubscription(shop);
  if (sub) return NextResponse.json({ active: true, debug: "ACTIVE" });

  const { confirmationUrl, error } = await createSubscription(shop);
  return NextResponse.json({
    active: false,
    confirmationUrl: confirmationUrl ?? null,
    debug: error || (confirmationUrl ? "CREATED" : "NO_CONFIRMATION_URL"),
  });
}
