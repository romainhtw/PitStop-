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
