import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";
import type { VariantSuggestion } from "@/lib/types";

export const runtime = "nodejs";

// Search products by title only (never broad — avoids matching description/tags)
const PRODUCT_TITLE_QUERY = /* GraphQL */ `
  query ProductTitleSearch($q: String!) {
    products(first: 20, query: $q) {
      nodes {
        title
        productType
        variants(first: 10) {
          nodes {
            id
            title
            sku
            barcode
            inventoryItem { id }
          }
        }
      }
    }
  }
`;

// Search variants directly by SKU or barcode
const VARIANT_CODE_QUERY = /* GraphQL */ `
  query VariantCodeSearch($q: String!) {
    productVariants(first: 10, query: $q) {
      edges {
        node {
          id
          title
          sku
          barcode
          product { title productType }
          inventoryItem { id }
        }
      }
    }
  }
`;

interface ProductTitleData {
  products: {
    nodes: Array<{
      title: string;
      productType: string;
      variants: {
        nodes: Array<{ id: string; title: string; sku: string; barcode: string; inventoryItem: { id: string } }>;
      };
    }>;
  };
}

interface VariantCodeData {
  productVariants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string;
        barcode: string;
        product: { title: string; productType: string };
        inventoryItem: { id: string };
      };
    }>;
  };
}

// Score how well a product title matches the search query (higher = better match)
function relevanceScore(productTitle: string, query: string): number {
  const t = productTitle.toLowerCase();
  const q = query.toLowerCase().trim();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const allWordsMatch = words.every((w) => t.includes(w));
  if (allWordsMatch) return 80;
  const matchCount = words.filter((w) => t.includes(w)).length;
  return Math.round((matchCount / Math.max(words.length, 1)) * 60);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ variants: [] });

  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify not configured" }, { status: 500 });
  }

  try {
    const words = q.split(/\s+/).filter((w) => w.length > 1);

    // Build title queries — always scoped to title: to avoid tag/description noise
    const titleQueries: string[] = [`title:${q}`];

    // Multi-word: also search with each meaningful word separately (catches partial matches)
    if (words.length > 1) {
      // AND: all words must appear in title
      const andQuery = words.map((w) => `title:${w}`).join(" ");
      titleQueries.push(andQuery);
    } else if (words.length === 1 && q.length >= 3) {
      // Single word: also try without title: prefix but still field-scoped
      titleQueries.push(`title:${q}*`);
    }

    // Fetch all searches in parallel
    const [titleResults, skuResults, barcodeResults] = await Promise.all([
      Promise.all(titleQueries.map((tq) => shopifyFetch<ProductTitleData>(PRODUCT_TITLE_QUERY, { q: tq }))),
      shopifyFetch<VariantCodeData>(VARIANT_CODE_QUERY, { q: `sku:${q}` }),
      shopifyFetch<VariantCodeData>(VARIANT_CODE_QUERY, { q: `barcode:${q}` }),
    ]);

    // Collect scored variants from title searches
    const scored: Array<{ variant: VariantSuggestion; score: number }> = [];
    const seen = new Set<string>();

    for (const result of titleResults) {
      for (const p of result?.data?.products?.nodes ?? []) {
        const score = relevanceScore(p.title, q);
        for (const v of p.variants.nodes) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          scored.push({
            score,
            variant: {
              variantId: v.id,
              inventoryItemId: v.inventoryItem.id,
              productTitle: p.title + (v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""),
              sku: v.sku || undefined,
              barcode: v.barcode || undefined,
            },
          });
        }
      }
    }

    // Collect SKU/barcode matches (high priority — direct code hit)
    for (const edge of [...(skuResults?.data?.productVariants?.edges ?? []), ...(barcodeResults?.data?.productVariants?.edges ?? [])]) {
      const v = edge.node;
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      scored.push({
        score: 95, // SKU/barcode match is very confident
        variant: {
          variantId: v.id,
          inventoryItemId: v.inventoryItem.id,
          productTitle: v.product.title + (v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""),
          sku: v.sku || undefined,
          barcode: v.barcode || undefined,
        },
      });
    }

    // Sort by score descending, cap at 15
    scored.sort((a, b) => b.score - a.score);
    const variants = scored.slice(0, 15).map((s) => ({ ...s.variant, score: s.score }));

    return NextResponse.json({ variants });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
