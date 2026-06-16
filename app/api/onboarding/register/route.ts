/**
 * POST /api/onboarding/register
 *
 * Self-serve merchant registration. Creates:
 *   1. Firebase Auth user
 *   2. bcrypt-hashed password stored on merchant doc
 *   3. Stripe customer
 *   4. /merchants/{uid} Firestore document (tier=FREE)
 *   5. Shopify OAuth state (CSRF token, 10-min TTL)
 *
 * Returns: { merchantId, authUrl } — client redirects to authUrl to
 * connect the merchant's Shopify store.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuth }      from "firebase-admin/auth";
import { FieldValue }   from "firebase-admin/firestore";
import Stripe           from "stripe";
import bcrypt           from "bcrypt";
import { randomBytes }  from "crypto";
import { adminDb }      from "@/lib/firebaseAdmin";
import { requireEnv }   from "@/lib/requireEnv";
import { TIERS }        from "@/lib/billing/tiers";

export const runtime = "nodejs";

const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_orders",
].join(",");

// ── Validation helpers ───────────────────────────────────────────────────────

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function isValidShopifyDomain(d: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(d);
}

// ── Rate limiting (simple in-process) ───────────────────────────────────────

const REG_RATE = new Map<string, { count: number; resetAt: number }>();

function registrationRateCheck(ip: string): boolean {
  const now   = Date.now();
  const entry = REG_RATE.get(ip);
  if (!entry || now > entry.resetAt) {
    REG_RATE.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 }); // 1/hr per IP
    return true;
  }
  if (entry.count >= 3) return false; // max 3 registrations/hr from same IP
  entry.count++;
  return true;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!registrationRateCheck(ip)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  let body: { legalName?: string; email?: string; password?: string; shopifyStoreDomain?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { legalName, email, password, shopifyStoreDomain } = body;

  // Input validation
  if (!legalName?.trim() || legalName.trim().length < 2) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "legalName" }, { status: 400 });
  }
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "email" }, { status: 400 });
  }
  if (!password || password.length < 12) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "password", message: "Minimum 12 characters" }, { status: 400 });
  }
  if (!shopifyStoreDomain || !isValidShopifyDomain(shopifyStoreDomain)) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "shopifyStoreDomain", message: "Must be *.myshopify.com" }, { status: 400 });
  }

  const normalEmail = email.toLowerCase().trim();

  // Check uniqueness by email
  const existing = await adminDb
    .collection("merchants")
    .where("ownerEmail", "==", normalEmail)
    .limit(1)
    .get();
  if (!existing.empty) {
    return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });
  }

  // Check uniqueness by Shopify domain
  const existingDomain = await adminDb
    .collection("merchants")
    .where("shopifyStoreDomain", "==", shopifyStoreDomain.toLowerCase())
    .limit(1)
    .get();
  if (!existingDomain.empty) {
    return NextResponse.json({ error: "STORE_ALREADY_REGISTERED" }, { status: 409 });
  }

  // 1. Firebase Auth user
  let fbUser: { uid: string };
  try {
    fbUser = await getAuth().createUser({
      email:       normalEmail,
      password,
      displayName: legalName.trim(),
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });
    }
    throw err;
  }

  const merchantId = fbUser.uid;

  // 2. bcrypt password
  const hashedOwnerPassword = await bcrypt.hash(password, 12);

  // 3. Stripe customer
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });
  const customer = await stripe.customers.create({
    email:    normalEmail,
    name:     legalName.trim(),
    metadata: { merchantId, shopifyStoreDomain },
  });

  // 4. Shopify OAuth state (CSRF, single-use, 10-min TTL)
  const state = randomBytes(32).toString("hex");
  await adminDb.collection("oauthStates").doc(state).set({
    merchantId,
    shopifyStoreDomain: shopifyStoreDomain.toLowerCase(),
    createdAt:  FieldValue.serverTimestamp(),
    expiresAt:  new Date(Date.now() + 10 * 60 * 1000),
  });

  // 5. /merchants/{uid} Firestore document
  await adminDb.collection("merchants").doc(merchantId).set({
    merchantId,
    legalName:            legalName.trim(),
    shopifyStoreDomain:   shopifyStoreDomain.toLowerCase(),
    shopifyAccessToken:   "",        // filled after OAuth callback
    stripeCustomerId:     customer.id,
    stripeSubscriptionId: "",
    subscriptionTier:     "FREE",
    subscriptionStatus:   "active",
    subscriptionCurrentPeriodEnd: null,
    ownerUid:             merchantId,
    ownerEmail:           normalEmail,
    hashedOwnerPassword,
    pins:                 {},
    limits:               TIERS.FREE,
    createdAt:            FieldValue.serverTimestamp(),
    updatedAt:            FieldValue.serverTimestamp(),
  });

  // 6. Firebase custom claims
  await getAuth().setCustomUserClaims(merchantId, {
    merchantId,
    role: "owner",
  });

  // 7. Build Shopify OAuth URL
  const redirectUri = requireEnv("SHOPIFY_REDIRECT_URI");
  const authUrl = [
    `https://${shopifyStoreDomain}/admin/oauth/authorize`,
    `?client_id=${requireEnv("SHOPIFY_CLIENT_ID")}`,
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}`,
    `&redirect_uri=${encodeURIComponent(redirectUri)}`,
    `&state=${state}`,
  ].join("");

  return NextResponse.json({ merchantId, authUrl }, { status: 201 });
}
