/**
 * Paginated catalog sync — processes ONE page of Shopify products (≤250) per call
 * so a 13k-product catalog never hits the 60s serverless limit.
 * Client calls repeatedly with ?cursor=… until done: true.
 * GET /api/shopify/catalog/sync?cursor=<cursor>
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { fetchVariantsPage, fetchInventoryLevels, toLocationGid } from "@/lib/shopify";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

async function syncPage(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify credentials not configured" }, { status: 500 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  // Optional onboarding filter: only import variants in these collections (CSV of titles)
  const collectionsParam = req.nextUrl.searchParams.get("collections");
  const collectionFilter = collectionsParam
    ? new Set(collectionsParam.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))
    : null;

  // 1. One page of variants
  const fetched = await fetchVariantsPage(cursor);
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

  // 2. Inventory levels for this page's items (both locations)
  const storeGid = toLocationGid(process.env.SHOPIFY_LOCATION_ID_STORE);
  const warehouseGid = toLocationGid(process.env.SHOPIFY_LOCATION_ID_WAREHOUSE);
  const inventoryItemIds = variants.map((v) => v.inventoryItemId);

  const storeMap = new Map<string, { onHandQty: number; unitCost: number | null }>();
  const warehouseMap = new Map<string, number>();

  // Chunk into 250s (Shopify nodes() limit) — one page rarely exceeds this but be safe
  const CHUNK = 250;
  for (let i = 0; i < inventoryItemIds.length; i += CHUNK) {
    const chunk = inventoryItemIds.slice(i, i + CHUNK);
    const [storeLevels, warehouseLevels] = await Promise.all([
      storeGid ? fetchInventoryLevels(chunk, storeGid) : Promise.resolve([]),
      warehouseGid ? fetchInventoryLevels(chunk, warehouseGid) : Promise.resolve([]),
    ]);
    for (const l of storeLevels) storeMap.set(l.inventoryItemId, { onHandQty: l.onHandQty, unitCost: l.unitCost });
    for (const l of warehouseLevels) warehouseMap.set(l.inventoryItemId, l.onHandQty);
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
      onHandQtyWarehouse: warehouseMap.get(v.inventoryItemId) ?? 0,
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
