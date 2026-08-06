/**
 * Stock value aggregation — pure module, no Firestore/Next deps, so the
 * verification script (scripts/stock-snapshot-test.ts) and the app share the
 * exact same maths.
 *
 * Bulk operation JSONL is FLAT: variant rows come first, their inventory-level
 * rows follow later carrying __parentId. We stream line-by-line and keep only a
 * compact per-variant map (price/cost), never the whole JSONL in memory.
 *
 * Money is accumulated as integer ten-thousandths (unitCost can carry 4
 * decimals) and exposed as integer minor units (hundredths) at the end —
 * float summation across a large catalogue drifts.
 */

export const BULK_STOCK_QUERY = /* GraphQL */ `
  {
    productVariants {
      edges {
        node {
          id
          price
          inventoryItem {
            id
            unitCost { amount }
            inventoryLevels {
              edges {
                node {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface LocationTotals {
  /** integer minor units (hundredths) */
  cost: number;
  /** integer minor units (hundredths) */
  retail: number;
  items: number;
}

export interface StockAggregation {
  totalVariants: number;
  /** variants that have stock somewhere but a null unitCost */
  missingCostCount: number;
  /** keyed by location gid */
  byLocation: Record<string, LocationTotals>;
  all: LocationTotals;
}

/** Parse a decimal money string to integer ten-thousandths without float error. */
export function toTenThousandths(amount: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return 0;
  const [, sign, whole, frac = ""] = m;
  const fracPadded = (frac + "0000").slice(0, 4);
  const value = parseInt(whole, 10) * 10000 + parseInt(fracPadded, 10);
  return sign === "-" ? -value : value;
}

interface VariantEntry {
  priceTt: number; // ten-thousandths
  costTt: number | null;
  hasStock: boolean;
}

interface BulkVariantRow {
  id: string;
  price: string;
  inventoryItem?: {
    id?: string;
    unitCost?: { amount: string } | null;
    // present only when Shopify inlines levels instead of emitting child rows
    inventoryLevels?: { edges?: Array<{ node: BulkLevelRow }> };
  } | null;
}

interface BulkLevelRow {
  location?: { id: string; name: string } | null;
  quantities?: Array<{ name: string; quantity: number }>;
  __parentId?: string;
}

/**
 * Consume JSONL lines (already split) and aggregate. Lines may arrive in any
 * chunking, but Shopify guarantees a child row appears after its parent.
 */
export async function aggregateStockLines(
  lines: AsyncIterable<string>
): Promise<StockAggregation & { locations: Array<{ id: string; name: string }> }> {
  // Compact map: variant/inventoryItem gid → entry. Child rows have been
  // observed carrying either the variant gid or the inventoryItem gid as
  // __parentId depending on API version, so index under both.
  const variants = new Map<string, VariantEntry>();
  const byLocation: Record<string, LocationTotals & { costTt: number; retailTt: number }> = {};
  const locationNames = new Map<string, string>();
  let totalVariants = 0;
  let missingCostCount = 0;

  const applyLevel = (entry: VariantEntry, level: BulkLevelRow) => {
    const locId = level.location?.id;
    if (!locId) return;
    if (level.location?.name) locationNames.set(locId, level.location.name);
    const qty = level.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
    const bucket = (byLocation[locId] ??= { cost: 0, retail: 0, items: 0, costTt: 0, retailTt: 0 });
    // Negative available kept as-is — clamping hides real oversell.
    bucket.items += qty;
    bucket.retailTt += entry.priceTt * qty;
    if (entry.costTt !== null) bucket.costTt += entry.costTt * qty;
    if (qty !== 0 && !entry.hasStock) {
      entry.hasStock = true;
      if (entry.costTt === null) missingCostCount++;
    }
  };

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const row = JSON.parse(line) as (BulkVariantRow & BulkLevelRow) | BulkLevelRow;

    if (!("__parentId" in row) || !row.__parentId) {
      // Top-level variant row.
      const v = row as BulkVariantRow;
      if (!v.id?.includes("/ProductVariant/")) continue;
      totalVariants++;
      const costAmount = v.inventoryItem?.unitCost?.amount ?? null;
      const entry: VariantEntry = {
        priceTt: toTenThousandths(v.price ?? "0"),
        costTt: costAmount !== null ? toTenThousandths(costAmount) : null,
        hasStock: false,
      };
      variants.set(v.id, entry);
      if (v.inventoryItem?.id) variants.set(v.inventoryItem.id, entry);
      // Defensive: some responses inline levels rather than emitting child rows.
      for (const e of v.inventoryItem?.inventoryLevels?.edges ?? []) applyLevel(entry, e.node);
    } else {
      const level = row as BulkLevelRow;
      const entry = level.__parentId ? variants.get(level.__parentId) : undefined;
      if (entry) applyLevel(entry, level);
    }
  }

  // totals.all = sum of the per-location figures (single pass, in ten-thousandths).
  const all = { cost: 0, retail: 0, items: 0, costTt: 0, retailTt: 0 };
  const out: Record<string, LocationTotals> = {};
  for (const [locId, b] of Object.entries(byLocation)) {
    all.costTt += b.costTt;
    all.retailTt += b.retailTt;
    all.items += b.items;
    out[locId] = { cost: Math.round(b.costTt / 100), retail: Math.round(b.retailTt / 100), items: b.items };
  }

  return {
    totalVariants,
    missingCostCount,
    byLocation: out,
    all: { cost: Math.round(all.costTt / 100), retail: Math.round(all.retailTt / 100), items: all.items },
    locations: Array.from(locationNames, ([id, name]) => ({ id, name })),
  };
}

/** Split a byte stream into JSONL lines without buffering the whole payload. */
export async function* streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const p of parts) yield p;
  }
  carry += decoder.decode();
  if (carry.trim()) yield carry;
}
