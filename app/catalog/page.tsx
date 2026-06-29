"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShopifyProduct } from "@/lib/types";
import { loadCatalog, invalidateCache } from "@/lib/catalogCache";
import { apiFetch } from "@/lib/apiClient";

type SortKey = "productTitle" | "onHand" | "unitCost" | "price" | "margin";
type SortDir = "asc" | "desc";

function StockBadge({ qty }: { qty: number }) {
  if (qty <= 0) return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-2xs font-mono font-medium tracking-[0.08em] select-none"
      style={{
        color: "var(--ps-status-shortage)",
        backgroundColor: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.35)",
        borderLeftWidth: "2px",
        borderLeftColor: "var(--ps-status-shortage)",
      }}
    >
      OUT
    </span>
  );
  if (qty <= 3) return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-2xs font-mono font-medium tracking-[0.08em] select-none"
      style={{
        color: "var(--ps-status-drift)",
        backgroundColor: "rgba(234,179,8,0.08)",
        border: "1px solid rgba(234,179,8,0.35)",
        borderLeftWidth: "2px",
        borderLeftColor: "var(--ps-status-drift)",
      }}
    >
      {qty}
    </span>
  );
  return <span className="text-sm font-mono tabular-nums text-text-primary">{qty}</span>;
}

export default function CatalogPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStock, setFilterStock] = useState<"all" | "low" | "out">("all");
  const [sortKey, setSortKey] = useState<SortKey>("productTitle");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // Onboarding: choose which collections to import
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [collections, setCollections] = useState<Array<{ title: string; count: number }>>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());

  async function openImportModal() {
    setImportModalOpen(true);
    if (collections.length === 0) {
      setCollectionsLoading(true);
      try {
        const res = await apiFetch("/api/shopify/collections");
        const data = await res.json();
        if (res.ok && Array.isArray(data.collections)) setCollections(data.collections);
      } catch { /* non-fatal */ } finally {
        setCollectionsLoading(false);
      }
    }
  }

  function toggleCollection(title: string) {
    setSelectedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }

  function applyProducts(items: ShopifyProduct[]) {
    setProducts(items);
    if (items.length > 0) {
      const latest = items.reduce((a, b) => (a.syncedAt > b.syncedAt ? a : b));
      setLastSynced(latest.syncedAt);
    }
  }

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      // Instant from cache, then live-update when the background refresh lands
      const items = await loadCatalog(force, applyProducts);
      applyProducts(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const productTypes = useMemo(() => {
    const types = new Set(products.flatMap((p) => p.collections ?? []).filter(Boolean));
    return Array.from(types).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      const onHand = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
      const matchSearch =
        !q ||
        p.productTitle.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.variantTitle.toLowerCase().includes(q);
      const matchType = !filterType || (p.collections ?? []).includes(filterType);
      const matchStock =
        filterStock === "all" ||
        (filterStock === "out" && onHand <= 0) ||
        (filterStock === "low" && onHand > 0 && onHand <= 3);
      return matchSearch && matchType && matchStock;
    });
  }, [products, search, filterType, filterStock]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      const aOnHand = (a.onHandQtyStore ?? 0) + (a.onHandQtyWarehouse ?? 0);
      const bOnHand = (b.onHandQtyStore ?? 0) + (b.onHandQtyWarehouse ?? 0);
      const aMargin = a.unitCost && a.price ? ((a.price - a.unitCost) / a.price) * 100 : -1;
      const bMargin = b.unitCost && b.price ? ((b.price - b.unitCost) / b.price) * 100 : -1;
      switch (sortKey) {
        case "productTitle": av = a.productTitle; bv = b.productTitle; break;
        case "onHand": av = aOnHand; bv = bOnHand; break;
        case "unitCost": av = a.unitCost ?? -1; bv = b.unitCost ?? -1; break;
        case "price": av = a.price; bv = b.price; break;
        case "margin": av = aMargin; bv = bMargin; break;
      }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "productTitle" ? "asc" : "desc"); }
  }

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <th
        className="px-4 py-2.5 text-right cursor-pointer select-none"
        onClick={() => toggleSort(col)}
      >
        <span className={`text-[10px] font-mono font-semibold uppercase tracking-widest transition-colors ${active ? "text-accent" : "text-text-tertiary hover:text-text-secondary"}`}>
          {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </span>
      </th>
    );
  }

  const outCount = products.filter((p) => (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) <= 0).length;
  const lowCount = products.filter((p) => { const q = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0); return q > 0 && q <= 3; }).length;

  async function handleExportXlsx() {
    const XLSX = await import("xlsx");
    const rows = sorted.map((p) => ({
      Product: p.productTitle,
      Variant: p.variantTitle || "",
      SKU: p.sku || "",
      Barcode: p.barcode || "",
      Collection: (p.collections ?? [])[0] || "",
      "In Store": p.onHandQtyStore ?? 0,
      Warehouse: p.onHandQtyWarehouse ?? 0,
      "Cost ($)": p.unitCost != null ? p.unitCost : "",
      "Retail ($)": p.price,
      "Margin (%)": p.unitCost && p.price > 0 ? parseFloat((((p.price - p.unitCost) / p.price) * 100).toFixed(1)) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Catalog");
    XLSX.writeFile(wb, `catalog-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleSync(collectionTitles?: string[]) {
    setSyncing(true);
    setImportModalOpen(false);
    setError(null);
    setSyncMsg("Syncing… 0 variants");
    const colParam = collectionTitles && collectionTitles.length > 0
      ? `&collections=${encodeURIComponent(collectionTitles.join(","))}`
      : "";
    try {
      // Paginated: one page (≤250 products) per call, loop until done — avoids the 60s timeout
      let cursor: string | null = null;
      let total = 0;
      let page = 0;
      let guard = 0;
      do {
        const base = "/api/shopify/catalog/sync";
        const url = cursor
          ? `${base}?cursor=${encodeURIComponent(cursor)}${colParam}`
          : colParam ? `${base}?${colParam.slice(1)}` : base;
        const res = await apiFetch(url, { method: "GET" });
        const text = await res.text();
        let data: { processed?: number; done?: boolean; nextCursor?: string | null; error?: string };
        try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 300) || `HTTP ${res.status}`); }
        if (!res.ok) throw new Error(data.error || "Sync failed");
        total += data.processed ?? 0;
        page += 1;
        setSyncMsg(`Syncing… page ${page} · ${total} variants`);
        cursor = data.done ? null : (data.nextCursor ?? null);
      } while (cursor && ++guard < 500);

      setSyncMsg(`${total} variants synced`);
      invalidateCache();
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfillCollections() {
    setSyncing(true);
    setError(null);
    setSyncMsg("Backfilling collections… 0%");
    try {
      let cursor: string | null = null;
      let total = 0;
      let page = 0;
      for (;;) {
        const url = "/api/shopify/backfill-collections" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
        const res = await apiFetch(url);
        const data = await res.json() as { processed?: number; done?: boolean; nextCursor?: string | null; error?: string };
        if (!res.ok || data.error) throw new Error(data.error || "Backfill failed");
        total += data.processed ?? 0;
        page++;
        setSyncMsg(`Backfilling collections… page ${page} (${total} variants)`);
        if (data.done) break;
        cursor = data.nextCursor ?? null;
      }
      setSyncMsg(`Collections backfilled for ${total} variants`);
      invalidateCache();
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRegisterWebhooks() {
    setRegistering(true);
    setError(null);
    try {
      const res = await apiFetch("/api/shopify/webhooks/register", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      const okCount = data.okCount ?? (data.results?.filter((r: { success: boolean }) => r.success).length ?? 0);
      const total = data.total ?? (data.results?.length ?? 0);
      setSyncMsg(
        okCount === total
          ? "Auto-sync is on — Shopify will push product updates automatically."
          : `Auto-sync enabled for ${okCount} of ${total} updates. Try again, or contact support if it persists.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl">
      {/* Import-by-collection modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 pt-16" onClick={() => setImportModalOpen(false)}>
          <div className="bg-surface-1 border border-border-1 w-full max-w-lg max-h-[75vh] flex flex-col rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-text-primary">Import by collection</p>
                <button onClick={() => setImportModalOpen(false)} className="text-text-tertiary hover:text-text-primary text-lg leading-none">&times;</button>
              </div>
              <p className="text-xs text-text-tertiary">Tick the collections to import. Leave all unticked to import the entire catalog.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {collectionsLoading ? (
                <p className="text-center text-text-tertiary text-sm py-10">Loading collections…</p>
              ) : collections.length === 0 ? (
                <p className="text-center text-text-tertiary text-sm py-10">No collections found.</p>
              ) : (
                collections.map((c) => (
                  <label key={c.title} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCollections.has(c.title)}
                      onChange={() => toggleCollection(c.title)}
                      className="w-4 h-4 accent-accent"
                    />
                    <span className="flex-1 text-sm text-text-primary">{c.title}</span>
                    <span className="text-xs font-mono text-text-tertiary">{c.count}</span>
                  </label>
                ))
              )}
            </div>
            <div className="p-3 border-t border-border-0 flex items-center justify-between gap-2">
              <span className="text-xs text-text-tertiary">{selectedCollections.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSync()}
                  className="text-sm border border-border-1 text-text-secondary hover:text-text-primary px-3 py-1.5 rounded transition-colors"
                >
                  Import everything
                </button>
                <button
                  onClick={() => handleSync(Array.from(selectedCollections))}
                  disabled={selectedCollections.size === 0}
                  className="text-sm bg-accent hover:bg-accent-dim disabled:opacity-40 text-white font-medium px-4 py-1.5 rounded transition-colors"
                >
                  Import selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-0.5">Product Catalog</h1>
          <p className="text-text-tertiary text-sm font-mono">
            {products.length > 0
              ? `${products.length} variants · last synced ${lastSynced ? formatDate(lastSynced) : "—"}`
              : "Pull your active Shopify products here"}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap lg:justify-end gap-2">
          {products.length > 0 && (
            <button
              onClick={handleExportXlsx}
              className="inline-flex items-center justify-center gap-1.5 text-sm border border-border-1 text-text-secondary hover:text-text-primary hover:border-border-2 px-3 py-2 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Excel
            </button>
          )}
          <button
            onClick={handleBackfillCollections}
            disabled={syncing || registering}
            className="inline-flex items-center justify-center gap-1.5 text-sm border border-border-1 text-text-secondary hover:text-text-primary hover:border-border-2 px-3 py-2 transition-colors disabled:opacity-40"
          >
            {syncing ? "…" : "Update Collections"}
          </button>
          <button
            onClick={handleRegisterWebhooks}
            disabled={registering || syncing}
            className="inline-flex items-center justify-center gap-1.5 text-sm border border-border-1 text-text-secondary hover:text-text-primary hover:border-border-2 px-3 py-2 transition-colors disabled:opacity-40"
          >
            {registering ? "Registering…" : "Enable Auto-Sync"}
          </button>
          <button
            onClick={openImportModal}
            disabled={syncing || registering}
            className="inline-flex items-center justify-center gap-1.5 text-sm border border-border-1 text-text-secondary hover:text-text-primary hover:border-border-2 px-3 py-2 transition-colors disabled:opacity-40"
          >
            Choose collections
          </button>
          <button
            onClick={() => handleSync()}
            disabled={syncing || registering}
            className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-40 text-white text-sm font-medium px-4 py-2 border border-accent transition-colors col-span-2 sm:col-span-1"
          >
            {syncing ? (
              <>
                <span className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
                Syncing…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                Sync Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stock alert summary — design-system badges */}
      {products.length > 0 && (outCount > 0 || lowCount > 0) && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {outCount > 0 && (
            <button
              onClick={() => setFilterStock(filterStock === "out" ? "all" : "out")}
              className="inline-flex items-center gap-2 text-sm font-mono font-medium px-3 py-1.5 transition-colors"
              style={filterStock === "out" ? {
                color: "#fff",
                backgroundColor: "var(--ps-status-shortage)",
                border: "2px solid var(--ps-status-shortage)",
                borderLeftWidth: "2px",
              } : {
                color: "var(--ps-status-shortage)",
                backgroundColor: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderLeftWidth: "2px",
                borderLeftColor: "var(--ps-status-shortage)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {outCount} out of stock
            </button>
          )}
          {lowCount > 0 && (
            <button
              onClick={() => setFilterStock(filterStock === "low" ? "all" : "low")}
              className="inline-flex items-center gap-2 text-sm font-mono font-medium px-3 py-1.5 transition-colors"
              style={filterStock === "low" ? {
                color: "#fff",
                backgroundColor: "var(--ps-status-drift)",
                border: "2px solid var(--ps-status-drift)",
                borderLeftWidth: "2px",
              } : {
                color: "var(--ps-status-drift)",
                backgroundColor: "rgba(234,179,8,0.08)",
                border: "1px solid rgba(234,179,8,0.35)",
                borderLeftWidth: "2px",
                borderLeftColor: "var(--ps-status-drift)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {lowCount} low stock (≤3)
            </button>
          )}
          {filterStock !== "all" && (
            <button
              onClick={() => setFilterStock("all")}
              className="text-xs text-text-tertiary hover:text-text-secondary transition-colors font-mono"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 border-l-2 border-status-shortage bg-[rgba(239,68,68,0.08)] text-status-shortage text-sm font-mono">
          {error}
        </div>
      )}
      {syncMsg && (
        <div className="mb-4 p-3 border-l-2 border-status-match bg-[rgba(34,197,94,0.08)] text-status-match text-sm font-mono">
          {syncMsg}
        </div>
      )}

      {/* Filters */}
      {products.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search name, SKU, barcode…"
            aria-label="Search catalog"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 bg-surface-2 border border-border-1 text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-surface-2 border border-border-1 text-text-primary px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          >
            <option value="">All collections</option>
            {productTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {(search || filterType || filterStock !== "all") && (
            <span className="text-xs text-text-tertiary font-mono">{sorted.length} result{sorted.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-3 text-text-tertiary py-20 justify-center font-mono text-sm">
          <div className="w-4 h-4 border border-border-2 border-t-accent rounded-full animate-spin" />
          Loading catalog…
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-24 bg-surface-1 border border-border-0">
          <p className="text-text-primary font-medium mb-1">No products yet</p>
          <p className="text-text-tertiary text-sm mb-6 font-mono">Click &ldquo;Sync Now&rdquo; to pull your active Shopify products</p>
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            className="bg-accent hover:bg-accent-dim text-white text-sm font-medium px-6 py-2.5 border border-accent transition-colors disabled:opacity-40"
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      ) : (
        <div className="bg-surface-1 border border-border-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border-0 bg-surface-2">
                  <th
                    className="px-4 py-2.5 cursor-pointer select-none"
                    onClick={() => toggleSort("productTitle")}
                  >
                    <span className={`text-[10px] font-mono font-semibold uppercase tracking-widest transition-colors ${sortKey === "productTitle" ? "text-accent" : "text-text-tertiary hover:text-text-secondary"}`}>
                      Product{sortKey === "productTitle" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-tertiary">Variant</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-tertiary">SKU</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-tertiary">Collection</th>
                  <SortTh col="onHand" label="In Store" />
                  <SortTh col="onHand" label="Whouse" />
                  <SortTh col="unitCost" label="Cost" />
                  <SortTh col="price" label="Retail" />
                  <SortTh col="margin" label="Margin" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-text-tertiary font-mono text-sm">
                      No results
                    </td>
                  </tr>
                ) : (
                  sorted.map((p) => {
                    const margin = p.unitCost && p.price > 0
                      ? ((p.price - p.unitCost) / p.price) * 100
                      : null;
                    const storeQty = p.onHandQtyStore ?? 0;
                    const whQty = p.onHandQtyWarehouse ?? 0;
                    return (
                      <tr key={p.variantId} className="border-b border-border-0 last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{p.productTitle}</td>
                        <td className="px-4 py-3 text-text-secondary text-xs font-mono">
                          {p.variantTitle || <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                          {p.sku || <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {p.productType ? (
                            <span
                              className="inline-flex text-2xs font-mono px-1.5 py-0.5 text-text-tertiary"
                              style={{ border: "1px solid var(--ps-border-1)" }}
                            >
                              {p.productType}
                            </span>
                          ) : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right"><StockBadge qty={storeQty} /></td>
                        <td className="px-4 py-3 text-right"><StockBadge qty={whQty} /></td>
                        <td className="px-4 py-3 text-right text-text-secondary text-xs font-mono tabular-nums">
                          {p.unitCost != null ? `$${p.unitCost.toFixed(2)}` : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-text-primary font-mono tabular-nums text-xs">
                          ${p.price.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {margin != null ? (
                            <span className={`text-xs font-mono font-semibold tabular-nums ${margin >= 40 ? "text-status-match" : margin >= 25 ? "text-status-drift" : "text-status-shortage"}`}>
                              {margin.toFixed(0)}%
                            </span>
                          ) : <span className="text-text-tertiary">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
