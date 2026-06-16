"use client";

import { useEffect, useState } from "react";
import type { PriceGroup } from "@/app/api/shopify/price-audit/route";
import { apiFetch } from "@/lib/apiClient";
import type { ShopifyProduct } from "@/lib/types";
import { loadCatalog } from "@/lib/catalogCache";
import FeedbackChat from "@/components/FeedbackChat";
import BackButton from "@/components/BackButton";

const AUDIT_CHAT_CONTEXT = `The user is talking about the Price Audit feature in PitStop — an internal ops tool for Elite Racing Cycles, a bike shop in Perth with 10 staff and 5 per shift.

The Price Audit feature currently:
- Scans all Shopify products (paginated, 250 at a time)
- Groups products by normalised title (lowercased, trimmed)
- Finds groups with 2+ listings where prices differ (spread > $0)
- Shows: min price, max price, spread, suggested average
- Handles $0-priced items separately: excludes them from average, offers "Fix price" button to set only the $0 listings to the non-zero average
- Sorts results by spread descending (biggest discrepancies first)
- Applies prices via Shopify productVariantUpdate mutation

The user now wants to define ADDITIONAL things to audit beyond price inconsistencies. Your job is to ask 3-5 questions to understand exactly what other audit checks they want (e.g. missing images, missing SKUs, $0 prices across the whole catalogue, products with no description, duplicate barcodes, etc.), then generate a brief to send to Romain.`;

type PriceStrategy = "avg" | "min" | "max";

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

