import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch, REGISTER_WEBHOOK_MUTATION, LIST_WEBHOOKS_QUERY } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";

// Each topic → the endpoint that handles it. Product topics keep the catalog's
// product metadata fresh; inventory_levels/update keeps STOCK fresh (product
// webhooks do NOT fire on inventory-only changes like sales).
const TOPICS: Array<{ topic: string; path: string }> = [
  { topic: "PRODUCTS_CREATE", path: "products" },
  { topic: "PRODUCTS_UPDATE", path: "products" },
  { topic: "PRODUCTS_DELETE", path: "products" },
  { topic: "INVENTORY_LEVELS_UPDATE", path: "inventory" },
];

// GET — report whether auto-sync is currently on (all topics registered), so the
// catalog can show live status instead of only offering to enable it.
export async function GET(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const res = await shopifyFetch<{
      webhookSubscriptions: { edges: Array<{ node: { topic: string } }> };
    }>(shop, LIST_WEBHOOKS_QUERY);
    const active = new Set((res.data?.webhookSubscriptions?.edges ?? []).map((e) => e.node.topic));
    const registered = TOPICS.filter((t) => active.has(t.topic)).map((t) => t.topic);
    const total = TOPICS.length;
    return NextResponse.json({
      enabled: registered.length === total,
      registered,
      okCount: registered.length,
      total,
    });
  } catch (err) {
    return NextResponse.json(
      { enabled: false, error: err instanceof Error ? err.message : "status check failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  // Prefer the canonical app URL (stable custom domain) so webhooks register to a
  // permanent address, not an ephemeral per-deploy Vercel URL.
  const baseUrl = process.env.SHOPIFY_APP_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!baseUrl) {
    return NextResponse.json(
      { error: "App URL not configured (set SHOPIFY_APP_URL)." },
      { status: 400 }
    );
  }

  const results = [];

  for (const { topic, path } of TOPICS) {
    const callbackUrl = `${baseUrl}/api/shopify/webhooks/${path}`;
    const result = await shopifyFetch(shop, REGISTER_WEBHOOK_MUTATION, { topic, callbackUrl });
    const data = result?.data as {
      webhookSubscriptionCreate: {
        userErrors: { field: string; message: string }[];
        webhookSubscription: { id: string; topic: string } | null;
      };
    };
    const sub = data?.webhookSubscriptionCreate;
    const errs = sub?.userErrors ?? [];
    // "Address for this topic has already been taken" means the webhook is ALREADY
    // registered at this URL — that's the desired state, treat it as success.
    const alreadyActive = errs.some((e) => /already been taken|already exists/i.test(e.message));
    const created = !!sub?.webhookSubscription;
    results.push({
      topic,
      success: created || alreadyActive,
      alreadyActive,
      errors: created || alreadyActive ? [] : errs,
      id: sub?.webhookSubscription?.id ?? null,
    });
  }

  const okCount = results.filter((r) => r.success).length;
  return NextResponse.json({ baseUrl, results, ok: okCount === results.length, okCount, total: results.length });
}
