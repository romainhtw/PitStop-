"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PurchaseOrder } from "@/lib/types";

function fmt(n: number) {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PurchaseOrderPdfPage() {
  const params = useParams<{ id: string }>();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/purchase-orders/${params.id}`)
      .then((r) => r.json())
      .then((data: PurchaseOrder | { error: string }) => {
        if ("error" in data) setError(data.error);
        else setPo(data);
      })
      .catch(() => setError("Failed to load purchase order"));
  }, [params.id]);

  // Auto-print once data is loaded
  useEffect(() => {
    if (!po) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [po]);

  const visibleItems = po?.lineItems.filter((l) => !l.hidden) ?? [];
  const subtotal = visibleItems.reduce((s, l) => s + l.qty * l.costPrice, 0);
  const gstTotal = visibleItems.reduce(
    (s, l) => s + (l.gstApplicable ? l.qty * l.costPrice * 0.1 : 0),
    0
  );
  const freight = po?.invoiceTotals?.freightShipping ?? po?.shippingCost ?? 0;
  const grandTotal = subtotal + gstTotal + freight;

  if (error) {
    return (
      <div className="p-10 text-red-600">
        <p>Error: {error}</p>
        <button onClick={() => window.history.back()} className="mt-4 text-sm underline text-gray-500">
          Go back
        </button>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="p-10 flex items-center gap-3 text-gray-400">
        <span className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <>
      {/* Screen-only toolbar */}
      <div data-no-print className="flex items-center gap-3 px-8 py-3 bg-white border-b border-gray-200 print:hidden">
        <button
          onClick={() => window.history.back()}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Back
        </button>
        <span className="text-gray-300">|</span>
        <button
          onClick={() => window.print()}
          className="text-sm font-medium text-brand-green hover:underline"
        >
          Print / Save as PDF
        </button>
      </div>

      {/* Document */}
      <div className="bg-white min-h-screen p-10 max-w-4xl mx-auto print:p-0 print:max-w-none">

        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="font-display text-4xl tracking-widest text-[#2d5a3d] leading-none mb-1">
              PITSTOP
            </div>
            <div className="text-xs text-gray-400 tracking-widest uppercase">by Elite Racing Cycles</div>
            <div className="mt-3 text-xs text-gray-500 leading-relaxed">
              Perth, Western Australia<br />
              hello@eliteracing.com.au
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900 mb-1">PURCHASE ORDER</div>
            <div className="text-xs text-gray-400 uppercase tracking-widest mb-3">
              {po.status === "draft" ? "DRAFT" : po.status === "ordered" ? "ORDERED" : po.status.toUpperCase()}
            </div>
            <table className="text-xs text-gray-600 ml-auto">
              <tbody>
                <tr>
                  <td className="pr-4 py-0.5 text-gray-400">PO Number</td>
                  <td className="font-mono font-semibold text-gray-900">{po.orderNumber || po.id.slice(0, 8).toUpperCase()}</td>
                </tr>
                {po.invoiceNumber && (
                  <tr>
                    <td className="pr-4 py-0.5 text-gray-400">Invoice No.</td>
                    <td className="font-mono font-semibold">{po.invoiceNumber}</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-4 py-0.5 text-gray-400">Date</td>
                  <td className="font-semibold">{fmtDate(po.invoiceDate || po.createdAt)}</td>
                </tr>
                {po.paymentTerms && (
                  <tr>
                    <td className="pr-4 py-0.5 text-gray-400">Terms</td>
                    <td>{po.paymentTerms}</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-4 py-0.5 text-gray-400">Currency</td>
                  <td>{po.currency || "AUD"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Supplier + Delivery */}
        <div className="grid grid-cols-2 gap-8 mb-10">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Supplier</div>
            <div className="text-sm font-semibold text-gray-900">{po.supplier || "—"}</div>
            {po.taxVatNumber && (
              <div className="text-xs text-gray-400 mt-0.5">ABN / Tax: {po.taxVatNumber}</div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Deliver To</div>
            <div className="text-sm font-semibold text-gray-900">{po.location}</div>
            <div className="text-xs text-gray-400 mt-0.5">Elite Racing Cycles, Perth WA</div>
          </div>
        </div>

        {/* Line items table */}
        <table className="w-full text-xs mb-8 border-collapse">
          <thead>
            <tr className="bg-[#2d5a3d] text-white">
              <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Description</th>
              <th className="px-3 py-2.5 text-left font-semibold tracking-wide">SKU</th>
              <th className="px-3 py-2.5 text-center font-semibold tracking-wide">Qty</th>
              <th className="px-3 py-2.5 text-right font-semibold tracking-wide">Unit Cost</th>
              <th className="px-3 py-2.5 text-right font-semibold tracking-wide">GST</th>
              <th className="px-3 py-2.5 text-right font-semibold tracking-wide">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, i) => {
              const lineTotal = item.qty * item.costPrice;
              const lineGst = item.gstApplicable ? lineTotal * 0.1 : 0;
              return (
                <tr key={item.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-3 py-2 text-gray-900 font-medium">
                    {item.name}
                    {item.optionValues && item.optionValues.length > 0 && (
                      <span className="text-gray-400 font-normal">
                        {" "}— {item.optionValues.map((o) => o.optionValue).join(" / ")}
                      </span>
                    )}
                    {item.barcode && <div className="text-gray-300 font-mono text-[10px]">{item.barcode}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{item.sku}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{item.qty}</td>
                  <td className="px-3 py-2 text-right text-gray-700">${fmt(item.costPrice)}</td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {item.gstApplicable ? `$${fmt(lineGst)}` : "GST-free"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">${fmt(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-10">
          <div className="w-64">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal (ex GST)</span>
                <span>${fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>GST (10%)</span>
                <span>${fmt(gstTotal)}</span>
              </div>
              {freight > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Freight</span>
                  <span>${fmt(freight)}</span>
                </div>
              )}
              {po.invoiceTotals?.insurance && po.invoiceTotals.insurance > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Insurance</span>
                  <span>${fmt(po.invoiceTotals.insurance)}</span>
                </div>
              )}
              {po.invoiceTotals?.customsTariffs && po.invoiceTotals.customsTariffs > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Customs / Tariffs</span>
                  <span>${fmt(po.invoiceTotals.customsTariffs)}</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-1.5 flex justify-between font-bold text-sm text-gray-900">
                <span>Total (inc GST)</span>
                <span>${fmt(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes + Signature */}
        <div className="grid grid-cols-2 gap-8 mt-8 pt-8 border-t border-gray-100">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Notes</div>
            <div className="text-xs text-gray-400 leading-relaxed">
              Please reference PO number on all correspondence and packaging.
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Authorised By</div>
            <div className="mt-6 border-b border-gray-300 w-48" />
            <div className="text-[10px] text-gray-400 mt-1">Signature / Date</div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-4 border-t border-gray-100 text-center text-[10px] text-gray-300">
          Generated by PitStop · Elite Racing Cycles · Perth, WA
        </div>
      </div>
    </>
  );
}
