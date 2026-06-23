"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { useRouter } from "next/navigation";
import type { PurchaseOrder, POStatus } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StatusType } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_MAP: Record<POStatus, StatusType> = {
  draft: "DRAFT",
  awaiting_review: "AWAITING_REVIEW",
  ordered: "ORDERED",
  approved: "APPROVED",
};

function DeleteButton({ po, onDelete }: { po: PurchaseOrder; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const syncedCount = po.syncResult?.results.filter(
    (r) => r.status === "synced" && r.delta
  ).length ?? 0;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const res = await apiFetch(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Delete failed");
      setDeleting(false);
      return;
    }
    onDelete(po.id);
  }

  if (deleteError) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-status-shortage">{deleteError}</span>
        <button onClick={() => { setDeleteError(null); setConfirming(false); }} className="text-xs text-text-tertiary hover:text-text-secondary">Dismiss</button>
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        {syncedCount > 0 && (
          <span className="text-xs text-status-drift font-medium">
            {syncedCount} item{syncedCount !== 1 ? "s" : ""} will be reversed in Shopify
          </span>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-status-shortage font-medium hover:underline disabled:opacity-50"
        >
          {deleting ? "Reversing…" : "Confirm delete"}
        </button>
        <span className="text-border-1">|</span>
        <button onClick={() => setConfirming(false)} className="text-xs text-text-tertiary hover:text-text-secondary">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-11 h-11 lg:w-5 lg:h-5 flex items-center justify-center text-text-tertiary hover:text-status-shortage transition-colors"
      aria-label="Delete purchase order"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
      </svg>
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  loading: boolean;
  href?: string;
  children?: React.ReactNode;
}

function StatCard({ label, value, loading, href, children }: StatCardProps) {
  const inner = (
    <div className="bg-surface-1 border border-border-0 p-5 flex flex-col gap-2 hover:border-border-1 transition-colors">
      <p className="text-2xs font-mono text-text-tertiary uppercase tracking-widest">{label}</p>
      {loading ? (
        <div className="h-8 w-24 bg-surface-3 animate-pulse" />
      ) : children ?? (
        <p className="font-mono text-2xl font-semibold text-text-primary tabular-nums">{value}</p>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function DashboardPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reusing, setReusing] = useState<string | null>(null);
  const [reuseError, setReuseError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/purchase-orders")
      .then((r) => r.json())
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  async function handleReuse(po: PurchaseOrder) {
    setReusing(po.id);
    setReuseError(null);
    try {
      const res = await apiFetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: po.supplier,
          location: po.location,
          paymentTerms: po.paymentTerms,
          currency: po.currency,
          lineItems: po.lineItems.map((li) => ({ ...li, hidden: false })),
          shippingCost: po.shippingCost,
          invoiceTotals: po.invoiceTotals,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't reuse this order");
      router.push(`/purchase-orders/${data.id}/review`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Couldn't reuse this order";
      setReuseError(
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? "Couldn't reach the server — check your connection and try again."
          : raw
      );
      setReusing(null);
    }
  }

  function handleDelete(id: string) {
    setOrders((prev) => prev.filter((po) => po.id !== id));
  }

  const q = search.toLowerCase().trim();
  const filtered = q
    ? orders.filter(
        (po) =>
          po.supplier?.toLowerCase().includes(q) ||
          po.invoiceNumber?.toLowerCase().includes(q) ||
          po.invoiceDate?.toLowerCase().includes(q) ||
          po.location?.toLowerCase().includes(q)
      )
    : orders;

  const totalCost   = orders.reduce((s, po) => s + po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0), 0);
  const totalRetail = orders.reduce((s, po) => s + po.lineItems.reduce((a, li) => a + li.qty * li.retailPrice, 0), 0);
  const totalItems  = orders.reduce((s, po) => s + po.lineItems.reduce((a, li) => a + li.qty, 0), 0);

  const supplierSpend = orders
    .filter((po) => po.status === "approved")
    .reduce<Record<string, { spend: number; poCount: number; items: number }>>((acc, po) => {
      const key = po.supplier || "Unknown";
      const cost = po.lineItems.reduce((s, li) => s + li.qty * li.costPrice, 0);
      const items = po.lineItems.reduce((s, li) => s + li.qty, 0);
      if (!acc[key]) acc[key] = { spend: 0, poCount: 0, items: 0 };
      acc[key].spend += cost;
      acc[key].poCount += 1;
      acc[key].items += items;
      return acc;
    }, {});
  const supplierRows = Object.entries(supplierSpend).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);

  return (
    <div className="p-4 lg:p-8 max-w-7xl">

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-sans text-2xl font-semibold text-text-primary tracking-tight">Dashboard</h1>
          <p className="text-xs text-text-tertiary mt-0.5 font-mono">Inventory at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/purchase-orders/new/manual">
            <Button variant="secondary" size="sm">+ Manual order</Button>
          </Link>
          <Link href="/purchase-orders/new">
            <Button variant="primary" size="sm">+ Upload invoice</Button>
          </Link>
        </div>
      </div>

      {reuseError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 bg-status-shortage-bg border border-status-shortage/30 px-4 py-2.5">
          <span className="text-sm text-status-shortage">{reuseError}</span>
          <button onClick={() => setReuseError(null)} className="text-xs text-text-tertiary hover:text-text-secondary shrink-0">Dismiss</button>
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-px border border-border-0 bg-border-0 mb-6 overflow-hidden">
        <StatCard label="Cost Value"  value={fmt(totalCost)}   loading={loading} />
        <StatCard label="Retail Value" value={fmt(totalRetail)} loading={loading} />
        <StatCard label="Total Items" value={totalItems}        loading={loading} />
      </div>

      {/* Purchase Orders table */}
      <div className="bg-surface-1 border border-border-0 mb-6">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 h-11 border-b border-border-0">
          <span className="text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest shrink-0">
            Purchase Orders
          </span>
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" strokeLinecap="square"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Supplier, invoice, date…"
              aria-label="Search purchase orders"
              className="w-full pl-7 pr-3 h-7 text-xs bg-surface-2 border border-border-0 text-text-primary placeholder:text-text-tertiary font-mono focus:outline-none focus:border-border-2 focus:ring-2 focus:ring-[var(--ps-focus)] transition-colors"
            />
          </div>
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-text-tertiary hover:text-text-secondary shrink-0">
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-tertiary text-sm font-mono">
            Loading…
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-sm text-text-tertiary">No purchase orders yet</p>
            <Link href="/purchase-orders/new" className="text-xs text-accent hover:text-accent-dim font-mono transition-colors">
              Create your first one →
            </Link>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-border-0">
              {filtered.length === 0 && (
                <div className="p-8 text-center text-text-tertiary text-sm font-mono">No results for &ldquo;{search}&rdquo;</div>
              )}
              {filtered.map((po) => {
                const cost = po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0);
                return (
                  <div key={po.id} className="px-4 py-3 hover:bg-surface-2 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-sans text-sm font-medium text-text-primary">{po.supplier || "—"}</p>
                        <p className="font-mono text-xs text-text-secondary mt-0.5">#{po.invoiceNumber || "—"} · {po.invoiceDate || "—"}</p>
                        <p className="font-mono text-xs text-text-tertiary">{po.location}</p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <p className="font-mono text-sm font-semibold text-text-primary tabular-nums">{fmt(cost)}</p>
                        <StatusBadge status={STATUS_MAP[po.status]} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <Link href={`/purchase-orders/${po.id}/review`} className="text-xs font-medium text-accent hover:text-accent-dim transition-colors">
                        View →
                      </Link>
                      <div className="flex items-center gap-3">
                        <button onClick={() => handleReuse(po)} disabled={reusing === po.id} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50">
                          {reusing === po.id ? "Creating…" : "Reuse"}
                        </button>
                        <DeleteButton po={po} onDelete={handleDelete} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-0">
                    {["Invoice #", "Supplier", "Date", "Location", "Items", "Total Cost", "Status", "", ""].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest first:pl-5 last:pr-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-8 text-center text-text-tertiary text-sm font-mono">
                        No results for &ldquo;{search}&rdquo;
                      </td>
                    </tr>
                  )}
                  {filtered.map((po) => {
                    const itemsCount = po.lineItems.reduce((a, li) => a + li.qty, 0);
                    const cost       = po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0);
                    return (
                      <tr key={po.id} className="border-t border-border-0 hover:bg-surface-2 transition-colors">
                        <td className="pl-5 pr-4 py-2.5 font-mono text-sm text-text-primary">{po.invoiceNumber || "—"}</td>
                        <td className="px-4 py-2.5 font-sans text-sm text-text-primary">{po.supplier || "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-text-secondary">{po.invoiceDate || "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-text-secondary">{po.location}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-text-primary tabular-nums text-right">{itemsCount}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-text-primary tabular-nums text-right">{fmt(cost)}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={STATUS_MAP[po.status]} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-4">
                            <button onClick={() => handleReuse(po)} disabled={reusing === po.id} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50">
                              {reusing === po.id ? "Creating…" : "Reuse"}
                            </button>
                            <Link href={`/purchase-orders/${po.id}/review`} className="text-xs font-medium text-accent hover:text-accent-dim transition-colors">
                              View →
                            </Link>
                          </div>
                        </td>
                        <td className="pr-5 pl-2 py-2.5 text-center">
                          <DeleteButton po={po} onDelete={handleDelete} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Supplier Spend */}
      {supplierRows.length > 0 && (
        <div className="bg-surface-1 border border-border-0">
          <div className="flex items-center px-5 h-11 border-b border-border-0">
            <span className="text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest">
              Supplier Spend — Approved
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-0">
                  {["Supplier", "Total Spend", "POs", "Items", "Share"].map((h, i) => (
                    <th key={h} className={`px-5 py-2.5 text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest ${i > 0 ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supplierRows.map(([supplier, data]) => {
                  const share = totalCost > 0 ? (data.spend / totalCost) * 100 : 0;
                  return (
                    <tr key={supplier} className="border-t border-border-0 hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-2.5 font-sans text-sm text-text-primary">{supplier}</td>
                      <td className="px-5 py-2.5 font-mono text-sm text-text-primary tabular-nums text-right font-medium">{fmt(data.spend)}</td>
                      <td className="px-5 py-2.5 font-mono text-sm text-text-secondary tabular-nums text-right">{data.poCount}</td>
                      <td className="px-5 py-2.5 font-mono text-sm text-text-secondary tabular-nums text-right">{data.items}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          {/* Hard bar — no rounded-full */}
                          <div className="w-20 h-1 bg-surface-3 overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all duration-300"
                              style={{ width: `${Math.min(share, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-text-tertiary w-8 text-right tabular-nums">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
