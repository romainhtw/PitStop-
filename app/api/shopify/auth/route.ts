/**
 * GET /api/shopify/auth
 * Begin the Shopify OAuth install flow.
 * Generates a CSRF state token, sets it as a short-lived cookie,
 * and redirects the merchant to the Shopify OAuth consent screen.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isValidShop, buildInstallUrl } from "@/lib/shopify/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const shop = req.nextUrl.searchParams.get("shop") ?? "";

  if (!shop || !isValidShop(shop)) {
    return new NextResponse(
      JSON.stringify({ error: "Missing or invalid `shop` parameter" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const state = randomBytes(16).toString("hex");
  const installUrl = buildInstallUrl(shop, state);

  const res = NextResponse.redirect(installUrl);
  res.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   60 * 10, // 10 minutes
    path:     "/",
  });

  return res;
}
