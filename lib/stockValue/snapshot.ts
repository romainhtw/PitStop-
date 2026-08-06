/**
 * Stock value snapshot orchestration — Firestore `stockSnapshot/{shopDomain}`.
 *
 * Three triggers, one flow (spec §4), adapted to this repo's Vercel runtime:
 *  - nightly cron fan-out      → startSnapshot(shop)            (api/cron/stock-snapshots)
 *  - Refresh button / first run → startSnapshot(shop, {manual})  (api/shopify/stock-value/refresh)
 *  - bulk_operations/finish webhook → completeSnapshot(shop)     (api/shopify/webhooks/bulk-operations-finish)
 *
 * Auth: background triggers have no session token, and stored offline tokens
 * expire in ~1 h, so every entry point goes through ensureFreshShopToken()
 * (client-credentials grant — Production only, where the API secret lives).
 *
 * Money is stored as integer minor units (hundredths). Totals keys are built
 * from the location list fetched at start-of-run, so location changes
 * self-correct on the next run.
 */
import { adminDb } from "@/lib/firebaseAdmin";
import { shopifyFetch } from "@/lib/shopify";
import { ensureFreshShopToken } from "@/lib/shopify/clientCredentials";
import {
  BULK_STOCK_QUERY,
  aggregateStockLines,
  streamLines,
  type LocationTotals,
} from "@/lib/stockValue/aggregate";

export const SNAPSHOT_COLLECTION = "stockSnapshot";

export const MANUAL_REFRESH_COOLDOWN_MS = 15 * 60_000;
/** A "running" snapshot older than this is presumed to have missed its finish webhook. */
export const STALE_RUNNING_MS = 2 * 60 * 60_000;

export interface StockSnapshotDoc {
  status: "ready" | "running" | "failed";
  updatedAt: string; // ISO — when totals were last successfully written
  startedAt?: string; // ISO — when the current/last run began
  lastManualRefreshAt?: string;
  lastError: string | null;
  currencyCode: string;
  totalVariants: number;
  missingCostCount: number;
  locations: Array<{ id: string; name: string }>;
  /** "all" plus one key per location gid; money in integer minor units */
  totals: Record<string, LocationTotals>;
  /** gid of the in-flight bulk operation, cleared on completion */
  bulkOpId?: string | null;
}

export class SnapshotBusyError extends Error {
  constructor() {
    super("Another bulk operation is already running for this shop");
    this.name = "SnapshotBusyError";
  }
}

export class SnapshotRateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super("Manual refresh is limited to one per 15 minutes");
    this.name = "SnapshotRateLimitedError";
  }
}

function docRef(shop: string) {
  return adminDb.collection(SNAPSHOT_COLLECTION).doc(shop);
}

export async function getSnapshot(shop: string): Promise<StockSnapshotDoc | null> {
  const snap = await docRef(shop).get();
  return snap.exists ? (snap.data() as StockSnapshotDoc) : null;
}

interface CurrentBulkOpData {
  currentBulkOperation: {
    id: string;
    status: string;
    url: string | null;
    errorCode: string | null;
  } | null;
}

const CURRENT_BULK_OP_QUERY = /* GraphQL */ `
  { currentBulkOperation { id status url errorCode } }
`;

const SHOP_CURRENCY_QUERY = /* GraphQL */ `
  { shop { currencyCode } }
`;

const LOCATIONS_PAGE_QUERY = /* GraphQL */ `
  query SnapshotLocations($cursor: String) {
    locations(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes { id name }
    }
  }
`;

interface LocationsPageData {
  locations: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ id: string; name: string }>;
  };
}

// Paginated on purpose — the shared fetchActiveLocations() caps at 20, which
// silently truncates multi-location shops. Location count is unknown per shop.
async function fetchAllActiveLocations(shop: string): Promise<Array<{ id: string; name: string }>> {
  const all: Array<{ id: string; name: string }> = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data?: LocationsPageData } = await shopifyFetch<LocationsPageData>(
      shop,
      LOCATIONS_PAGE_QUERY,
      { cursor }
    );
    const conn = page.data?.locations;
    if (!conn) break;
    all.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return all;
}

