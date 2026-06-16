import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";

// ── Route classification ─────────────────────────────────────────────────────
const WEBHOOK_RE    = /^\/api\/(billing\/webhook|shopify\/webhooks|stripe\/webhook)/;
const STATIC_RE     = /^\/(_next|favicon\.ico|logo\.png|public|icon|apple-icon|icons\/|manifest\.webmanifest)/;
const AUTH_RE       = /^\/(login|register|onboarding|signup|pricing|api\/auth|api\/onboarding|api\/merchants\/signup|api\/shopify\/auth)/;
const OWNER_ONLY_RE = /^\/(billing|settings|api-keys|api\/merchants|api\/billing)/;

// ── JWT payload shape ────────────────────────────────────────────────────────
export interface PitStopJwt extends JWTPayload {
  merchantId: string;
  role: "owner" | "admin" | "staff";
  sub: string;
}

function getSecret(): Uint8Array {
  const s = process.env.PITSTOP_JWT_SECRET ?? process.env.PITSTOP_PIN;
  if (!s) throw new Error("PITSTOP_JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

async function verifyToken(token: string | undefined): Promise<PitStopJwt | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
      issuer:   "pitstop",
      audience: "pitstop-app",
    });
    return payload as PitStopJwt;
  } catch {
    return null;
  }
}

// Legacy SHA-256 check — kept during migration window for existing sessions
async function legacyCookieValid(value: string | undefined): Promise<boolean> {
  const pin = process.env.PITSTOP_PIN;
  if (!value || !pin) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return value === hex;
}

// ── Middleware ───────────────────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (WEBHOOK_RE.test(pathname)) return NextResponse.next();
  if (STATIC_RE.test(pathname))  return NextResponse.next();
  if (AUTH_RE.test(pathname))    return NextResponse.next();
  if (pathname === "/")          return NextResponse.next();

  // Try JWT auth (multi-tenant)
  const ownerPayload = await verifyToken(req.cookies.get("pitstop_owner_auth")?.value);
  const staffPayload = ownerPayload
    ? null
    : await verifyToken(req.cookies.get("pitstop_auth")?.value);
  const payload = ownerPayload ?? staffPayload;

  if (payload) {
    if (OWNER_ONLY_RE.test(pathname) && payload.role !== "owner") {
      return pathname.startsWith("/api/")
        ? new NextResponse(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } })
        : NextResponse.redirect(new URL("/dashboard", req.url));
    }
    const headers = new Headers(req.headers);
    headers.set("x-merchant-id", payload.merchantId);
    headers.set("x-user-role",   payload.role);
    headers.set("x-user-sub",    payload.sub ?? "");
    return NextResponse.next({ request: { headers } });
  }

  // Legacy fallback — SHA-256 cookie from old single-tenant scheme
  const staffCookie = req.cookies.get("pitstop_auth")?.value;
  if (await legacyCookieValid(staffCookie)) {
    const headers = new Headers(req.headers);
    headers.set("x-merchant-id", "elite-racing");
    headers.set("x-user-role",   "admin");
    headers.set("x-user-sub",    "legacy");
    return NextResponse.next({ request: { headers } });
  }

  // Unauthenticated
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", pathname);
  const res = NextResponse.redirect(loginUrl);
  res.cookies.delete("pitstop_auth");
  res.cookies.delete("pitstop_owner_auth");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
