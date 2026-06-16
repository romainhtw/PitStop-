/**
 * Migration runner — uses Firebase CLI access token (no service account needed).
 * Run: node scripts/migrate-runner.js
 */

const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────────────────────────────────────
const PROJECT_ID = "pitstop-ea39d";
const MERCHANT_ID = "elite-racing";
const LEGAL_NAME = "Elite Racing Cycles Pty Ltd";
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "elite-racing-cycles.myshopify.com";

const OWNER_EMAIL = process.env.MIGRATION_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.MIGRATION_OWNER_PASSWORD;
const LEGACY_PIN = process.env.MIGRATION_LEGACY_PIN;

if (!OWNER_EMAIL || !OWNER_PASSWORD || !LEGACY_PIN) {
  console.error("Missing: MIGRATION_OWNER_EMAIL, MIGRATION_OWNER_PASSWORD, MIGRATION_LEGACY_PIN");
  process.exit(1);
}

// ── Get Firebase CLI access token ────────────────────────────────────────────
function getAccessToken() {
  const configPath = os.homedir() + "/.config/configstore/firebase-tools.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

// ── Firestore REST helpers ───────────────────────────────────────────────────
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function httpsRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ""),
      method,
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Convert JS value to Firestore field value format
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreDoc(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

// List all docs in a collection
async function listCollection(col, token) {
  const docs = [];
  let pageToken = null;
  do {
    const qs = pageToken ? `?pageToken=${pageToken}&pageSize=300` : `?pageSize=300`;
    const res = await httpsRequest("GET", `/${col}${qs}`, null, token);
    if (res.status !== 200) {
      console.error(`  Failed to list ${col}:`, JSON.stringify(res.body).substring(0, 200));
      break;
    }
    if (res.body.documents) docs.push(...res.body.documents);
    pageToken = res.body.nextPageToken || null;
  } while (pageToken);
  return docs;
}

// Get a single document
async function getDoc(col, docId, token) {
  const res = await httpsRequest("GET", `/${col}/${docId}`, null, token);
  return res;
}

// Create or overwrite a document (PATCH = upsert)
async function setDoc(col, docId, data, token) {
  const doc = toFirestoreDoc(data);
  const fieldMask = Object.keys(doc.fields).join(",");
  const res = await httpsRequest(
    "PATCH",
    `/${col}/${docId}?updateMask.fieldPaths=${Object.keys(doc.fields).join("&updateMask.fieldPaths=")}`,
    doc,
    token
  );
  return res;
}

// Update a document (merge single field)
async function updateDoc(col, docId, field, value, token) {
  const doc = toFirestoreDoc({ [field]: value });
  const res = await httpsRequest(
    "PATCH",
    `/${col}/${docId}?updateMask.fieldPaths=${field}`,
    doc,
    token
  );
  return res;
}

// ── Bcrypt simulation — we can't use bcrypt in plain node easily ─────────────
// We'll use the bcrypt npm module
async function hashPassword(password) {
  try {
    const bcrypt = require("bcrypt");
    return await bcrypt.hash(password, 12);
  } catch {
    // fallback: use bcryptjs
    const bcrypt = require("bcryptjs");
    return await bcrypt.hash(password, 12);
  }
}

function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" PitStop Multi-Tenant Migration");
  console.log(`  Merchant: ${MERCHANT_ID} (${LEGAL_NAME})`);
  console.log("═══════════════════════════════════════════════════════\n");

  const token = getAccessToken();
  console.log("✓ Firebase CLI access token loaded\n");

  // ── Step 1: Create merchant doc ────────────────────────────────────────────
  console.log("Step 1 — Creating merchant document...");
  const existing = await getDoc("merchants", MERCHANT_ID, token);
  if (existing.status === 200 && existing.body.fields) {
    console.log(`  [merchants/${MERCHANT_ID}] already exists — skipped`);
  } else {
    const hashedPassword = await hashPassword(OWNER_PASSWORD);
    const pinHash = hashPin(LEGACY_PIN);
    const merchantData = {
      merchantId: MERCHANT_ID,
      legalName: LEGAL_NAME,
      shopifyStoreDomain: SHOPIFY_DOMAIN,
      shopifyAccessToken: "",
      stripeCustomerId: process.env.STRIPE_CUSTOMER_ID || "",
      stripeSubscriptionId: "",
      subscriptionTier: "GROWTH",
      subscriptionStatus: "active",
      subscriptionCurrentPeriodEnd: null,
      ownerUid: MERCHANT_ID,
      ownerEmail: OWNER_EMAIL.toLowerCase(),
      hashedOwnerPassword: hashedPassword,
      pins: { [pinHash]: { role: "admin", label: "Legacy PIN — rename me" } },
      limits: { locations: 3, skus: 5000, features: ["ai_parsing"] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = await setDoc("merchants", MERCHANT_ID, merchantData, token);
    if (res.status === 200) {
      console.log(`  [merchants/${MERCHANT_ID}] created ✓`);
    } else {
      console.error(`  [merchants/${MERCHANT_ID}] FAILED:`, JSON.stringify(res.body).substring(0, 300));
      process.exit(1);
    }
  }

  // ── Step 2: Backfill merchantId ────────────────────────────────────────────
  console.log("\nStep 2 — Backfilling merchantId on all collections...");
  const COLLECTIONS = ["purchaseOrders", "suppliers", "skuMappings", "shopifyProducts", "transfers", "auditLogs"];
  let grandTotal = 0;

  for (const col of COLLECTIONS) {
    const docs = await listCollection(col, token);
    if (docs.length === 0) {
      console.log(`  [${col}] empty — skipped`);
      continue;
    }

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const doc of docs) {
      if (doc.fields && doc.fields.merchantId) {
        skipped++;
        continue;
      }
      // Extract doc ID from name: projects/.../databases/.../documents/{col}/{id}
      const docId = doc.name.split("/").pop();
      const res = await updateDoc(col, docId, "merchantId", MERCHANT_ID, token);
      if (res.status === 200) {
        updated++;
      } else {
        errors.push(`${docId}: ${res.status}`);
      }
    }

    console.log(`  [${col}] ${updated} updated, ${skipped} already had merchantId${errors.length ? `, ${errors.length} errors` : ""}`);
    if (errors.length > 0) console.log(`    Errors: ${errors.slice(0, 5).join(", ")}`);
    grandTotal += updated;
  }
  console.log(`\n  Total documents updated: ${grandTotal}`);

  // ── Step 3: Verify ─────────────────────────────────────────────────────────
  console.log("\nStep 3 — Verification...");
  for (const col of COLLECTIONS) {
    const docs = await listCollection(col, token);
    const withTenant = docs.filter(d => d.fields && d.fields.merchantId && d.fields.merchantId.stringValue === MERCHANT_ID).length;
    const pct = docs.length > 0 ? Math.round((withTenant / docs.length) * 100) : 100;
    console.log(`  [${col}] ${withTenant}/${docs.length} docs have merchantId (${pct}%)`);
  }

  const merchantCheck = await getDoc("merchants", MERCHANT_ID, token);
  console.log(`  [merchants/${MERCHANT_ID}] exists: ${merchantCheck.status === 200}`);

  console.log("\n✓ Migration complete.\n");
  console.log("Next steps:");
  console.log("  1. Add Vercel env vars: PITSTOP_JWT_SECRET, SHOPIFY_TOKEN_ENCRYPTION_KEY");
  console.log("  2. Update /merchants/elite-racing.ownerUid with the real Firebase Auth UID");
  console.log("  3. Encrypt shopifyAccessToken with AES-256-GCM");
}

main().catch((err) => {
  console.error("\n✗ Migration failed:", err.message || err);
  process.exit(1);
});
