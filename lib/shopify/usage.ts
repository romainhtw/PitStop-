/**
 * Per-shop monthly invoice-parsing usage counter.
 *
 * One Firestore doc per shop per calendar month:
 *   invoiceUsage/{shop}__{YYYY-MM} = { shop, monthKey, count, updatedAt }
 *
 * The counter is keyed by UTC month so it "resets" automatically on the 1st —
 * a new month simply reads a fresh (absent → 0) document.
 */
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

const COLLECTION = "invoiceUsage";

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// First instant of next UTC month — when the current month's quota resets.
function resetAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface MonthlyUsage {
  count: number;
  monthKey: string;
  /** ISO timestamp of the next reset (first of next UTC month). */
  resetDate: string;
  /** Human-readable reset date, e.g. "August 1, 2026". */
  resetLabel: string;
}

export async function getMonthlyInvoiceUsage(shop: string, now: Date): Promise<MonthlyUsage> {
  const key = monthKey(now);
  const reset = resetAt(now);
  let count = 0;
  try {
    const snap = await adminDb.collection(COLLECTION).doc(`${shop}__${key}`).get();
    count = snap.exists ? Number(snap.data()?.count ?? 0) : 0;
  } catch {
    // If usage can't be read we treat it as 0 rather than blocking a paying
    // merchant on a transient Firestore hiccup. Fails open on the counter only.
    count = 0;
  }
  return {
    count,
    monthKey: key,
    resetDate: reset.toISOString(),
    resetLabel: reset.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

// Atomically record one parsed invoice against the current month. Best-effort:
// a failed increment must never lose the merchant their parsed PO, so callers
// should not await this on the critical path in a way that can throw.
export async function incrementMonthlyInvoiceUsage(shop: string, now: Date): Promise<void> {
  const key = monthKey(now);
  await adminDb.collection(COLLECTION).doc(`${shop}__${key}`).set(
    {
      shop,
      monthKey: key,
      count: FieldValue.increment(1),
      updatedAt: now.toISOString(),
    },
    { merge: true }
  );
}
