import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";

function verifyHmac(body: string, hmacHeader: string, secret: string): boolean {
  const computed = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

interface WebhookVariant {
  id: number;
  title: string;
  sku: string;
  barcode: string;
  price: string;
  compare_at_price: string | null;
  inventory_item_id: number;
}

interface WebhookProduct {
  id: number;
  title: string;
  product_type: string;
  status: string;
  tags: string;
  updated_at: string;
  variants: WebhookVariant[];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  // Always require a configured secret — reject if missing
  if (!secret) {
    console.error("[shopify-webhook] SHOPIFY_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  let payload: WebhookProduct;
  try {
    payload = JSON.parse(rawBody) as WebhookProduct;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Resolve which merchant this webhook belongs to (multi-tenant routing) ──
  const shopDomain = (req.headers.get("x-shopify-shop-domain") ?? "").trim().toLowerCase();
  let merchantId: string | null = null;
  if (shopDomain) {
    const snap = await adminDb
      .collection("merchants")
      .where("shopifyStoreDomain", "==", shopDomain)
      .limit(1)
      .get();
    if (!snap.empty) merchantId = snap.docs[0].id;
  }
  // Fallback for the original single-tenant Elite Racing instance (env-configured domain)
  if (!merchantId && shopDomain && shopDomain === (process.env.SHOPIFY_STORE_DOMAIN ?? "").trim().toLowerCase()) {
    merchantId = "elite-racing";
  }
  if (!merchantId) {
    // Unknown shop — ack so Shopify stops retrying, but write nothing
    console.warn("[shopify-webhook] no merchant for shop domain:", shopDomain);
    return NextResponse.json({ ok: true, action: "no_merchant", shopDomain });
  }

  const col = adminDb.collection("shopifyProducts");
  const syncedAt = new Date().toISOString();

  if (topic === "products/delete") {
    const variants = (payload.variants ?? []).filter((v) => v.id);
    if (variants.length > 0) {
      const batch = adminDb.batch();
      for (const v of variants) batch.delete(col.doc(String(v.id)));
      await batch.commit();
    }
    return NextResponse.json({ ok: true, action: "deleted", productId: payload.id });
  }

  // PRODUCTS_CREATE or PRODUCTS_UPDATE — upsert ALL statuses (active, draft, archived).
  // Client requirement: full catalog regardless of Shopify status. Products are only
  // removed from Firestore on an explicit products/delete webhook (handled above).
  const tags = payload.tags ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  // Skip variants without a valid inventory_item_id (can be absent on some webhook payloads)
  const validVariants = (payload.variants ?? []).filter((v) => v.id && v.inventory_item_id);

  if (validVariants.length === 0) {
    return NextResponse.json({ ok: true, action: "skipped_no_valid_variants", productId: payload.id });
  }

  const batch = adminDb.batch();
  for (const v of validVariants) {
    const variantId = `gid://shopify/ProductVariant/${v.id}`;
    const product: ShopifyProduct = {
      merchantId,
      variantId,
      productId: `gid://shopify/Product/${payload.id}`,
      productTitle: payload.title,
      variantTitle: v.title === "Default Title" ? "" : v.title,
      sku: v.sku || "",
      barcode: v.barcode || "",
      price: parseFloat(v.price) || 0,
      compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
      inventoryItemId: `gid://shopify/InventoryItem/${v.inventory_item_id}`,
      productType: payload.product_type || "",
      status: payload.status.toUpperCase(),
      tags,
      shopifyUpdatedAt: payload.updated_at,
      syncedAt,
    };
    batch.set(col.doc(String(v.id)), product);
  }

  await batch.commit();
  return NextResponse.json({ ok: true, action: "upserted", variants: validVariants.length });
}
