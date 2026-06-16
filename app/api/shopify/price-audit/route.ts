import { NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";

interface ShopifyProductNode {
  id: string;
  title: string;
  variants: {
    nodes: Array<{
      id: string;
      price: string;
    }>;
  };
}

interface GetProductsData {
  products: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: ShopifyProductNode[];
  };
}

export interface PriceGroup {
  normalizedTitle: string;
  products: {
    productId: string;
    title: string;
    variantId: string;
    price: number;
  }[];
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  nonZeroAvgPrice: number;
  spread: number;
  hasZeroPrices: boolean;
}

const GET_PRODUCTS_QUERY = /* GraphQL */ `
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        variants(first: 1) {
          nodes { id price }
        }
      }
    }
  }
`;

async function fetchAllProducts(): Promise<ShopifyProductNode[]> {
  const all: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: { data?: GetProductsData; errors?: Array<{ message: string }> } =
      await shopifyFetch<GetProductsData>(GET_PRODUCTS_QUERY, { cursor });

    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map((e: { message: string }) => e.message).join("; "));
    }

    const page = response.data?.products;
    if (!page) break;

    all.push(...page.nodes);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return all;
}

export async function GET() {
  try {
    if (
      !process.env.SHOPIFY_STORE_DOMAIN ||
      !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
    ) {
      return NextResponse.json(
        { error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    const products = await fetchAllProducts();

    // Group by normalized title
    const groupMap = new Map<
      string,
      Array<{ productId: string; title: string; variantId: string; price: number }>
    >();

    for (const product of products) {
      const normalizedTitle = product.title.toLowerCase().trim();
      const variant = product.variants.nodes[0];
      if (!variant) continue;

      const price = parseFloat(variant.price);
      if (isNaN(price)) continue;

      const entry = {
        productId: product.id,
        title: product.title,
        variantId: variant.id,
        price,
      };

      if (!groupMap.has(normalizedTitle)) {
        groupMap.set(normalizedTitle, []);
      }
      groupMap.get(normalizedTitle)!.push(entry);
    }

    // Build groups — only where 2+ products AND price variance > 0
    const groups: PriceGroup[] = [];

    for (const [normalizedTitle, entries] of Array.from(groupMap.entries())) {
      if (entries.length < 2) continue;

      const prices = entries.map((e: { price: number }) => e.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const spread = maxPrice - minPrice;

      if (spread === 0) continue;

      const hasZeroPrices = prices.some((p) => p === 0);
      const nonZeroPrices = prices.filter((p) => p > 0);

      const avgPrice =
        Math.round(
          (prices.reduce((a: number, b: number) => a + b, 0) / prices.length) * 100
        ) / 100;

      const nonZeroAvgPrice =
        nonZeroPrices.length > 0
          ? Math.round(
              (nonZeroPrices.reduce((a, b) => a + b, 0) / nonZeroPrices.length) * 100
            ) / 100
          : 0;

      groups.push({
        normalizedTitle,
        products: entries,
        minPrice,
        maxPrice,
        avgPrice,
        nonZeroAvgPrice,
        spread,
        hasZeroPrices,
      });
    }

    // Sort by spread descending
    groups.sort((a, b) => b.spread - a.spread);

    return NextResponse.json({
      groups,
      totalProducts: products.length,
      totalGroups: groups.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
