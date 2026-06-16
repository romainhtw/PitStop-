"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiClient";
import { v4 as uuidv4 } from "uuid";
import BackButton from "@/components/BackButton";
import ProductPicker from "@/components/ProductPicker";
import { loadCatalog } from "@/lib/catalogCache";
import type { LineItem, PurchaseOrder, ShopifyProduct } from "@/lib/types";

export default function ManualPurchaseOrderPage() {
  const router = useRouter();

  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [orderNumber, setOrderNumber] = useState("");
  const [location, setLocation] = useState<PurchaseOrder["location"]>("In-Store Fitzgerald St");
  const [currency, setCurrency] = useState("AUD");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: uuidv4(), name: "", sku: "", barcode: "", optionValues: [], category: "", qty: 1, costPrice: 0, retailPrice: 0, gstApplicable: true, hidden: false },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ShopifyProduct[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    loadCatalog(false, setCatalog).then(setCatalog).catch(() => {});
  }, []);

  // Add a product from the catalog as a prefilled line item
  const addFromCatalog = (p: ShopifyProduct) => {
    const variant = p.variantTitle && p.variantTitle !== "Default Title" ? p.variantTitle : "";
    const name = variant ? `${p.productTitle} — ${variant}` : p.productTitle;
    setLineItems((prev) => {
      // Replace the leading empty row if the form is still untouched
      const onlyEmpty = prev.length === 1 && !prev[0].name.trim() && !prev[0].sku.trim();
      const row: LineItem = {
        id: uuidv4(),
        name,
        sku: p.sku || "",
        barcode: p.barcode || "",
        optionValues: variant ? [{ optionName: "Variant", optionValue: variant }] : [],
        category: p.collections?.[0] || "",
        qty: 1,
        costPrice: p.unitCost ?? 0,
        retailPrice: p.price ?? 0,
        gstApplicable: true,
        hidden: false,
      };
      return onlyEmpty ? [row] : [...prev, row];
    });
    setPickerOpen(false);
  };

  const inputCls = "w-full rounded border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent";
  const cellCls = "w-full rounded border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent";

  const updateItem = (idx: number, patch: Partial<LineItem>) =>
    setLineItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addRow = () =>
    setLineItems((prev) => [
      ...prev,
      { id: uuidv4(), name: "", sku: "", barcode: "", optionValues: [], category: "", qty: 1, costPrice: 0, retailPrice: 0, gstApplicable: true, hidden: false },
    ]);

  const removeRow = (idx: number) =>
    setLineItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = lineItems.reduce((s, li) => s + li.qty * li.costPrice, 0);
  const gst = lineItems.filter((li) => li.gstApplicable).reduce((s, li) => s + li.qty * li.costPrice, 0) * 0.1;
  const total = subtotal + gst;

  async function handleCreate() {
    if (!supplier.trim()) { setError("Supplier name is required."); return; }
    if (lineItems.every((li) => !li.name.trim())) { setError("Add at least one line item."); return; }
    setSubmitting(true);
    setError(null);

    const now = new Date().toISOString();
    const id = uuidv4();
    const po: PurchaseOrder = {
      id,
      supplier: supplier.trim(),
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate,
      currency,
      taxVatNumber: "",
      orderNumber: orderNumber.trim(),
      location,
      paymentTerms: paymentTerms.trim(),
      lineItems,
      shippingCost: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    try {
      const res = await apiFetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(po),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create PO");
      router.push(`/purchase-orders/${data.id}/review`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-10 max-w-5xl">
      {pickerOpen && (
        <ProductPicker
          catalog={catalog}
          onSelect={addFromCatalog}
          onClose={() => setPickerOpen(false)}
          title="Add a product to this order"
        />
      )}
      <div className="mb-4"><BackButton /></div>
      <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-0.5">New Purchase Order</h1>
      <p className="text-text-secondary text-sm mb-1">Enter order details manually — no invoice upload needed.</p>
      <p className="text-sm mb-8">
        <span className="text-text-tertiary">Have the supplier invoice? </span>
        <a href="/purchase-orders/new" className="text-accent hover:underline font-medium">Upload the PDF instead →</a>
      </p>

      {/* Header */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-4">Order Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Supplier *</label>
            <input className={inputCls} value={supplier} placeholder="e.g. Supplier Name" onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Order / PO Number</label>
            <input className={inputCls} value={orderNumber} placeholder="e.g. PO-2026-001" onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Order Date</label>
            <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Invoice # (if known)</label>
            <input className={inputCls} value={invoiceNumber} placeholder="Leave blank if not yet received" onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Location</label>
            <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value as PurchaseOrder["location"])}>
              <option value="In-Store Fitzgerald St">In-Store Fitzgerald St</option>
              <option value="Warehouse">Warehouse</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Currency</label>
            <input className={inputCls} value={currency} maxLength={3} placeholder="AUD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-text-secondary mb-1 block">Payment Terms</label>
            <input className={inputCls} value={paymentTerms} placeholder="e.g. 30 days EOM" onChange={(e) => setPaymentTerms(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Line Items</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-dim text-white text-sm font-medium px-3 py-1.5 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              Search &amp; add product
            </button>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 bg-surface-2 hover:bg-surface-2 text-accent text-sm font-medium px-3 py-1.5 rounded transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Blank row
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-text-tertiary uppercase tracking-widest border-b border-border-0">
                <th className="py-2 pr-2">Item Name</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2 w-32">Collection</th>
                <th className="py-2 pr-2 w-20">Qty</th>
                <th className="py-2 pr-2 w-28">Cost (ex GST)</th>
                <th className="py-2 pr-2 w-28">Retail Price</th>
                <th className="py-2 pr-2 w-16 text-center">GST</th>
                <th className="py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li, idx) => (
                <tr key={li.id} className="border-b border-border-0">
                  <td className="py-1.5 pr-2">
                    <input className={cellCls} value={li.name} placeholder="Product name" onChange={(e) => updateItem(idx, { name: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input className={cellCls} value={li.sku} placeholder="Supplier SKU" onChange={(e) => updateItem(idx, { sku: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input list="category-options" className={cellCls} value={li.category} placeholder="Collection" onChange={(e) => updateItem(idx, { category: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" min={0} className={cellCls} value={li.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" step="0.01" min={0} className={cellCls} value={li.costPrice} onChange={(e) => updateItem(idx, { costPrice: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" step="0.01" min={0} className={cellCls} value={li.retailPrice} onChange={(e) => updateItem(idx, { retailPrice: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <input type="checkbox" checked={li.gstApplicable} onChange={(e) => updateItem(idx, { gstApplicable: e.target.checked })} className="w-4 h-4 accent-[#FF5A00]" />
                  </td>
                  <td className="py-1.5">
                    <button onClick={() => removeRow(idx)} className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-red-500 text-xl leading-none rounded transition-colors">&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="category-options">
          <option value="Apparel" /><option value="Accessories" /><option value="Footwear" />
          <option value="Electronics" /><option value="Home & Garden" /><option value="Beauty" />
          <option value="Food & Drink" /><option value="Tools" /><option value="Other" />
        </datalist>
      </div>

      {/* Totals */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <div className="flex justify-end">
          <div className="w-72 space-y-2 text-sm">
            <div className="flex justify-between text-text-secondary">
              <span>Subtotal (ex GST)</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>GST (10%)</span><span>${gst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-accent border-t border-border-0 pt-2">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-tertiary">You can upload the invoice PDF later from the review page.</p>
        <button
          onClick={handleCreate}
          disabled={submitting}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-60 text-white text-sm font-semibold px-6 py-2.5 rounded transition-colors"
        >
          {submitting && (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {submitting ? "Creating…" : "Create PO →"}
        </button>
      </div>
    </div>
  );
}
