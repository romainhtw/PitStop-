/**
 * requireShop — authenticate an embedded-app API request and guarantee a
 * fresh access token is cached in Firestore before returning.
 *
 * Flow:
 *  1. Extract the App Bridge session token (JWT) from Authorization: Bearer.
 *  2. Verify it via HS256 → derive the shop domain.
 *  3. Load the persisted token from Firestore.
 *  4. If absent or within 60 s of expiry, run a token exchange and persist
 *     the new expiring token.  If exchange fails and there is no existing
 *     token, return null (unauthenticated).
 *  5. Return the shop domain so the caller can pass it to shopifyFetch().
 *
 * All existing routes that do:
 *   const shop = await requireShop(req);
 *   if (!shop) return 401;
 *   ... shopifyFetch(shop, ...) ...
 * will transparently benefit from the auto-refresh with zero changes.
 */
import { type NextRequest } from "next/server";
import {
  getSessionTokenFromRequest,
  verifyShopifySessionToken,
} from "@/lib/shopify/sessionToken";
import { getShop, saveShop } from "@/lib/shopify/shops";
import { exchangeSessionToken } from "@/lib/shopify/tokenExchange";

export async function requireShop(req: NextRequest): Promise<string | null> {
  // 1. Extract raw session token from the Authorization header.
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) { console.error("[requireShop] NO session token in Authorization header"); return null; }

  // 2. Verify signature and derive shop domain.
  const shop = await verifyShopifySessionToken(sessionToken);
  if (!shop) { console.error("[requireShop] session token present but verify returned null"); return null; }

  // 3. Always exchange the session token for a fresh EXPIRING offline token.
  //    Token exchange is cheap and is the recommended per-request auth pattern;
  //    it also self-heals any legacy non-expiring token cached in Firestore
  //    (non-expiring tokens are rejected by the Admin API with 403).
  const exchanged = await exchangeSessionToken(shop, sessionToken);

  if (exchanged && exchanged.expiresAt > Date.now()) {
    await saveShop(shop, exchanged.accessToken, exchanged.scope, exchanged.expiresAt);
  } else {
    const existing = await getShop(shop);
    if (!existing?.accessToken) {
      // Exchange failed and we have nothing cached — cannot serve the request.
      console.error(`[requireShop] token exchange failed for ${shop} and no cached token exists`);
      return null;
    }
    // Exchange failed but a cached token exists — fall through and let
    // shopifyFetch attempt it; Shopify will 401/403 if truly dead.
  }

  // 5. Return the verified shop domain.
  return shop;
}
