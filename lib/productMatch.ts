/**
 * Smart client-side product matching.
 *
 * Cross-references every signal on a parsed invoice line item (SKU, barcode,
 * product name, model numbers, size/colour) against the loaded Shopify catalog.
 *
 * Design principles (after real-world tuning):
 *  - PRIMARY signals identify a product: exact/partial SKU, barcode, name + model tokens.
 *  - MODIFIER signals (colour / size) only refine a product that already matched on a
 *    primary signal. Colour + size ALONE must never produce a suggestion, otherwise every
 *    "White / M" product matches every other "White / M" product.
 *  - Size tokens ("M", "S") are matched on whole-word boundaries, never as substrings
 *    (so "M" doesn't match "Matte" and "S" doesn't match "Shiny").
 */
import type { LineItem, ShopifyProduct } from "@/lib/types";

const SIZE_WORDS = new Set([
  "xs", "s", "m", "l", "xl", "xxl", "xxxl",
  "small", "medium", "large", "xsmall", "xlarge", "xxlarge",
]);

// Common size abbreviation ↔ full word, so "M" matches a "Medium" variant and vice-versa
const SIZE_ALIASES: Record<string, string[]> = {
  xs: ["xs", "xsmall", "extra small"],
  s: ["s", "small"],
  m: ["m", "medium", "med"],
  l: ["l", "large", "lg"],
  xl: ["xl", "xlarge", "extra large"],
  xxl: ["xxl", "xxlarge"],
  small: ["s", "small"],
  medium: ["m", "medium", "med"],
  large: ["l", "large", "lg"],
};

function norm(s: string | undefined | null): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s: string | undefined | null): string[] {
  return norm(s).split(" ").filter((t) => t.length >= 2);
}

/** A model identifier: pure 2+ digit number, or alphanumeric combo (r7000, wg11, dt240). */
function isModelToken(t: string): boolean {
  return /^\d{2,}$/.test(t) || /^[a-z]{1,4}\d{2,}/.test(t) || /^\d{2,}[a-z]{1,4}$/.test(t);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `token` appears as a whole word inside the normalised haystack. */
function wholeWordPresent(token: string, hayNorm: string): boolean {
  if (!token) return false;
  return new RegExp(`(^|\\s)${escapeRegex(token)}($|\\s)`).test(hayNorm);
}

/** Longest shared leading run of two alphanumeric SKU strings. */
function sharedPrefixLen(a: string, b: string): number {
  const x = a.replace(/[^a-z0-9]/g, "");
  const y = b.replace(/[^a-z0-9]/g, "");
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

export interface ScoredProduct {
  product: ShopifyProduct;
  score: number;        // 0–100 confidence
  reasons: string[];    // human-readable signals, e.g. ["SKU ~CHE00101WG11", "model wg11", "Size M"]
}

export function scoreProduct(
  item: Pick<LineItem, "name" | "sku" | "barcode" | "optionValues">,
  product: ShopifyProduct
): { score: number; reasons: string[]; primary: number } {
  const reasons: string[] = [];

  const itemSku = norm(item.sku);
  const itemBarcode = norm(item.barcode);
  const pSku = norm(product.sku);
  const pBarcode = norm(product.barcode);

  // ── PRIMARY: codes ─────────────────────────────────────────────────────────
  let codeScore = 0;
  if (itemSku && pSku && itemSku === pSku) { codeScore = 100; reasons.push("SKU match"); }
  else if (itemBarcode && pBarcode && itemBarcode === pBarcode) { codeScore = 100; reasons.push("Barcode match"); }
  else if (itemSku && pBarcode && itemSku === pBarcode) { codeScore = 94; reasons.push("Code match"); }
  else if (itemBarcode && pSku && itemBarcode === pSku) { codeScore = 94; reasons.push("Code match"); }
  else if (itemSku && pSku) {
    // Partial SKU — suppliers often append a colour/size suffix (CHE00101WG11.2C vs CHE00101WG11-20)
    const shared = sharedPrefixLen(itemSku, pSku);
    const cleanLen = Math.min(itemSku.replace(/[^a-z0-9]/g, "").length, pSku.replace(/[^a-z0-9]/g, "").length);
    if (shared >= 8 || (shared >= 6 && shared >= cleanLen - 2)) {
      codeScore = Math.min(85, 55 + shared * 2);
      reasons.push(`SKU ~${itemSku.replace(/[^a-z0-9]/g, "").slice(0, shared)}`);
    }
  }

  // ── PRIMARY: name + model tokens ────────────────────────────────────────────
  const itemTokens = tokenize(item.name);
  const haystackSet = new Set(tokenize(`${product.productTitle} ${product.variantTitle}`));
  let nameHit = 0;
  let nameWeight = 0;
  for (const t of itemTokens) {
    const weight = isModelToken(t) ? 3 : 1;
    nameWeight += weight;
    if (haystackSet.has(t)) {
      nameHit += weight;
      if (isModelToken(t)) reasons.push(`model ${t}`);
    }
  }
  const nameScore = nameWeight > 0 ? (nameHit / nameWeight) * 75 : 0;
  // Surface a name reason so a brand/name match (not just model numbers) counts as primary
  if (nameScore >= 18) reasons.push("name");

  // Primary confidence is the strongest single identifier
  const primary = Math.max(codeScore, nameScore);

  // ── MODIFIERS: colour / size — only when a primary signal already matched ────
  let modifierScore = 0;
  if (primary >= 12) {
    const variantNorm = norm(product.variantTitle);
    for (const ov of item.optionValues ?? []) {
      const val = norm(ov.optionValue);
      if (!val) continue;
      const candidates = SIZE_ALIASES[val] ?? [val];
      const present = candidates.some((c) =>
        c.split(" ").every((word) => wholeWordPresent(word, variantNorm))
      );
      if (present) {
        modifierScore += SIZE_WORDS.has(val) ? 12 : 9;
        reasons.push(`${ov.optionName || "Variant"} ${ov.optionValue}`);
      }
    }
  }

  const score = Math.min(100, Math.round(primary + modifierScore));
  // "name" is an internal flag, not a display reason — drop it from the visible list
  const uniqueReasons = Array.from(new Set(reasons.filter((r) => r !== "name"))).slice(0, 4);
  return { score, reasons: uniqueReasons, primary };
}

/**
 * Rank the catalog against a line item. Only returns products that matched on a real
 * PRIMARY signal (name/model/SKU/barcode) — colour+size alone never qualifies.
 */
export function suggestMatches(
  item: Pick<LineItem, "name" | "sku" | "barcode" | "optionValues">,
  catalog: ShopifyProduct[],
  limit = 6,
  minScore = 35
): ScoredProduct[] {
  const scored: ScoredProduct[] = [];
  for (const product of catalog) {
    const { score, reasons, primary } = scoreProduct(item, product);
    // Require a real identifying signal (name/model/SKU/barcode), not just a colour/size echo
    if (primary >= 18 && score >= minScore) scored.push({ product, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Confidence tier for UI badge colour. */
export function confidenceTier(score: number): "strong" | "possible" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 55) return "possible";
  return "weak";
}
