"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog } from "@/lib/catalogCache";
import type { ShopifyProduct } from "@/lib/types";
import type { TransferItem, TransferLocation, TransferRecord } from "@/app/api/shopify/transfers/route";

type Tab = "new" | "history";

const LOCATIONS: TransferLocation[] = ["In-Store Fitzgerald St", "Warehouse"];

interface DraftItem {
  inventoryItemId: string;
  sku: string;
  name: string;
  variantTitle: string;
  qty: number;
  onHandFrom: number;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function TransfersPage() {
  const [tab, setTab] = useState<Tab>("new");

  // Catalog
  const [catalog, setCatalog] = useState<ShopifyProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  // New transfer form
  const [fromLocation, setFromLocation] = useState<TransferLocation>("Warehouse");
  const [toLocation, setToLocation] = useState<TransferLocation>("In-Store Fitzgerald St");
  const [search, setSearch] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string } | null>(null);

  // History
  const [history, setHistory] = useState<TransferRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCatalog(false, setCatalog).then((prods) => {
      setCatalog(prods);
      setCatalogLoading(false);
    });
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/shopify/transfers");
      const data = await res.json() as TransferRecord[];
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  // Swap locations
  const swapLocations = () => {
    setFromLocation(toLocation);
    setToLocation(fromLocation);
    // Recalculate onHand for draft items after swap
    setDraftItems((prev) =>
      prev.map((item) => {
        const prod = catalog.find((p) => p.inventoryItemId === item.inventoryItemId);
        if (!prod) return item;
        const onHandFrom =
          toLocation === "In-Store Fitzgerald St"
            ? (prod.onHandQtyStore ?? 0)
            : (prod.onHandQtyWarehouse ?? 0);
        return { ...item, onHandFrom };
      })
    );
  };

  // Search results
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const already = new Set(draftItems.map((d) => d.inventoryItemId));
    return catalog
      .filter(
        (p) =>
          !already.has(p.inventoryItemId) &&
          (p.productTitle.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q) ||
            p.barcode?.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [search, catalog, draftItems]);

  const addItem = (prod: ShopifyProduct) => {
    const onHandFrom =
      fromLocation === "In-Store Fitzgerald St"
        ? (prod.onHandQtyStore ?? 0)
        : (prod.onHandQtyWarehouse ?? 0);
    setDraftItems((prev) => [
      ...prev,
      {
        inventoryItemId: prod.inventoryItemId,
        sku: prod.sku,
        name: prod.productTitle,
        variantTitle: prod.variantTitle,
        qty: 1,
        onHandFrom,
      },
    ]);
    setSearch("");
    searchRef.current?.focus();
  };

  const removeItem = (inventoryItemId: string) =>
    setDraftItems((prev) => prev.filter((d) => d.inventoryItemId !== inventoryItemId));

  const updateQty = (inventoryItemId: string, qty: number) =>
    setDraftItems((prev) =>
      prev.map((d) => (d.inventoryItemId === inventoryItemId ? { ...d, qty: Math.max(1, qty) } : d))
    );

