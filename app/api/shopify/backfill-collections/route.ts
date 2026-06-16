/**
 * Paginated collection backfill — processes one page of Shopify products (250) per call.
 * Client calls repeatedly until done: true.
 * GET /api/shopify/backfill-collections?cursor=<cursor>
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 60;

const QUERY = /* GraphQL */ `
  query GetCollections($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active OR status:draft OR status:archived") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          variants(first: 100) {
            edges { node { id } }
          }
          collections(first: 10) {
            edges { node { title } }
          }
        }
      }
    }
  }
`;

interface CollectionsData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    edges: Array<{
      node: {
        variants: { edges: Array<{ node: { id: string } }> };
        collections: { edges: Array<{ node: { title: string } }> };
      };
    }>;
  };
}

export async function GET(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  const result = await shopifyFetch<CollectionsData>(QUERY, cursor ? { cursor } : {});
  const products = result?.data?.products;
  if (!products) {
    return NextResponse.json({ error: "Shopify fetch failed" }, { status: 500 });
  }

  // Build variantId → collections map for this page
  const variantCollections = new Map<string, string[]>();
  for (const { node: p } of products.edges) {
    const cols = p.collections.edges.map((e) => e.node.title);
    for (const { node: v } of p.variants.edges) {
      variantCollections.set(v.id, cols);
    }
  }

  // Find matching Firestore docs and update
  if (variantCollections.size > 0) {
    const variantIds = Array.from(variantCollections.keys());

    // Firestore "in" queries support up to 30 values — batch them
    const CHUNK = 30;
    const batches: Promise<void>[] = [];

    for (let i = 0; i < variantIds.length; i += CHUNK) {
      const chunk = variantIds.slice(i, i + CHUNK);
      batches.push((async () => {
        const snap = await adminDb
          .collection("shopifyProducts")
          .where("merchantId", "==", merchantId)
          .where("variantId", "in", chunk)
          .get();

        if (snap.empty) return;
        const batch = adminDb.batch();
        for (const doc of snap.docs) {
          const variantId = doc.data().variantId as string;
          const cols = variantCollections.get(variantId) ?? [];
          batch.update(doc.ref, { collections: cols });
        }
        await batch.commit();
      })());
    }

    await Promise.all(batches);
  }

  return NextResponse.json({
    processed: variantCollections.size,
    done: !products.pageInfo.hasNextPage,
    nextCursor: products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null,
  });
}
