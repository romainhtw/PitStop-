import type { PurchaseOrder } from "@/lib/types";

/**
 * Invoices that quietly went nowhere.
 *
 * Both of the sync bugs found on 2026-08-18 were invisible because nothing threw:
 * an invoice was reported as synced while zero lines reached Shopify, and the
 * merchant's manual product matches were discarded on leaving the page. Watching
 * for exceptions cannot catch either. Watching for *outcomes* can — these are the
 * states that should be impossible, checked against the order history the
 * dashboard already holds.
 */

export type StuckReason = "never_landed" | "unmatched_lines" | "never_synced";

export interface StuckInvoice {
  id: string;
  supplier: string;
  invoiceNumber: string;
  reason: StuckReason;
  detail: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A partly-matched invoice is normal for a day or two; a week means nobody came back to it. */
export const UNMATCHED_GRACE_DAYS = 7;
/** An invoice parsed but never sent. Long enough not to nag about this week's paperwork. */
export const NEVER_SYNCED_GRACE_DAYS = 14;

function daysSince(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((now - t) / DAY_MS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Worst first: an invoice that landed nothing is a broken promise, an unmatched
// line is unfinished work, and a never-sent invoice may just be recent paperwork.
const SEVERITY: Record<StuckReason, number> = {
  never_landed: 0,
  unmatched_lines: 1,
  never_synced: 2,
};

export function findStuckInvoices(
  orders: PurchaseOrder[],
  now: number = Date.now()
): StuckInvoice[] {
  const stuck: StuckInvoice[] = [];

  for (const po of orders) {
    const sync = po.syncResult;
    const base = { id: po.id, supplier: po.supplier, invoiceNumber: po.invoiceNumber };

    if (sync && sync.successCount === 0) {
      // The exact shape of the ghost-approved bug: a sync ran and wrote nothing.
      stuck.push({
        ...base,
        reason: "never_landed",
        detail:
          sync.notFoundCount > 0
            ? `No line reached Shopify — ${plural(sync.notFoundCount, "line")} matched no product.`
            : "A sync ran but no line reached Shopify.",
      });
      continue;
    }

    if (sync && sync.notFoundCount > 0) {
      const days = daysSince(sync.syncedAt, now);
      if (days >= UNMATCHED_GRACE_DAYS) {
        stuck.push({
          ...base,
          reason: "unmatched_lines",
          detail: `${plural(sync.notFoundCount, "line")} still unmatched after ${plural(days, "day")}.`,
        });
      }
      continue;
    }

    if (!sync && po.status !== "draft") {
      const days = daysSince(po.createdAt, now);
      if (days >= NEVER_SYNCED_GRACE_DAYS) {
        stuck.push({
          ...base,
          reason: "never_synced",
          detail: `Imported ${plural(days, "day")} ago and never sent to Shopify.`,
        });
      }
    }
  }

  return stuck.sort((a, b) => SEVERITY[a.reason] - SEVERITY[b.reason]);
}
