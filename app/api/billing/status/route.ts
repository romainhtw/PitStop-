import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { PLAN_QUOTAS, PLAN_NAMES, PLAN_PRICES } from "@/lib/stripe/usageTracking";

export const runtime = "nodejs";

export async function GET() {
  try {
    const snap = await adminDb.collection("settings").doc("billing").get();

    if (!snap.exists) {
      return NextResponse.json({ status: "no_subscription" });
    }

    const data = snap.data() as {
      plan?: string;
      status?: string;
      planName?: string;
      subscriptionId?: string;
      customerId?: string;
      currentPeriodEnd?: string;
      currentPeriodStart?: string;
      invoicesUsedThisPeriod?: number;
      overageSubscriptionItemId?: string;
      isFounder?: boolean;
      founderLockedPrice?: number;
      founderCouponAppliedAt?: string;
      referralCode?: string;
      freeInvoiceCredits?: number;
      freeInvoicesUsed?: number;
      referredBy?: string;
    };

    const plan = data.plan ?? "growth";
    const quota = PLAN_QUOTAS[plan] ?? 100;
    const used = data.invoicesUsedThisPeriod ?? 0;
    const freeCredits = data.freeInvoiceCredits ?? 0;
    const freeUsed = data.freeInvoicesUsed ?? 0;
    const freeRemaining = Math.max(0, freeCredits - freeUsed);

    const effectivePlanPrice = data.isFounder
      ? (data.founderLockedPrice ?? PLAN_PRICES[plan])
      : PLAN_PRICES[plan];

    return NextResponse.json({
      // Subscription state
      status: data.status ?? "unknown",
      subscriptionId: data.subscriptionId,
      currentPeriodEnd: data.currentPeriodEnd,
      currentPeriodStart: data.currentPeriodStart,

      // Plan details
      plan,
      planName: PLAN_NAMES[plan] ?? data.planName ?? "Growth",
      planPriceCents: PLAN_PRICES[plan] ?? 8900,
      effectivePriceCents: effectivePlanPrice,

      // Usage
      quota,
      used,
      remaining: Math.max(0, quota - used),
      percentUsed: quota > 0 ? Math.round((used / quota) * 100) : 0,
      overageCount: Math.max(0, used - quota),
      isOverage: used > quota,

      // Free credits (from referral)
      freeCredits,
      freeUsed,
      freeRemaining,

      // Founder
      isFounder: data.isFounder ?? false,
      founderLockedPrice: data.founderLockedPrice,
      founderCouponAppliedAt: data.founderCouponAppliedAt,

      // Referral
      referralCode: data.referralCode,
      referredBy: data.referredBy,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
