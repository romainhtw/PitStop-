"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";

// Client-side mirror of lib/stockValue/snapshot.ts — the server module pulls in
// firebase-admin, so only the shape is shared, not the import.
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

interface Row {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  available: number;
  unitCost: number | null; // minor units
  price: number; // minor units
  lineCost: number | null; // minor units
  lineRetail: number; // minor units
}

type Status = "all" | "active" | "draft" | "archived";

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

const SELECT_CLASS =
  "h-8 px-2 text-xs font-mono bg-surface-2 border border-border-0 text-text-primary focus:outline-none focus:border-border-2";

export default function StockValuePage() {
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  // Filter bar
  const [locationId, setLocationId] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [excludeTags, setExcludeTags] = useState("");
  const [term, setTerm] = useState("");

  // Table
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [tableLoading, setTableLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const querySeq = useRef(0);

  const loadSnapshot = useCallback(async () => {
    const res = await apiFetch("/api/shopify/stock-value");
    if (!res.ok) return;
    const data = (await res.json()) as { snapshot: StockSnapshot | null };
    setSnapshot(data.snapshot);
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // Totals arrive via the finish webhook — poll until the doc settles. The old
  // numbers stay on screen the whole time.
  useEffect(() => {
    if (snapshot?.status !== "running") return;
    const t = setInterval(loadSnapshot, 8000);
    return () => clearInterval(t);
  }, [snapshot?.status, loadSnapshot]);

  const running = snapshot?.status === "running" || refreshing;

  async function triggerRefresh() {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const res = await apiFetch("/api/shopify/stock-value/refresh", { method: "POST" });
      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSec?: number };
        setRefreshNote(`Refresh available in ${Math.ceil((data.retryAfterSec ?? 900) / 60)} min`);
      } else if (res.status === 409) {
        setRefreshNote("Another sync is running — try again shortly");
      } else if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRefreshNote(data.error || "Refresh failed");
      }
      await loadSnapshot();
    } finally {
      setRefreshing(false);
    }
  }

  function tableUrl(after: string | null): string {
    const p = new URLSearchParams();
    if (term.trim()) p.set("q", term.trim());
    if (locationId !== "all") p.set("location", locationId);
    if (status !== "all") p.set("status", status);
    if (excludeTags.trim()) p.set("excludeTags", excludeTags.trim());
    if (after) p.set("cursor", after);
    return `/api/shopify/stock-value/products?${p.toString()}`;
  }

  // Debounced reload whenever any filter changes — 300 ms, server-side only.
  useEffect(() => {
    const handle = setTimeout(async () => {
      const seq = ++querySeq.current;
      setTableLoading(true);
      setTableError(null);
      try {
        const res = await apiFetch(tableUrl(null));
        if (seq !== querySeq.current) return; // a newer query already won
        const data = (await res.json().catch(() => ({}))) as {
          rows?: Row[];
          hasNextPage?: boolean;
          endCursor?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setTableError(data.error || "Couldn't load products");
          setRows([]);
        } else {
          setRows(data.rows ?? []);
          setHasNext(data.hasNextPage ?? false);
          setCursor(data.endCursor ?? null);
        }
      } catch {
        if (seq === querySeq.current) setTableError("Couldn't reach the server");
      } finally {
        if (seq === querySeq.current) setTableLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, locationId, status, excludeTags]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const seq = querySeq.current;
    try {
      const res = await apiFetch(tableUrl(cursor));
      const data = (await res.json().catch(() => ({}))) as {
        rows?: Row[];
        hasNextPage?: boolean;
        endCursor?: string | null;
      };
      if (seq !== querySeq.current) return; // filters changed mid-flight
      if (res.ok) {
        setRows((prev) => [...prev, ...(data.rows ?? [])]);
        setHasNext(data.hasNextPage ?? false);
        setCursor(data.endCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const currency = snapshot?.currencyCode;
  const money = useCallback(
    (minor: number | null) => {
      if (minor === null || !currency) return "—";
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
    },
    [currency]
  );

  const hasTotals = !!snapshot?.totals && !!snapshot.updatedAt;
  const totals = hasTotals ? snapshot!.totals![locationId] ?? snapshot!.totals!.all : undefined;
  const locations = snapshot?.locations ?? [];
  // Status and tag filters narrow the table but not the snapshot totals, which
  // are computed per location only. Say so rather than let the two disagree.
  const filtersNarrowTable = status !== "all" || !!excludeTags.trim() || !!term.trim();

  return (
    <div className="p-4 lg:p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-text-primary">Stock Value</h1>
        <p className="text-sm text-text-tertiary">
          What your inventory is worth right now, at cost and at retail
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {locations.length > 1 && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            aria-label="Filter by location"
            className={SELECT_CLASS}
          >
            <option value="all">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          aria-label="Filter by product status"
          className={SELECT_CLASS}
        >
          <option value="all">All products</option>
          <option value="active">Active only</option>
          <option value="draft">Draft only</option>
          <option value="archived">Archived only</option>
        </select>
        <input
          type="text"
          value={excludeTags}
          onChange={(e) => setExcludeTags(e.target.value)}
          placeholder="Exclude with tags…"
          aria-label="Exclude products with tags"
          className="h-8 px-2 w-44 text-xs font-mono bg-surface-2 border border-border-0 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-2"
        />
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
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
            className="w-full pl-7 pr-3 h-8 text-xs bg-surface-2 border border-border-0 text-text-primary placeholder:text-text-tertiary font-mono focus:outline-none focus:border-border-2 focus:ring-2 focus:ring-[var(--ps-focus)] transition-colors"
          />
        </div>
        {(term || excludeTags || status !== "all") && (
          <button
            onClick={() => {
              setTerm("");
              setExcludeTags("");
              setStatus("all");
            }}
            className="text-xs text-text-tertiary hover:text-text-secondary"
          >
            Reset
          </button>
        )}
      </div>

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
              <span className="text-xs text-text-tertiary">
                Last attempt failed: {snapshot.lastError}
              </span>
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
        {hasTotals && filtersNarrowTable && (
          <p className="text-xs text-text-tertiary">
            Totals cover every product{locationId === "all" ? "" : " at this location"} — the
            filters below apply to the table only
          </p>
        )}
      </div>

      {/* Valued product table */}
      <div className="bg-surface-1 border border-border-0">
        {tableLoading ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">Loading…</div>
        ) : tableError ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">{tableError}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm font-mono">
            {term.trim() ? `No results for “${term.trim()}”` : "No products match these filters"}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border-0">
              {rows.map((r) => (
                <div key={r.variantId} className="px-4 py-3">
                  <p className="text-sm text-text-primary">
                    {r.productTitle}
                    {r.variantTitle && (
                      <span className="text-text-tertiary"> — {r.variantTitle}</span>
                    )}
                  </p>
                  <p className="text-xs font-mono text-text-tertiary mt-0.5">
                    {r.sku || "no SKU"} · {r.available} × {money(r.unitCost)} ={" "}
                    {money(r.lineCost)}
                  </p>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-0">
                    {[
                      "Product",
                      "Variant",
                      "SKU",
                      "Barcode",
                      "Available",
                      "Current cost",
                      "Total cost",
                      "Retail price",
                      "Total retail",
                    ].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest first:pl-5 last:pr-5 ${
                          i >= 4 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-0">
                  {rows.map((r) => (
                    <tr key={r.variantId} className="hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-2.5 pl-5 text-sm text-text-primary">{r.productTitle}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-secondary">
                        {r.variantTitle || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-secondary">
                        {r.sku || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-secondary">
                        {r.barcode || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-primary tabular-nums text-right">
                        {r.available}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-secondary tabular-nums text-right">
                        {money(r.unitCost)}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-primary tabular-nums text-right">
                        {money(r.lineCost)}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-text-secondary tabular-nums text-right">
                        {money(r.price)}
                      </td>
                      <td className="px-4 py-2.5 pr-5 text-xs font-mono text-text-primary tabular-nums text-right">
                        {money(r.lineRetail)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 h-11 border-t border-border-0">
              <span className="text-2xs font-mono text-text-tertiary uppercase tracking-widest">
                {rows.length} row{rows.length === 1 ? "" : "s"} shown
              </span>
              {hasNext && (
                <Button variant="secondary" size="xs" onClick={loadMore} loading={loadingMore}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
