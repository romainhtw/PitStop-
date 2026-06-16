import Dexie, { type Table } from "dexie";
import type { ShopifyProduct } from "@/lib/types";

// ── Entry persisted per scan session ────────────────────────────────────────
export interface StockTakeEntry {
  variantId: string;
  counted: number;
  done: boolean;
  updatedAt: number;
}

// ── Local catalog mirror (barcode + sku indexed for instant lookup) ──────────
export interface LocalCatalogItem {
  variantId: string;
  barcode: string;         // normalised uppercase
  sku: string;             // normalised uppercase
  supplierSkus: string[];  // multi-entry index — covers supplier cross-refs
  productTitle: string;
  variantTitle: string;
  productType: string;
  inventoryItemId: string;
  onHandQtyStore: number;
  onHandQtyWarehouse: number;
  cachedAt: number;
}

class StockTakeDatabase extends Dexie {
  entries!: Table<StockTakeEntry, string>;
  catalog!: Table<LocalCatalogItem, string>;

  constructor() {
    super("pitstop_stocktake");

    // v1 — original entries table (keep for migration)
    this.version(1).stores({
      entries: "variantId, done, updatedAt",
    });

    // v2 — add local catalog with multi-criteria indexes
    // *supplierSkus = multi-entry index (each array element gets its own index row)
    this.version(2).stores({
      entries: "variantId, done, updatedAt",
      catalog: "variantId, barcode, sku, *supplierSkus, productType",
    });
  }
}

export const stockTakeDb = new StockTakeDatabase();

// ── Entry helpers ─────────────────────────────────────────────────────────────
export async function loadEntries(): Promise<Record<string, { counted: number; done: boolean }>> {
  try {
    const rows = await stockTakeDb.entries.toArray();
    const map: Record<string, { counted: number; done: boolean }> = {};
    for (const r of rows) map[r.variantId] = { counted: r.counted, done: r.done };
    return map;
  } catch {
    return {};
  }
}

export async function saveEntry(variantId: string, counted: number, done: boolean): Promise<void> {
  try {
    await stockTakeDb.entries.put({ variantId, counted, done, updatedAt: Date.now() });
  } catch {}
}

export async function clearAllEntries(): Promise<void> {
  try {
    await stockTakeDb.entries.clear();
  } catch {}
}

// ── Catalog sync — populate local Dexie from loaded products ────────────────
export async function syncCatalogToLocal(products: ShopifyProduct[]): Promise<void> {
  const rows: LocalCatalogItem[] = products.map((p) => ({
    variantId: p.variantId,
    barcode: (p.barcode ?? "").trim().toUpperCase(),
    sku: (p.sku ?? "").trim().toUpperCase(),
    supplierSkus: [],
    productTitle: p.productTitle,
    variantTitle: p.variantTitle,
    productType: p.productType,
    inventoryItemId: p.inventoryItemId,
    onHandQtyStore: p.onHandQtyStore ?? 0,
    onHandQtyWarehouse: p.onHandQtyWarehouse ?? 0,
    cachedAt: Date.now(),
  }));

  await stockTakeDb.transaction("rw", stockTakeDb.catalog, async () => {
    await stockTakeDb.catalog.bulkPut(rows);
  });
}

// ── Multi-criteria lookup: barcode → SKU → supplierSku waterfall ─────────────
export interface LookupResult {
  item: LocalCatalogItem;
  matchedOn: "barcode" | "sku" | "supplierSku";
}

export async function lookupByCode(raw: string): Promise<LookupResult | null> {
  const code = raw.trim().toUpperCase();
  if (!code) return null;

  const byBarcode = await stockTakeDb.catalog.where("barcode").equals(code).first();
  if (byBarcode) return { item: byBarcode, matchedOn: "barcode" };

  const bySku = await stockTakeDb.catalog.where("sku").equals(code).first();
  if (bySku) return { item: bySku, matchedOn: "sku" };

  const bySupplier = await stockTakeDb.catalog.where("supplierSkus").equals(code).first();
  if (bySupplier) return { item: bySupplier, matchedOn: "supplierSku" };

  return null;
}

// Fallback: in-memory search against already-loaded products (before Dexie is populated)
export function lookupInMemory(code: string, products: ShopifyProduct[]): ShopifyProduct | null {
  const c = code.trim().toUpperCase();
  return products.find(
    (p) =>
      (p.barcode ?? "").trim().toUpperCase() === c ||
      (p.sku ?? "").trim().toUpperCase() === c
  ) ?? null;
}
