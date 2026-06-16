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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!baseUrl) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_APP_URL env var to your Vercel URL (e.g. https://pitstop.vercel.app)" },
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
    results.push({
      topic,
      success: (sub?.userErrors?.length ?? 0) === 0 && !!sub?.webhookSubscription,
      errors: sub?.userErrors ?? [],
      id: sub?.webhookSubscription?.id ?? null,
    });
  }

  return NextResponse.json({ callbackUrl, results });
}
