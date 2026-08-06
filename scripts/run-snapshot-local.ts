/**
 * Local end-to-end test of the stock snapshot flow against a real shop,
 * driving the SAME lib code the routes use (startSnapshot/completeSnapshot).
 * The finish webhook can't reach localhost, so this polls and then calls
 * completeSnapshot directly — production waits on the webhook instead.
 *
 * Run:
 *   npx ts-node -P tsconfig.scripts.json scripts/run-snapshot-local.ts <shop.myshopify.com>
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_JSON (loaded from .env.local) and a
 * still-valid stored shop token (open the app in admin to refresh it —
 * client-credentials refresh only works in prod where the API secret lives).
 */
import * as dotenv from "dotenv";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("tsconfig-paths").register({
  baseUrl: path.join(__dirname, ".."),
  paths: { "@/*": ["./*"] },
});
dotenv.config({ path: ".env.local", quiet: true } as dotenv.DotenvConfigOptions);

async function main() {
  const shop = process.argv[2];
  if (!shop) {
    console.error("Usage: run-snapshot-local.ts <shop.myshopify.com>");
    process.exit(1);
  }

  // Import AFTER dotenv so firebaseAdmin sees the service account.
  const { startSnapshot, completeSnapshot, getSnapshot } = await import("../lib/stockValue/snapshot");

  console.log(`Starting snapshot for ${shop}…`);
  const res = await startSnapshot(shop, { manual: false });
  console.log("startSnapshot →", JSON.stringify(res));

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const doc = await getSnapshot(shop);
    if (!doc?.bulkOpId) break;
    console.log(`  waiting on ${doc.bulkOpId} (${Math.round((Date.now() - t0) / 1000)}s)…`);
    await completeSnapshot(shop); // no-op while the bulk op is still RUNNING
    if (Date.now() - t0 > 15 * 60_000) throw new Error("timed out");
  }

  const doc = await getSnapshot(shop);
  console.log("\nFinal doc:");
  console.log(JSON.stringify(doc, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FAILED:", err);
    process.exit(1);
  }
);
