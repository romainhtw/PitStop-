import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { SupplierProfile } from "@/lib/types";

export const runtime = "nodejs";

function supplierNameKey(name: string) {
  return decodeURIComponent(name).toLowerCase().trim();
}

// Tenant-scoped Firestore document id: prevents one tenant's supplier doc from
// shadowing another's when they share a supplier name (e.g. "BSD").
function supplierDocId(merchantId: string, name: string) {
  return `${merchantId}__${supplierNameKey(name)}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const docId = supplierDocId(merchantId, params.name);
    let snap = await adminDb.collection("suppliers").doc(docId).get();

    // Back-compat: fall back to the pre-namespaced doc id, but only if it
    // belongs to this tenant.
    if (!snap.exists) {
      const legacy = await adminDb.collection("suppliers").doc(supplierNameKey(params.name)).get();
      if (legacy.exists && (legacy.data() as SupplierProfile).merchantId === merchantId) {
        snap = legacy;
      }
    }
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data() as SupplierProfile;
    if (data.merchantId && data.merchantId !== merchantId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await req.json() as Partial<SupplierProfile>;
    const nameKey = supplierNameKey(params.name);
    const docId   = supplierDocId(merchantId, params.name);
    const ref     = adminDb.collection("suppliers").doc(docId);
    const existing = await ref.get();

    const now = new Date().toISOString();
    const existingData = existing.exists ? (existing.data() as SupplierProfile) : null;
    if (existingData?.merchantId && existingData.merchantId !== merchantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const merged: SupplierProfile = {
      id: docId,
      merchantId,
      name: body.name || existingData?.name || nameKey,
      parseHints: body.parseHints ?? existingData?.parseHints ?? "",
      defaultLocation: body.defaultLocation ?? existingData?.defaultLocation ?? "",
      approvedPOCount: existingData?.approvedPOCount ?? 0,
      lastSeen: existingData?.lastSeen ?? now,
      updatedAt: now,
    };

    await ref.set(merged);
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
