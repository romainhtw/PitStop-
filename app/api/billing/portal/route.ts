import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST() {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-04-22.dahlia" });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://elite-racing.vercel.app";

    const snap = await adminDb.collection("settings").doc("billing").get();
    const billing = snap.exists ? (snap.data() as { customerId?: string }) : null;
    const customerId = billing?.customerId;

    if (!customerId) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
