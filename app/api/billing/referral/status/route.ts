import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const billingSnap = await adminDb.collection("settings").doc("billing").get();
    const billing = (billingSnap.data() ?? {}) as { referralCode?: string };

    if (!billing.referralCode) {
      return NextResponse.json({ hasReferralCode: false });
    }

    const referralSnap = await adminDb.collection("referrals").doc(billing.referralCode).get();
    if (!referralSnap.exists) {
      return NextResponse.json({ hasReferralCode: false });
    }

    const data = referralSnap.data() as {
      code: string;
      totalReferrals?: number;
      totalCreditsEarned?: number;
      referrals?: Array<{ refereeEmail: string; signedUpAt: string; creditAmountCents: number }>;
    };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://elite-racing.vercel.app";

    return NextResponse.json({
      hasReferralCode: true,
      code: data.code,
      link: `${appUrl}/billing?ref=${data.code}`,
      totalReferrals: data.totalReferrals ?? 0,
      totalCreditsEarnedAUD: ((data.totalCreditsEarned ?? 0) / 100).toFixed(2),
      referrals: (data.referrals ?? []).map((r) => ({
        // Mask email for privacy
        email: r.refereeEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
        joinedAt: r.signedUpAt,
        creditEarned: `$${(r.creditAmountCents / 100).toFixed(2)}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
