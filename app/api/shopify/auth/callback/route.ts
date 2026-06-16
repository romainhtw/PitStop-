/**
 * GET /api/shopify/auth/callback
 * Finish the Shopify OAuth install flow.
 * Validates HMAC + CSRF state, exchanges the code for a permanent access token,
 * persists the token, and redirects into the embedded app.
 */
import { NextRequest, NextResponse } from "next/server";
import { isValidShop, verifyOAuthHmac, exchangeCodeForToken } from "@/lib/shopify/oauth";
import { saveShop } from "@/lib/shopify/shops";

export const runtime = "nodejs";

const API_KEY = process.env.SHOPIFY_API_KEY!;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;

    const shop  = searchParams.get("shop")  ?? "";
    const code  = searchParams.get("code")  ?? "";
    const state = searchParams.get("state") ?? "";

    // 1. Validate shop domain
    if (!shop || !isValidShop(shop)) {
      return new NextResponse(
        JSON.stringify({ error: "Missing or invalid `shop` parameter" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // 2. Verify Shopify HMAC signature
    if (!verifyOAuthHmac(searchParams)) {
      return new NextResponse(
        JSON.stringify({ error: "HMAC validation failed" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // 3. Verify CSRF state cookie
    const cookieState = req.cookies.get("shopify_oauth_state")?.value ?? "";
    if (!state || !cookieState || state !== cookieState) {
      return new NextResponse(
        JSON.stringify({ error: "State mismatch — possible CSRF attempt" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }

    // 4. Exchange code for offline access token
    const { access_token, scope } = await exchangeCodeForToken(shop, code);

    // 5. Persist to Firestore
    await saveShop(shop, access_token, scope);

    // 6. Redirect into the embedded app and clear the state cookie
    const appUrl = `https://${shop}/admin/apps/${API_KEY}`;
    const res = NextResponse.redirect(appUrl);
    res.cookies.set("shopify_oauth_state", "", {
      httpOnly: true,
      secure:   true,
      sameSite: "lax",
      maxAge:   0,
      path:     "/",
    });

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[shopify/auth/callback]", message);
    return new NextResponse(
      JSON.stringify({ error: "OAuth callback failed", detail: message }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