  const handleSubmit = async () => {
    if (!draftItems.length) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const items: TransferItem[] = draftItems.map((d) => ({
        inventoryItemId: d.inventoryItemId,
        sku: d.sku,
        name: d.name + (d.variantTitle && d.variantTitle !== "Default Title" ? ` — ${d.variantTitle}` : ""),
        qty: d.qty,
      }));
      const res = await fetch("/api/shopify/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromLocation, toLocation, items }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setSubmitResult({ ok: false, message: data.error ?? "Transfer failed" });
      } else {
        setSubmitResult({ ok: true, message: `${draftItems.length} SKU${draftItems.length > 1 ? "s" : ""} transferred from ${fromLocation} → ${toLocation}` });
        setDraftItems([]);
      }
    } catch (err) {
      setSubmitResult({ ok: false, message: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  };

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-accent text-accent"
        : "border-transparent text-text-tertiary hover:text-text-secondary"
    }`;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-4xl leading-none tracking-wide text-accent mb-1">
          Stock Transfers
        </h1>
        <p className="text-text-tertiary text-sm">Move inventory between In-Store and Warehouse.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-0 mb-6">
        <button className={tabCls("new")} onClick={() => setTab("new")}>New Transfer</button>
        <button className={tabCls("history")} onClick={() => setTab("history")}>History</button>
      </div>

      {/* ── NEW TRANSFER ── */}
      {tab === "new" && (
        <div className="space-y-6">

          {/* Result banner */}
          {submitResult && (
            <div className={`p-4 rounded-lg border text-sm flex items-start gap-3 ${
              submitResult.ok
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-700"
            }`}>
              <span className="shrink-0 mt-0.5">{submitResult.ok ? "✓" : "✕"}</span>
              <span>{submitResult.message}</span>
              <button className="ml-auto text-xs opacity-60 hover:opacity-100" onClick={() => setSubmitResult(null)}>✕</button>
            </div>
          )}

          {/* Location selector */}
          <div className="bg-surface-1 border border-border-0 p-5">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest block mb-1.5">From</label>
                <select
                  value={fromLocation}
                  onChange={(e) => {
                    const val = e.target.value as TransferLocation;
                    if (val === toLocation) return;
                    setFromLocation(val);
                    setDraftItems([]);
                  }}
                  className="w-full border border-border-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  style={{ color: "#000" }}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l} disabled={l === toLocation}>{l}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={swapLocations}
                title="Swap locations"
                className="mt-5 p-2 rounded-full border border-border-1 hover:border-accent hover:text-accent text-text-tertiary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>

              <div className="flex-1">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest block mb-1.5">To</label>
                <select
                  value={toLocation}
                  onChange={(e) => {
                    const val = e.target.value as TransferLocation;
                    if (val === fromLocation) return;
                    setToLocation(val);
                    setDraftItems([]);
                  }}
                  className="w-full border border-border-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  style={{ color: "#000" }}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l} disabled={l === fromLocation}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Product search */}
          <div className="bg-surface-1 border border-border-0 p-5">
            <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest block mb-2">
              Add Products
            </label>
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search by name, SKU, or barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={catalogLoading}
                className="w-full border border-border-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent pr-8 bg-surface-2 text-text-primary placeholder:text-text-tertiary"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="mt-1 border border-border-0 divide-y divide-border-0 max-h-64 overflow-y-auto bg-surface-1">
                {searchResults.map((p) => {
                  const onHandFrom =
                    fromLocation === "In-Store Fitzgerald St"
                      ? (p.onHandQtyStore ?? 0)
                      : (p.onHandQtyWarehouse ?? 0);
                  return (
                    <button
                      key={p.variantId}
                      onClick={() => addItem(p)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2 transition-colors"
                    >
                      <div>
                        <div className="text-sm font-medium text-text-primary">{p.productTitle}</div>
                        {p.variantTitle && p.variantTitle !== "Default Title" && (
                          <div className="text-xs text-text-tertiary">{p.variantTitle}</div>
                        )}
                        <div className="text-xs text-text-tertiary font-mono">{p.sku}</div>
                      </div>
                      <div className="text-xs text-text-tertiary shrink-0 ml-4">
                        {onHandFrom} on hand
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {search.trim() && !catalogLoading && searchResults.length === 0 && (
              <p className="mt-2 text-xs text-text-tertiary">No matching products found.</p>
            )}
          </div>

          {/* Draft items table */}
          {draftItems.length > 0 && (
            <div className="bg-surface-1 border border-border-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 border-b border-border-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-text-secondary">Product</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Available</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Transfer Qty</th>
                    <th className="px-4 py-3 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-0">
                  {draftItems.map((item) => (
                    <tr key={item.inventoryItemId}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{item.name}</div>
                        {item.variantTitle && item.variantTitle !== "Default Title" && (
                          <div className="text-xs text-text-tertiary">{item.variantTitle}</div>
                        )}
                        <div className="text-xs font-mono text-text-tertiary">{item.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${item.qty > item.onHandFrom ? "text-red-500" : "text-text-primary"}`}>
                          {item.onHandFrom}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={1}
                          max={item.onHandFrom || 9999}
                          value={item.qty}
                          onChange={(e) => updateQty(item.inventoryItemId, parseInt(e.target.value) || 1)}
                          className={`w-20 border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-accent bg-surface-2 text-text-primary placeholder:text-text-tertiary ${
                            item.qty > item.onHandFrom ? "border-red-300 bg-red-50" : "border-border-1"
                          }`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeItem(item.inventoryItemId)}
                          className="text-text-tertiary hover:text-red-400 transition-colors text-lg leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Over-stock warning */}
              {draftItems.some((d) => d.qty > d.onHandFrom) && (
                <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600">
                  Some quantities exceed available stock. Shopify will reject the transfer.
                </div>
              )}

