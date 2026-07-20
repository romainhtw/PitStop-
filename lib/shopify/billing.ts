import { shopifyFetch } from "@/lib/shopify";

export const PLAN = {
  name: "PitStop",
  amount: 19,
  currency: "USD",
  trialDays: 30,
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

// ── Server-side billing enforcement ────────────────────────────────────────────
// Dev stores are always allowed (for testing/App Store review); every other shop
// must have an ACTIVE subscription before it can use paid/mutating features.
//
// Tri-state so callers can tell the two blocking cases apart:
//   "active"       → allow the action
//   "none"         → verified: no active subscription → 402 "subscription required"
//   "check_failed" → couldn't verify (transient Shopify/API error) → 503 "retry",
//                    NEVER tell a possibly-paying merchant to subscribe.
// Still fails closed: both "none" and "check_failed" block the action; only the
// message differs.
export type BillingAccess = "active" | "none" | "check_failed";

export async function checkBillingAccess(shop: string): Promise<BillingAccess> {
  // Dev-store detection is best-effort: if it fails we simply treat the shop as
  // non-dev and let the subscription check below be authoritative.
  try {
    const dev = await shopifyFetch<ShopPlanData>(shop, `{ shop { plan { partnerDevelopment } } }`);
    if (dev?.data?.shop?.plan?.partnerDevelopment === true) return "active";
  } catch {
    /* fall through to the subscription check */
  }

  try {
    const res = await shopifyFetch<ActiveSubscriptionsData>(
      shop,
      `{ currentAppInstallation { activeSubscriptions { id name status } } }`
    );
    // A GraphQL-level error or missing data means we genuinely could not verify.
    if (res.errors?.length || !res.data) return "check_failed";
    const subs = res.data.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.some((s) => s.status === "ACTIVE") ? "active" : "none";
  } catch {
    // Network / 5xx / max-retries — couldn't reach billing.
    return "check_failed";
  }
}

// Maps a billing state to the response a route should send, or null to proceed.
// Keeps the 402-vs-503 messaging identical across every gated route.
export function billingBlock(
  access: BillingAccess
): { status: number; body: Record<string, string> } | null {
  if (access === "active") return null;
  if (access === "none") return { status: 402, body: { error: "SUBSCRIPTION_REQUIRED" } };
  return {
    status: 503,
    body: {
      error: "BILLING_CHECK_FAILED",
      message: "Couldn't verify your subscription — temporary issue, please retry in a moment.",
    },
  };
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
