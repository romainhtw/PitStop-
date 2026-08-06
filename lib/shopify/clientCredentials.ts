/**
 * Client-credentials token refresh for background jobs.
 *
 * Stored offline tokens are EXPIRING (~1 h): requireShop refreshes them via
 * token exchange, but that needs a live App Bridge session token. Nightly
 * snapshots and webhook handlers run with no session, so they mint a fresh
 * token with the client-credentials grant (client_id + client_secret only),
 * which Shopify issues for any shop that has the app installed.
 *
 * SHOPIFY_API_SECRET is set in Vercel Production only — in local dev this
 * falls back to whatever token is cached (background flows are prod-only).
 */
import { getShop, saveShop } from "@/lib/shopify/shops";

const EXPIRY_MARGIN_MS = 120_000;

export async function ensureFreshShopToken(shop: string): Promise<string> {
  const existing = await getShop(shop);
  if (!existing) throw new Error("SHOP_NOT_INSTALLED");

  const fresh =
    existing.expiresAt === undefined || existing.expiresAt > Date.now() + EXPIRY_MARGIN_MS;
  if (fresh) return existing.accessToken;

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    // Can't refresh here (e.g. local dev) — surface the stale token and let
    // the Admin API reject it with a clear 401 rather than failing opaquely.
    console.warn(`[clientCredentials] ${shop}: token stale but no API secret in env`);
    return existing.accessToken;
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`CLIENT_CREDENTIALS_FAILED: HTTP ${res.status} ${body}`);
  }

  const json = (await res.json()) as { access_token?: string; scope?: string; expires_in?: number };
  if (!json.access_token) throw new Error("CLIENT_CREDENTIALS_FAILED: no access_token in response");

  const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 3_300_000;
  await saveShop(shop, json.access_token, json.scope ?? existing.scope, expiresAt);
  return json.access_token;
}
