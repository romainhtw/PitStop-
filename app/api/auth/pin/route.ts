import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { createHash } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const RATE: Map<string, { count: number; resetAt: number }> = new Map();
const RATE_MAX = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function rateCheck(key: string): boolean {
  const now = Date.now();
  const entry = RATE.get(key);
  if (!entry || now > entry.resetAt) {
    RATE.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

function getSecret(): Uint8Array {
  const s = process.env.PITSTOP_JWT_SECRET ?? process.env.PITSTOP_PIN;
  if (!s) throw new Error("PITSTOP_JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let body: { merchantId?: string; pin?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { merchantId, pin } = body;
  if (!merchantId || !pin || pin.length < 4 || pin.length > 12) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Rate limit per IP + merchant
  if (!rateCheck(`${ip}:${merchantId}`)) {
    return NextResponse.json({ error: "RATE_LIMITED", retryAfterSeconds: 900 }, { status: 429 });
  }

  const merchantDoc = await adminDb.collection("merchants").doc(merchantId).get();
  if (!merchantDoc.exists) {
    hashPin(pin); // constant-time dummy to prevent merchant enumeration
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const merchant = merchantDoc.data()!;

  if (merchant.subscriptionStatus === "canceled" || merchant.subscriptionStatus === "unpaid") {
    return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 402 });
  }

  const pinHash  = hashPin(pin);
  const pinEntry = merchant.pins?.[pinHash];
  if (!pinEntry) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const jwt = await new SignJWT({
    merchantId,
    role: pinEntry.role as string,
    sub:  pinEntry.label as string,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("pitstop")
    .setAudience("pitstop-app")
    .setExpirationTime("8h")
    .sign(getSecret());

  // Append audit log (server-side — bypasses Firestore rules)
  adminDb.collection("auditLogs").add({
    merchantId,
    type:      "AUTH_PIN_SUCCESS",
    actor:     pinEntry.label,
    role:      pinEntry.role,
    ip,
    timestamp: new Date(),
  }).catch(() => {});

  const from = req.nextUrl.searchParams.get("from") ?? "/dashboard";
  const res  = NextResponse.json({ ok: true, role: pinEntry.role, redirect: from });
  res.cookies.set("pitstop_auth", jwt, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    path:     "/",
    maxAge:   8 * 60 * 60,
  });
  return res;
}
