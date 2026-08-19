import type { POStatus, SyncResult } from "@/lib/types";

/**
 * What a sync actually achieved — kept apart from the route so it can be tested.
 *
 * These two rules were the whole of the 2026-08-18 "ghost approved" bug. The
 * status used to be derived from errorCount alone, so an invoice whose lines all
 * came back not_found (zero errors, zero writes) was promoted to "approved": the
 * UI showed a green tick, the retry was refused as already-synced, and Shopify
 * had received nothing.
 */

type Outcome = Pick<SyncResult, "successCount" | "errorCount">;

/** True only when at least one line was written to Shopify. */
export function landedInShopify(sync: Pick<SyncResult, "successCount"> | null | undefined): boolean {
  return (sync?.successCount ?? 0) > 0;
}

/**
 * A purchase order is only "approved" when the sync both wrote something and hit
 * no errors. Anything else goes back to the merchant for another pass.
 */
export function statusAfterSync(sync: Outcome): POStatus {
  return sync.errorCount === 0 && sync.successCount > 0 ? "approved" : "awaiting_review";
}
