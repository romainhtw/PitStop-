import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";

export const runtime = "nodejs";

export async function POST() {
  try {
    const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://elite-racing.vercel.app";

    const billingSnap = await adminDb.collection("settings").doc("billing").get();
    const billing = (billingSnap.data() ?? {}) as {
      customerId?: string;
      referralCode?: string;
      referralCodeId?: string;
    };

    // Idempotent — return existing code if already generated
    if (billing.referralCode && billing.referralCodeId) {
      return NextResponse.json({
        hasReferralCode: true,
        code: billing.referralCode,
        link: `${appUrl}/billing?ref=${billing.referralCode}`,
        totalReferrals: 0,
        totalCreditsEarnedAUD: "0.00",
        referrals: [],
      });
    }

    if (!billing.customerId) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 400 });
    }

    // Get customer info for the slug
    const customerRaw = await stripe.customers.retrieve(billing.customerId);
    if (!customerRaw || (customerRaw as { deleted?: boolean }).deleted) {
      return NextResponse.json({ error: "Customer not found in Stripe" }, { status: 404 });
    }
    const customer = customerRaw as Stripe.Customer;

    // Build slug from email prefix or name
    const emailSlug = customer.email?.split("@")[0]?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
    const nameSlug = typeof customer.name === "string"
      ? customer.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
      : "";
    const slug = (emailSlug || nameSlug || "SHOP").slice(0, 10);
    const code = `PITSTOP-${slug}`.slice(0, 20); // Stripe max 20 chars

    // Create Stripe Coupon for the referee (20% off first 3 months)
    const refereeCoupon = await stripe.coupons.create({
      name: `PitStop — Referred by ${slug}`,
      percent_off: 20,
      duration: "repeating",
      duration_in_months: 3,
      metadata: {
        type: "referral_referee",
        referrerCustomerId: billing.customerId,
      },
    });

    // Create PromotionCode (the shareable code)
    const promotionCode = await stripe.promotionCodes.create({
      coupon: refereeCoupon.id,
      code,
      max_redemptions: 100,
      restrictions: { first_time_transaction: true },
      metadata: {
        referrerCustomerId: billing.customerId,
        referrerEmail: customer.email ?? "",
        referrerShopSlug: slug,
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Save to Firestore
    await adminDb.collection("settings").doc("billing").update({
      referralCode: code,
      referralCodeId: promotionCode.id,
    });

    await adminDb.collection("referrals").doc(code).set({
      code,
      referrerCustomerId: billing.customerId,
      referrerEmail: customer.email ?? "",
      referrerShopSlug: slug,
      stripeCouponId: refereeCoupon.id,
      stripePromotionCodeId: promotionCode.id,
      createdAt: new Date().toISOString(),
      totalReferrals: 0,
      totalCreditsEarned: 0,
      referrals: [],
    });

    return NextResponse.json({
      hasReferralCode: true,
      code,
      link: `${appUrl}/billing?ref=${code}`,
      totalReferrals: 0,
      totalCreditsEarnedAUD: "0.00",
      referrals: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
