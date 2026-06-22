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
  getPrimaryLocationGid,
  activateInventoryItems,
} from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
import { lookupMapping, saveMapping, lookupNameMapping, saveNameMapping } from "@/lib/adminMappings";
import type { AuditLog, PurchaseOrder, LineSyncResult, SyncResult, VariantSuggestion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  shop: string,
  name: string,
  optionValues?: Array<{ optionName: string; optionValue: string }>
): Promise<VariantSuggestion[]> {
  const modelTokens = extractModelTokens(name);
  const brand = extractBrandToken(name);
  const optionModel = modelOptionTokens(optionValues);

  const searchTerms: string[] = [];

  searchTerms.push(name);

  for (const m of modelTokens) {
    if (brand) searchTerms.push(`${brand} ${m}`);
    searchTerms.push(m);
  }

  if (optionModel) {
    if (brand) searchTerms.push(`${brand} ${optionModel}`);
    searchTerms.push(optionModel);
  }

  const uniqueTerms = Array.from(new Set(searchTerms)).slice(0, 6);

  const results = await Promise.allSettled(
    uniqueTerms.map((term) => {
      if (term === name) return searchVariantsByTitle(shop, term);
      return fetchVariantsByQuery(shop, `title:${term}`);
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
    const shop = await requireShop(req);
    if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const merchantId = shop;

    type SyncOverride = { variantId: string; inventoryItemId: string; productTitle: string };
    const { poId, dryRun, overrides } = (await req.json()) as {
      poId: string;
      dryRun?: boolean;
      overrides?: Record<string, SyncOverride>;
    };

    if (!poId) return NextResponse.json({ error: "poId is required" }, { status: 400 });

    // Fetch PO
    const poRef = adminDb.collection("purchaseOrders").doc(poId);
    const poSnap = await poRef.get();
    if (!poSnap.exists) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const po = poSnap.data() as PurchaseOrder;
    if (po.merchantId && po.merchantId !== merchantId) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    // ── Idempotency guard ──────────────────────────────────────────────────
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

    // Resolve location GID from this shop's primary active location
    const locationGid = await getPrimaryLocationGid(shop);
    if (!locationGid) {
      return NextResponse.json({ error: "No active location found for this shop." }, { status: 500 });
    }

    // ── Location preflight check ──────────────────────────────────────────
    const locStatus = await checkLocation(shop, locationGid);
    if (locStatus.isActive === false && locStatus.checked === true) {
      return NextResponse.json({
        error: `The primary location is inactive or archived in Shopify. Activate it before syncing.`,
        locationInactive: true,
      }, { status: 400 });
    }

    const referenceDocumentUri = `gid://pitstop/Invoice/${po.invoiceNumber || poId}`;

    const exchangeRate = (po.currency && po.currency !== "AUD" && po.exchangeRate && po.exchangeRate > 0)
      ? po.exchangeRate
      : 1;

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
            result.suggestions = await enrichedTitleSearch(shop, item.name, item.optionValues);
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
            const nameMatch = item.name
              ? await lookupNameMapping(merchantId, po.supplier, item.name)
              : null;

            if (nameMatch) {
              result.shopifyVariantId = nameMatch.variantId;
              result.inventoryItemId = nameMatch.inventoryItemId;
              result.shopifyProductTitle = nameMatch.productTitle;
              result.matchedFromCache = true;
            } else {
              let variant = await findVariantBySku(shop, item.sku, dryRun ? locationGid : undefined);
              if (!variant && item.barcode) {
                variant = await findVariantBySku(shop, item.barcode, dryRun ? locationGid : undefined);
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
                result.suggestions = await enrichedTitleSearch(shop, item.name, item.optionValues);
              }
            }
          }
        }
      } catch (err) {
        result.status = "error";
        result.errorMessage = err instanceof Error ? err.message : "Unknown error";
      }
      return result;
    };

    const CONCURRENCY = 5;
    const results: LineSyncResult[] = [];
    for (let i = 0; i < visibleItems.length; i += CONCURRENCY) {
      const batch = visibleItems.slice(i, i + CONCURRENCY);
      results.push(...await Promise.all(batch.map(matchItem)));
    }

    const matchedResults = results.filter((r) => r.inventoryItemId);
    const inventoryItemIds = Array.from(new Set(matchedResults.map((r) => r.inventoryItemId!)));

    const levelMap = new Map<string, { onHandQty: number; unitCost: number | null; tracked: boolean; stocked: boolean }>();
    if (inventoryItemIds.length > 0) {
      const levels = await fetchInventoryLevels(shop, inventoryItemIds, locationGid);
      for (const l of levels) {
        levelMap.set(l.inventoryItemId, { onHandQty: l.onHandQty, unitCost: l.unitCost, tracked: l.tracked, stocked: l.stocked });
      }
    }

    // Allocate the surcharge across ALL invoice lines (correct denominator),
    // then apply only matched lines' shares below. Allocating over matched-only
    // lines over-loads each matched unit's landed cost when some lines are unmatched.
    const landedCostAllocations = allocateLandedCosts(
      visibleItems.map((it) => ({ costPrice: it.costPrice * exchangeRate, qty: it.qty })),
      po.invoiceTotals
    );
    const landedCostMap = new Map<string, number>();
    visibleItems.forEach((item, idx) => {
      landedCostMap.set(item.id, landedCostAllocations[idx] ?? 0);
    });

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

      const existingCost = level?.unitCost ?? null;
      result.previousUnitCost = existingCost ?? undefined;
      result.appliedUnitCost = result.landedCost ?? undefined;

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
        pushed = (existingQty * existingCost + incomingQty * incomingCost) / (existingQty + incomingQty);
      } else if (existingCost > 0) {
        pushed = (existingCost + incomingCost) / 2;
      } else {
        pushed = incomingCost;
      }
      result.newAvgCost = parseFloat(pushed.toFixed(4));
      costSnapshot[result.inventoryItemId] = existingCost;
    }

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

    // Lines already written to Shopify by a PREVIOUS (partial) sync must NOT be
    // re-applied — otherwise re-syncing the remaining failed lines double-counts
    // every previously-synced line (the guard above only covers fully-approved POs).
    const priorSyncedIds = new Set(
      ((po.syncResult && po.syncResult.results) || [])
        .filter((r) => r.status === "synced")
        .map((r) => r.lineItemId)
    );
    const batchItems: Array<{ inventoryItemId: string; quantity: number; changeFromQuantity: number; lineItemId: string }> = [];

    for (const result of results) {
      if (!result.inventoryItemId) continue;
      if (priorSyncedIds.has(result.lineItemId)) {
        result.status = "synced";
        result.delta = 0;
        continue;
      }
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

    // Defensive: collapse any duplicate inventory items (distinct lines that
    // resolved to the same variant) — inventorySetQuantities rejects a batch with
    // a repeated (inventoryItemId, locationId) pair ("must be unique").
    const mergedById = new Map<string, { inventoryItemId: string; quantity: number; changeFromQuantity: number }>();
    for (const b of batchItems) {
      const ex = mergedById.get(b.inventoryItemId);
      if (ex) ex.quantity += b.quantity - b.changeFromQuantity;
      else mergedById.set(b.inventoryItemId, { inventoryItemId: b.inventoryItemId, quantity: b.quantity, changeFromQuantity: b.changeFromQuantity });
    }
    const writeItems = Array.from(mergedById.values());
    if (writeItems.length < batchItems.length) {
      console.warn(`[sync] merged ${batchItems.length - writeItems.length} duplicate inventory item(s) before write`);
    }

    // Stock any item not yet present at this location, otherwise inventorySetQuantities
    // fails with "The specified inventory item is not stocked at the location."
    const notStocked = writeItems
      .map((b) => b.inventoryItemId)
      .filter((id) => !levelMap.get(id)?.stocked);
    if (notStocked.length > 0) {
      await activateInventoryItems(shop, notStocked, locationGid);
    }

    const { userErrors, groupId } = await batchSetInventory(
      shop,
      writeItems,
      locationGid,
      referenceDocumentUri
    );

    if (userErrors.length > 0) {
      const isConcurrencyError = userErrors.some(
        (e) => e.code === "INVALID" || e.message.toLowerCase().includes("quantity")
      );
      if (isConcurrencyError) {
        const freshLevels = await fetchInventoryLevels(shop, inventoryItemIds, locationGid);
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
          if (result.inventoryItemId && !priorSyncedIds.has(result.lineItemId)) {
            result.status = "error";
            result.errorMessage = userErrors.map((e) => e.message).join("; ");
          }
        }
      }
    } else {
      for (const result of results) {
        if (!result.inventoryItemId || priorSyncedIds.has(result.lineItemId)) continue;
        const lineItem = visibleItems.find((li) => li.id === result.lineItemId);
        result.status = "synced";
        result.delta = lineItem?.qty ?? 0;
      }

      await Promise.allSettled(
        results
          .filter((r) => r.inventoryItemId && r.newAvgCost && r.newAvgCost > 0 && !priorSyncedIds.has(r.lineItemId))
          .map((r) => updateInventoryItemCost(shop, r.inventoryItemId!, r.newAvgCost!))
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
