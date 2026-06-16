/**
 * /api/merchants/[merchantId]/pins
 *
 * Owner-only PIN management for a merchant's staff access codes.
 *
 * POST   → add a new PIN  { pin, role, label }
 * DELETE → remove a PIN by label  ?label=Manager
 *
 * Security:
 *   - Requires role=owner in JWT (enforced by middleware + double-check here)
 *   - URL merchantId must match token merchantId (cross-tenant guard)
 *   - PINs are SHA-256 hashed before storage — raw PINs never persisted
 *   - Response never includes hashes or raw PINs
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue }  from "firebase-admin/firestore";
import { createHash }  from "crypto";
import { adminDb }     from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

/** Verify the caller owns this tenant. Middleware injects x-merchant-id. */
function assertOwner(req: NextRequest, merchantId: string): NextResponse | null {
  const role           = req.headers.get("x-user-role");
  const tokenMerchant  = req.headers.get("x-merchant-id");

  if (role !== "owner") {
    return NextResponse.json({ error: "FORBIDDEN", message: "Owner role required." }, { status: 403 });
  }
  if (tokenMerchant !== merchantId) {
    return NextResponse.json({ error: "TENANT_MISMATCH" }, { status: 403 });
  }
  return null;
}

// ── POST — add PIN ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ merchantId: string }> },
) {
  const { merchantId } = await ctx.params;
  const denied = assertOwner(req, merchantId);
  if (denied) return denied;

  let body: { pin?: string; role?: string; label?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { pin, role, label } = body;

  if (!pin || !/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "INVALID_PIN", message: "PIN must be 4–8 digits." }, { status: 400 });
  }
  if (!["admin", "staff"].includes(role ?? "")) {
    return NextResponse.json({ error: "INVALID_ROLE", message: "role must be admin or staff." }, { status: 400 });
  }
  if (!label || typeof label !== "string" || label.trim().length < 1 || label.trim().length > 40) {
    return NextResponse.json({ error: "INVALID_LABEL", message: "label must be 1–40 characters." }, { status: 400 });
  }

  const ref  = adminDb.collection("merchants").doc(merchantId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "MERCHANT_NOT_FOUND" }, { status: 404 });

  const pins    = (snap.data()!.pins ?? {}) as Record<string, { role: string; label: string }>;
  const pinHash = hashPin(pin);

  // Reject duplicate PIN hash
  if (pins[pinHash]) {
    return NextResponse.json({ error: "PIN_ALREADY_EXISTS" }, { status: 409 });
  }

  // Reject duplicate label (for UX clarity)
  const labelTaken = Object.values(pins).some((p) => p.label === label.trim());
  if (labelTaken) {
    return NextResponse.json({ error: "LABEL_ALREADY_EXISTS" }, { status: 409 });
  }

  await ref.update({
    [`pins.${pinHash}`]: { role, label: label.trim() },
    updatedAt:           FieldValue.serverTimestamp(),
  });

  await adminDb.collection("auditLogs").add({
    merchantId,
    type:      "PIN_ADDED",
    actor:     req.headers.get("x-user-sub"),
    label:     label.trim(),
    role,
    timestamp: new Date(),
  });

  return NextResponse.json({ ok: true, label: label.trim(), role }, { status: 201 });
}

// ── DELETE — remove PIN by label ──────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ merchantId: string }> },
) {
  const { merchantId } = await ctx.params;
  const denied = assertOwner(req, merchantId);
  if (denied) return denied;

  const label = new URL(req.url).searchParams.get("label");
  if (!label) {
    return NextResponse.json({ error: "LABEL_REQUIRED", message: "?label= query param required." }, { status: 400 });
  }

  const ref  = adminDb.collection("merchants").doc(merchantId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "MERCHANT_NOT_FOUND" }, { status: 404 });

  const pins = (snap.data()!.pins ?? {}) as Record<string, { role: string; label: string }>;
  const entry = Object.entries(pins).find(([, v]) => v.label === label);

  if (!entry) {
    return NextResponse.json({ error: "PIN_NOT_FOUND" }, { status: 404 });
  }

  const [pinHash] = entry;

  await ref.update({
    [`pins.${pinHash}`]: FieldValue.delete(),
    updatedAt:           FieldValue.serverTimestamp(),
  });

  await adminDb.collection("auditLogs").add({
    merchantId,
    type:      "PIN_REMOVED",
    actor:     req.headers.get("x-user-sub"),
    label,
    timestamp: new Date(),
  });

  return NextResponse.json({ ok: true });
}

// ── GET — list PINs (labels + roles only, never hashes) ──────────────────────

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ merchantId: string }> },
) {
  const { merchantId } = await ctx.params;
  const denied = assertOwner(req, merchantId);
  if (denied) return denied;

  const snap = await adminDb.collection("merchants").doc(merchantId).get();
  if (!snap.exists) return NextResponse.json({ error: "MERCHANT_NOT_FOUND" }, { status: 404 });

  const pins = (snap.data()!.pins ?? {}) as Record<string, { role: string; label: string }>;

  // Return only label + role — never hashes
  const list = Object.values(pins).map(({ role, label }) => ({ role, label }));

  return NextResponse.json({ pins: list });
}
