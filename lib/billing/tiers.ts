/**
 * PitStop — Subscription Tier Definitions
 * Single source of truth for feature limits across the app.
 */

export type TierName = "FREE" | "GROWTH" | "PRO";

export interface TierLimits {
  locations:   number;   // -1 = unlimited
  skus:        number;   // -1 = unlimited
  invoices:    number;   // monthly invoice parses; -1 = unlimited
  features:    string[];
}

export const TIERS: Record<TierName, TierLimits> = {
  FREE: {
    locations: 1,
    skus:      500,
    invoices:  10,
    features:  [],
  },
  GROWTH: {
    locations: 3,
    skus:      5000,
    invoices:  100,
    features:  ["ai_parsing"],
  },
  PRO: {
    locations: -1,
    skus:      -1,
    invoices:  -1,
    features:  ["ai_parsing", "priority_support"],
  },
};

export const TIER_RANK: Record<TierName, number> = {
  FREE:   0,
  GROWTH: 1,
  PRO:    2,
};

/** Map existing single-tenant plan names → TierName */
export const LEGACY_PLAN_TO_TIER: Record<string, TierName> = {
  starter: "FREE",
  growth:  "GROWTH",
  founder: "GROWTH",
  pro:     "PRO",
};

export function planToTier(plan: string | undefined): TierName {
  if (!plan) return "FREE";
  return LEGACY_PLAN_TO_TIER[plan.toLowerCase()] ?? "FREE";
}
