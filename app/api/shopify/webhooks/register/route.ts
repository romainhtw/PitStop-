import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch, REGISTER_WEBHOOK_MUTATION } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";

export const runtime = "nodejs";

const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
] as const;

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

  const callbackUrl = `${baseUrl}/api/shopify/webhooks/products`;
  const results = [];

  for (const topic of TOPICS) {
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
  return NextResponse.json({ callbackUrl, results, ok: okCount === results.length, okCount, total: results.length });
}