function SpreadBadge({ spread }: { spread: number }) {
  const color =
    spread > 20
      ? "text-status-shortage"
      : spread > 5
      ? "text-status-drift"
      : "text-text-secondary";
  return <span className={`font-mono tabular-nums ${color}`}>{fmt(spread)}</span>;
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

type HealthIssue = { variantId: string; productTitle: string; variantTitle: string; sku: string; barcode: string; issues: string[] };

export default function PriceAuditPage() {
  const [activeTab, setActiveTab] = useState<"prices" | "health">("prices");
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<PriceGroup[] | null>(null);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [stats, setStats] = useState<{ totalProducts: number; totalGroups: number } | null>(null);
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [priceStrategy, setPriceStrategy] = useState<PriceStrategy>("avg");

  useEffect(() => {
    setHealthLoading(true);
    const computeIssues = (products: ShopifyProduct[]) => {
      const issues: HealthIssue[] = [];
      for (const p of products) {
        const flags: string[] = [];
        if (!p.sku) flags.push("Missing SKU");
        if (!p.barcode) flags.push("Missing barcode");
        if (p.price === 0) flags.push("$0 retail price");
        if (!p.compareAtPrice) flags.push("No compare-at price");
        if (!p.productType) flags.push("No collection");
        if (p.unitCost == null) flags.push("No cost price");
        if (flags.length > 0) {
          issues.push({
            variantId: p.variantId,
            productTitle: p.productTitle,
            variantTitle: p.variantTitle || "",
            sku: p.sku || "",
            barcode: p.barcode || "",
            issues: flags,
          });
        }
      }
      setHealthIssues(issues);
    };
    loadCatalog(false, computeIssues)
      .then(computeIssues)
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, []);

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setGroups(null);
    setStats(null);
    setApplying(new Set());
    setApplied(new Set());

    try {
      const res = await apiFetch("/api/shopify/price-audit");
      const data = await res.json();

      if (!res.ok) {
        setScanError(data.error ?? "Scan failed");
        return;
      }

      setGroups(data.groups);
      setStats({ totalProducts: data.totalProducts, totalGroups: data.totalGroups });
    } catch {
      setScanError("Network error — could not reach the server.");
    } finally {
      setScanning(false);
    }
  }

  function getTargetPrice(group: PriceGroup, fixZeroOnly: boolean): number {
    if (fixZeroOnly) return group.nonZeroAvgPrice;
    if (priceStrategy === "min") return group.minPrice;
    if (priceStrategy === "max") return group.maxPrice;
    return group.avgPrice;
  }

  async function handleApply(group: PriceGroup, fixZeroOnly = false) {
    const key = group.normalizedTitle;
    setApplying((prev) => new Set(prev).add(key));

    try {
      const targetPrice = getTargetPrice(group, fixZeroOnly);
      const updates = group.products
        .filter((p) => (fixZeroOnly ? p.price === 0 : true))
        .map((p) => ({ variantId: p.variantId, price: targetPrice }));

      const res = await apiFetch("/api/shopify/price-audit/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      const data = await res.json();

      if (!res.ok || (data.errors && data.errors.length > 0)) {
        const errMsg = data.errors?.join("\n") ?? data.error ?? "Update failed";
        alert(`Some updates failed:\n${errMsg}`);
      }

      setApplied((prev) => new Set(prev).add(key));
    } catch {
      alert("Network error — could not apply prices.");
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const strategyLabel = (s: PriceStrategy, group: PriceGroup) => {
    if (s === "min") return fmt(group.minPrice);
    if (s === "max") return fmt(group.maxPrice);
    return fmt(group.avgPrice);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl">
      <div className="mb-4"><BackButton /></div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-1">Catalogue Audit</h1>
          <p className="text-text-secondary text-sm font-mono">Price consistency and data health checks.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FeedbackChat context={AUDIT_CHAT_CONTEXT} buttonLabel="Help · Feedback" />
          {activeTab === "prices" && (
            <button
              onClick={handleScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-40 text-white text-sm font-medium px-4 py-2 border border-accent transition-colors"
            >
              {scanning && <Spinner />}
              {scanning ? "Scanning…" : "Scan Catalogue"}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-border-0">
        {(["prices", "health"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {tab === "prices" ? "Price Consistency" : (
              <span className="flex items-center gap-1.5">
                Catalogue Health
                {healthIssues.length > 0 && (
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-0.5"
                    style={{
                      color: "var(--ps-status-drift)",
                      backgroundColor: "rgba(234,179,8,0.12)",
                      border: "1px solid rgba(234,179,8,0.35)",
                    }}
                  >
                    {healthIssues.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Catalogue Health Tab ── */}
      {activeTab === "health" && (
        healthLoading ? (
          <div className="flex items-center gap-3 text-text-tertiary py-16 justify-center font-mono text-sm">
            <div className="w-4 h-4 border border-border-2 border-t-accent rounded-full animate-spin" />
            Checking catalogue health…
          </div>
        ) : healthIssues.length === 0 ? (
          <div className="text-center py-24 bg-surface-1 border border-border-0">
            <div className="text-4xl mb-3">✓</div>
            <p className="text-text-primary font-medium">Catalogue is clean</p>
            <p className="text-text-tertiary text-sm mt-1 font-mono">All products have SKUs, barcodes, prices, and collections.</p>
          </div>
        ) : (
          <div className="bg-surface-1 border border-border-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-border-0 text-sm text-text-secondary font-mono">
              <span className="font-semibold text-text-primary">{healthIssues.length}</span> variants with missing data
              <span className="text-text-tertiary mx-2">·</span>
              <span className="text-xs text-text-tertiary">Sync catalogue first for up-to-date data</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border-0 bg-surface-2">
                    <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Product</th>
                    <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">SKU</th>
                    <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {healthIssues.map((item) => (
                    <tr key={item.variantId} className="border-b border-border-0 last:border-0 hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-text-primary">{item.productTitle}</p>
                        {item.variantTitle && <p className="text-xs text-text-tertiary mt-0.5">{item.variantTitle}</p>}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-text-secondary">
                        {item.sku || <span className="text-status-shortage">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.issues.map((issue) => (
                            <span
                              key={issue}
                              className="text-[11px] font-mono font-medium px-2 py-0.5"
                              style={{
                                color: "var(--ps-status-drift)",
                                backgroundColor: "rgba(234,179,8,0.08)",
                                border: "1px solid rgba(234,179,8,0.25)",
                              }}
                            >
                              {issue}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Price Consistency Tab ── */}
      {activeTab === "prices" && (
        <>
          {scanError && (
            <div className="mb-6 p-3 border-l-2 border-status-shortage bg-[rgba(239,68,68,0.08)] text-status-shortage text-sm font-mono">
              {scanError}
            </div>
          )}

          {stats !== null && (
            <div className="mb-4 text-sm text-text-secondary font-mono flex items-center gap-3 flex-wrap">
              <span><span className="text-text-primary font-semibold">{stats.totalProducts}</span> products scanned</span>
              <span className="text-text-tertiary">·</span>
              <span><span className="text-text-primary font-semibold">{stats.totalGroups}</span> groups with price irregularities</span>
            </div>
          )}

          {/* Price strategy selector — shown once scan has results */}
          {groups !== null && groups.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-text-tertiary font-mono uppercase tracking-widest">Apply as</span>
              <div className="flex border border-border-1">
                {(["min", "avg", "max"] as PriceStrategy[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPriceStrategy(s)}
                    className={[
                      "px-3 py-1 text-xs font-mono uppercase tracking-widest transition-colors",
                      priceStrategy === s
                        ? "bg-accent text-white"
                        : "bg-surface-2 text-text-tertiary hover:text-text-secondary",
                    ].join(" ")}
                  >
                    {s === "min" ? "Min" : s === "max" ? "Max" : "Avg"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-text-tertiary font-mono">
                {priceStrategy === "min" && "Set all to the lowest price in the group"}
                {priceStrategy === "avg" && "Set all to the average price in the group"}
                {priceStrategy === "max" && "Set all to the highest price in the group"}
              </span>
            </div>
          )}

          {groups !== null && (
            <div className="bg-surface-1 border border-border-0 overflow-hidden">
              {groups.length === 0 ? (
                <div className="p-12 text-center text-text-tertiary text-sm font-mono">
                  No price irregularities found — catalogue looks consistent.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-border-0 bg-surface-2">
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Product Title</th>
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Listings</th>
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Min</th>
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Max</th>
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">Spread</th>
                        <th className="px-5 py-3 text-[11px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">
                          {priceStrategy === "min" ? "Min (target)" : priceStrategy === "max" ? "Max (target)" : "Avg (target)"}
                        </th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => {
                        const key = group.normalizedTitle;
                        const isApplying = applying.has(key);
                        const isApplied = applied.has(key);
                        return (
                          <tr
                            key={key}
                            className={[
                              "border-b border-border-0 transition-colors hover:bg-surface-2",
                              isApplied ? "bg-[rgba(34,197,94,0.06)]" : "",
                            ].join(" ")}
                          >
                            <td className="px-5 py-3 max-w-xs truncate font-medium text-text-primary">
                              {group.products[0]?.title ?? group.normalizedTitle}
                            </td>
                            <td className="px-5 py-3 text-text-secondary font-mono tabular-nums">{group.products.length}</td>
                            <td className="px-5 py-3 text-text-secondary font-mono tabular-nums">{fmt(group.minPrice)}</td>
                            <td className="px-5 py-3 text-text-secondary font-mono tabular-nums">{fmt(group.maxPrice)}</td>
                            <td className="px-5 py-3"><SpreadBadge spread={group.spread} /></td>
                            <td className="px-5 py-3 font-mono font-bold text-text-primary tabular-nums">
                              {group.hasZeroPrices ? fmt(group.nonZeroAvgPrice) : strategyLabel(priceStrategy, group)}
                              {group.hasZeroPrices && (
                                <span className="ml-1.5 text-[10px] font-normal text-status-drift uppercase tracking-wide">excl. $0</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {isApplied ? (
                                <span className="inline-flex items-center gap-1.5 text-status-match text-xs font-mono font-semibold">
                                  ✓ Applied
                                </span>
                              ) : group.hasZeroPrices ? (
                                <button
                                  onClick={() => handleApply(group, true)}
                                  disabled={isApplying}
                                  className="inline-flex items-center gap-1.5 bg-status-drift/10 hover:bg-status-drift/20 border border-status-drift/30 text-status-drift disabled:opacity-40 text-xs font-mono font-medium px-3 py-1.5 transition-colors"
                                >
                                  {isApplying && <Spinner />}
                                  {isApplying ? "Fixing…" : "Fix $0 prices"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleApply(group, false)}
                                  disabled={isApplying}
                                  className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-dim border border-accent disabled:opacity-40 text-white text-xs font-mono font-medium px-3 py-1.5 transition-colors"
                                >
                                  {isApplying && <Spinner />}
                                  {isApplying ? "Applying…" : `Apply ${priceStrategy}`}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
