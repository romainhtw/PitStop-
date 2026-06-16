import Dexie, { type Table } from "dexie";
import type { ShopifyProduct } from "@/lib/types";

/**
 * Catalog cache — instant on every login.
 *
 * The full catalog is persisted in IndexedDB (survives tab close / re-login),
 * so loadCatalog() returns it immediately. A background revalidation refreshes
 * it when stale (stale-while-revalidate) without blocking the UI. Only the very
 * first ever load (empty IndexedDB) waits on the network.
 */
const TTL_MS = 30 * 60 * 1000; // consider cache stale after 30 min → background refresh

interface CacheRow {
  key: string;
  products: ShopifyProduct[];
  ts: number;
}

class CatalogCacheDB extends Dexie {
  kv!: Table<CacheRow, string>;
  constructor() {
    super("pitstop_cache");
    this.version(1).stores({ kv: "key" });
  }
}

// Lazily create the DB only in the browser
let db: CatalogCacheDB | null = null;
function getDb(): CatalogCacheDB | null {
  if (typeof window === "undefined") return null;
  if (!db) db = new CatalogCacheDB();
  return db;
}

// Session-level in-memory cache (fastest within a single page session)
let mem: ShopifyProduct[] | null = null;
let memTs = 0;
let revalidating = false;

async function fetchFresh(): Promise<ShopifyProduct[]> {
  const res = await fetch("/api/shopify/catalog");
  if (!res.ok) throw new Error("Failed to load catalog");
  const products = (await res.json() as ShopifyProduct[]).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle)
  );
  mem = products;
  memTs = Date.now();
  getDb()?.kv.put({ key: "catalog", products, ts: memTs }).catch(() => {});
  return products;
}

function revalidate(onRevalidated?: (p: ShopifyProduct[]) => void) {
  if (revalidating) return;
  revalidating = true;
  fetchFresh()
    .then((p) => onRevalidated?.(p))
    .catch(() => {})
    .finally(() => { revalidating = false; });
}

/**
 * Returns the catalog as fast as possible.
 * @param force        bypass all caches and fetch fresh (awaited)
 * @param onRevalidated optional — called with fresh data when a background refresh completes
 */
export async function loadCatalog(
  force = false,
  onRevalidated?: (p: ShopifyProduct[]) => void
): Promise<ShopifyProduct[]> {
  if (force) return fetchFresh();

  // 1. In-memory (instant)
  if (mem) {
    if (Date.now() - memTs > TTL_MS) revalidate(onRevalidated);
    return mem;
  }

  // 2. IndexedDB (instant across logins)
  try {
    const row = await getDb()?.kv.get("catalog");
    if (row?.products?.length) {
      mem = row.products;
      memTs = row.ts;
      if (Date.now() - row.ts > TTL_MS) revalidate(onRevalidated);
      return row.products;
    }
  } catch { /* fall through to cold fetch */ }

  // 3. Cold fetch (first ever load)
  return fetchFresh();
}

export function invalidateCache() {
  mem = null;
  memTs = 0;
  getDb()?.kv.delete("catalog").catch(() => {});
}