const RUN_BULK_QUERY = /* GraphQL */ `
  mutation RunStockBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

interface RunBulkData {
  bulkOperationRunQuery: {
    bulkOperation: { id: string; status: string } | null;
    userErrors: Array<{ field: string | null; message: string }>;
  };
}

/**
 * Kick off a snapshot run: stamp status "running" (totals untouched), fetch
 * currency + locations, start the bulk operation. Completion happens in
 * completeSnapshot() when the bulk_operations/finish webhook lands.
 */
export async function startSnapshot(
  shop: string,
  opts: { manual?: boolean } = {}
): Promise<{ started: boolean; alreadyRunning?: boolean }> {
  const existing = await getSnapshot(shop);

  if (opts.manual && existing?.lastManualRefreshAt) {
    const elapsed = Date.now() - Date.parse(existing.lastManualRefreshAt);
    if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
      throw new SnapshotRateLimitedError(MANUAL_REFRESH_COOLDOWN_MS - elapsed);
    }
  }

  await ensureFreshShopToken(shop);

  try {
    // Location list + currency are read per run, never cached or hardcoded.
    const [currencyRes, locations] = await Promise.all([
      shopifyFetch<{ shop: { currencyCode: string } }>(shop, SHOP_CURRENCY_QUERY),
      fetchAllActiveLocations(shop),
    ]);
    const currencyCode = currencyRes.data?.shop.currencyCode;
    if (!currencyCode) throw new Error("Could not read shop.currencyCode");

    // One bulk operation per shop at a time (Shopify constraint). If ours is
    // still in flight this is a no-op; if another feature owns it, back off.
    const current = (await shopifyFetch<CurrentBulkOpData>(shop, CURRENT_BULK_OP_QUERY)).data
      ?.currentBulkOperation;
    if (current && (current.status === "RUNNING" || current.status === "CREATED")) {
      if (existing?.bulkOpId === current.id) return { started: false, alreadyRunning: true };
      throw new SnapshotBusyError();
    }

    const run = (await shopifyFetch<RunBulkData>(shop, RUN_BULK_QUERY, { query: BULK_STOCK_QUERY }))
      .data?.bulkOperationRunQuery;
    if (run?.userErrors?.length) {
      throw new Error("bulkOperationRunQuery: " + run.userErrors.map((e) => e.message).join("; "));
    }
    const bulkOpId = run?.bulkOperation?.id;
    if (!bulkOpId) throw new Error("bulkOperationRunQuery returned no operation id");

    const update: Partial<StockSnapshotDoc> = {
      status: "running",
      startedAt: new Date().toISOString(),
      lastError: null,
      currencyCode,
      locations,
      bulkOpId,
    };
    if (opts.manual) update.lastManualRefreshAt = new Date().toISOString();
    await docRef(shop).set(update, { merge: true });
    return { started: true };
  } catch (err) {
    if (err instanceof SnapshotBusyError || err instanceof SnapshotRateLimitedError) throw err;
    // Keep old totals; record the failure (spec §4.7).
    await docRef(shop).set(
      {
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
        bulkOpId: null,
      },
      { merge: true }
    );
    throw err;
  }
}

const BULK_OP_BY_ID_QUERY = /* GraphQL */ `
  query BulkOpById($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status url errorCode }
    }
  }
`;

interface BulkOpByIdData {
  node: { id: string; status: string; url: string | null; errorCode: string | null } | null;
}

/**
 * Finish a snapshot run: look up the bulk operation, stream + aggregate its
 * JSONL result, and write totals. Called by the finish webhook, and by the
 * nightly cron as a stale-run repair path.
 */
export async function completeSnapshot(shop: string, bulkOpGid?: string): Promise<void> {
  const doc = await getSnapshot(shop);
  if (!doc?.bulkOpId) return; // nothing in flight — a foreign bulk op finished
  if (bulkOpGid && bulkOpGid !== doc.bulkOpId) return; // not our operation

  try {
    await ensureFreshShopToken(shop);
    const op = (await shopifyFetch<BulkOpByIdData>(shop, BULK_OP_BY_ID_QUERY, { id: doc.bulkOpId }))
      .data?.node;
    if (!op) throw new Error(`Bulk operation ${doc.bulkOpId} not found`);

    if (op.status === "RUNNING" || op.status === "CREATED") return; // webhook raced the op — try again later
    if (op.status !== "COMPLETED") {
      throw new Error(`Bulk operation ${op.status}${op.errorCode ? `: ${op.errorCode}` : ""}`);
    }

    let agg = {
      totalVariants: 0,
      missingCostCount: 0,
      byLocation: {} as Record<string, LocationTotals>,
      all: { cost: 0, retail: 0, items: 0 },
      locations: [] as Array<{ id: string; name: string }>,
    };
    if (op.url) {
      // Signed result URL — download needs no auth. Streamed, never buffered.
      const res = await fetch(op.url);
      if (!res.ok || !res.body) throw new Error(`Result download failed: HTTP ${res.status}`);
      agg = await aggregateStockLines(streamLines(res.body as ReadableStream<Uint8Array>));
    }

    // Keys come from the location list fetched at start-of-run (zero entries
    // for locations with no rows), UNION any location seen in the result —
    // deactivated locations can still hold stock that is counted in "all",
    // and dropping their key would make the dropdown disagree with the total.
    const locations = [...(doc.locations ?? [])];
    const known = new Set(locations.map((l) => l.id));
    for (const loc of agg.locations) {
      if (!known.has(loc.id)) {
        known.add(loc.id);
        locations.push(loc);
      }
    }
    const totals: Record<string, LocationTotals> = { all: agg.all };
    for (const loc of locations) {
      totals[loc.id] = agg.byLocation[loc.id] ?? { cost: 0, retail: 0, items: 0 };
    }

    const update: Partial<StockSnapshotDoc> = {
      status: "ready",
      updatedAt: new Date().toISOString(),
      lastError: null,
      totalVariants: agg.totalVariants,
      missingCostCount: agg.missingCostCount,
      locations,
      totals,
      bulkOpId: null,
    };
    await docRef(shop).set(update, { merge: true });
  } catch (err) {
    await docRef(shop).set(
      {
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
        bulkOpId: null,
      },
      { merge: true }
    );
    throw err;
  }
}

export async function deleteSnapshot(shop: string): Promise<void> {
  await docRef(shop).delete();
}
