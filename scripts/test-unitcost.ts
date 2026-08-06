/**
 * One-off: sanity-check that inventoryItem.unitCost is readable with the shop's
 * offline token stored in Firestore `shops/{shop}`.
 *
 * Auth: Firebase CLI credentials (~/.config/configstore/firebase-tools.json),
 * same approach as migrate-runner.js — no service account needed. The stored
 * refresh token is exchanged for a fresh access token via the firebase-tools
 * public OAuth client.
 *
 * Run:
 *   npx ts-node -P tsconfig.scripts.json scripts/test-unitcost.ts <shop.myshopify.com>
 *
 * Without an argument it lists the doc IDs in `shops/` so you can pick one.
 * Prints the raw HTTP status and response body (GraphQL errors included).
 * Never prints access tokens.
 */
import * as fs from "fs";
import * as os from "os";

const PROJECT_ID = "pitstop-ea39d";
const API_VERSION = "2026-07";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// firebase-tools' OAuth client — public constants shipped in the CLI source.
const FIREBASE_CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

const QUERY = /* GraphQL */ `
  query TestUnitCost {
    productVariants(first: 3) {
      edges {
        node {
          id
          sku
          title
          inventoryItem {
            id
            unitCost {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

async function getGoogleAccessToken(): Promise<string> {
  const configPath = os.homedir() + "/.config/configstore/firebase-tools.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const refreshToken: string | undefined = config?.tokens?.refresh_token;
  if (!refreshToken) throw new Error("No refresh_token in firebase-tools configstore — run `firebase login`");

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
  if (!res.ok) {
    throw new Error(`Token refresh failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

type FirestoreFields = Record<string, { stringValue?: string; timestampValue?: string; nullValue?: null }>;

function str(fields: FirestoreFields, key: string): string | null {
  const f = fields[key];
  if (!f) return null;
  return f.stringValue ?? f.timestampValue ?? null;
}

async function listShops(gToken: string): Promise<void> {
  const res = await fetch(`${FIRESTORE_BASE}/shops?pageSize=50`, {
    headers: { Authorization: `Bearer ${gToken}` },
  });
  const json = (await res.json()) as { documents?: Array<{ name: string; fields: FirestoreFields }> };
  console.log("No shop given. Docs in shops/:");
  for (const d of json.documents ?? []) {
    const id = d.name.split("/").pop();
    console.log(
      ` - ${id}  (scope: ${str(d.fields, "scope") ?? "?"}, uninstalledAt: ${str(d.fields, "uninstalledAt") ?? "null"})`
    );
  }
}

async function main() {
  const shop = process.argv[2] || process.env.SHOPIFY_STORE_DOMAIN;
  const gToken = await getGoogleAccessToken();
  console.log("✓ Firebase CLI access token refreshed");

  if (!shop) {
    await listShops(gToken);
    process.exit(1);
  }

  const docRes = await fetch(`${FIRESTORE_BASE}/shops/${shop}`, {
    headers: { Authorization: `Bearer ${gToken}` },
  });
  if (docRes.status !== 200) {
    console.error(`shops/${shop}: HTTP ${docRes.status}`, (await docRes.text()).slice(0, 200));
    process.exit(1);
  }
  const doc = (await docRes.json()) as { fields: FirestoreFields };
  const accessToken = str(doc.fields, "accessToken");
  const scope = str(doc.fields, "scope");
  const uninstalledAt = str(doc.fields, "uninstalledAt");

  if (!accessToken) {
    console.error(`shops/${shop}: no accessToken field (uninstalledAt: ${uninstalledAt})`);
    process.exit(1);
  }
  if (accessToken.startsWith("AES256GCM:")) {
    console.error(`shops/${shop}: token is AES-256-GCM encrypted — need SHOPIFY_TOKEN_ENCRYPTION_KEY to decrypt`);
    process.exit(1);
  }
  console.log(`shops/${shop} → token loaded (length ${accessToken.length}), scope: ${scope}, uninstalledAt: ${uninstalledAt}`);

  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query: QUERY }),
  });

  console.log(`\nPOST ${url}`);
  console.log(`HTTP ${res.status} ${res.statusText}\n`);
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
