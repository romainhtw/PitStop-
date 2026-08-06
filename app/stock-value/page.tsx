"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";

// Client-side mirror of lib/stockValue/snapshot.ts types — the server module
// pulls in firebase-admin, so only the shape is shared, not the import.
interface LocationTotals {
  cost: number; // integer minor units
  retail: number; // integer minor units
  items: number;
}

interface StockSnapshot {
  status: "ready" | "running" | "failed";
  updatedAt?: string;
  lastError: string | null;
  currencyCode: string;
  totalVariants: number;
  missingCostCount: number;
  locations: Array<{ id: string; name: string }>;
  totals?: Record<string, LocationTotals>;
}

interface SearchRow {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  price: string;
  unitCost: string | null;
  inventoryQuantity: number;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function StatCard({ label, value, dimmed }: { label: string; value: string; dimmed?: boolean }) {
  return (
    <div className="bg-surface-1 p-5 flex flex-col gap-2">
      <p className="text-2xs font-mono text-text-tertiary uppercase tracking-widest">{label}</p>
      <p
        className={`font-mono text-2xl font-semibold tabular-nums ${
          dimmed ? "text-text-tertiary" : "text-text-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function StockValuePage() {
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [locationId, setLocationId] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/shopify/stock-value");
    if (!res.ok) return;
    const data = (await res.json()) as { snapshot: StockSnapshot | null };
    setSnapshot(data.snapshot);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a snapshot is running its totals arrive via webhook — poll until
  // the doc settles. Old numbers stay on screen the whole time.
  const running = snapshot?.status === "running" || refreshing;
  useEffect(() => {
    if (snapshot?.status !== "running") return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [snapshot?.status, load]);

  async function triggerRefresh() {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const res = await apiFetch("/api/shopify/stock-value/refresh", { method: "POST" });
      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSec?: number };
        const min = Math.ceil((data.retryAfterSec ?? 900) / 60);
        setRefreshNote(`Refresh available in ${min} min`);
      } else if (res.status === 409) {
        setRefreshNote("Another sync is running — try again shortly");
      } else if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRefreshNote(data.error || "Refresh failed");
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  // Debounced live search — 300 ms, server-side only (spec §5).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = term.trim();
    if (!q) {
      setRows([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      try {
        const res = await apiFetch(`/api/shopify/stock-value/search?q=${encodeURIComponent(q)}`);
        if (seq !== searchSeq.current) return; // stale response
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setSearchError(data.error || "Search failed");
          setRows([]);
        } else {
          const data = (await res.json()) as { variants: SearchRow[] };
          setRows(data.variants);
          setSearchError(null);
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term]);

  const currency = snapshot?.currencyCode;
  const money = useCallback(
    (minor: number) => {
      if (!currency) return "—";
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
    },
    [currency]
  );
  const moneyStr = useCallback(
    (amount: string | null) => {
      if (amount === null || !currency) return "—";
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        parseFloat(amount)
      );
    },
    [currency]
  );

  const hasTotals = !!snapshot?.totals && !!snapshot.updatedAt;
  const totals: LocationTotals | undefined = hasTotals
    ? snapshot!.totals![locationId] ?? snapshot!.totals!.all
    : undefined;
  const locations = snapshot?.locations ?? [];

  return (
    <div className="p-4 lg:p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-text-primary">Stock Value</h1>
        <p className="text-sm text-text-tertiary">
          What your inventory is worth right now, at cost and at retail
        </p>
      </div>

      {/* Location filter — hidden entirely for single-location shops */}
      {locations.length > 1 && hasTotals && (
        <div className="mb-3">
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            aria-label="Filter by location"
            className="h-8 px-2 text-xs font-mono bg-surface-2 border border-border-0 text-text-primary focus:outline-none focus:border-border-2"
          >
            <option value="all">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Stat strip — greyed em-dashes before the first run, never zeros */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px border border-border-0 bg-border-0 mb-3">
        <StatCard label="Total Cost" value={totals ? money(totals.cost) : "—"} dimmed={!totals} />
        <StatCard label="Total Retail" value={totals ? money(totals.retail) : "—"} dimmed={!totals} />
        <StatCard
          label="Total Items"
          value={totals ? totals.items.toLocaleString() : "—"}
          dimmed={!totals}
        />
      </div>

      <div className="mb-6 flex flex-col gap-1">
        {!loaded ? (
          <p className="text-xs text-text-tertiary font-mono">Loading…</p>
        ) : !hasTotals ? (
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={triggerRefresh} loading={running}>
              {running ? "Calculating…" : "Calculate"}
            </Button>
            {snapshot?.status === "failed" && snapshot.lastError && (
              <span className="text-xs text-text-tertiary">Last attempt failed: {snapshot.lastError}</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary">
            Last updated {relativeTime(snapshot!.updatedAt!)} ·{" "}
            <button
              onClick={triggerRefresh}
              disabled={running}
              className="text-text-secondary hover:text-text-primary disabled:cursor-default"
            >
              {running ? (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border border-text-tertiary border-t-transparent rounded-full animate-spin" />
                  Refreshing…
                </span>
              ) : (
                "Refresh"
              )}
            </button>
            {snapshot?.status === "failed" && snapshot.lastError && (
              <span> · Last refresh failed: {snapshot.lastError}</span>
            )}
          </p>
        )}
        {refreshNote && <p className="text-xs text-text-tertiary">{refreshNote}</p>}
        {hasTotals && snapshot!.missingCostCount > 0 && (
          <p className="text-xs text-text-tertiary">
            {snapshot!.missingCostCount.toLocaleString()} variant
            {snapshot!.missingCostCount === 1 ? " has" : "s have"} no cost price — excluded from
            Total cost
          </p>
        )}
      </div>

      {/* Product search — live against Shopify, independent of the snapshot */}
      <div className="bg-surface-1 border border-border-0">
        <div className="flex items-center gap-3 px-4 h-11 border-b border-border-0">
          <span className="text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest shrink-0">
            Product Search
          </span>
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="square" />
            </svg>
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Title, SKU or barcode…"
              aria-label="Search products"
              className="w-full pl-7 pr-3 h-7 text-xs bg-surface-2 border border-border-0 text-text-primary placeholder:text-text-tertiary font-mono focus:outline-none focus:border-border-2 focus:ring-2 focus:ring-[var(--ps-focus)] transition-colors"
            />
          </div>
          {term && (
            <button
              onClick={() => setTerm("")}
              className="text-xs text-text-tertiary hover:text-text-secondary shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {!term.trim() ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">
            Search your catalogue by product title, SKU or barcode
          </div>
        ) : searching ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">Searching…</div>
        ) : searchError ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">{searchError}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">
            No results for &ldquo;{term.trim()}&rdquo;
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border-0">
              {rows.map((r) => (
                <div key={r.variantId} className="px-4 py-3">
                  <p className="text-sm text-text-primary">
                    {r.productTitle}
                    {r.variantTitle && <span className="text-text-tertiary"> — {r.variantTitle}</span>}
                  </p>
                  <p className="text-xs font-mono text-text-tertiary mt-0.5">
                    {r.sku || "no SKU"} · qty {r.inventoryQuantity} · {moneyStr(r.price)}
                  </p>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="hidden sm:table w-full">
              <thead>
                <tr className="border-b border-border-0">
                  {["Product", "SKU", "Barcode", "Cost", "Price", "Qty"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest first:pl-5 last:pr-5 last:text-right"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-0">
                {rows.map((r) => (
                  <tr key={r.variantId} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2.5 pl-5 text-sm text-text-primary">
                      {r.productTitle}
                      {r.variantTitle && (
                        <span className="text-text-tertiary"> — {r.variantTitle}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-text-secondary">
                      {r.sku || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-text-secondary">
                      {r.barcode || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-text-secondary tabular-nums">
                      {moneyStr(r.unitCost)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-text-secondary tabular-nums">
                      {moneyStr(r.price)}
                    </td>
                    <td className="px-4 py-2.5 pr-5 text-xs font-mono text-text-secondary tabular-nums text-right">
                      {r.inventoryQuantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
