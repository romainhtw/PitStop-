import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcrypt";
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

function getSecret(): Uint8Array {
  const s = process.env.PITSTOP_JWT_SECRET ?? process.env.PITSTOP_PIN;
  if (!s) throw new Error("PITSTOP_JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

// Dummy hash used for timing attack prevention when email not found
const DUMMY_HASH = "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  if (!rateCheck(`owner:${ip}:${email.toLowerCase()}`)) {
    return NextResponse.json({ error: "RATE_LIMITED", retryAfterSeconds: 900 }, { status: 429 });
  }

  const snap = await adminDb
    .collection("merchants")
    .where("ownerEmail", "==", email.toLowerCase())
    .limit(1)
    .get();

  if (snap.empty) {
    await bcrypt.compare(password, DUMMY_HASH); // timing equalization
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const merchant = snap.docs[0].data();
  const ok = await bcrypt.compare(password, merchant.hashedOwnerPassword);
  if (!ok) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  if (merchant.subscriptionStatus === "canceled") {
    return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 402 });
  }

  const jwt = await new SignJWT({
    merchantId: merchant.merchantId,
    role:       "owner",
    sub:        merchant.ownerUid ?? merchant.merchantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("pitstop")
    .setAudience("pitstop-app")
    .setExpirationTime("24h")
    .sign(getSecret());

  adminDb.collection("auditLogs").add({
    merchantId: merchant.merchantId,
    type:       "AUTH_OWNER_SUCCESS",
    actor:      merchant.ownerEmail,
    ip,
    timestamp:  new Date(),
  }).catch(() => {});

  const res = NextResponse.json({ ok: true, merchantId: merchant.merchantId });
  res.cookies.set("pitstop_owner_auth", jwt, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    path:     "/",
    maxAge:   24 * 60 * 60,
  });
  return res;
}
