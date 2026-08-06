import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";

/**
 * Live product search for the Stock Value panel — hits Shopify directly,
 * never the snapshot (spec §5).
 *
 * Query syntax verified against pitstop-dev on 2026-07 (scripts/test-search-syntax.ts):
 *  - infix wildcards (`sku:*T*`) are NOT reliably supported → prefix fallback
 *  - `title:` filters the VARIANT title; free text matches product titles,
 *    sku token-prefixes, and exact barcodes
 *  - `sku:T*` / `barcode:T*` do per-token prefix matching
 * So: free text covers titles (incl. multi-word), plus explicit sku/barcode
 * prefix clauses for single-token terms.
 */
const SEARCH_QUERY = /* GraphQL */ `
  query SearchVariants($q: String!, $cursor: String) {
    productVariants(first: 50, query: $q, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          sku
          barcode
          price
          product { title }
          inventoryItem { unitCost { amount } }
          inventoryQuantity
        }
      }
    }
  }
`;

interface SearchData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        price: string;
        product: { title: string };
        inventoryItem: { unitCost: { amount: string } | null } | null;
        inventoryQuantity: number | null;
      };
    }>;
  };
}

// Strip everything Shopify's search grammar treats as syntax before
// interpolating user input into the query string.
function sanitizeTerm(raw: string): string {
  return raw
    .replace(/["'\\():*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuery(term: string): string {
  const words = term.split(" ");
  if (words.length === 1) {
    // Single token: free text (titles + fuzzy) OR explicit code prefixes.
    return `${term} OR sku:${term}* OR barcode:${term}*`;
  }
  // Multi-word terms are title searches; codes never contain spaces.
  return term;
}

export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const term = sanitizeTerm(req.nextUrl.searchParams.get("q") ?? "");
  if (!term) return NextResponse.json({ variants: [], hasNextPage: false, endCursor: null });
  const cursor = req.nextUrl.searchParams.get("cursor") || undefined;

  try {
    const result = await shopifyFetch<SearchData>(shop, SEARCH_QUERY, {
      q: buildQuery(term),
      cursor: cursor ?? null,
    });
    const conn = result.data?.productVariants;
    const variants = (conn?.edges ?? []).map(({ node }) => ({
      variantId: node.id,
      productTitle: node.product.title,
      variantTitle: node.title === "Default Title" ? "" : node.title,
      sku: node.sku || "",
      barcode: node.barcode || "",
      price: node.price,
      unitCost: node.inventoryItem?.unitCost?.amount ?? null,
      inventoryQuantity: node.inventoryQuantity ?? 0,
    }));
    return NextResponse.json({
      variants,
      hasNextPage: conn?.pageInfo.hasNextPage ?? false,
      endCursor: conn?.pageInfo.endCursor ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed" },
      { status: 500 }
    );
  }
}
