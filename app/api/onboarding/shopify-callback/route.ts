/**
 * GET /api/onboarding/shopify-callback
 *
 * Handles Shopify OAuth callback after merchant approves app install:
 *   1. Validates HMAC signature (tamper detection)
 *   2. Validates & consumes the CSRF state token
 *   3. Exchanges code for permanent access token
 *   4. Encrypts & stores token on merchant doc
 *   5. Registers Shopify webhooks for the store
 *   6. Redirects to /onboarding/complete
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue }       from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "crypto";
import { adminDb }          from "@/lib/firebaseAdmin";
import { requireEnv }       from "@/lib/requireEnv";
import { encryptToken }     from "@/lib/crypto/tokenEncryption";

export const runtime = "nodejs";

const WEBHOOK_TOPICS = [
  "products/update",
  "inventory_levels/update",
  "orders/create",
  "app/uninstalled",
] as const;

// ── HMAC verification ────────────────────────────────────────────────────────

function verifyShopifyHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("hmac");
  params.delete("signature");

  const entries: [string, string][] = [];
  params.forEach((v, k) => entries.push([k, v]));
  const message = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const calculated = createHmac("sha256", requireEnv("SHOPIFY_CLIENT_SECRET"))
    .update(message)
    .digest("hex");

  const a = Buffer.from(hmac,        "utf8");
  const b = Buffer.from(calculated,  "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Register webhooks ────────────────────────────────────────────────────────

async function registerWebhooks(
  shop:         string,
  accessToken:  string,
  merchantId:   string,
): Promise<void> {
  const appUrl = requireEnv("APP_URL");

  for (const topic of WEBHOOK_TOPICS) {
    const address = `${appUrl}/api/shopify/webhooks?merchantId=${merchantId}`;
    try {
      const res = await fetch(`https://${shop}/admin/api/2024-10/webhooks.json`, {
        method:  "POST",
        headers: {
          "content-type":             "application/json",
          "X-Shopify-Access-Token":   accessToken,
        },
        body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[shopify-callback] webhook ${topic} failed: ${text}`);
      }
    } catch (err) {
      console.error(`[shopify-callback] webhook ${topic} error:`, err);
    }
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const params = url.searchParams;

  const code  = params.get("code");
  const shop  = params.get("shop");
  const state = params.get("state");

  if (!code || !shop || !state) {
    return NextResponse.json({ error: "MISSING_PARAMS" }, { status: 400 });
  }

  // 1. HMAC validation
  if (!verifyShopifyHmac(params)) {
    return NextResponse.json({ error: "INVALID_HMAC" }, { status: 400 });
  }

  // 2. State validation (CSRF + expiry + single-use)
  const stateRef  = adminDb.collection("oauthStates").doc(state);
  const stateSnap = await stateRef.get();

  if (!stateSnap.exists) {
    return NextResponse.json({ error: "INVALID_STATE" }, { status: 400 });
  }

  const stateData = stateSnap.data()!;

  if (stateData.shopifyStoreDomain !== shop.toLowerCase()) {
    return NextResponse.json({ error: "STATE_DOMAIN_MISMATCH" }, { status: 400 });
  }

  if ((stateData.expiresAt as { toDate(): Date }).toDate() < new Date()) {
    await stateRef.delete();
    return NextResponse.json({ error: "STATE_EXPIRED" }, { status: 400 });
  }

  // Consume state immediately (prevent replay)
  await stateRef.delete();

  const { merchantId } = stateData;

  // 3. Exchange code for permanent access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify({
      client_id:     requireEnv("SHOPIFY_CLIENT_ID"),
      client_secret: requireEnv("SHOPIFY_CLIENT_SECRET"),
      code,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[shopify-callback] token exchange failed:", text);
    return NextResponse.json({ error: "OAUTH_EXCHANGE_FAILED" }, { status: 502 });
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // 4. Encrypt and store token
  const encrypted = encryptToken(access_token);

  await adminDb.collection("merchants").doc(merchantId).update({
    shopifyAccessToken:   encrypted,
    shopifyStoreDomain:   shop.toLowerCase(),
    shopifyConnectedAt:   FieldValue.serverTimestamp(),
    updatedAt:            FieldValue.serverTimestamp(),
  });

  // 5. Register webhooks (non-fatal if fails)
  await registerWebhooks(shop, access_token, merchantId);

  // 6. Redirect to completion page
  const completeUrl = new URL("/onboarding/complete", requireEnv("APP_URL"));
  completeUrl.searchParams.set("merchantId", merchantId);
  return NextResponse.redirect(completeUrl.toString());
}
