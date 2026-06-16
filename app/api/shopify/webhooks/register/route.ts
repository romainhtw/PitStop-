import { NextResponse } from "next/server";
import { shopifyFetch, REGISTER_WEBHOOK_MUTATION } from "@/lib/shopify";

export const runtime = "nodejs";

const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
] as const;

export async function POST() {
  // Fix: use ?? so NEXT_PUBLIC_APP_URL is preferred, VERCEL_URL is the fallback
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!baseUrl) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_APP_URL env var to your Vercel URL (e.g. https://elite-racing.vercel.app)" },
      { status: 400 }
    );
  }

  const callbackUrl = `${baseUrl}/api/shopify/webhooks/products`;
  const results = [];

  for (const topic of TOPICS) {
    const result = await shopifyFetch(REGISTER_WEBHOOK_MUTATION, { topic, callbackUrl });
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
