/**
 * AES-256-GCM envelope encryption for Shopify access tokens.
 * Key must be 32 bytes, base64-encoded in SHOPIFY_TOKEN_ENCRYPTION_KEY env var.
 *
 * Format stored in Firestore:
 *   AES256GCM:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO  = "aes-256-gcm";
const LABEL = "AES256GCM";

function getKey(): Buffer {
  const raw = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY env var not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  return key;
}

export function encryptToken(plaintext: string): string {
  const key    = getKey();
  const iv     = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${LABEL}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(LABEL + ":")) {
    // Legacy plaintext — return as-is (migration period)
    if (stored.startsWith("PLAINTEXT:")) return stored.slice("PLAINTEXT:".length);
    return stored;
  }
  const [, ivB64, tagB64, ctB64] = stored.split(":");
  const key      = getKey();
  const iv       = Buffer.from(ivB64,  "base64");
  const tag      = Buffer.from(tagB64, "base64");
  const ct       = Buffer.from(ctB64,  "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
