/**
 * Backfill Shopify collections onto existing Firestore shopifyProducts docs.
 * Uses Firebase CLI access token + Shopify Admin API directly.
 * Run: node scripts/sync-collections.js
 */

const fs = require("fs");
const os = require("os");
const https = require("https");

const PROJECT_ID = "pitstop-ea39d";
const MERCHANT_ID = "elite-racing";

// ── Firebase CLI token ───────────────────────────────────────────────────────
function getFirebaseToken() {
  const p = os.homedir() + "/.config/configstore/firebase-tools.json";
  return JSON.parse(fs.readFileSync(p, "utf8")).tokens.access_token;
}

// ── Generic HTTPS request ────────────────────────────────────────────────────
function request(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request(
      { hostname, path, method, headers: { "Content-Type": "application/json", ...headers, ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ── Firestore helpers ────────────────────────────────────────────────────────
const FS_BASE = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path, token) {
  return request("GET", "firestore.googleapis.com", FS_BASE + path, { Authorization: "Bearer " + token }, null);
}

async function firestorePatch(path, fields, token) {
  const mask = Object.keys(fields).join("&updateMask.fieldPaths=");
  return request(
    "PATCH",
    "firestore.googleapis.com",
    FS_BASE + path + `?updateMask.fieldPaths=${mask}`,
    { Authorization: "Bearer " + token },
    { fields }
  );
}

async function listCollection(col, token) {
  const docs = [];
  let pageToken = null;
  do {
    const qs = pageToken ? `?pageToken=${pageToken}&pageSize=300` : "?pageSize=300";
    const res = await request("GET", "firestore.googleapis.com", `${FS_BASE}/${col}${qs}`, { Authorization: "Bearer " + token }, null);
    if (res.body.documents) docs.push(...res.body.documents);
    pageToken = res.body.nextPageToken || null;
  } while (pageToken);
  return docs;
}

// ── Shopify GraphQL ──────────────────────────────────────────────────────────
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2025-04";

if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
  console.error("Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN");
  process.exit(1);
}

async function shopifyGraphql(query, variables) {
  return request(
    "POST",
    SHOPIFY_DOMAIN,
    `/admin/api/${API_VERSION}/graphql.json`,
    { "X-Shopify-Access-Token": SHOPIFY_TOKEN },
    { query, variables }
  );
}

const COLLECTIONS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          variants(first: 100) {
            edges { node { id } }
          }
          collections(first: 10) {
            edges { node { title } }
          }
        }
      }
    }
  }
`;

async function fetchCollectionMap() {
  console.log("  Fetching collections from Shopify...");
  const variantToCollections = new Map(); // variantGid → string[]
  let cursor = null;
  let page = 0;

  for (;;) {
    page++;
    const vars = cursor ? { cursor } : {};
    const res = await shopifyGraphql(COLLECTIONS_QUERY, vars);
    const products = res.body?.data?.products;
    if (!products) { console.error("  Shopify error:", JSON.stringify(res.body).substring(0, 200)); break; }

    for (const { node: p } of products.edges) {
      const collections = p.collections.edges.map((e) => e.node.title);
      for (const { node: v } of p.variants.edges) {
        variantToCollections.set(v.id, collections);
      }
    }

    process.stdout.write(`\r  Page ${page} — ${variantToCollections.size} variants mapped`);
    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;

    // Respect Shopify rate limit
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log();
  return variantToCollections;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" PitStop — Backfill Shopify Collections");
  console.log("═══════════════════════════════════════════════════════\n");

  const token = getFirebaseToken();
  console.log("✓ Firebase CLI token loaded");

  // 1. Fetch collections from Shopify
  const variantToCollections = await fetchCollectionMap();
  console.log(`✓ ${variantToCollections.size} variants with collection data\n`);

  // 2. List all shopifyProducts from Firestore
  console.log("  Listing Firestore shopifyProducts...");
  const docs = await listCollection("shopifyProducts", token);
  console.log(`  ${docs.length} documents found\n`);

  // 3. Patch each doc with its collections
  let updated = 0, skipped = 0, errors = 0;
  const BATCH = 20; // parallel requests

  const docsToUpdate = docs.filter((doc) => {
    const merchantId = doc.fields?.merchantId?.stringValue;
    return merchantId === MERCHANT_ID;
  });

  console.log(`  Updating ${docsToUpdate.length} Elite Racing docs...`);

  for (let i = 0; i < docsToUpdate.length; i += BATCH) {
    const chunk = docsToUpdate.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (doc) => {
      const docId = doc.name.split("/").pop();
      const variantId = doc.fields?.variantId?.stringValue;
      if (!variantId) { skipped++; return; }

      const collections = variantToCollections.get(variantId) ?? [];
      const res = await firestorePatch(
        `/shopifyProducts/${docId}`,
        { collections: { arrayValue: { values: collections.map((t) => ({ stringValue: t })) } } },
        token
      );
      if (res.status === 200) updated++;
      else errors++;
    }));

    if ((i / BATCH) % 10 === 0) {
      process.stdout.write(`\r  ${updated} updated, ${skipped} skipped, ${errors} errors`);
    }
  }

  console.log(`\n\n✓ Done — ${updated} updated, ${skipped} skipped, ${errors} errors\n`);
}

main().catch((err) => {
  console.error("\n✗ Failed:", err.message || err);
  process.exit(1);
});
