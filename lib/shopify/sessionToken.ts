/**
 * Shopify App Bridge session-token verification (for embedded API auth).
 *
 * Session tokens are HS256 JWTs signed with the app's API secret.
 * The `dest` claim contains the shop origin, e.g. "https://shop.myshopify.com".
 *
 * This module is wired into API routes in a later phase — exported here for
 * incremental adoption.
 */
import { jwtVerify, type JWTPayload } from "jose";
import { type NextRequest } from "next/server";

const API_SECRET = process.env.SHOPIFY_API_SECRET!;
const API_KEY    = process.env.SHOPIFY_API_KEY!;

interface ShopifySessionPayload extends JWTPayload {
  dest?: string;
}

/**
 * Verifies a Shopify App Bridge session token.
 * Returns the shop domain (e.g. "mystore.myshopify.com") on success, or null.
 */
export async function verifyShopifySessionToken(
  token: string
): Promise<string | null> {
  try {
    const secret = new TextEncoder().encode(API_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      audience:   API_KEY,
    });

    const shopPayload = payload as ShopifySessionPayload;
    const dest = shopPayload.dest;
    if (!dest) return null;

    // Strip "https://" prefix to return bare shop domain
    return dest.replace(/^https?:\/\//, "");
  } catch (e) {
    console.error("[sessionToken] verify FAILED:", e instanceof Error ? e.message : e, "| API_KEY len:", (API_KEY||"").length, "| API_SECRET len:", (API_SECRET||"").length);
    return null;
  }
}

/**
 * Extracts the raw Bearer token from the Authorization header without
 * verifying it. Returns null if the header is absent or malformed.
 */
export function getSessionTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Extracts and verifies the Shopify session token from the
 * `Authorization: Bearer <token>` request header.
 * Returns the shop domain or null if missing / invalid.
 */
export async function getShopFromRequest(
  req: NextRequest
): Promise<string | null> {
  const raw = getSessionTokenFromRequest(req);
  if (!raw) return null;
  return verifyShopifySessionToken(raw);
}