              <div className="px-4 py-3 border-t border-border-0 flex items-center justify-between">
                <span className="text-xs text-text-tertiary">
                  {draftItems.length} SKU{draftItems.length !== 1 ? "s" : ""} ·{" "}
                  {draftItems.reduce((s, d) => s + d.qty, 0)} units total
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || draftItems.some((d) => d.qty > d.onHandFrom)}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded bg-accent text-white text-sm font-medium disabled:opacity-50 hover:bg-accent-dim transition-colors"
                >
                  {submitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Transferring…
                    </>
                  ) : (
                    `Transfer to ${toLocation}`
                  )}
                </button>
              </div>
            </div>
          )}

          {draftItems.length === 0 && !submitResult && (
            <p className="text-sm text-text-tertiary text-center py-4">
              Search for products above to build your transfer list.
            </p>
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab === "history" && (
        <div>
          {historyLoading ? (
            <div className="flex items-center justify-center h-40 text-text-tertiary text-sm gap-2">
              <span className="w-4 h-4 border-2 border-border-1 border-t-accent rounded-full animate-spin" />
              Loading…
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-16 text-text-tertiary text-sm">No transfers yet.</div>
          ) : (
            <div className="space-y-3">
              {history.map((rec) => (
                <div key={rec.id} className="bg-surface-1 border border-border-0 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary">{rec.fromLocation}</span>
                        <svg className="w-4 h-4 text-text-tertiary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <span className="font-medium text-text-primary">{rec.toLocation}</span>
                      </div>
                      <div className="text-xs text-text-tertiary mt-0.5">{fmtDate(rec.executedAt)}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      rec.status === "done"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-600"
                    }`}>
                      {rec.status === "done" ? "Completed" : "Failed"}
                    </span>
                  </div>

                  {rec.error && (
                    <div className="mb-2 text-xs text-red-600 bg-red-50 rounded p-2">{rec.error}</div>
                  )}

                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-tertiary">
                        <th className="text-left font-medium pb-1">Product</th>
                        <th className="text-left font-medium pb-1">SKU</th>
                        <th className="text-right font-medium pb-1">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-0">
                      {rec.items.map((item, i) => (
                        <tr key={i}>
                          <td className="py-1 text-text-primary">{item.name}</td>
                          <td className="py-1 font-mono text-text-tertiary">{item.sku}</td>
                          <td className="py-1 text-right font-semibold text-text-primary">{item.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-2 pt-2 border-t border-border-0 flex justify-between text-xs text-text-tertiary">
                    <span>{rec.items.length} SKU{rec.items.length !== 1 ? "s" : ""} · {rec.items.reduce((s, i) => s + i.qty, 0)} units</span>
                    {rec.shopifyGroupId && (
                      <span className="font-mono text-text-tertiary truncate ml-4">
                        Shopify: {rec.shopifyGroupId.split("/").pop()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
