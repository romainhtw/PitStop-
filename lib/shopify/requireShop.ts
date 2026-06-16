import { type NextRequest } from "next/server";
import { getShopFromRequest } from "@/lib/shopify/sessionToken";

export async function requireShop(req: NextRequest): Promise<string | null> {
  return getShopFromRequest(req);
}
