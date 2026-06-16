import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const shop = req.nextUrl.searchParams.get("shop");

  if (!shop) {
    const fallback = process.env.SHOPIFY_APP_URL ?? "/";
    return NextResponse.redirect(fallback);
  }

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return NextResponse.redirect(`https://${shop}/admin/apps/${apiKey}`);
}
