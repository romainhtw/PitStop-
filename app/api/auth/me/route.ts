/**
 * GET /api/auth/me
 *
 * Returns the caller's identity, derived from middleware-injected headers
 * (which originate from the verified JWT cookie). Used by the client to
 * discover its own merchantId/role without parsing the cookie.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const merchantId = req.headers.get("x-merchant-id");
  const role       = req.headers.get("x-user-role");
  const sub        = req.headers.get("x-user-sub");

  if (!merchantId || !role) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({ merchantId, role, sub: sub ?? null });
}
