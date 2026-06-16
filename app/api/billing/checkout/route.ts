import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";

export const runtime = "nodejs";

const PLAN_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? "",
  growth:  process.env.STRIPE_PRICE_GROWTH  ?? "",
  pro:     process.env.STRIPE_PRICE_PRO     ?? "",
};

const PLAN_QUOTAS: Record<string, number> = {
  starter: 25,
  growth: 100,
  pro: 250,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { plan?: string; referralCode?: string };
    const plan = (body.plan ?? "growth").toLowerCase();
    const referralCode = body.referralCode?.trim() ?? "";

    const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://elite-racing.vercel.app";

    // Resolve flat price — fall back to legacy STRIPE_PRICE_ID if new vars not set yet
    const flatPriceId = PLAN_PRICE_IDS[plan] || process.env.STRIPE_PRICE_ID || "";
    if (!flatPriceId) {
      return NextResponse.json(
        { error: `Plan "${plan}" price not configured. Run the stripe-setup script first.` },
        { status: 400 }
      );
    }

    // Reuse existing Stripe customer if we already have one
    let customerId: string | undefined;
    try {
      const snap = await adminDb.collection("settings").doc("billing").get();
      if (snap.exists) customerId = (snap.data() as { customerId?: string }).customerId;
    } catch { /* first time — no billing doc */ }

    const lineItems = [
      { price: flatPriceId, quantity: 1 },
    ] as { price: string; quantity?: number }[];

    // Attach metered overage price if configured
    const overagePriceId = process.env.STRIPE_OVERAGE_PRICE_ID ?? "";
    if (overagePriceId) lineItems.push({ price: overagePriceId });

    // Validate referral promo code if provided
    let discounts: { promotion_code: string }[] | undefined;
    if (referralCode) {
      try {
        const codes = await stripe.promotionCodes.list({ code: referralCode, limit: 1 });
        if (codes.data.length > 0 && codes.data[0].active) {
          discounts = [{ promotion_code: codes.data[0].id }];
        }
      } catch { /* invalid code — ignore */ }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      discounts,
      allow_promotion_codes: !discounts,
      billing_address_collection: "auto",
      subscription_data: {
        metadata: {
          plan,
          includedInvoices: String(PLAN_QUOTAS[plan] ?? 100),
          referralCode: referralCode || "",
        },
      },
      success_url: `${appUrl}/billing?success=1`,
      cancel_url:  `${appUrl}/billing?cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
