import { type NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest, verifyShopifySessionToken } from "@/lib/shopify/sessionToken";
import { getShop, saveShop } from "@/lib/shopify/shops";
import { exchangeSessionToken } from "@/lib/shopify/tokenExchange";
import { getPlanTier, createSubscription } from "@/lib/shopify/billing";

export const runtime = "nodejs";

// Freemium: `authenticated` gates app access (free & paid both get in);
// `active` / `tier` drive the upgrade CTA. Returns 200 always with a `debug`
// field so the cause is visible in the UI while we validate billing.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = (debug: string) =>
    NextResponse.json({ authenticated: false, active: false, tier: null, confirmationUrl: null, debug });

  const tok = getSessionTokenFromRequest(req);
  if (!tok) return denied("NO_SESSION_TOKEN");

  const shop = await verifyShopifySessionToken(tok);
  if (!shop) return denied("VERIFY_FAILED");

  // Always exchange the session token for a fresh EXPIRING offline token.
  // This self-heals any legacy non-expiring token still cached in Firestore.
  const ex = await exchangeSessionToken(shop, tok);
  if (ex && ex.expiresAt > Date.now()) {
    await saveShop(shop, ex.accessToken, ex.scope, ex.expiresAt);
  } else {
    const existing = await getShop(shop);
    if (!existing?.accessToken) {
      return denied("EXCHANGE_FAILED_NO_TOKEN");
    }
    // Exchange failed but a cached token exists — let the API attempt it.
  }

  // Authenticated from here on — every tier gets into the app.
  const tier = await getPlanTier(shop);
  // comp (complimentary), paid, and dev are all "active" with no upgrade CTA — and
  // crucially comp never reaches createSubscription below, so it's never billed.
  if (tier === "comp" || tier === "paid" || tier === "dev") {
    return NextResponse.json({ authenticated: true, active: true, tier, confirmationUrl: null, debug: tier.toUpperCase() });
  }

  // free (or a transient "unknown"): still allow access, and surface an upgrade
  // confirmation URL so the merchant can move to the paid (100/mo) plan.
  const { confirmationUrl, error } = await createSubscription(shop);
  return NextResponse.json({
    authenticated: true,
    active: false,
    tier: "free",
    confirmationUrl: confirmationUrl ?? null,
    debug: error || (confirmationUrl ? "FREE" : "NO_CONFIRMATION_URL"),
  });
}
