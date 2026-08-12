/**
 * Proves the totals-only fallback matches the per-location aggregation.
 *
 * The fallback exists for apps whose credentials cannot read locations: it asks
 * Shopify for `inventoryQuantity` (stock across every location) instead of
 * walking inventory levels. Both paths must produce identical headline figures,
 * otherwise a merchant on the fallback would see different numbers from one on
 * the full path.
 *
 * Run:
 *   npx ts-node -P tsconfig.scripts.json scripts/stock-totals-fallback-test.ts <shop.myshopify.com>
 *
 * Read-only. Runs two bulk operations back to back, so it needs a shop with no
 * other bulk operation in flight.
 */
import * as fs from "fs";
import * as os from "os";
import {
  BULK_STOCK_QUERY,
  BULK_STOCK_QUERY_TOTALS_ONLY,
  aggregateStockLines,
  aggregateStockTotals,
  streamLines,
} from "../lib/stockValue/aggregate";

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
  const doc = await fetch(`${FIRESTORE_BASE}/shops/${shop}`, {
    headers: { Authorization: `Bearer ${gToken}` },
  });
  const token = ((await doc.json()) as { fields: Record<string, { stringValue?: string }> }).fields
    ?.accessToken?.stringValue;
  if (!token) throw new Error("no stored token for " + shop);
  return token;
}

async function gql<T>(shop: string, token: string, query: string, variables?: unknown): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  // Shopify returns `errors` as an array for GraphQL problems but as a bare
  // string for auth failures, so never assume it is a list.
  if (json.errors) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.errors).slice(0, 200)}`);
  if (!json.data) throw new Error(`HTTP ${res.status}: no data`);
  return json.data;
}

interface CurrentOp {
  currentBulkOperation: { id: string; status: string; url: string | null; errorCode: string | null } | null;
}

async function runBulk(shop: string, token: string, query: string): Promise<string | null> {
  const started = await gql<{
    bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(shop, token, `mutation($q:String!){ bulkOperationRunQuery(query:$q){ bulkOperation{ id } userErrors{ message } } }`, { q: query });
  const errs = started.bulkOperationRunQuery.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const cur = (await gql<CurrentOp>(shop, token, `{ currentBulkOperation { id status url errorCode } }`)).currentBulkOperation;
    if (!cur) continue;
    if (cur.status === "COMPLETED") return cur.url;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(cur.status)) throw new Error(`${cur.status}: ${cur.errorCode}`);
    if (Date.now() - t0 > 10 * 60_000) throw new Error("timed out");
  }
}

async function download(url: string | null) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
  return streamLines(res.body as ReadableStream<Uint8Array>);
}

const fmt = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

async function main() {
  const shop = process.argv[2];
  if (!shop) throw new Error("usage: stock-totals-fallback-test.ts <shop.myshopify.com>");
  const token = await getShopToken(shop);

  console.log("running per-location bulk query…");
  const linesA = await download(await runBulk(shop, token, BULK_STOCK_QUERY));
  const byLocation = linesA
    ? await aggregateStockLines(linesA)
    : { all: { cost: 0, retail: 0, items: 0 }, totalVariants: 0, missingCostCount: 0 };

  console.log("running totals-only bulk query…");
  const linesB = await download(await runBulk(shop, token, BULK_STOCK_QUERY_TOTALS_ONLY));
  const totalsOnly = linesB
    ? await aggregateStockTotals(linesB)
    : { all: { cost: 0, retail: 0, items: 0 }, totalVariants: 0, missingCostCount: 0 };

  console.log(`\n${"".padEnd(16)} ${"cost".padStart(14)} ${"retail".padStart(16)} ${"items".padStart(8)}  variants  missingCost`);
  for (const [label, a] of [["per-location", byLocation], ["totals-only", totalsOnly]] as const) {
    console.log(
      `${label.padEnd(16)} ${fmt(a.all.cost).padStart(14)} ${fmt(a.all.retail).padStart(16)} ${String(a.all.items).padStart(8)}  ${String(a.totalVariants).padStart(8)}  ${a.missingCostCount}`
    );
  }

  const same =
    byLocation.all.cost === totalsOnly.all.cost &&
    byLocation.all.retail === totalsOnly.all.retail &&
    byLocation.all.items === totalsOnly.all.items;
  console.log(same ? "\n✓ IDENTICAL — fallback is equivalent" : "\n✗ MISMATCH — do not ship the fallback");
  if (!same) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
