/**
 * POST /api/merchants/signup
 *
 * Public self-serve merchant signup. Creates a free-tier merchant with
 * SHA-256 hashed owner + staff PINs. Returns the generated merchantId and
 * login URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isPin(p: string): boolean {
  return /^\d{4,8}$/.test(p);
}

function isEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

async function uniqueMerchantId(base: string): Promise<string> {
  let candidate = base || `shop-${randomBytes(2).toString("hex")}`;
  // Check existence; if taken, append a random suffix and retry.
  for (let i = 0; i < 5; i++) {
    const snap = await adminDb.collection("merchants").doc(candidate).get();
    if (!snap.exists) return candidate;
    const suffix = randomBytes(2).toString("hex"); // 4 hex chars
    const trimmed = base.slice(0, Math.max(1, 40 - suffix.length - 1));
    candidate = `${trimmed}-${suffix}`;
  }
  throw new Error("Could not allocate unique merchantId");
}

export async function POST(req: NextRequest) {
  let body: {
    shopName?: string;
    ownerName?: string;
    email?: string;
    ownerPin?: string;
    staffPin?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const shopName  = body.shopName?.trim();
  const ownerName = body.ownerName?.trim() ?? "";
  const email     = body.email?.trim().toLowerCase() ?? "";
  const ownerPin  = body.ownerPin ?? "";
  const staffPin  = body.staffPin ?? "";

  if (!shopName || shopName.length < 2) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "shopName" }, { status: 400 });
  }
  if (email && !isEmail(email)) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "email" }, { status: 400 });
  }
  if (!isPin(ownerPin)) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "ownerPin", message: "PIN must be 4-8 digits" }, { status: 400 });
  }
  if (!isPin(staffPin)) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "staffPin", message: "PIN must be 4-8 digits" }, { status: 400 });
  }
  if (ownerPin === staffPin) {
    return NextResponse.json({ error: "INVALID_INPUT", field: "staffPin", message: "Staff PIN must differ from owner PIN" }, { status: 400 });
  }

  const base = slugify(shopName);
  const merchantId = await uniqueMerchantId(base);

  await adminDb.collection("merchants").doc(merchantId).set({
    merchantId,
    shopName,
    ownerName,
    email,
    plan: "free",
    createdAt: new Date().toISOString(),
    ownerPinHash: sha256(ownerPin),
    staffPinHash: sha256(staffPin),
  });

  return NextResponse.json({ merchantId, loginUrl: "/login" }, { status: 201 });
}
