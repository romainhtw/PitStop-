import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
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
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ variants: [] });

  try {
    const words = q.split(/\s+/).filter((w) => w.length > 1);

    const titleQueries: string[] = [`title:${q}`];

    if (words.length > 1) {
      const andQuery = words.map((w) => `title:${w}`).join(" ");
      titleQueries.push(andQuery);
    } else if (words.length === 1 && q.length >= 3) {
      titleQueries.push(`title:${q}*`);
    }

    const [titleResults, skuResults, barcodeResults] = await Promise.all([
      Promise.all(titleQueries.map((tq) => shopifyFetch<ProductTitleData>(shop, PRODUCT_TITLE_QUERY, { q: tq }))),
      shopifyFetch<VariantCodeData>(shop, VARIANT_CODE_QUERY, { q: `sku:${q}` }),
      shopifyFetch<VariantCodeData>(shop, VARIANT_CODE_QUERY, { q: `barcode:${q}` }),
    ]);

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

    for (const edge of [...(skuResults?.data?.productVariants?.edges ?? []), ...(barcodeResults?.data?.productVariants?.edges ?? [])]) {
      const v = edge.node;
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      scored.push({
        score: 95,
        variant: {
          variantId: v.id,
          inventoryItemId: v.inventoryItem.id,
          productTitle: v.product.title + (v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""),
          sku: v.sku || undefined,
          barcode: v.barcode || undefined,
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const variants = scored.slice(0, 15).map((s) => ({ ...s.variant, score: s.score }));

    return NextResponse.json({ variants });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
