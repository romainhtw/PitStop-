/**
 * GET /api/shopify/collections
 * Lists the merchant's Shopify collections (title + product count) so they can
 * choose which slices of their catalog to import during onboarding.
 */
import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";

const QUERY = /* GraphQL */ `
  query GetCollections($cursor: String) {
    collections(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        productsCount { count }
      }
    }
  }
`;

interface CollectionsData {
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    nodes: Array<{ title: string; productsCount?: { count: number } }>;
  };
}

export async function GET(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify credentials not configured" }, { status: 500 });
  }

  try {
    const collections: Array<{ title: string; count: number }> = [];
    let cursor: string | undefined;
    let guard = 0;
    for (;;) {
      const page = await shopifyFetch<CollectionsData>(QUERY, cursor ? { cursor } : {});
      const data = page?.data?.collections;
      if (!data) break;
      for (const c of data.nodes) {
        collections.push({ title: c.title, count: c.productsCount?.count ?? 0 });
      }
      if (!data.pageInfo.hasNextPage || ++guard > 20) break;
      cursor = data.pageInfo.endCursor;
    }
    collections.sort((a, b) => a.title.localeCompare(b.title));
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
