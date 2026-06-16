import { type NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopify/requireShop";
import { getActiveSubscription, createSubscription } from "@/lib/shopify/billing";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const shop = await requireShop(req);
  if (!shop) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await getActiveSubscription(shop);
  if (sub) {
    return NextResponse.json({ active: true });
  }

  const { confirmationUrl, error } = await createSubscription(shop);
  return NextResponse.json({ active: false, confirmationUrl, error });
}
