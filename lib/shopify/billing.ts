import { shopifyFetch } from "@/lib/shopify";

export const PLAN = {
  name: "PitStop",
  amount: 19,
  currency: "USD",
  trialDays: 14,
} as const;

// ── Dev-store detection ────────────────────────────────────────────────────────

interface ShopPlanData {
  shop: { plan: { partnerDevelopment: boolean } };
}

export async function isDevStore(shop: string): Promise<boolean> {
  try {
    const result = await shopifyFetch<ShopPlanData>(
      shop,
      `{ shop { plan { partnerDevelopment } } }`
    );
    return result?.data?.shop?.plan?.partnerDevelopment === true;
  } catch {
    return false;
  }
}

// ── Active subscription check ──────────────────────────────────────────────────

interface ActiveSubscriptionsData {
  currentAppInstallation: {
    activeSubscriptions: Array<{ id: string; name: string; status: string }>;
  };
}

export async function getActiveSubscription(
  shop: string
): Promise<{ id: string; name: string; status: string } | null> {
  try {
    const result = await shopifyFetch<ActiveSubscriptionsData>(
      shop,
      `{ currentAppInstallation { activeSubscriptions { id name status } } }`
    );
    const subs = result?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.find((s) => s.status === "ACTIVE") ?? null;
  } catch {
    return null;
  }
}

// ── Plan tier & access ─────────────────────────────────────────────────────────
// Freemium model:
//   "free"    → no active subscription. The app is fully usable, but invoice
//               parsing is capped at INVOICE_QUOTA.free per calendar month.
//   "paid"    → an ACTIVE recurring subscription. Cap raised to INVOICE_QUOTA.paid.
//   "dev"     → partner development store (testing / App Store review). Uncapped.
//   "unknown" → couldn't verify the subscription (transient Shopify/API error).
//
// Only "unknown" blocks app access (fail closed with a retry — NEVER tell a
// possibly-paying merchant to subscribe). Free and paid both get in; the monthly
// quota at the invoice-parsing route is what separates the tiers.
export const INVOICE_QUOTA = { free: 5, paid: 100 } as const;

export type PlanTier = "dev" | "paid" | "free" | "unknown";

export async function getPlanTier(shop: string): Promise<PlanTier> {
  // Dev-store detection is best-effort: if it fails we fall through and let the
  // subscription check below be authoritative.
  try {
    const dev = await shopifyFetch<ShopPlanData>(shop, `{ shop { plan { partnerDevelopment } } }`);
    if (dev?.data?.shop?.plan?.partnerDevelopment === true) return "dev";
  } catch {
    /* fall through to the subscription check */
  }

  try {
    const res = await shopifyFetch<ActiveSubscriptionsData>(
      shop,
      `{ currentAppInstallation { activeSubscriptions { id name status } } }`
    );
    // A GraphQL-level error or missing data means we genuinely could not verify.
    if (res.errors?.length || !res.data) return "unknown";
    const subs = res.data.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.some((s) => s.status === "ACTIVE") ? "paid" : "free";
  } catch {
    // Network / 5xx / max-retries — couldn't reach billing.
    return "unknown";
  }
}

// Monthly invoice-parsing cap for a tier. Infinity = uncapped (dev stores).
// "unknown" falls back to the paid cap so a transient billing-check failure never
// throttles a paying merchant below their entitlement (access is still gated
// separately by appAccessBlock, which fails closed on "unknown").
export function invoiceQuotaFor(tier: PlanTier): number {
  switch (tier) {
    case "dev":
      return Number.POSITIVE_INFINITY;
    case "paid":
    case "unknown":
      return INVOICE_QUOTA.paid;
    case "free":
      return INVOICE_QUOTA.free;
  }
}

// App-access gate for mutating routes. Blocks ONLY when we couldn't verify the
// shop's subscription; every real tier (dev/paid/free) is allowed through. Keeps
// the 503 messaging identical across every gated route.
export function appAccessBlock(
  tier: PlanTier
): { status: number; body: Record<string, string> } | null {
  if (tier === "unknown") {
    return {
      status: 503,
      body: {
        error: "BILLING_CHECK_FAILED",
        message: "Couldn't verify your subscription — temporary issue, please retry in a moment.",
      },
    };
  }
  return null;
}

// ── Create subscription ────────────────────────────────────────────────────────

const CREATE_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $trialDays: Int!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      confirmationUrl
      userErrors { message }
    }
  }
`;

interface CreateSubscriptionData {
  appSubscriptionCreate: {
    confirmationUrl: string | null;
    userErrors: Array<{ message: string }>;
  };
}

export async function createSubscription(
  shop: string
): Promise<{ confirmationUrl: string | null; error?: string }> {
  const test = await isDevStore(shop);

  const returnUrl = `${process.env.SHOPIFY_APP_URL}/api/shopify/billing/callback?shop=${shop}`;

  const variables = {
    name: PLAN.name,
    returnUrl,
    test,
    trialDays: PLAN.trialDays,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: PLAN.amount, currencyCode: PLAN.currency },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  };

  try {
    const result = await shopifyFetch<CreateSubscriptionData>(
      shop,
      CREATE_SUBSCRIPTION_MUTATION,
      variables
    );
    const data = result?.data?.appSubscriptionCreate;
    if (data?.userErrors?.length) {
      return { confirmationUrl: null, error: data.userErrors[0].message };
    }
    return { confirmationUrl: data?.confirmationUrl ?? null };
  } catch (err) {
    return {
      confirmationUrl: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
