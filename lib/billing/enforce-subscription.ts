/**
 * PitStop — Subscription Enforcement
 *
 * Call enforceSubscription() at the top of any API route that requires
 * a minimum tier. Throws SubscriptionError (carry HTTP statusCode) on failure.
 *
 * Strategy:
 *   1. Read the /merchants/{merchantId} doc (multi-tenant path)
 *   2. If not found, fall back to /settings/billing (Elite Racing legacy)
 *   3. Cache per merchantId for 60 s to avoid hammering Firestore
 */

import { adminDb } from "@/lib/firebaseAdmin";
import { TIER_RANK, planToTier, type TierName } from "@/lib/billing/tiers";

// ── Error class ──────────────────────────────────────────────────────────────

export class SubscriptionError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly currentTier: TierName,
    public readonly requiredTier: TierName,
  ) {
    super(`${code}: ${currentTier} < ${requiredTier}`);
    this.name = "SubscriptionError";
  }
}

// ── In-process cache (Vercel serverless — per-instance, 60 s TTL) ────────────

interface CacheEntry {
  tier:      TierName;
  status:    string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export function invalidateSubscriptionCache(merchantId: string): void {
  cache.delete(merchantId);
}

// ── Core lookup ──────────────────────────────────────────────────────────────

async function resolveTier(merchantId: string): Promise<{ tier: TierName; status: string }> {
  // 1. Multi-tenant merchant doc
  const merchantSnap = await adminDb.collection("merchants").doc(merchantId).get();
  if (merchantSnap.exists) {
    const data = merchantSnap.data()!;
    return {
      tier:   (data.subscriptionTier as TierName) ?? "FREE",
      status: (data.subscriptionStatus as string) ?? "inactive",
    };
  }

  // 2. Legacy single-tenant fallback (Elite Racing / settings/billing)
  const billingSnap = await adminDb.collection("settings").doc("billing").get();
  if (billingSnap.exists) {
    const data = billingSnap.data()!;
    return {
      tier:   planToTier(data.plan as string | undefined),
      status: (data.status as string) ?? "inactive",
    };
  }

  return { tier: "FREE", status: "inactive" };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Throws SubscriptionError if the merchant's tier is below requiredTier,
 * or if the subscription is not active/trialing.
 *
 * @example
 * const merchantId = req.headers.get("x-merchant-id")!;
 * await enforceSubscription(merchantId, "GROWTH");
 */
export async function enforceSubscription(
  merchantId: string,
  requiredTier: TierName,
): Promise<void> {
  const now = Date.now();

  let entry = cache.get(merchantId);
  if (!entry || now - entry.fetchedAt > CACHE_TTL_MS) {
    const { tier, status } = await resolveTier(merchantId);
    entry = { tier, status, fetchedAt: now };
    cache.set(merchantId, entry);
  }

  const activeStatuses = ["active", "trialing", "past_due"];
  if (!activeStatuses.includes(entry.status)) {
    throw new SubscriptionError(402, "SUBSCRIPTION_INACTIVE", entry.tier, requiredTier);
  }

  if (TIER_RANK[entry.tier] < TIER_RANK[requiredTier]) {
    throw new SubscriptionError(402, "UPGRADE_REQUIRED", entry.tier, requiredTier);
  }
}

/**
 * Non-throwing version — returns whether the merchant has access.
 * Use in UI-facing API routes where you want to return degraded data
 * rather than a hard error.
 */
export async function hasSubscription(
  merchantId: string,
  requiredTier: TierName,
): Promise<boolean> {
  try {
    await enforceSubscription(merchantId, requiredTier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to wrap an API route handler with subscription enforcement.
 * Returns a 402 JSON response automatically on failure.
 *
 * @example
 * export const POST = withSubscription("GROWTH", async (req) => { ... });
 */
export function withSubscription(
  requiredTier: TierName,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const merchantId = (req as Request & { headers: Headers }).headers.get("x-merchant-id");
    if (!merchantId) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    }
    try {
      await enforceSubscription(merchantId, requiredTier);
    } catch (e) {
      if (e instanceof SubscriptionError) {
        return new Response(
          JSON.stringify({
            error:        e.code,
            currentTier:  e.currentTier,
            requiredTier: e.requiredTier,
          }),
          { status: e.statusCode, headers: { "content-type": "application/json" } },
        );
      }
      throw e;
    }
    return handler(req);
  };
}
