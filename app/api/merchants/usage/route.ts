import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getFreeTierUsage, PLAN_QUOTAS, PLAN_NAMES } from "@/lib/stripe/usageTracking";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const merchantSnap = await adminDb.collection("merchants").doc(merchantId).get();
  const plan: string = merchantSnap.exists
    ? ((merchantSnap.data()?.plan as string) ?? "free")
    : "free";

  if (plan === "free") {
    const { used, limit, remaining } = await getFreeTierUsage(merchantId);
    return NextResponse.json({
      plan,
      planName: PLAN_NAMES.free,
      invoicesUsed: used,
      invoiceLimit: limit,
      remaining,
      isBlocked: used >= limit,
    });
  }

  // Paid plan — read from settings/billing
  try {
    const billingSnap = await adminDb.collection("settings").doc("billing").get();
    const billing = billingSnap.data() ?? {};
    const quota = PLAN_QUOTAS[plan] ?? 100;
    const used = (billing.invoicesUsedThisPeriod as number) ?? 0;
    return NextResponse.json({
      plan,
      planName: PLAN_NAMES[plan] ?? plan,
      invoicesUsed: used,
      invoiceLimit: quota,
      remaining: Math.max(0, quota - used),
      isBlocked: false,
    });
  } catch {
    return NextResponse.json({ plan, planName: plan, invoicesUsed: 0, invoiceLimit: 999, remaining: 999, isBlocked: false });
  }
}
