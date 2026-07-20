import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyWebhookHmac } from "@/lib/shopify/webhookVerify";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";

// inventory_levels/update payload — one location's available count for one item.
interface InventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
}

// Resolve the variant + its AUTHORITATIVE total available (across ALL locations)
// from an inventory item. The webhook payload only carries one location's count,
// which would under-report for multi-location shops — so we ask Shopify for the
// variant's inventoryQuantity (the same total the catalog sync anchors to).
const VARIANT_BY_INVENTORY_ITEM = /* GraphQL */ `
  query VariantByInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        id
        inventoryQuantity
      }
    }
  }
`;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");

  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  let payload: InventoryLevelPayload;
  try {
    payload = JSON.parse(rawBody) as InventoryLevelPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shop = (req.headers.get("x-shopify-shop-domain") ?? "").trim().toLowerCase();
  if (!shop) {
    return NextResponse.json({ ok: true, action: "no_shop" });
  }
  if (!payload.inventory_item_id) {
    return NextResponse.json({ ok: true, action: "no_inventory_item" });
  }

  // Ask Shopify for the variant + authoritative all-location total. This needs a
  // live token: in a webhook there is no session to exchange, so a lapsed offline
  // token can fail here. If it does we ACK (200) and skip — the mirror is refreshed
  // on the next Sync Now / next product webhook. We NEVER write the raw per-location
  // `available` from the payload, which would silently under-report multi-location.
  let variantNumericId: string | null = null;
  let total = 0;
  try {
    const gid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    const res = await shopifyFetch<{
      inventoryItem: { variant: { id: string; inventoryQuantity: number | null } | null } | null;
    }>(shop, VARIANT_BY_INVENTORY_ITEM, { id: gid });
    const variant = res.data?.inventoryItem?.variant;
    if (!variant?.id) {
      return NextResponse.json({ ok: true, action: "no_variant" });
    }
    variantNumericId = variant.id.split("/").pop() ?? null;
    total = variant.inventoryQuantity ?? 0;
  } catch (err) {
    // Expired token / API error — ack so Shopify stops retrying; stock will be
    // reconciled on the next full sync.
    console.warn("[inventory-webhook] refetch failed, skipping:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, action: "refetch_failed" });
  }

  if (!variantNumericId) {
    return NextResponse.json({ ok: true, action: "no_variant_id" });
  }

  // Only update a variant we already mirror — never create a partial doc missing
  // product metadata. Unknown variants are picked up by the next full sync.
  const docRef = adminDb.collection("shopifyProducts").doc(variantNumericId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: true, action: "not_mirrored", variantId: variantNumericId });
  }
  // Scope guard: only touch this shop's own mirrored doc.
  if ((snap.data()?.merchantId ?? "") !== shop) {
    return NextResponse.json({ ok: true, action: "wrong_merchant" });
  }

  await docRef.set(
    {
      onHandQtyStore: Math.max(0, total),
      onHandQtyWarehouse: 0,
      syncedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, action: "stock_updated", variantId: variantNumericId, total });
}
