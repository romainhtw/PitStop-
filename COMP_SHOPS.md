# Complimentary (comp) shops

A **comp** shop is a store you gift full access to: **unlimited** invoice parsing and
**never** billed through Shopify. It sits above every other tier — a comp grant
overrides `free`, `paid`, and `dev`.

How it works:

- `getPlanTier()` checks the `compShops` Firestore collection **first**. If the shop
  has a doc there (and it hasn't expired), the tier is `comp`.
- `comp` gets an unlimited monthly invoice quota (`invoiceQuotaFor("comp") = Infinity`).
- `comp` passes the app-access gate like any real tier (never blocked).
- The billing status route treats `comp` as active with **no upgrade CTA**, so
  `createSubscription()` is never reached — Shopify billing is never triggered.

The `compShops` collection is **server-only** (`firestore.rules` denies all client
reads and writes, same as `invoiceUsage`). You add and remove grants by hand in the
Firebase console.

## Add a shop by hand (Firebase console)

1. Open the [Firebase console](https://console.firebase.google.com/) and select the
   PitStop project.
2. Go to **Firestore Database → Data**.
3. If the `compShops` collection doesn't exist yet: click **Start collection**,
   enter the Collection ID `compShops`. Otherwise click **compShops**, then
   **Add document**.
4. Set the **Document ID** to the shop's myShopify domain, exactly as Shopify reports
   it — e.g. `jack.myshopify.com`. This is the key `getPlanTier()` looks up, so it
   must match precisely (all lowercase, includes `.myshopify.com`).
5. Add fields:

   | Field       | Type      | Required | Notes                                                        |
   |-------------|-----------|----------|--------------------------------------------------------------|
   | `addedAt`   | timestamp | yes\*    | When you granted it. Use the clock icon → "Set to now".      |
   | `note`      | string    | no       | Why it's comped, e.g. "Beta partner — comped by Romain".     |
   | `expiresAt` | timestamp | no       | Omit for a permanent grant. Set a future date to auto-expire.|

   \* `addedAt` is only bookkeeping — the tier check ignores it. Only the document's
   existence and `expiresAt` matter for access.

6. Click **Save**.

The change takes effect on the shop's next request (no deploy needed).

## Expiry

- **No `expiresAt`** → comp forever.
- **`expiresAt` in the future** → still comp.
- **`expiresAt` in the past** → the shop drops back to its real tier (`free`/`paid`),
  and normal billing/quotas resume automatically.

## Remove a comp grant

Delete the shop's document from `compShops` (⋮ menu on the document → **Delete
document**). The shop reverts to its real tier on its next request.
