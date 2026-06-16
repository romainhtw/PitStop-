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

/** Refresh when fewer than 60 seconds remain before expiry. */
const EXPIRY_BUFFER_MS = 60_000;

export async function requireShop(req: NextRequest): Promise<string | null> {
  // 1. Extract raw session token from the Authorization header.
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) return null;

  // 2. Verify signature and derive shop domain.
  const shop = await verifyShopifySessionToken(sessionToken);
  if (!shop) return null;

  // 3. Load the current persisted record.
  const existing = await getShop(shop);

  // 4. Decide whether a token exchange is needed.
  const needsRefresh =
    !existing?.accessToken ||
    existing.expiresAt === undefined ||
    existing.expiresAt < Date.now() + EXPIRY_BUFFER_MS;

  if (needsRefresh) {
    const exchanged = await exchangeSessionToken(shop, sessionToken);

    if (exchanged) {
      await saveShop(shop, exchanged.accessToken, exchanged.scope, exchanged.expiresAt);
    } else if (!existing?.accessToken) {
      // Exchange failed and we have nothing cached — cannot serve the request.
      console.error(`[requireShop] token exchange failed for ${shop} and no cached token exists`);
      return null;
    }
    // If exchange failed but an existing (possibly stale) token exists, fall
    // through and let shopifyFetch attempt it — Shopify will 401 if truly dead.
  }

  // 5. Return the verified shop domain.
  return shop;
}
