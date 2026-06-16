/**
 * Legacy /api/auth endpoint — kept for backward compatibility.
 * Forwards PIN auth to /api/auth/pin with merchantId="elite-racing".
 * Remove once the login page is fully migrated to /api/auth/pin.
 */
import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

export const runtime = "nodejs";

function getSecret(): Uint8Array {
  const s = process.env.PITSTOP_JWT_SECRET ?? process.env.PITSTOP_PIN;
  if (!s) throw new Error("PITSTOP_JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  const { pin } = (await req.json()) as { pin?: string };
  const expectedPin = process.env.PITSTOP_PIN;

  if (!expectedPin) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }
  if (!pin || pin !== expectedPin) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "/dashboard";

  // Issue a proper JWT so the new middleware accepts it
  const jwt = await new SignJWT({
    merchantId: "elite-racing",
    role:       "admin",
    sub:        "Legacy PIN",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("pitstop")
    .setAudience("pitstop-app")
    .setExpirationTime("8h")
    .sign(getSecret());

  const res = NextResponse.json({ ok: true, redirect: from });
  res.cookies.set("pitstop_auth", jwt, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   8 * 60 * 60,
    path:     "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("pitstop_auth",       "", { maxAge: 0, path: "/" });
  res.cookies.set("pitstop_owner_auth", "", { maxAge: 0, path: "/" });
  return res;
}
