/**
 * POST /api/merchants/config
 *
 * Saves the caller's own merchant Shopify credentials.
 *
 * Security:
 *   - merchantId is read from x-merchant-id (middleware-injected JWT claim).
 *     The body's merchantId is ignored to prevent cross-tenant writes.
 *   - Validates the domain ends in .myshopify.com.
 *   - Pings Shopify Admin API (/admin/api/2025-04/shop.json) to confirm the
 *     token actually works before persisting.
 *   - Persists shopifyAccessToken with a "PLAINTEXT:" prefix to match the
 *     migration script. A future task will swap this for KMS-encrypted storage.
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const SHOPIFY_API_VERSION = "2025-04";
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export async function POST(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { shopifyStoreDomain?: string; shopifyAdminToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const shopifyStoreDomain = (body.shopifyStoreDomain ?? "").trim().toLowerCase();
  const shopifyAdminToken  = (body.shopifyAdminToken ?? "").trim();

  if (!shopifyStoreDomain || !DOMAIN_RE.test(shopifyStoreDomain)) {
    return NextResponse.json(
      { error: "INVALID_DOMAIN", message: "Domain must look like your-store.myshopify.com" },
      { status: 400 },
    );
  }
  if (!shopifyAdminToken || shopifyAdminToken.length < 10) {
    return NextResponse.json(
      { error: "INVALID_TOKEN", message: "Admin API token looks too short." },
      { status: 400 },
    );
  }

  // Validate token by calling Shopify's shop.json endpoint.
  try {
    const pingUrl = `https://${shopifyStoreDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`;
    const pingRes = await fetch(pingUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": shopifyAdminToken,
        "Content-Type": "application/json",
      },
    });
    if (pingRes.status === 401 || pingRes.status === 403) {
      return NextResponse.json(
        { error: "TOKEN_REJECTED", message: "Shopify rejected the token. Double-check it has read/write access." },
        { status: 400 },
      );
    }
    if (pingRes.status === 404) {
      return NextResponse.json(
        { error: "STORE_NOT_FOUND", message: "Shopify could not find that store domain." },
        { status: 400 },
      );
    }
    if (!pingRes.ok) {
      return NextResponse.json(
        { error: "SHOPIFY_ERROR", message: `Shopify responded ${pingRes.status} ${pingRes.statusText}` },
        { status: 400 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error reaching Shopify";
    return NextResponse.json({ error: "NETWORK_ERROR", message }, { status: 502 });
  }

  // Persist — merchant doc may not yet exist (set with merge).
  await adminDb.collection("merchants").doc(merchantId).set(
    {
      shopifyStoreDomain,
      shopifyAccessToken: `PLAINTEXT:${shopifyAdminToken}`,
      shopifyConfiguredAt: FieldValue.serverTimestamp(),
      updatedAt:           FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await adminDb.collection("auditLogs").add({
    merchantId,
    type:      "SHOPIFY_CONFIG_UPDATED",
    actor:     req.headers.get("x-user-sub"),
    domain:    shopifyStoreDomain,
    timestamp: new Date(),
  });

  return NextResponse.json({ ok: true });
}
