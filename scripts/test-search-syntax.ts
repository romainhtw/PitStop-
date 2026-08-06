/**
 * Verifies productVariants(query:) wildcard behaviour on Admin API 2026-07
 * against pitstop-dev before building the Stock Value search bar.
 * Spec requires: title:*TERM* OR sku:*TERM* OR barcode:*TERM* — confirm each
 * field accepts infix wildcards, else fall back to prefix (TERM*).
 *
 * Run: npx ts-node -P tsconfig.scripts.json scripts/test-search-syntax.ts pitstop-dev.myshopify.com
 */
import * as fs from "fs";
import * as os from "os";

const PROJECT_ID = "pitstop-ea39d";
const API_VERSION = "2026-07";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FIREBASE_CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

async function getShopToken(shop: string): Promise<string> {
  const config = JSON.parse(
    fs.readFileSync(os.homedir() + "/.config/configstore/firebase-tools.json", "utf8")
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.tokens.refresh_token,
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
    }),
  });
  const gToken = ((await res.json()) as { access_token: string }).access_token;
  const docRes = await fetch(`${FIRESTORE_BASE}/shops/${shop}`, {
    headers: { Authorization: `Bearer ${gToken}` },
  });
  const doc = (await docRes.json()) as { fields: Record<string, { stringValue?: string }> };
  const token = doc.fields?.accessToken?.stringValue;
  if (!token) throw new Error("no token");
  return token;
}

async function search(shop: string, token: string, q: string): Promise<string[]> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: q
        ? `query($q:String!){ productVariants(first:5, query:$q){ edges{ node{ sku barcode product{title} } } } }`
        : `{ productVariants(first:5){ edges{ node{ sku barcode product{title} } } } }`,
      variables: q ? { q } : undefined,
    }),
  });
  const json = (await res.json()) as {
    data?: { productVariants: { edges: Array<{ node: { sku: string; barcode: string; product: { title: string } } }> } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length || !json.data) return ["ERROR: " + JSON.stringify(json.errors ?? json).slice(0, 300)];
  return (json.data?.productVariants.edges ?? []).map(
    (e) => `${e.node.product.title} | sku=${e.node.sku} | barcode=${e.node.barcode}`
  );
}

async function main() {
  const shop = process.argv[2] || "pitstop-dev.myshopify.com";
  const token = await getShopToken(shop);

  // Grab a few real variants to derive test terms.
  const sample = await search(shop, token, "");
  console.log("SAMPLE VARIANTS:");
  sample.forEach((s) => console.log("  " + s));

  const term = process.argv[3];
  if (!term) {
    console.log("\nPass a test term as second arg to run the wildcard matrix.");
    return;
  }

  const cases = [
    `title:*${term}*`,
    `title:${term}*`,
    `title:${term}`,
    `sku:*${term}*`,
    `sku:${term}*`,
    `sku:${term}`,
    `barcode:*${term}*`,
    `barcode:${term}*`,
    `barcode:${term}`,
    `title:*${term}* OR sku:*${term}* OR barcode:*${term}*`,
  ];
  for (const q of cases) {
    const hits = await search(shop, token, q);
    console.log(`\nquery: ${q}   → ${hits.length} hit(s)`);
    hits.slice(0, 3).forEach((h) => console.log("  " + h));
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
