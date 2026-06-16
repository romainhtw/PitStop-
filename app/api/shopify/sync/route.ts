import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  findVariantBySku,
  searchVariantsByTitle,
  fetchVariantsByQuery,
  batchSetInventory,
  fetchInventoryLevels,
  updateInventoryItemCost,
  checkLocation,
  toLocationGid,
} from "@/lib/shopify";
import { lookupMapping, saveMapping, lookupNameMapping, saveNameMapping } from "@/lib/adminMappings";
import type { AuditLog, PurchaseOrder, LineSyncResult, SyncResult, VariantSuggestion } from "@/lib/types";

export const runtime = "nodejs";

// Returns option values that look like model identifiers (contain digits: "57|64", "DT 240", "12x100")
function modelOptionTokens(optionValues?: Array<{ optionName: string; optionValue: string }>): string {
  if (!optionValues || optionValues.length === 0) return "";
  return optionValues
    .map((ov) => ov.optionValue.trim())
    .filter((v) => /\d/.test(v) && v.length > 1)
    .slice(0, 2)
    .join(" ");
}

function extractModelTokens(name: string): string[] {
  const tokens = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  return tokens.filter(
    (t) => /^\d{2,}$/.test(t) || /^[a-z]{1,5}\d{2,}/.test(t) || /^\d{2,}[a-z]{1,5}$/.test(t)
  );
}

function extractBrandToken(name: string): string {
  const tokens = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const STOPWORDS = new Set(["the", "and", "for", "set", "kit", "new", "pro", "with", "black", "white", "red", "blue"]);
  return tokens.find((t) => /^[a-z]{2,}$/.test(t) && !STOPWORDS.has(t)) ?? "";
}

async function enrichedTitleSearch(
  name: string,
  optionValues?: Array<{ optionName: string; optionValue: string }>
): Promise<VariantSuggestion[]> {
  const modelTokens = extractModelTokens(name);
  const brand = extractBrandToken(name);
  const optionModel = modelOptionTokens(optionValues);

  const searchTerms: string[] = [];

  // 1. Full name (most specific)
  searchTerms.push(name);

  // 2. Brand + each model number token
  for (const m of modelTokens) {
    if (brand) searchTerms.push(`${brand} ${m}`);
    // 3. Model number alone (very discriminating in cycling)
    searchTerms.push(m);
  }

  // 4. From optionValues (size/model combos)
  if (optionModel) {
    if (brand) searchTerms.push(`${brand} ${optionModel}`);
    searchTerms.push(optionModel);
  }

  // Deduplicate and cap at 6 searches
  const uniqueTerms = Array.from(new Set(searchTerms)).slice(0, 6);

  const results = await Promise.allSettled(
    uniqueTerms.map((term) => {
      if (term === name) return searchVariantsByTitle(term);
      return fetchVariantsByQuery(`title:${term}`);
    })
  );

  const seen = new Set<string>();
  const merged: VariantSuggestion[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const v of result.value) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      merged.push({
        variantId: v.id,
        inventoryItemId: v.inventoryItem.id,
        productTitle: v.product.title,
        sku: v.sku || undefined,
        barcode: v.barcode || undefined,
        score: titleScore(v.product.title, name),
      });
    }
  }

  // Sort by score desc, only show results with score > 0, cap at 10
  return merged
    .filter((s) => (s.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);
}

function titleScore(productTitle: string, lineItemName: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const t = normalize(productTitle);
  const q = normalize(lineItemName);

  if (t === q) return 100;
  if (t.includes(q)) return 95;

  const tSet = new Set(t.split(" ").filter(Boolean));
  const qTokens = q.split(" ").filter((w) => w.length >= 2);

  if (qTokens.length === 0) return 0;

  let score = 0;
  let totalWeight = 0;

  for (const tok of qTokens) {
    // Model numbers (pure 2+ digit numbers, or alphanumeric combos like r7000) get 3x weight
    const isModel =
      /^\d{2,}$/.test(tok) ||
      /^[a-z]{1,4}\d{2,}/.test(tok) ||
      /^\d{2,}[a-z]{1,4}/.test(tok);
    const weight = isModel ? 3 : 1;
    totalWeight += weight;
    if (tSet.has(tok) || t.includes(tok)) {
      score += weight;
    }
  }

  return Math.round((score / totalWeight) * 90);
}

