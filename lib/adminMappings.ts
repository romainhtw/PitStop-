/**
 * Server-side (Admin SDK) version of supplier SKU mappings.
 * Use this in API routes. The client-side lib/mappings.ts still exists
 * for any browser-side reads (now read-only under Firestore rules).
 */
import { adminDb } from "@/lib/firebaseAdmin";

export interface SkuMapping {
  merchantId?: string;
  supplierSku: string;
  supplier: string;
  variantId: string;
  inventoryItemId: string;
  productTitle: string;
  confirmedAt: string;
  confirmedCount: number;
}

function mappingId(merchantId: string, supplier: string, sku: string): string {
  const clean = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 80);
  return `${clean(merchantId)}__${clean(supplier)}__${clean(sku)}`;
}

export async function lookupMapping(
  merchantId: string,
  supplier: string,
  sku: string
): Promise<SkuMapping | null> {
  if (!sku || !supplier) return null;
  try {
    const snap = await adminDb
      .collection("supplierSkuMappings")
      .doc(mappingId(merchantId, supplier, sku))
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as SkuMapping;
    if (data.merchantId && data.merchantId !== merchantId) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveMapping(
  merchantId: string,
  supplier: string,
  sku: string,
  match: { variantId: string; inventoryItemId: string; productTitle: string }
): Promise<void> {
  if (!sku || !supplier) return;
  try {
    const id = mappingId(merchantId, supplier, sku);
    const ref = adminDb.collection("supplierSkuMappings").doc(id);
    const existing = await ref.get();
    const prevCount = existing.exists ? ((existing.data()?.confirmedCount as number) || 0) : 0;
    await ref.set({
      merchantId,
      supplierSku: sku,
      supplier,
      variantId: match.variantId,
      inventoryItemId: match.inventoryItemId,
      productTitle: match.productTitle,
      confirmedAt: new Date().toISOString(),
      confirmedCount: prevCount + 1,
    });
  } catch {
    // non-critical — never block a sync for a mapping write failure
  }
}

// ── Name-based learned mappings ──────────────────────────────────────────────
// Keyed on supplier product name so that next invoice with the same name hits
// cache immediately, even when the SKU/barcode is missing or changes.

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length >= 2)
    .join("_")
    .slice(0, 100);
}

function nameId(merchantId: string, supplier: string, name: string): string {
  const clean = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 60);
  const norm = normalizeName(name);
  return `${clean(merchantId)}__${clean(supplier)}__${norm}`;
}

export async function lookupNameMapping(
  merchantId: string,
  supplier: string,
  name: string
): Promise<SkuMapping | null> {
  if (!name || !supplier) return null;
  try {
    const snap = await adminDb
      .collection("supplierNameMappings")
      .doc(nameId(merchantId, supplier, name))
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as SkuMapping;
    if (data.merchantId && data.merchantId !== merchantId) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveNameMapping(
  merchantId: string,
  supplier: string,
  name: string,
  match: { variantId: string; inventoryItemId: string; productTitle: string }
): Promise<void> {
  if (!name || !supplier) return;
  try {
    const id = nameId(merchantId, supplier, name);
    const ref = adminDb.collection("supplierNameMappings").doc(id);
    const existing = await ref.get();
    const prevCount = existing.exists ? ((existing.data()?.confirmedCount as number) || 0) : 0;
    await ref.set({
      merchantId,
      supplierSku: name, // reuse SkuMapping shape — supplierSku stores the name here
      supplier,
      variantId: match.variantId,
      inventoryItemId: match.inventoryItemId,
      productTitle: match.productTitle,
      confirmedAt: new Date().toISOString(),
      confirmedCount: prevCount + 1,
    });
  } catch {
    // non-critical
  }
}
