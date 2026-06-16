/**
 * Per-shop token store — Firestore `shops/{shopDomain}`.
 *
 * Tokens are stored encrypted via AES-256-GCM when SHOPIFY_TOKEN_ENCRYPTION_KEY
 * is present; otherwise plaintext (acceptable for local dev / early phase).
 */
import { adminDb } from "@/lib/firebaseAdmin";
import { encryptToken, decryptToken } from "@/lib/crypto/tokenEncryption";

interface ShopDoc {
  shop: string;
  accessToken: string;
  scope: string;
  installedAt: string;
  uninstalledAt: string | null;
}

function tryEncrypt(token: string): string {
  if (!process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY) return token;
  try {
    return encryptToken(token);
  } catch {
    return token;
  }
}

function tryDecrypt(stored: string): string {
  if (!process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY) return stored;
  try {
    return decryptToken(stored);
  } catch {
    return stored;
  }
}

export async function saveShop(
  shop: string,
  accessToken: string,
  scope: string
): Promise<void> {
  await adminDb
    .collection("shops")
    .doc(shop)
    .set(
      {
        shop,
        accessToken: tryEncrypt(accessToken),
        scope,
        installedAt: new Date().toISOString(),
        uninstalledAt: null,
      },
      { merge: true }
    );
}

export async function getShop(
  shop: string
): Promise<{ accessToken: string; scope: string } | null> {
  const snap = await adminDb.collection("shops").doc(shop).get();
  if (!snap.exists) return null;

  const data = snap.data() as ShopDoc;
  if (data.uninstalledAt) return null;

  return {
    accessToken: tryDecrypt(data.accessToken),
    scope: data.scope,
  };
}

export async function markUninstalled(shop: string): Promise<void> {
  await adminDb.collection("shops").doc(shop).set(
    {
      uninstalledAt: new Date().toISOString(),
      accessToken: "",
    },
    { merge: true }
  );
}
