import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
import { toTenThousandths } from "@/lib/stockValue/aggregate";

export const runtime = "nodejs";

/**
 * Valued product table for the Stock Value panel — live against Shopify, never
 * the snapshot. Powers both browsing (no search term) and search.
 *
 * Ordered by product title (`products(sortKey: TITLE)`) so the table reads like
 * Stocky's "Current stock on hand". Query syntax verified against pitstop-dev
 * on Admin API 2026-07 (scripts/test-search-syntax.ts): no infix wildcards, so
 * free text plus `sku:`/`barcode:` prefix clauses, combined with AND/parens.
 *
 * Page size is 15 products × up to 100 variants — a requested query cost of
 * ~1500 against the 2000-point ceiling, which avoids truncating products with
 * many variants.
 */
const LEVEL_FRAGMENT = /* GraphQL */ `
  inventoryLevel(locationId: $loc) {
    quantities(names: ["available"]) { quantity }
  }
`;

function buildQueryDocument(withLocation: boolean): string {
  return /* GraphQL */ `
    query StockTable($q: String, $cursor: String${withLocation ? ", $loc: ID!" : ""}) {
      products(first: 15, after: $cursor, sortKey: TITLE, query: $q) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          variants(first: 100) {
            nodes {
              id
              title
              sku
              barcode
              price
              inventoryQuantity
              inventoryItem {
                unitCost { amount }
                ${withLocation ? LEVEL_FRAGMENT : ""}
              }
            }
          }
        }
      }
    }
  `;
}

interface TableData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      variants: {
        nodes: Array<{
          id: string;
          title: string;
          sku: string | null;
          barcode: string | null;
          price: string;
          inventoryQuantity: number | null;
          inventoryItem: {
            unitCost: { amount: string } | null;
            inventoryLevel?: { quantities: Array<{ quantity: number }> } | null;
          } | null;
        }>;
      };
    }>;
  };
}

// Strip everything Shopify's search grammar treats as syntax before
// interpolating user input into the query string.
function sanitize(raw: string): string {
  return raw.replace(/["'\\():*]/g, " ").replace(/\s+/g, " ").trim();
}

const STATUSES = new Set(["active", "draft", "archived"]);

function buildSearchQuery(params: URLSearchParams): string | null {
  const clauses: string[] = [];

  const term = sanitize(params.get("q") ?? "");
  if (term) {
    // Single token: free text (product titles) OR code prefixes. Multi-word
    // terms are title searches — SKUs and barcodes never contain spaces.
    clauses.push(
      term.includes(" ") ? `(${term})` : `(${term} OR sku:${term}* OR barcode:${term}*)`
    );
  }

  const status = (params.get("status") ?? "all").toLowerCase();
  if (STATUSES.has(status)) clauses.push(`status:${status}`);

  for (const tag of (params.get("excludeTags") ?? "").split(",")) {
    const clean = sanitize(tag);
    if (clean) clauses.push(`-tag:${clean}`);
  }

  return clauses.length ? clauses.join(" AND ") : null;
}

export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const location = params.get("location") ?? "all";
  const withLocation = location !== "all" && location.startsWith("gid://shopify/Location/");
  const cursor = params.get("cursor") || null;

  const variables: Record<string, unknown> = { q: buildSearchQuery(params), cursor };
  if (withLocation) variables.loc = location;

  try {
    const result = await shopifyFetch<TableData>(shop, buildQueryDocument(withLocation), variables);
    if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
    const conn = result.data?.products;

    const rows = (conn?.nodes ?? []).flatMap((product) =>
      product.variants.nodes.map((v) => {
        // With a location selected, a variant not stocked there has no level —
        // that reads as zero here, not as its all-locations quantity.
        const available = withLocation
          ? v.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0
          : v.inventoryQuantity ?? 0;
        const costTt = v.inventoryItem?.unitCost ? toTenThousandths(v.inventoryItem.unitCost.amount) : null;
        const priceTt = toTenThousandths(v.price ?? "0");
        return {
          variantId: v.id,
          productTitle: product.title,
          variantTitle: v.title === "Default Title" ? "" : v.title,
          sku: v.sku || "",
          barcode: v.barcode || "",
          available,
          // Money in integer minor units, consistent with the snapshot totals.
          unitCost: costTt === null ? null : Math.round(costTt / 100),
          price: Math.round(priceTt / 100),
          lineCost: costTt === null ? null : Math.round((costTt * available) / 100),
          lineRetail: Math.round((priceTt * available) / 100),
        };
      })
    );

    return NextResponse.json({
      rows,
      hasNextPage: conn?.pageInfo.hasNextPage ?? false,
      endCursor: conn?.pageInfo.endCursor ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load products" },
      { status: 500 }
    );
  }
}
