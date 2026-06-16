/**
 * PitStop — Stripe Product & Price Bootstrap
 * Run ONCE: node scripts/stripe-setup.mjs
 * Requires: STRIPE_SECRET_KEY in environment
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-setup.mjs
 *   (or set in .env.local and source it first)
 */

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("❌  STRIPE_SECRET_KEY not set. Export it first.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

async function run() {
  console.log("🚀  Setting up PitStop Stripe products…\n");

  // ── PRODUCT ────────────────────────────────────────────────────────────
  const product = await stripe.products.create({
    name: "PitStop",
    description: "Shopify inventory automation for multi-location retail",
    metadata: { app: "pitstop" },
  });
  console.log("✅  Product:", product.id);

  // ── OVERAGE PRICE ($0.99/invoice beyond quota) ─────────────────────────
  const overagePrice = await stripe.prices.create({
    product: product.id,
    nickname: "Invoice Overage",
    currency: "aud",
    billing_scheme: "per_unit",
    unit_amount: 99,
    recurring: {
      interval: "month",
      usage_type: "metered",
      aggregate_usage: "sum",
    },
    metadata: { type: "overage" },
  });
  console.log("✅  Overage price:", overagePrice.id);

  // ── STARTER — $39/mo, 25 invoices ─────────────────────────────────────
  const starterPrice = await stripe.prices.create({
    product: product.id,
    nickname: "Starter",
    currency: "aud",
    billing_scheme: "per_unit",
    unit_amount: 3900,
    recurring: { interval: "month", usage_type: "licensed" },
    metadata: { tier: "starter", included_invoices: "25", type: "flat" },
  });
  console.log("✅  Starter price:", starterPrice.id);

  // ── GROWTH — $89/mo, 100 invoices ─────────────────────────────────────
  const growthPrice = await stripe.prices.create({
    product: product.id,
    nickname: "Growth",
    currency: "aud",
    billing_scheme: "per_unit",
    unit_amount: 8900,
    recurring: { interval: "month", usage_type: "licensed" },
    metadata: { tier: "growth", included_invoices: "100", type: "flat" },
  });
  console.log("✅  Growth price:", growthPrice.id);

  // ── PRO — $179/mo, 250 invoices ───────────────────────────────────────
  const proPrice = await stripe.prices.create({
    product: product.id,
    nickname: "Pro",
    currency: "aud",
    billing_scheme: "per_unit",
    unit_amount: 17900,
    recurring: { interval: "month", usage_type: "licensed" },
    metadata: { tier: "pro", included_invoices: "250", type: "flat" },
  });
  console.log("✅  Pro price:", proPrice.id);

  // ── FOUNDER COUPON — $40 off forever (Growth $89 → $49) ───────────────
  let founderCoupon;
  try {
    founderCoupon = await stripe.coupons.create({
      id: "FOUNDER_GROWTH_FOREVER",
      name: "Founder Lifetime Rate — Growth",
      currency: "aud",
      amount_off: 4000,
      duration: "forever",
      metadata: { type: "founder", plan: "growth" },
    });
    console.log("✅  Founder coupon:", founderCoupon.id);
  } catch (e) {
    if (e.code === "resource_already_exists") {
      founderCoupon = { id: "FOUNDER_GROWTH_FOREVER" };
      console.log("⚠️   Founder coupon already exists — skipping");
    } else throw e;
  }

  // ── OUTPUT ─────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Add these to Vercel → Settings → Environment Variables:\n");
  console.log(`STRIPE_PRODUCT_ID=${product.id}`);
  console.log(`STRIPE_OVERAGE_PRICE_ID=${overagePrice.id}`);
  console.log(`STRIPE_PRICE_STARTER=${starterPrice.id}`);
  console.log(`STRIPE_PRICE_GROWTH=${growthPrice.id}`);
  console.log(`STRIPE_PRICE_PRO=${proPrice.id}`);
  console.log(`STRIPE_FOUNDER_COUPON_ID=${founderCoupon.id}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

run().catch((e) => {
  console.error("❌  Setup failed:", e.message);
  process.exit(1);
});
