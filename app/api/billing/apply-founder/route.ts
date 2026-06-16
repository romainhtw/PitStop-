import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";

export const runtime = "nodejs";

/**
 * POST /api/billing/apply-founder
 * Applies the lifetime founder discount to the current customer.
 * Protected — only call this from your admin flow or a secure webhook.
 * Requires header: x-admin-secret matching ADMIN_SECRET env var.
 */
export async function POST(req: Request) {
  // Simple secret guard — add ADMIN_SECRET to Vercel env vars
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const provided = req.headers.get("x-admin-secret");
    if (provided !== adminSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });

    const billingSnap = await adminDb.collection("settings").doc("billing").get();
    if (!billingSnap.exists) {
      return NextResponse.json({ error: "No billing record found" }, { status: 404 });
    }

    const billing = billingSnap.data() as { customerId?: string; isFounder?: boolean };

    if (!billing.customerId) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    if (billing.isFounder) {
      return NextResponse.json({ ok: true, message: "Already a founder — no change." });
    }

    const couponId = requireEnv("STRIPE_FOUNDER_COUPON_ID");

    // Apply coupon to the active subscription (duration: "forever" means it never drops off)
    const billingData = billingSnap.data() as { customerId?: string; subscriptionId?: string; isFounder?: boolean };
    if (!billingData.subscriptionId) {
      return NextResponse.json({ error: "No active subscription to apply discount to" }, { status: 400 });
    }
    await stripe.subscriptions.update(billingData.subscriptionId, {
      coupon: couponId,
    } as Parameters<typeof stripe.subscriptions.update>[1]);

    // Record in Firestore
    await adminDb.collection("settings").doc("billing").update({
      isFounder: true,
      founderCouponAppliedAt: new Date().toISOString(),
      founderLockedPrice: 4900, // $49 AUD
      founderCouponId: couponId,
    });

    return NextResponse.json({
      ok: true,
      message: "Founder discount applied. This customer will pay $49/mo forever.",
      customerId: billing.customerId,
      couponId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
