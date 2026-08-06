/**
 * Step-1 verification for the Stock Value slice: run the bulk operation against
 * a real shop with its stored offline token, stream + aggregate the JSONL, and
 * print totals per location. For Jack's shop the output is compared against his
 * Stocky figures (852,716.66 cost / 7,460,747.25 retail / 9,395 items).
 *
 * Auth: same firebase-tools CLI credential approach as test-unitcost.ts.
 *
 * Run:
 *   npx ts-node -P tsconfig.scripts.json scripts/stock-snapshot-test.ts <shop.myshopify.com>
 *
 * Read-only: bulkOperationRunQuery only reads product/inventory data.
 * Polling is acceptable here (one-off script); the app itself waits on the
 * bulk_operations/finish webhook instead.
 */
import * as fs from "fs";
import * as os from "os";
import { BULK_STOCK_QUERY, aggregateStockLines, streamLines } from "../lib/stockValue/aggregate";

const PROJECT_ID = "pitstop-ea39d";
const API_VERSION = "2026-07";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FIREBASE_CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

const STOCKY_EXPECTED: Record<string, { cost: number; retail: number; items: number }> = {
  "254127-f1.myshopify.com": { cost: 852_716.66, retail: 7_460_747.25, items: 9_395 },
};

async function getGoogleAccessToken(): Promise<string> {
  const config = JSON.parse(
    fs.readFileSync(os.homedir() + "/.config/configstore/firebase-tools.json", "utf8")
  );
  const refreshToken: string | undefined = config?.tokens?.refresh_token;
  if (!refreshToken) throw new Error("No refresh_token — run `firebase login`");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function getShopToken(shop: string): Promise<string> {
  const gToken = await getGoogleAccessToken();
  const res = await fetch(`${FIRESTORE_BASE}/shops/${shop}`, {
    headers: { Authorization: `Bearer ${gToken}` },
  });
  if (res.status !== 200) throw new Error(`shops/${shop}: HTTP ${res.status}`);
  const doc = (await res.json()) as { fields: Record<string, { stringValue?: string }> };
  const token = doc.fields?.accessToken?.stringValue;
  if (!token) throw new Error(`shops/${shop}: no accessToken`);
  if (token.startsWith("AES256GCM:")) throw new Error("token encrypted — need SHOPIFY_TOKEN_ENCRYPTION_KEY");
  return token;
}

async function gql<T>(shop: string, token: string, query: string): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error("GraphQL: " + json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("no data in response");
  return json.data;
}

interface CurrentBulkOp {
  currentBulkOperation: { id: string; status: string; url: string | null; objectCount: string; errorCode: string | null } | null;
}

const fmt = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

async function main() {
  const shop = process.argv[2];
  if (!shop) {
    console.error("Usage: stock-snapshot-test.ts <shop.myshopify.com>");
    process.exit(1);
  }
  const token = await getShopToken(shop);
  console.log(`✓ token loaded for ${shop}`);

  const shopInfo = await gql<{ shop: { currencyCode: string } }>(shop, token, `{ shop { currencyCode } }`);
  console.log(`  currency: ${shopInfo.shop.currencyCode}`);

  // Never stomp an in-flight bulk operation (one per shop at a time).
  const current = await gql<CurrentBulkOp>(shop, token, `{ currentBulkOperation { id status url objectCount errorCode } }`);
  if (current.currentBulkOperation?.status === "RUNNING" || current.currentBulkOperation?.status === "CREATED") {
    console.error(`A bulk operation is already ${current.currentBulkOperation.status} — aborting.`);
    process.exit(1);
  }

  const started = await gql<{
    bulkOperationRunQuery: { bulkOperation: { id: string; status: string } | null; userErrors: Array<{ message: string }> };
  }>(
    shop,
    token,
    `mutation { bulkOperationRunQuery(query: """${BULK_STOCK_QUERY}""") { bulkOperation { id status } userErrors { field message } } }`
  );
  const errs = started.bulkOperationRunQuery.userErrors;
  if (errs.length) throw new Error("userErrors: " + errs.map((e) => e.message).join("; "));
  console.log(`✓ bulk operation started: ${started.bulkOperationRunQuery.bulkOperation?.id}`);

  // Poll (script-only; the app uses the finish webhook).
  const t0 = Date.now();
  let url: string | null = null;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const cur = (await gql<CurrentBulkOp>(shop, token, `{ currentBulkOperation { id status url objectCount errorCode } }`)).currentBulkOperation;
    if (!cur) continue;
    process.stdout.write(`  ${cur.status} — ${cur.objectCount} objects (${Math.round((Date.now() - t0) / 1000)}s)\r\n`);
    if (cur.status === "COMPLETED") { url = cur.url; break; }
    if (["FAILED", "CANCELED", "EXPIRED"].includes(cur.status)) throw new Error(`bulk op ${cur.status}: ${cur.errorCode}`);
    if (Date.now() - t0 > 20 * 60_000) throw new Error("timed out after 20 min");
  }

  if (!url) { console.log("Completed with no URL — empty result (no variants)."); return; }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`result download failed: HTTP ${res.status}`);
  const agg = await aggregateStockLines(streamLines(res.body as ReadableStream<Uint8Array>));

  console.log(`\n=== ${shop} ===`);
  console.log(`variants: ${agg.totalVariants}, missing cost (with stock): ${agg.missingCostCount}`);
  for (const loc of agg.locations) {
    const t = agg.byLocation[loc.id];
    console.log(`  ${loc.name.padEnd(20)} cost ${fmt(t.cost).padStart(14)}  retail ${fmt(t.retail).padStart(14)}  items ${t.items}`);
  }
  console.log(`  ${"ALL".padEnd(20)} cost ${fmt(agg.all.cost).padStart(14)}  retail ${fmt(agg.all.retail).padStart(14)}  items ${agg.all.items}`);

  const expected = STOCKY_EXPECTED[shop];
  if (expected) {
    console.log(`\nStocky says: cost ${expected.cost.toLocaleString("en-US", { minimumFractionDigits: 2 })}  retail ${expected.retail.toLocaleString("en-US", { minimumFractionDigits: 2 })}  items ${expected.items}`);
    const dc = agg.all.cost - Math.round(expected.cost * 100);
    const dr = agg.all.retail - Math.round(expected.retail * 100);
    const di = agg.all.items - expected.items;
    console.log(`Delta: cost ${fmt(dc)}  retail ${fmt(dr)}  items ${di}`);
    console.log(dc === 0 && dr === 0 && di === 0 ? "✓ EXACT MATCH" : "✗ MISMATCH — investigate before building downstream");
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
