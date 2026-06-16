"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/types";

interface ProductPickerProps {
  catalog: ShopifyProduct[];
  onSelect: (product: ShopifyProduct) => void;
  onClose: () => void;
  /** Pre-fill the search box (e.g. the parsed line-item name). */
  initialQuery?: string;
  title?: string;
}

const norm = (s: string | undefined | null) => (s || "").toLowerCase();

/**
 * Shared product search/select modal. Searches the loaded catalog instantly
 * (title, variant, SKU, barcode, collection) and groups variants under their
 * parent product so size/colour options appear together. Used by manual PO
 * creation, manual add-item, and the review-page match flow.
 */
export default function ProductPicker({
  catalog,
  onSelect,
  onClose,
  initialQuery = "",
  title = "Find a product",
}: ProductPickerProps) {
  const [q, setQ] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const query = norm(q).trim();
    if (query.length < 2) return [];
    const terms = query.split(/\s+/).filter(Boolean);

    const matched = catalog.filter((p) => {
      const hay = `${norm(p.productTitle)} ${norm(p.variantTitle)} ${norm(p.sku)} ${norm(p.barcode)} ${(p.collections ?? []).map(norm).join(" ")}`;
      return terms.every((t) => hay.includes(t));
    });

    // Group variants under their parent product
    const map = new Map<string, { title: string; collection: string; variants: ShopifyProduct[] }>();
    for (const p of matched) {
      const key = p.productId || p.productTitle;
      if (!map.has(key)) {
        map.set(key, { title: p.productTitle, collection: p.collections?.[0] || "", variants: [] });
      }
      map.get(key)!.variants.push(p);
    }
    return Array.from(map.values()).slice(0, 50);
  }, [q, catalog]);

  const variantLabel = (p: ShopifyProduct) =>
    p.variantTitle && p.variantTitle !== "Default Title" ? p.variantTitle : "";

  const stock = (p: ShopifyProduct) => (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 pt-20" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border-1 w-full max-w-2xl max-h-[75vh] flex flex-col rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header / search */}
        <div className="p-4 border-b border-border-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors text-lg leading-none">&times;</button>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by product name, SKU, barcode, or collection…"
              className="w-full pl-10 pr-3 py-2.5 text-sm rounded border border-border-1 bg-white text-gray-900 placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {q.trim().length < 2 ? (
            <p className="text-center text-text-tertiary text-sm py-12">Type at least 2 characters to search the catalog.</p>
          ) : groups.length === 0 ? (
            <p className="text-center text-text-tertiary text-sm py-12">No products match &ldquo;{q}&rdquo;.</p>
          ) : (
            <div className="divide-y divide-border-0">
              {groups.map((g, gi) => (
                <div key={gi} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-text-primary">{g.title}</p>
                    {g.collection && <span className="shrink-0 text-[10px] font-mono text-text-tertiary uppercase tracking-wide">{g.collection}</span>}
                  </div>
                  <div className="flex flex-col gap-1">
                    {g.variants.map((p) => (
                      <button
                        key={p.variantId}
                        onClick={() => onSelect(p)}
                        className="group flex items-center justify-between gap-3 text-left px-3 py-2 rounded border border-transparent hover:border-accent hover:bg-surface-2 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text-primary truncate">
                            {variantLabel(p) || <span className="text-text-tertiary italic">Default</span>}
                          </p>
                          <p className="text-[11px] font-mono text-text-tertiary truncate">
                            {p.sku || "no SKU"}{p.barcode ? ` · ${p.barcode}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-mono text-text-primary tabular-nums">${(p.price ?? 0).toFixed(2)}</p>
                          <p className="text-[11px] font-mono text-text-tertiary tabular-nums">{stock(p)} in stock</p>
                        </div>
                        <span className="shrink-0 text-accent opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium">Select</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
