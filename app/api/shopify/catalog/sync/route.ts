/**
 * Paginated catalog sync — processes ONE page of Shopify products (≤250) per call
 * so a 13k-product catalog never hits the 60s serverless limit.
 * Client calls repeatedly with ?cursor=… until done: true.
 * GET /api/shopify/catalog/sync?cursor=<cursor>
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { fetchVariantsPage, fetchInventoryLevels, getPrimaryLocationGid } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

async function syncPage(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const merchantId = shop;

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  // Optional onboarding filter: only import variants in these collections (CSV of titles)
  const collectionsParam = req.nextUrl.searchParams.get("collections");
  const collectionFilter = collectionsParam
    ? new Set(collectionsParam.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))
    : null;

  // 1. One page of variants
  const fetched = await fetchVariantsPage(shop, cursor);
  const nextCursor = fetched.nextCursor;
  const syncedAt = new Date().toISOString();

  // Apply the collection filter if onboarding chose a subset
  const variants = collectionFilter
    ? fetched.variants.filter((v) => (v.collections ?? []).some((c) => collectionFilter.has(c.toLowerCase())))
    : fetched.variants;

  if (variants.length === 0) {
    // Still report whether more pages remain so the client keeps walking the catalog
    return NextResponse.json({ processed: 0, done: nextCursor === null, nextCursor });
  }

  // 2. Resolve the shop's primary active location
  const locationGid = await getPrimaryLocationGid(shop);
  if (!locationGid) {
    return NextResponse.json({ error: "No active location found for this shop" }, { status: 500 });
  }

  const inventoryItemIds = variants.map((v) => v.inventoryItemId);
  const storeMap = new Map<string, { onHandQty: number; unitCost: number | null }>();

  // Chunk into 250s (Shopify nodes() limit)
  const CHUNK = 250;
  for (let i = 0; i < inventoryItemIds.length; i += CHUNK) {
    const chunk = inventoryItemIds.slice(i, i + CHUNK);
    const levels = await fetchInventoryLevels(shop, chunk, locationGid);
    for (const l of levels) storeMap.set(l.inventoryItemId, { onHandQty: l.onHandQty, unitCost: l.unitCost });
  }

  // 3. Write this page
  const col = adminDb.collection("shopifyProducts");
  let batch = adminDb.batch();
  let opCount = 0;
  for (const v of variants) {
    const storeLevel = storeMap.get(v.inventoryItemId);
    const product: ShopifyProduct = {
      ...v,
      merchantId,
      syncedAt,
      onHandQtyStore: storeLevel?.onHandQty ?? 0,
      onHandQtyWarehouse: 0,
      unitCost: storeLevel?.unitCost ?? null,
    };
    const docId = v.variantId.split("/").pop()!;
    batch.set(col.doc(docId), product);
    opCount++;
    if (opCount === 499) {
      await batch.commit();
      batch = adminDb.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();

  return NextResponse.json({
    processed: variants.length,
    done: nextCursor === null,
    nextCursor,
    syncedAt,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await syncPage(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// Kept for backward compatibility — a single POST runs one page too.
export async function POST(req: NextRequest) {
  try {
    return await syncPage(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
