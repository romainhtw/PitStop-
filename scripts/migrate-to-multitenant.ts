/**
 * PitStop — Multi-Tenant Migration Script
 * ────────────────────────────────────────
 * Transforms the existing single-tenant Elite Racing Cycles dataset into the
 * multi-tenant schema by:
 *   1. Creating the /merchants/elite-racing document
 *   2. Backfilling merchantId = "elite-racing" on every existing document
 *      in all operational collections
 *
 * Run once in a maintenance window:
 *   MIGRATION_OWNER_EMAIL=... MIGRATION_OWNER_PASSWORD=... MIGRATION_LEGACY_PIN=... \
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   npx ts-node --project tsconfig.scripts.json scripts/migrate-to-multitenant.ts
 *
 * Safe to re-run — skips docs that already have merchantId set.
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import * as bcrypt from "bcrypt";

// ── Init ────────────────────────────────────────────────────────────────────

if (!getApps().length) {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    initializeApp({ credential: cert(JSON.parse(saJson) as Parameters<typeof cert>[0]) });
  } else {
    // Application Default Credentials (Firebase CLI / gcloud auth)
    initializeApp({ projectId: "pitstop-ea39d" });
  }
}
const db = getFirestore();

// ── Config ──────────────────────────────────────────────────────────────────

const MERCHANT_ID = "elite-racing";
const LEGAL_NAME = "Elite Racing Cycles Pty Ltd";
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN ?? "elite-racing-cycles.myshopify.com";

const COLLECTIONS = [
  "purchaseOrders",
  "suppliers",
  "skuMappings",
  "shopifyProducts",
  "transfers",
  "auditLogs",
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

async function batchBackfill(collectionName: string): Promise<number> {
  const colRef = db.collection(collectionName);
  const snap = await colRef.get();

  if (snap.empty) {
    console.log(`  [${collectionName}] empty — skipped`);
    return 0;
  }

  let batch = db.batch();
  let batchCount = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const doc of snap.docs) {
    if (doc.data().merchantId) {
      totalSkipped++;
      continue;
    }

    batch.update(doc.ref, {
      merchantId: MERCHANT_ID,
    });

    batchCount++;
    totalUpdated++;

    // Firestore batch limit is 500 writes
    if (batchCount === 499) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(
    `  [${collectionName}] ${totalUpdated} updated, ${totalSkipped} already had merchantId`
  );
  return totalUpdated;
}

// ── Step 1: Create merchant document ────────────────────────────────────────

async function createMerchantDoc(): Promise<void> {
  const ownerEmail = process.env.MIGRATION_OWNER_EMAIL;
  const ownerPassword = process.env.MIGRATION_OWNER_PASSWORD;
  const legacyPin = process.env.MIGRATION_LEGACY_PIN;

  if (!ownerEmail || !ownerPassword || !legacyPin) {
    throw new Error(
      "Missing required env vars: MIGRATION_OWNER_EMAIL, MIGRATION_OWNER_PASSWORD, MIGRATION_LEGACY_PIN"
    );
  }

  const merchantRef = db.collection("merchants").doc(MERCHANT_ID);
  const existing = await merchantRef.get();

  if (existing.exists) {
    console.log(`  [merchants/${MERCHANT_ID}] already exists — skipped`);
    return;
  }

  const hashedOwnerPassword = await bcrypt.hash(ownerPassword, 12);
  const pinHash = hashPin(legacyPin);

  await merchantRef.set({
    merchantId: MERCHANT_ID,
    legalName: LEGAL_NAME,
    shopifyStoreDomain: SHOPIFY_DOMAIN,
    shopifyAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
      ? `PLAINTEXT:${process.env.SHOPIFY_ADMIN_ACCESS_TOKEN}` // Replace with AES-256-GCM in prod
      : "",
    stripeCustomerId: process.env.STRIPE_CUSTOMER_ID ?? "",
    stripeSubscriptionId: "",
    subscriptionTier: "GROWTH", // Grandfathered — Elite Racing gets GROWTH
    subscriptionStatus: "active",
    subscriptionCurrentPeriodEnd: null,
    ownerUid: MERCHANT_ID, // Firebase Auth UID — update after creating Firebase Auth user
    ownerEmail: ownerEmail.toLowerCase(),
    hashedOwnerPassword,
    pins: {
      [pinHash]: { role: "admin", label: "Legacy PIN — rename me" },
    },
    limits: {
      locations: 3,
      skus: 5000,
      features: ["ai_parsing"],
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(`  [merchants/${MERCHANT_ID}] created ✓`);
}

// ── Step 2: Backfill all collections ────────────────────────────────────────

async function backfillAll(): Promise<void> {
  let grandTotal = 0;
  for (const col of COLLECTIONS) {
    const n = await batchBackfill(col);
    grandTotal += n;
  }
  console.log(`\n  Total documents updated: ${grandTotal}`);
}

// ── Step 3: Verify ──────────────────────────────────────────────────────────

async function verify(): Promise<void> {
  for (const col of COLLECTIONS) {
    const missing = await db
      .collection(col)
      .where("merchantId", "==", null)
      .limit(1)
      .get();
    // Also check for docs without the field at all
    // Note: Firestore can't query "field does not exist" directly —
    // the backfill handles this by checking doc.data().merchantId
    const total = (await db.collection(col).get()).size;
    const withTenant = (
      await db
        .collection(col)
        .where("merchantId", "==", MERCHANT_ID)
        .get()
    ).size;
    const pct = total > 0 ? Math.round((withTenant / total) * 100) : 100;
    console.log(`  [${col}] ${withTenant}/${total} docs have merchantId (${pct}%)`);
  }

  const merchantDoc = await db.collection("merchants").doc(MERCHANT_ID).get();
  console.log(
    `  [merchants/${MERCHANT_ID}] exists: ${merchantDoc.exists}`
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" PitStop Multi-Tenant Migration");
  console.log(`  Merchant: ${MERCHANT_ID} (${LEGAL_NAME})`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("Step 1 — Creating merchant document...");
  await createMerchantDoc();

  console.log("\nStep 2 — Backfilling merchantId on all collections...");
  await backfillAll();

  console.log("\nStep 3 — Verification...");
  await verify();

  console.log("\n✓ Migration complete.\n");
  console.log("Next steps:");
  console.log("  1. Deploy updated firestore.rules (firebase deploy --only firestore:rules)");
  console.log("  2. Deploy updated firestore.indexes.json (firebase deploy --only firestore:indexes)");
  console.log("  3. Update /merchants/elite-racing.ownerUid with the real Firebase Auth UID");
  console.log("  4. Encrypt shopifyAccessToken with AES-256-GCM (replace PLAINTEXT: prefix)");
  console.log("  5. Rename the legacy PIN label in /merchants/elite-racing.pins");
  console.log("  6. Update all API routes to filter by merchantId");
  process.exit(0);
})().catch((err) => {
  console.error("\n✗ Migration failed:", err);
  process.exit(1);
});
