"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/types";
import { loadCatalog } from "@/lib/catalogCache";
import { loadEntries, saveEntry, clearAllEntries, syncCatalogToLocal, lookupByCode, lookupInMemory } from "@/lib/stockTakeDb";
import BarcodeScanner, { type ScanResult } from "@/components/BarcodeScanner";
import { Button } from "@/components/ui/Button";

type Entry = { counted: number; done: boolean };

export default function StockTakePage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [flashVariantId, setFlashVariantId] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{ code: string; found: boolean } | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ success: boolean; adjustedCount: number; message?: string } | null>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const variantRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const applyItems = (items: ShopifyProduct[]) => {
      setProducts(items);
      syncCatalogToLocal(items).catch(() => {});
    };
    Promise.all([loadEntries(), loadCatalog(false, applyItems)]).then(([saved, items]) => {
      setEntries(saved);
      applyItems(items);
      setLoading(false);
    });
  }, []);

  function patchEntry(variantId: string, patch: Partial<Entry>) {
    setEntries((prev) => {
      const next = { ...{ counted: 0, done: false }, ...prev[variantId], ...patch };
      saveEntry(variantId, next.counted, next.done);
      return { ...prev, [variantId]: next };
    });
  }

  function resetAll() {
    setEntries({});
    clearAllEntries();
  }

  const handleScan = useCallback(async (code: string) => {
    const dbResult = await lookupByCode(code);
    const variantId = dbResult?.item.variantId
      ?? lookupInMemory(code, products)?.variantId;

    if (!variantId) {
      setScanFeedback({ code, found: false });
      setScanResult({ outcome: "notfound", label: code });
      setTimeout(() => setScanFeedback(null), 2000);
      return;
    }

    const product = products.find((p) => p.variantId === variantId);
    const label = product
      ? `${product.productTitle}${product.variantTitle && product.variantTitle !== "Default Title" ? ` — ${product.variantTitle}` : ""}`
      : variantId;

    const currentCount = entries[variantId]?.counted ?? 0;
    const isDuplicate = currentCount > 0;
    const matchedOn = dbResult?.matchedOn ?? "barcode";

    const revealRow = () => {
      setFlashVariantId(variantId);
      setTimeout(() => setFlashVariantId(null), 1500);
      const cat = product?.collections?.[0] || "Uncategorised";
      setCollapsed((prev) => ({ ...prev, [cat]: false }));
      setTimeout(() => {
        variantRefs.current[variantId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    };

    setScanFeedback({ code, found: true });
    setTimeout(() => setScanFeedback(null), 2000);

    if (isDuplicate) {
      // Already counted — ask before adding again (Task 9). Do NOT auto-increment.
      revealRow();
      setScanResult({
        outcome: "duplicate",
        label,
        matchedOn,
        currentCount,
        onAddAnyway: () => {
          patchEntry(variantId, { counted: currentCount + 1, done: true });
          setScanResult({ outcome: "found", label, matchedOn });
        },
        onSkip: () => setScanResult(null),
      });
      return;
    }

    // First time counting this item
    patchEntry(variantId, { counted: currentCount + 1, done: true });
    setScanResult({ outcome: "found", label, matchedOn });
    revealRow();
  }, [products, entries, patchEntry]);

  async function exportVariances() {
    const varRows: Array<{
      Product: string; Variant: string; SKU: string; Barcode: string;
      "Expected (Store)": number; "Expected (Warehouse)": number;
      Counted: number; Variance: number;
    }> = [];
    for (const p of products) {
      const entry = entries[p.variantId];
      if (!entry?.done) continue;
      const expected = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
      const variance = entry.counted - expected;
      if (variance === 0) continue;
      varRows.push({
        Product: p.productTitle, Variant: p.variantTitle || "",
        SKU: p.sku || "", Barcode: p.barcode || "",
        "Expected (Store)": p.onHandQtyStore ?? 0,
        "Expected (Warehouse)": p.onHandQtyWarehouse ?? 0,
        Counted: entry.counted, Variance: variance,
      });
    }
    if (varRows.length === 0) { alert("No variances — all counted items match expected quantities."); return; }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(varRows);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Variances");
    XLSX.writeFile(wb, `stock-variances-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? products.filter(
          (p) =>
            p.productTitle.toLowerCase().includes(q) ||
            p.variantTitle?.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q) ||
            p.barcode?.toLowerCase().includes(q)
        )
      : products;

    const map = new Map<string, ShopifyProduct[]>();
    for (const p of filtered) {
      const cat = p.collections?.[0] || "Uncategorised";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b);
    });
  }, [products, search]);

  const { totalVariants, doneCount } = useMemo(() => {
    const total = products.length;
    const done = Object.values(entries).filter((e) => e.done).length;
    return { totalVariants: total, doneCount: done };
  }, [products, entries]);

  const progressPct = totalVariants > 0 ? Math.round((doneCount / totalVariants) * 100) : 0;

  function scrollToCategory(cat: string) {
    setActiveCategory(cat);
    setCollapsed((prev) => ({ ...prev, [cat]: false }));
    categoryRefs.current[cat]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleCategory(cat: string) {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function markAllDone(cat: string, items: ShopifyProduct[]) {
    const allDone = items.every((p) => entries[p.variantId]?.done);
    setEntries((prev) => {
      const updated = { ...prev };
      for (const p of items) {
        const counted = prev[p.variantId]?.counted ?? 0;
        updated[p.variantId] = { counted, done: !allDone };
        saveEntry(p.variantId, counted, !allDone);
      }
      return updated;
    });
  }

  const variantItems = useMemo(() =>
    products
      .filter((p) => entries[p.variantId]?.done)
      .map((p) => ({
        product: p,
        counted: entries[p.variantId].counted,
        expected: p.onHandQtyStore ?? 0,
        delta: entries[p.variantId].counted - (p.onHandQtyStore ?? 0),
      }))
      .filter((r) => r.delta !== 0),
  [products, entries]);

  const doneItemCount = useMemo(() => Object.values(entries).filter((e) => e.done).length, [entries]);

  async function handleCommit() {
    setCommitting(true);
    try {
      const locationId = process.env.NEXT_PUBLIC_SHOPIFY_LOCATION_ID_STORE ?? "";
      const items = products
        .filter((p) => entries[p.variantId]?.done)
        .map((p) => ({ inventoryItemId: p.inventoryItemId, counted: entries[p.variantId].counted }));

      const res = await fetch("/api/shopify/stocktake/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, locationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      setCommitResult({
        success: true,
        adjustedCount: data.adjustedCount ?? 0,
        message: data.skipped ? data.message : undefined,
      });
      setCommitModalOpen(false);
    } catch (e) {
      setCommitResult({ success: false, adjustedCount: 0, message: e instanceof Error ? e.message : "Unknown error" });
      setCommitModalOpen(false);
    } finally {
      setCommitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-text-tertiary p-10 justify-center font-mono text-sm">
        <span className="w-4 h-4 border border-border-1 border-t-accent animate-spinner rounded-full" />
        Loading catalog…
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-2xl mb-3 font-mono text-text-tertiary">[  ]</p>
        <p className="font-medium text-text-primary mb-1 text-sm">No products in catalog</p>
        <p className="text-xs text-text-tertiary">Go to <a href="/catalog" className="text-accent hover:text-accent-dim underline transition-colors">Catalog</a> and sync first.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Barcode scanner overlay ── */}
      {scannerOpen && (
        <BarcodeScanner
          onDetected={handleScan}
          onClose={() => { setScannerOpen(false); setScanResult(null); }}
          scanResult={scanResult}
          totalCounted={Object.values(entries).reduce((s, e) => s + (e.counted > 0 ? e.counted : 0), 0)}
        />
      )}

      {/* ── Commit confirm modal ── */}
      {commitModalOpen && (
        <div className="fixed inset-0 z-50 bg-[var(--ps-overlay)] flex items-center justify-center p-4">
          <div className="bg-surface-1 border border-border-0 w-full max-w-2xl max-h-[80vh] flex flex-col animate-modal-in"
               style={{ borderTop: "2px solid var(--ps-status-drift)" }}>
            <div className="px-5 py-4 border-b border-border-0 flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">Commit Stock Take to Shopify</p>
                <p className="text-xs text-text-tertiary mt-0.5 font-mono">
                  {variantItems.length === 0
                    ? "All counted items match current Shopify levels."
                    : `${variantItems.length} variant${variantItems.length !== 1 ? "s" : ""} will be adjusted`}
                </p>
              </div>
              <button onClick={() => setCommitModalOpen(false)} className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                </svg>
              </button>
            </div>

            {variantItems.length > 0 ? (
              <div className="overflow-y-auto flex-1">
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="border-b border-border-0">
                      {["Product", "Expected", "Counted", "Delta"].map((h, i) => (
                        <th key={h} className={`px-5 py-2.5 text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest ${i > 0 ? "text-right" : "text-left"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {variantItems.map(({ product: p, counted, expected, delta }) => (
                      <tr key={p.variantId} className="border-t border-border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-5 py-2.5">
                          <p className="font-sans text-sm text-text-primary">{p.productTitle}</p>
                          {p.variantTitle && <p className="text-xs text-text-secondary">{p.variantTitle}</p>}
                          <p className="text-2xs text-text-tertiary font-mono mt-0.5">{p.sku}</p>
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-sm text-text-secondary tabular-nums">{expected}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-sm text-text-primary tabular-nums font-semibold">{counted}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-sm tabular-nums font-semibold">
                          <span className={delta > 0 ? "text-status-match" : "text-status-shortage"}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-12 text-text-tertiary text-sm font-mono">
                Nothing to commit — all counts match.
              </div>
            )}

            <div className="px-5 py-3 border-t border-border-0 bg-surface-2 flex items-center justify-between gap-3">
              <p className="text-2xs font-mono text-text-tertiary">
                Live Shopify quantities fetched before apply — prevents race conditions
              </p>
              <div className="flex gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setCommitModalOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCommit}
                  loading={committing}
                  disabled={committing || variantItems.length === 0}
                >
                  {committing ? "Committing…" : "Push to Shopify"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Commit result banner ── */}
      {commitResult && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 border text-sm font-mono animate-fade-in ${
            commitResult.success
              ? "bg-status-match-bg border-status-match text-status-match"
              : "bg-status-shortage-bg border-status-shortage text-status-shortage"
          }`}
        >
          <span>{commitResult.success ? "✓" : "✗"}</span>
          <span>
            {commitResult.success
              ? commitResult.message ?? `${commitResult.adjustedCount} variant${commitResult.adjustedCount !== 1 ? "s" : ""} updated`
              : commitResult.message}
          </span>
          <button onClick={() => setCommitResult(null)} className="ml-1 opacity-60 hover:opacity-100 text-base leading-none">×</button>
        </div>
      )}

      {/* ── Scan feedback toast ── */}
      {scanFeedback && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 border text-xs font-mono animate-fade-in pointer-events-none ${
            scanFeedback.found
              ? "bg-status-match-bg border-status-match text-status-match"
              : "bg-status-shortage-bg border-status-shortage text-status-shortage"
          }`}
        >
          {scanFeedback.found ? `✓ ${scanFeedback.code}` : `✗ NOT FOUND: ${scanFeedback.code}`}
        </div>
      )}

      {/* ── Category sidebar (desktop) ── */}
      <aside className="hidden lg:flex flex-col w-52 shrink-0 border-r border-border-0 bg-surface-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-border-0">
          <p className="text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest mb-2">Collections</p>
          {/* Progress bar — hard rect, no rounded-full */}
          <div className="h-px bg-border-0 overflow-hidden mb-2">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-2xs font-mono text-text-tertiary">{doneCount} / {totalVariants} counted</p>
        </div>
        <nav className="flex-1 py-1">
          {grouped.map(([cat, items]) => {
            const catDone = items.filter((p) => entries[p.variantId]?.done).length;
            const allDone = catDone === items.length;
            return (
              <button
                key={cat}
                onClick={() => scrollToCategory(cat)}
                className={[
                  "w-full text-left h-8 px-4 text-sm transition-colors border-l-2 flex items-center justify-between gap-2",
                  activeCategory === cat
                    ? "border-accent text-text-primary bg-accent-muted font-medium"
                    : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2",
                ].join(" ")}
              >
                <span className="truncate text-xs">{cat}</span>
                <span
                  className="shrink-0 font-mono text-2xs"
                  style={{ color: allDone ? "var(--ps-status-match)" : "var(--ps-text-tertiary)" }}
                >
                  {catDone}/{items.length}
                </span>
              </button>
            );
          })}
        </nav>
        {doneCount > 0 && (
          <div className="px-4 py-3 border-t border-border-0">
            <button
              onClick={resetAll}
              className="text-2xs font-mono text-text-tertiary hover:text-status-shortage transition-colors"
            >
              Reset all counts
            </button>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex-none px-4 h-12 border-b border-border-0 bg-surface-1 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <span className="font-sans text-base font-semibold text-text-primary">Stock Take</span>
            <span className="font-mono text-xs text-text-tertiary">{doneCount}/{totalVariants} · {progressPct}%</span>
            {doneCount > 0 && (
              <span
                className="hidden sm:inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium"
                title="Your count is saved on this device automatically — you can close the tab and resume later, even days later."
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                Auto-saved
              </span>
            )}
          </div>

          {/* Mobile progress strip */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-20 h-px bg-border-0 overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Search */}
          <div className="relative hidden sm:block">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" strokeLinecap="square"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Product, SKU, barcode…"
              className="pl-7 pr-3 h-7 w-52 text-xs bg-surface-2 border border-border-0 text-text-primary placeholder:text-text-tertiary font-mono focus:outline-none focus:border-border-2 focus:ring-2 focus:ring-[var(--ps-focus)] transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary text-sm">×</button>
            )}
          </div>

          {/* SCAN — primary action, always visible */}
          <button
            onClick={() => setScannerOpen(true)}
            className="inline-flex items-center gap-2 h-8 px-3 bg-accent hover:bg-accent-dim text-white text-xs font-medium font-sans border border-accent hover:border-accent-dim transition-colors"
            title="Open barcode scanner"
          >
            {/* Barcode icon — hard lines */}
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square">
              <line x1="1"  y1="0" x2="1"  y2="14"/>
              <line x1="3"  y1="0" x2="3"  y2="14"/>
              <line x1="5"  y1="0" x2="5"  y2="14"/>
              <line x1="7"  y1="0" x2="7"  y2="14"/>
              <line x1="9"  y1="0" x2="9"  y2="14"/>
              <line x1="11" y1="0" x2="11" y2="14"/>
              <line x1="13" y1="0" x2="13" y2="14"/>
              <line x1="15" y1="0" x2="15" y2="14"/>
              <line x1="17" y1="0" x2="17" y2="14"/>
            </svg>
            Scan
          </button>

          {doneItemCount > 0 && (
            <div className="hidden lg:flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={exportVariances}>
                Export
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setCommitResult(null); setCommitModalOpen(true); }}
              >
                Commit to Shopify
              </Button>
              <button onClick={resetAll} className="text-2xs font-mono text-text-tertiary hover:text-status-shortage transition-colors px-1">
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Mobile search */}
        <div className="sm:hidden px-3 py-2 border-b border-border-0 bg-surface-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, SKU, barcode…"
            className="w-full px-3 h-8 text-xs bg-surface-1 border border-border-0 text-text-primary placeholder:text-text-tertiary font-mono focus:outline-none focus:border-border-2 transition-colors"
          />
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-2">
          {grouped.length === 0 && (
            <div className="text-center py-16 text-text-tertiary text-sm font-mono">No results for &ldquo;{search}&rdquo;</div>
          )}

          {grouped.map(([cat, items]) => {
            const catDone = items.filter((p) => entries[p.variantId]?.done).length;
            const allDone = catDone === items.length;
            const isCollapsed = collapsed[cat];

            return (
              <div
                key={cat}
                ref={(el) => { categoryRefs.current[cat] = el; }}
                className="bg-surface-1 border border-border-0 overflow-hidden"
              >
                {/* Category header */}
                <div
                  className={[
                    "flex items-center justify-between px-4 h-9 cursor-pointer select-none border-b transition-colors",
                    allDone
                      ? "bg-status-match-bg border-status-match/20"
                      : "bg-surface-2 border-border-0 hover:bg-surface-3",
                  ].join(" ")}
                  onClick={() => toggleCategory(cat)}
                >
                  <div className="flex items-center gap-2.5">
                    <svg
                      className={`w-3 h-3 text-text-tertiary transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      viewBox="0 0 10 6" fill="currentColor"
                    >
                      <path d="M0 0l5 6 5-6z"/>
                    </svg>
                    <span className={`text-sm font-medium ${allDone ? "text-status-match" : "text-text-primary"}`}>
                      {cat}
                    </span>
                    <span
                      className="font-mono text-2xs"
                      style={{ color: allDone ? "var(--ps-status-match)" : "var(--ps-text-tertiary)" }}
                    >
                      {catDone}/{items.length}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); markAllDone(cat, items); }}
                    className={[
                      "text-2xs font-mono px-2 py-1 border transition-colors",
                      allDone
                        ? "border-status-match/30 text-status-match hover:bg-status-match-bg"
                        : "border-border-0 text-text-tertiary hover:border-border-1 hover:text-text-secondary",
                    ].join(" ")}
                  >
                    {allDone ? "Unmark all" : "Mark all ✓"}
                  </button>
                </div>

                {/* Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-border-0">
                    {items.map((p) => {
                      const entry = entries[p.variantId] ?? { counted: 0, done: false };
                      const isFlashing = flashVariantId === p.variantId;
                      const expected = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
                      const delta = entry.counted - expected;

                      return (
                        <div
                          key={p.variantId}
                          ref={(el) => { variantRefs.current[p.variantId] = el; }}
                          className={[
                            "flex items-center gap-3 px-4 py-2.5 transition-colors",
                            isFlashing
                              ? "animate-scan-pulse"
                              : entry.done
                                ? "bg-status-match-bg"
                                : "hover:bg-surface-2",
                          ].join(" ")}
                        >
                          {/* Done toggle */}
                          <button
                            onClick={() => patchEntry(p.variantId, { done: !entry.done })}
                            className={[
                              "shrink-0 w-4 h-4 border flex items-center justify-center transition-colors",
                              entry.done
                                ? "bg-status-match border-status-match"
                                : "border-border-2 hover:border-status-match",
                            ].join(" ")}
                            aria-label="Mark as counted"
                          >
                            {entry.done && (
                              <svg className="w-2.5 h-2.5 text-canvas" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter"/>
                              </svg>
                            )}
                          </button>

                          {/* Product info */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${entry.done ? "text-text-tertiary line-through" : "text-text-primary"}`}>
                              {p.productTitle}
                              {p.variantTitle && p.variantTitle !== "Default Title" && (
                                <span className="ml-1.5 text-text-tertiary font-normal">— {p.variantTitle}</span>
                              )}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {p.sku && <span className="text-2xs text-text-tertiary font-mono">{p.sku}</span>}
                              {p.barcode && <span className="text-2xs text-text-tertiary font-mono">{p.barcode}</span>}
                              {entry.done && (
                                <span className={`text-2xs font-mono font-semibold ${delta === 0 ? "text-status-match" : delta > 0 ? "text-status-match" : "text-status-shortage"}`}>
                                  {delta === 0 ? "=" : delta > 0 ? `+${delta}` : `${delta}`}
                                </span>
                              )}
                              {!entry.done && expected > 0 && (
                                <span className="text-2xs text-text-tertiary font-mono">exp {expected}</span>
                              )}
                            </div>
                          </div>

                          {/* Counter — flat stepper */}
                          <div className="flex items-stretch shrink-0 border border-border-0">
                            <button
                              onClick={() => patchEntry(p.variantId, { counted: Math.max(0, entry.counted - 1) })}
                              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors border-r border-border-0 text-base font-medium"
                              aria-label="Decrease"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={entry.counted}
                              onChange={(e) => patchEntry(p.variantId, { counted: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="w-11 text-center text-sm font-mono font-semibold tabular-nums bg-transparent text-text-primary outline-none border-none appearance-none"
                            />
                            <button
                              onClick={() => patchEntry(p.variantId, { counted: entry.counted + 1 })}
                              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors border-l border-border-0 text-base font-medium"
                              aria-label="Increase"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Mobile bottom spacer for the fixed scan button */}
          <div className="h-20 lg:hidden" />
        </div>

        {/* Mobile fixed scan button — always reachable at the bottom */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 border-t border-border-0 bg-surface-1 p-3 flex gap-2">
          <button
            onClick={() => setScannerOpen(true)}
            className="flex-1 h-12 bg-accent hover:bg-accent-dim text-white font-medium text-sm flex items-center justify-center gap-2.5 transition-colors"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square">
              <line x1="1"  y1="0" x2="1"  y2="14"/>
              <line x1="3"  y1="0" x2="3"  y2="14"/>
              <line x1="5"  y1="0" x2="5"  y2="14"/>
              <line x1="7"  y1="0" x2="7"  y2="14"/>
              <line x1="9"  y1="0" x2="9"  y2="14"/>
              <line x1="11" y1="0" x2="11" y2="14"/>
              <line x1="13" y1="0" x2="13" y2="14"/>
              <line x1="15" y1="0" x2="15" y2="14"/>
              <line x1="17" y1="0" x2="17" y2="14"/>
            </svg>
            Scan Barcode
          </button>
          {doneItemCount > 0 && (
            <button
              onClick={() => { setCommitResult(null); setCommitModalOpen(true); }}
              className="h-12 px-4 bg-surface-2 border border-border-0 text-text-primary text-sm font-medium transition-colors hover:bg-surface-3"
            >
              Commit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
