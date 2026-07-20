/**
 * Manual Shopify OAuth helpers — no @shopify/shopify-api dependency.
 * Uses Node built-in `crypto` only.
 */
import { createHmac, timingSafeEqual } from "crypto";

const API_KEY    = process.env.SHOPIFY_API_KEY!;
const API_SECRET = process.env.SHOPIFY_API_SECRET!;
const APP_URL    = process.env.SHOPIFY_APP_URL!;
const SCOPES     = process.env.SHOPIFY_SCOPES || "write_products,read_locations,write_inventory";

/** Validates that the shop domain looks like *.myshopify.com */
export function isValidShop(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

/** Builds the Shopify OAuth consent URL. */
export function buildInstallUrl(shop: string, state: string): string {
  const redirectUri = encodeURIComponent(`${APP_URL}/api/shopify/auth/callback`);
  const scopes      = encodeURIComponent(SCOPES);
  return (
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${API_KEY}` +
    `&scope=${scopes}` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`
  );
}

/**
 * Verifies the HMAC Shopify appends to the callback query string.
 *
 * Rules per Shopify docs:
 *   - Remove `hmac` and `signature` params.
 *   - Sort remaining params by key.
 *   - Build `key=value&key2=value2` (NOT percent-encoded).
 *   - HMAC-SHA256 with API_SECRET, hex-encoded.
 *   - Constant-time compare with the `hmac` query param.
 */
export function verifyOAuthHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const pairs: Array<[string, string]> = [];
  searchParams.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    pairs.push([key, value]);
  });

  pairs.sort(([a], [b]) => a.localeCompare(b));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join("&");

  const computed = createHmac("sha256", API_SECRET)
    .update(message, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(hmac, "utf8"));
  } catch {
    return false;
  }
}

/** Exchanges an OAuth code for a permanent offline access token. */
export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     API_KEY,
      client_secret: API_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{ access_token: string; scope: string }>;
}