// Value-based landed cost allocation: distribute freight/insurance/customs/brokerage
// proportionally by each item's share of the invoice subtotal
function allocateLandedCosts(
  items: Array<{ costPrice: number; qty: number }>,
  totals: { freightShipping?: number; insurance?: number; customsTariffs?: number; brokerageFees?: number } | undefined
): number[] {
  if (!totals) return items.map(() => 0);
  const totalSurcharge = (totals.freightShipping ?? 0) + (totals.insurance ?? 0) + (totals.customsTariffs ?? 0) + (totals.brokerageFees ?? 0);
  if (totalSurcharge <= 0) return items.map(() => 0);
  const invoiceValue = items.reduce((sum, it) => sum + it.costPrice * it.qty, 0);
  if (invoiceValue <= 0) return items.map(() => 0);
  return items.map((it) => {
    const share = (it.costPrice * it.qty) / invoiceValue;
    return parseFloat(((share * totalSurcharge) / Math.max(it.qty, 1)).toFixed(4));
  });
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    type SyncOverride = { variantId: string; inventoryItemId: string; productTitle: string };
    const { poId, dryRun, overrides } = (await req.json()) as {
      poId: string;
      dryRun?: boolean;
      overrides?: Record<string, SyncOverride>;
    };

    if (!poId) return NextResponse.json({ error: "poId is required" }, { status: 400 });

    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Shopify credentials not configured" }, { status: 500 });
    }

    // Fetch PO
    const poRef = adminDb.collection("purchaseOrders").doc(poId);
    const poSnap = await poRef.get();
    if (!poSnap.exists) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const po = poSnap.data() as PurchaseOrder;
    if (po.merchantId && po.merchantId !== merchantId) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    // ── Idempotency guard — reject re-sync on already-approved POs ──────
    if (!dryRun && po.status === "approved" && po.syncResult) {
      return NextResponse.json({
        ...po.syncResult,
        dryRun: false,
        idempotent: true,
        message: "This PO was already synced successfully. No changes made.",
      });
    }

    // ── Duplicate invoice detection ──────────────────────────────────────
    if (po.invoiceNumber) {
      const dupSnap = await adminDb.collection("purchaseOrders")
        .where("merchantId", "==", merchantId)
        .where("invoiceNumber", "==", po.invoiceNumber)
        .where("supplier", "==", po.supplier)
        .where("status", "==", "approved")
        .get();
      const existing = dupSnap.docs.find((d) => d.id !== poId);
      if (existing) {
        const existingData = existing.data() as PurchaseOrder;
        return NextResponse.json({
          duplicateInvoice: {
            detectedAt: existingData.updatedAt,
            originalPoId: existing.id,
          },
          error: `Duplicate invoice: ${po.invoiceNumber} from ${po.supplier} was already synced on ${existingData.updatedAt}.`,
        }, { status: 409 });
      }
    }

    // Resolve location GID
    const rawLocationId = po.location === "In-Store Fitzgerald St"
      ? process.env.SHOPIFY_LOCATION_ID_STORE
      : process.env.SHOPIFY_LOCATION_ID_WAREHOUSE;
    const locationGid = toLocationGid(rawLocationId);
    if (!locationGid) {
      return NextResponse.json({ error: `Shopify location ID not configured for "${po.location}".` }, { status: 500 });
    }

    // ── Location preflight check (best-effort — skip if token lacks read_locations scope) ──
    const locStatus = await checkLocation(locationGid);
    if (locStatus.isActive === false && locStatus.checked === true) {
      return NextResponse.json({
        error: `Location "${po.location}" is inactive or archived in Shopify. Activate it before syncing.`,
        locationInactive: true,
      }, { status: 400 });
    }

    // referenceDocumentUri for audit trail
    const referenceDocumentUri = `gid://pitstop/Invoice/${po.invoiceNumber || poId}`;

    // Exchange rate: 1 foreign currency = exchangeRate AUD
    const exchangeRate = (po.currency && po.currency !== "AUD" && po.exchangeRate && po.exchangeRate > 0)
      ? po.exchangeRate
      : 1;

    // ── MATCHING PHASE — process items in parallel (max 5 concurrent Shopify calls) ──
    const visibleItems = po.lineItems.filter((li) => !li.hidden);

    const matchItem = async (item: typeof visibleItems[0]): Promise<LineSyncResult> => {
      const result: LineSyncResult = {
        lineItemId: item.id,
        sku: item.sku,
        name: item.name,
        status: "not_found",
      };
      try {
        const override = overrides?.[item.id];
        if (override) {
          result.shopifyVariantId = override.variantId;
          result.inventoryItemId = override.inventoryItemId;
          result.shopifyProductTitle = override.productTitle;
          if (!dryRun) {
            if (item.sku) await saveMapping(merchantId, po.supplier, item.sku, override);
            if (item.barcode) await saveMapping(merchantId, po.supplier, item.barcode, override);
            if (item.name) await saveNameMapping(merchantId, po.supplier, item.name, override);
          }
        } else if (!item.sku) {
          result.errorMessage = "No SKU/barcode on this line item";
          if (dryRun && item.name) {
            result.suggestions = await enrichedTitleSearch(item.name, item.optionValues);
          }
        } else {
          const skuMapping = await lookupMapping(merchantId, po.supplier, item.sku);
          const barcodeMapping = !skuMapping && item.barcode
            ? await lookupMapping(merchantId, po.supplier, item.barcode)
            : null;
          const knownMatch = skuMapping ?? barcodeMapping;

          if (knownMatch) {
            result.shopifyVariantId = knownMatch.variantId;
            result.inventoryItemId = knownMatch.inventoryItemId;
            result.shopifyProductTitle = knownMatch.productTitle;
            result.matchedFromCache = true;
          } else {
            // Check name-based learned mapping before hitting Shopify
            const nameMatch = item.name
              ? await lookupNameMapping(merchantId, po.supplier, item.name)
              : null;

            if (nameMatch) {
              result.shopifyVariantId = nameMatch.variantId;
              result.inventoryItemId = nameMatch.inventoryItemId;
              result.shopifyProductTitle = nameMatch.productTitle;
              result.matchedFromCache = true;
            } else {
              let variant = await findVariantBySku(item.sku, dryRun ? locationGid : undefined);
              if (!variant && item.barcode) {
                variant = await findVariantBySku(item.barcode, dryRun ? locationGid : undefined);
              }
              if (variant) {
                result.shopifyVariantId = variant.id;
                result.inventoryItemId = variant.inventoryItem.id;
                result.shopifyProductTitle = variant.product?.title;
                if (variant.price) result.shopifyPrice = parseFloat(variant.price);
                const firstCollection = variant.product?.collections?.edges?.[0]?.node?.title;
                result.shopifyCategory = firstCollection || variant.product?.productType || "";
                const missing: { field: string; suggestedValue: string }[] = [];
                if (!variant.sku && item.sku) missing.push({ field: "sku", suggestedValue: item.sku });
                if (!variant.barcode && item.barcode) missing.push({ field: "barcode", suggestedValue: item.barcode });
                else if (!variant.barcode && item.sku) missing.push({ field: "barcode", suggestedValue: item.sku });
                if (missing.length > 0) result.shopifyMissingFields = missing;
                if (!dryRun) {
                  const matchData = { variantId: variant.id, inventoryItemId: variant.inventoryItem.id, productTitle: variant.product?.title ?? "" };
                  if (item.sku) await saveMapping(merchantId, po.supplier, item.sku, matchData);
                  if (item.barcode) await saveMapping(merchantId, po.supplier, item.barcode, matchData);
                  if (item.name) await saveNameMapping(merchantId, po.supplier, item.name, matchData).catch(() => {});
                }
              } else if (dryRun) {
                result.suggestions = await enrichedTitleSearch(item.name, item.optionValues);
              }
            }
          }
        }
      } catch (err) {
        result.status = "error";
        result.errorMessage = err instanceof Error ? err.message : "Unknown error";
      }
      return result;
    }

    // Run in batches of 5 to respect Shopify GraphQL rate limits
    const CONCURRENCY = 5;
    const results: LineSyncResult[] = [];
    for (let i = 0; i < visibleItems.length; i += CONCURRENCY) {
      const batch = visibleItems.slice(i, i + CONCURRENCY);
      results.push(...await Promise.all(batch.map(matchItem)));
    }

    // ── FETCH CURRENT INVENTORY LEVELS + COSTS ───────────────────────────
    const matchedResults = results.filter((r) => r.inventoryItemId);
    const inventoryItemIds = Array.from(new Set(matchedResults.map((r) => r.inventoryItemId!)));

    const levelMap = new Map<string, { onHandQty: number; unitCost: number | null; tracked: boolean }>();
    if (inventoryItemIds.length > 0) {
      const levels = await fetchInventoryLevels(inventoryItemIds, locationGid);
      for (const l of levels) {
        levelMap.set(l.inventoryItemId, { onHandQty: l.onHandQty, unitCost: l.unitCost, tracked: l.tracked });
      }
    }

    // ── LANDED COST ALLOCATION (value-based, exchange-rate adjusted) ────────
    const matchedItems = visibleItems.filter((item) =>
      results.find((r) => r.lineItemId === item.id && r.inventoryItemId)
    );
    const landedCostAllocations = allocateLandedCosts(
      matchedItems.map((it) => ({ costPrice: it.costPrice * exchangeRate, qty: it.qty })),
      po.invoiceTotals
    );
    const landedCostMap = new Map<string, number>();
    matchedItems.forEach((item, idx) => {
      landedCostMap.set(item.id, landedCostAllocations[idx] ?? 0);
    });

    // ── ENRICH RESULTS with qty, cost drift, landed cost ─────────────────
    for (const result of results) {
      if (!result.inventoryItemId) continue;
      const level = levelMap.get(result.inventoryItemId);
      const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
      if (level !== undefined) {
        result.currentQty = level.onHandQty;
        result.initialQty = level.onHandQty;
        if (!level.tracked) result.untrackedInventory = true;
      }
      const allocation = landedCostMap.get(result.lineItemId) ?? 0;
      const adjustedCost = (lineItem?.costPrice ?? 0) * exchangeRate;
      if (allocation > 0 || lineItem) {
        result.landedCost = adjustedCost + allocation;
      }

      // Record per-variant prior cost and applied cost for audit trail; newAvgCost set in product-level step below
      const existingCost = level?.unitCost ?? null;
      result.previousUnitCost = existingCost ?? undefined;
      result.appliedUnitCost = result.landedCost ?? undefined;

      // Cost drift: compare AUD-adjusted parsed cost vs Shopify unitCost
      if (level?.unitCost != null && lineItem && lineItem.costPrice > 0) {
        const pctChange = ((adjustedCost - level.unitCost) / level.unitCost) * 100;
        if (Math.abs(pctChange) >= 15) {
          result.costDrift = {
            historicalCost: level.unitCost,
            parsedCost: adjustedCost,
            pctChange: parseFloat(pctChange.toFixed(1)),
          };
        }
      }
    }

    // ── PER-VARIANT AVERAGE COST COMPUTATION ─────────────────────────────
    // Each variant (e.g. KASK White / S) averages ONLY with its own existing
    // stock — never with sibling variants. Runs in both dry-run and real sync.
    // Builds costSnapshot (inventoryItemId → previous cost) for reversal on delete.
    const costSnapshot: Record<string, number> = {};

    for (const result of results) {
      if (!result.inventoryItemId || !result.landedCost || result.landedCost <= 0) continue;
      const level = levelMap.get(result.inventoryItemId);
      const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
      const existingQty = level?.onHandQty ?? 0;
      const existingCost = level?.unitCost ?? 0;
      const incomingQty = lineItem?.qty ?? 0;
      const incomingCost = result.landedCost;

      let pushed: number;
      if (existingQty > 0 && existingCost > 0 && existingQty + incomingQty > 0) {
        // Quantity-weighted moving average against THIS variant's own stock
        pushed = (existingQty * existingCost + incomingQty * incomingCost) / (existingQty + incomingQty);
      } else if (existingCost > 0) {
        // Stock 0 / negative but a cost is on record → average the two prices
        pushed = (existingCost + incomingCost) / 2;
      } else {
        // No existing cost recorded → use the invoice price
        pushed = incomingCost;
      }
      result.newAvgCost = parseFloat(pushed.toFixed(4));
      costSnapshot[result.inventoryItemId] = existingCost; // prior cost for exact reversal
    }

    // ── DRY RUN — return preview without writing ──────────────────────────
    if (dryRun) {
      for (const result of results) {
        if (result.inventoryItemId && result.status === "not_found") {
          result.status = "synced";
          const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
          result.delta = lineItem?.qty ?? 0;
        }
      }
      return NextResponse.json({
        syncedAt: new Date().toISOString(),
        results,
        successCount: results.filter((r) => r.status === "synced").length,
        notFoundCount: results.filter((r) => r.status === "not_found").length,
        errorCount: results.filter((r) => r.status === "error").length,
        dryRun: true,
      });
    }

    // ── ACTUAL SYNC — inventorySetQuantities batch ────────────────────────
    const batchItems: Array<{ inventoryItemId: string; quantity: number; changeFromQuantity: number; lineItemId: string }> = [];

    for (const result of results) {
      if (!result.inventoryItemId) continue;
      const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
      if (!lineItem) continue;
      const initialQty = levelMap.get(result.inventoryItemId)?.onHandQty ?? 0;
      batchItems.push({
        inventoryItemId: result.inventoryItemId,
        quantity: initialQty + lineItem.qty,
        changeFromQuantity: initialQty,
        lineItemId: result.lineItemId,
      });
    }

    const { userErrors, groupId } = await batchSetInventory(
      batchItems.map(({ inventoryItemId, quantity, changeFromQuantity }) => ({ inventoryItemId, quantity, changeFromQuantity })),
      locationGid,
      referenceDocumentUri
    );

    // Map errors back to line items
    if (userErrors.length > 0) {
      // Check for concurrency conflict (changeFromQuantity mismatch)
      const isConcurrencyError = userErrors.some(
        (e) => e.code === "INVALID" || e.message.toLowerCase().includes("quantity")
      );
      if (isConcurrencyError) {
        // Re-fetch current levels for conflict resolution UI
        const freshLevels = await fetchInventoryLevels(inventoryItemIds, locationGid);
        for (const fresh of freshLevels) {
          const affectedResult = results.find((r) => r.inventoryItemId === fresh.inventoryItemId);
          const batchItem = batchItems.find((b) => b.inventoryItemId === fresh.inventoryItemId);
          if (affectedResult && batchItem) {
            const lineItem = visibleItems.find((li) => li.id === affectedResult.lineItemId);
            affectedResult.conflictError = {
              expectedQty: batchItem.changeFromQuantity,
              actualQty: fresh.onHandQty,
              suggestedQty: fresh.onHandQty + (lineItem?.qty ?? 0),
            };
            affectedResult.status = "error";
            affectedResult.errorMessage = `Inventory changed during review (expected ${batchItem.changeFromQuantity}, found ${fresh.onHandQty})`;
          }
        }
      } else {
        for (const result of results) {
          if (result.inventoryItemId) {
            result.status = "error";
            result.errorMessage = userErrors.map((e) => e.message).join("; ");
          }
        }
      }
    } else {
      // Success — mark all as synced
      for (const result of results) {
        if (!result.inventoryItemId) continue;
        const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
        result.status = "synced";
        result.delta = lineItem?.qty ?? 0;
      }

      // ── Per-variant cost write: each variant gets its own averaged cost ──
      await Promise.allSettled(
        results
          .filter((r) => r.inventoryItemId && r.newAvgCost && r.newAvgCost > 0)
          .map((r) => updateInventoryItemCost(r.inventoryItemId!, r.newAvgCost!))
      );
    }

    const syncResult: SyncResult = {
      syncedAt: new Date().toISOString(),
      results,
      successCount: results.filter((r) => r.status === "synced").length,
      notFoundCount: results.filter((r) => r.status === "not_found").length,
      errorCount: results.filter((r) => r.status === "error").length,
    };

    const newStatus = syncResult.errorCount === 0 ? "approved" : "awaiting_review";
    await poRef.update({
      status: newStatus,
      syncResult,
      costSnapshot,
      updatedAt: new Date().toISOString(),
    });

    // ── Write audit log ──────────────────────────────────────────────────
    if (syncResult.successCount > 0) {
      const auditLog: AuditLog = {
        id: `${poId}_${Date.now()}`,
        merchantId,
        poId,
        supplier: po.supplier,
        invoiceNumber: po.invoiceNumber,
        location: po.location,
        syncedAt: syncResult.syncedAt,
        successCount: syncResult.successCount,
        notFoundCount: syncResult.notFoundCount,
        errorCount: syncResult.errorCount,
        referenceDocumentUri,
        items: results.map((r) => ({
          name: r.name,
          sku: r.sku,
          status: r.status,
          delta: r.delta,
          landedCost: r.landedCost,
        })),
      };
      await adminDb.collection("auditLogs").doc(auditLog.id).set(auditLog).catch(() => {});
    }

    return NextResponse.json({ ...syncResult, dryRun: false, auditGroupId: groupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
