import { shopifyFetch } from "@/lib/shopify";
import { adminDb } from "@/lib/firebaseAdmin";

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
//   "comp"    → complimentary shop (manual gift). Uncapped and NEVER billed.
//               Checked first, overrides every other tier. See isCompShop.
//   "free"    → no active subscription. The app is fully usable, but invoice
//               parsing is capped at INVOICE_QUOTA.free per calendar month.
//   "paid"    → an ACTIVE recurring subscription. Cap raised to INVOICE_QUOTA.paid.
//   "dev"     → partner development store (testing / App Store review). Uncapped.
//   "unknown" → couldn't verify the subscription (transient Shopify/API error).
//
// Only "unknown" blocks app access (fail closed with a retry — NEVER tell a
// possibly-paying merchant to subscribe). comp/free/paid/dev all get in; the
// monthly quota at the invoice-parsing route is what separates the tiers.
export const INVOICE_QUOTA = { free: 5, paid: 100 } as const;

export type PlanTier = "comp" | "dev" | "paid" | "free" | "unknown";

// ── Complimentary (comp) shops ──────────────────────────────────────────────────
// A doc per gifted shop in the server-only "compShops" collection, keyed by shop
// domain (e.g. "jack.myshopify.com"):
//   { addedAt, note?, expiresAt? }
// A shop is comp when the doc exists AND expiresAt is absent or still in the
// future. Writes/reads are Admin-SDK only — see firestore.rules.
const COMP_SHOPS_COLLECTION = "compShops";

// Normalise an expiresAt value (Firestore Timestamp, ISO string, or epoch ms) to
// milliseconds. Returns null when it can't be interpreted.
function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export async function isCompShop(shop: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection(COMP_SHOPS_COLLECTION).doc(shop).get();
    if (!snap.exists) return false;
    const expiresAt = snap.data()?.expiresAt;
    if (expiresAt == null) return true; // no expiry → comp forever
    const expiryMs = toMillis(expiresAt);
    // An unparseable expiry is treated as still active: comp is a deliberate
    // manual gift, so we never let a malformed date silently start billing them.
    if (expiryMs == null) return true;
    return expiryMs > Date.now();
  } catch {
    // Firestore hiccup — don't wrongly grant comp; fall through to the real tier.
    return false;
  }
}

export async function getPlanTier(shop: string): Promise<PlanTier> {
  // Complimentary shops win over everything: a manual gift is uncapped and must
  // never touch Shopify billing. Checked before any Shopify API call.
  if (await isCompShop(shop)) return "comp";

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

// Test-only tier override. Lets a genuine partner development store exercise the
// real free/paid quota paths (block + counter writes) without a paid store.
//
// Hardened so it can NEVER affect a production merchant — two independent gates:
//   1. QUOTA_TEST_OVERRIDE must be explicitly set to "1" in the environment, AND
//   2. the store's REAL tier must be "dev" (partnerDevelopment === true, verified
//      against Shopify — a real free/paid merchant can never be a dev store).
// Because a real merchant fails gate #2, the override is structurally inert for
// them regardless of env. The only possible effect is to make a DEV store's
// enforcement stricter (cap it), which is harmless. Leave QUOTA_TEST_OVERRIDE
// unset in production for defence-in-depth.
// The forced tier comes from the ?forceTier= query param (for direct API calls)
// or, so the normal upload UI can drive it with no code change, the
// QUOTA_TEST_FORCE_TIER env var. The query param wins when both are present.
export function applyTierOverride(realTier: PlanTier, forceTier: string | null): PlanTier {
  if (process.env.QUOTA_TEST_OVERRIDE !== "1") return realTier;
  if (realTier !== "dev") return realTier;
  const requested = forceTier ?? process.env.QUOTA_TEST_FORCE_TIER ?? null;
  if (requested === "free" || requested === "paid") return requested;
  return realTier;
}

// Monthly invoice-parsing cap for a tier. Infinity = uncapped (comp & dev stores).
// "unknown" falls back to the paid cap so a transient billing-check failure never
// throttles a paying merchant below their entitlement (access is still gated
// separately by appAccessBlock, which fails closed on "unknown").
export function invoiceQuotaFor(tier: PlanTier): number {
  switch (tier) {
    case "comp":
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
// shop's subscription; every real tier (comp/dev/paid/free) is allowed through.
// Keeps the 503 messaging identical across every gated route.
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
