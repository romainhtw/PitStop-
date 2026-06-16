"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiClient";
import BackButton from "@/components/BackButton";
import ProductPicker from "@/components/ProductPicker";
import { v4 as uuidv4 } from "uuid";
import type { InvoiceTotals, LineItem, PurchaseOrder, ShopifyProduct, SyncResult, VariantSuggestion } from "@/lib/types";
import { loadCatalog } from "@/lib/catalogCache";
import { suggestMatches, confidenceTier as matchTier, type ScoredProduct } from "@/lib/productMatch";

interface CreateFormFields {
  title: string;
  sku: string;
  barcode: string;
  price: string;
  productType: string;
}

function confidenceTier(score?: number): { label: string; className: string } {
  if (score === undefined) return { label: "Unknown", className: "text-text-tertiary bg-surface-2" };
  if (score >= 80) return { label: "Strong", className: "text-emerald-700 bg-emerald-50" };
  if (score >= 60) return { label: "Possible", className: "text-amber-700 bg-amber-100" };
  return { label: "Weak", className: "text-text-secondary bg-surface-2" };
}

function ConfidenceBadge({ score }: { score?: number }) {
  const { label, className } = confidenceTier(score);
  return (
    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
}

function CreateProductForm({
  form,
  creating,
  onChange,
  onSubmit,
  onCancel,
}: {
  lineItemId: string;
  form: CreateFormFields;
  creating: boolean;
  onChange: (patch: Partial<CreateFormFields>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const fieldCls = "w-full rounded border border-amber-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent";
  return (
    <div className="mt-2 bg-surface-1 border border-amber-200 rounded-lg p-3 space-y-2">
      <p className="text-[10px] font-bold text-accent uppercase tracking-widest mb-1">New Shopify product</p>
      <div>
        <label className="text-[10px] text-text-secondary mb-0.5 block">Title *</label>
        <input className={fieldCls} value={form?.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-text-secondary mb-0.5 block">SKU</label>
          <input className={fieldCls} value={form?.sku ?? ""} onChange={(e) => onChange({ sku: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary mb-0.5 block">Barcode</label>
          <input className={fieldCls} value={form?.barcode ?? ""} onChange={(e) => onChange({ barcode: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary mb-0.5 block">Retail Price ($)</label>
          <input type="number" step="0.01" min={0} className={fieldCls} value={form?.price ?? ""} onChange={(e) => onChange({ price: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary mb-0.5 block">Product Type</label>
          <input className={fieldCls} value={form?.productType ?? ""} onChange={(e) => onChange({ productType: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <button onClick={onCancel} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">Cancel</button>
        <button
          onClick={onSubmit}
          disabled={creating || !form?.title?.trim()}
          className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          {creating ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Creating…
            </>
          ) : "Create & Match →"}
        </button>
      </div>
    </div>
  );
}

export default function ReviewPurchaseOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [taxVatNumber, setTaxVatNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [location, setLocation] = useState<PurchaseOrder["location"]>("In-Store Fitzgerald St");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [invoiceTotals, setInvoiceTotals] = useState<InvoiceTotals | undefined>(undefined);
  // GST base — whether GST is charged on goods only or goods + freight (AU default). Auto-detected from the invoice.
  const [gstBase, setGstBase] = useState<"goods" | "goods_plus_freight">("goods_plus_freight");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pdfPaneOpen, setPdfPaneOpen] = useState(false);
  const [markingOrdered, setMarkingOrdered] = useState(false);
  const [headerSaving, setHeaderSaving] = useState(false);
  const [headerSaved, setHeaderSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [previewResult, setPreviewResult] = useState<SyncResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [poStatus, setPoStatus] = useState<PurchaseOrder["status"]>("draft");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  type ConfirmedMapping = { variantId: string; inventoryItemId: string; productTitle: string };
  const [confirmedMappings, setConfirmedMappings] = useState<Record<string, ConfirmedMapping>>({});
  const [duplicateInvoiceError, setDuplicateInvoiceError] = useState<{ detectedAt: string; originalPoId: string } | null>(null);
  type ConflictItem = { lineItemId: string; name: string; expectedQty: number; actualQty: number; suggestedQty: number };
  const [conflictItems, setConflictItems] = useState<ConflictItem[]>([]);

  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ShopifyProduct[]>([]);
  // Which line item's product-search modal is open (null = closed). "__add__" = add a brand-new item.
  const [pickerForLine, setPickerForLine] = useState<string | null>(null);


  const [manualSearchQueries, setManualSearchQueries] = useState<Record<string, string>>({});
  const [manualSearchResults, setManualSearchResults] = useState<Record<string, VariantSuggestion[]>>({});
  const [manualSearching, setManualSearching] = useState<Record<string, boolean>>({});
  const [showSearchFor, setShowSearchFor] = useState<Record<string, boolean>>({});
  const [showCreateFor, setShowCreateFor] = useState<Record<string, boolean>>({});
  const [createFormData, setCreateFormData] = useState<Record<string, { title: string; sku: string; barcode: string; price: string; productType: string }>>({});
  const [creating, setCreating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const applyCatalog = (products: ShopifyProduct[]) => {
      setCatalog(products);
      const cols = Array.from(
        new Set(products.flatMap((p) => p.collections ?? []).filter(Boolean))
      ).sort();
      setCatalogCategories(cols);
    };
    loadCatalog(false, applyCatalog).then(applyCatalog).catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/purchase-orders/${id}`);
        if (!res.ok) throw new Error("Purchase order not found");
        const po = await res.json() as PurchaseOrder;

        setSupplier(po.supplier || "");
        setInvoiceNumber(po.invoiceNumber || "");
        setInvoiceDate(po.invoiceDate || "");
        setCurrency(po.currency || "AUD");
        setTaxVatNumber(po.taxVatNumber || "");
        setOrderNumber(po.orderNumber || "");
        setLocation(po.location || "In-Store Fitzgerald St");
        setPaymentTerms(po.paymentTerms || "");
        setShippingCost(Number(po.shippingCost) || 0);
        if (po.exchangeRate) setExchangeRate(po.exchangeRate);
        if (po.invoiceTotals) {
          const it = po.invoiceTotals;
          // Keep the invoice totals exactly as parsed — never rewrite the supplier's numbers.
          setInvoiceTotals(it);
          // Detect which GST base the supplier actually used by reverse-checking taxTotal.
          // A stored gstBase (from a previous edit) always wins.
          if (po.gstBase) {
            setGstBase(po.gstBase);
          } else if (it.taxTotal > 0 && it.subtotal > 0) {
            const goodsGst = it.subtotal * 0.1;
            const goodsFreightGst = (it.subtotal + it.freightShipping) * 0.1;
            const dGoods = Math.abs(it.taxTotal - goodsGst);
            const dFreight = Math.abs(it.taxTotal - goodsFreightGst);
            setGstBase(dFreight < dGoods ? "goods_plus_freight" : "goods");
          }
        }
        setLineItems(
          (po.lineItems || []).map((li) => ({
            id: li.id || uuidv4(),
            name: li.name || "",
            sku: li.sku || "",
            barcode: li.barcode || "",
            optionValues: li.optionValues || [],
            category: li.category || "",
            qty: Number(li.qty) || 0,
            costPrice: Number(li.costPrice) || 0,
            retailPrice: Number(li.retailPrice) || 0,
            gstApplicable: li.gstApplicable ?? true,
            hidden: li.hidden || false,
          }))
        );

        // Load supplier notes if available
        if (po.supplier) {
          const key = encodeURIComponent(po.supplier.toLowerCase().trim());
          const suppRes = await apiFetch(`/api/suppliers/${key}`);
          if (suppRes.ok) {
            const supp = await suppRes.json();
            if (supp.parseHints) {
              setSupplierNotes(supp.parseHints);
              setNotesOpen(true);
            }
            if (supp.defaultLocation && !po.location) {
              setLocation(supp.defaultLocation);
            }
          }
        }
        setPoStatus(po.status || "draft");
        if (po.pdfUrl) setPdfUrl(po.pdfUrl);
        if (po.syncResult) setSyncResult(po.syncResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load purchase order");
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, [id]);

  const subtotal = useMemo(
    () => lineItems.reduce((s, li) => s + li.qty * li.costPrice, 0),
    [lineItems]
  );
  const gstableItemsTotal = useMemo(
    () =>
      lineItems
        .filter((li) => li.gstApplicable)
        .reduce((s, li) => s + li.qty * li.costPrice, 0),
    [lineItems]
  );
  const shipping = Number(shippingCost) || 0;
  // GST base is detected per-invoice and user-overridable (Task 1).
  // "goods_plus_freight" = AU default (domestic freight is taxable); "goods" = some suppliers charge GST on goods only.
  const gstBaseAmount = gstBase === "goods_plus_freight" ? gstableItemsTotal + shipping : gstableItemsTotal;
  const gst = gstBaseAmount * 0.1;
  const total = subtotal + shipping + gst;

  // Bulk sync warning — >50 visible items risk a timeout
  const visibleItemCount = lineItems.filter((li) => !li.hidden).length;
  const isBulkPO = visibleItemCount > 50;

  // Math hard block — disable Preview + Sync if invoice total mismatches by > $1
  const mathDiscrepancy = useMemo(() => {
    if (!invoiceTotals?.grandTotal || invoiceTotals.grandTotal <= 0) return false;
    return Math.abs(total - invoiceTotals.grandTotal) > 1;
  }, [total, invoiceTotals]);

  // Would flipping the GST base resolve a current discrepancy? (Task 1 — "GST reverse" hint)
  const gstSwitchWouldFix = useMemo(() => {
    if (!invoiceTotals?.grandTotal || invoiceTotals.grandTotal <= 0) return false;
    const altBaseAmount = gstBase === "goods_plus_freight" ? gstableItemsTotal : gstableItemsTotal + shipping;
    const altTotal = subtotal + shipping + altBaseAmount * 0.1;
    return Math.abs(total - invoiceTotals.grandTotal) > 1 && Math.abs(altTotal - invoiceTotals.grandTotal) <= 1;
  }, [total, invoiceTotals, gstBase, gstableItemsTotal, shipping, subtotal]);

  // Live landed cost recalc — updates instantly when freight/customs fields change
  const liveLandedCosts = useMemo(() => {
    if (!previewResult) return new Map<string, number>();
    const surcharge = (invoiceTotals?.freightShipping ?? 0) + (invoiceTotals?.insurance ?? 0) + (invoiceTotals?.customsTariffs ?? 0) + (invoiceTotals?.brokerageFees ?? 0);
    const matched = previewResult.results.filter((r) => r.inventoryItemId);
    const items = matched.map((r) => {
      const li = lineItems.find((li) => li.id === r.lineItemId);
      return { lineItemId: r.lineItemId, costPrice: li?.costPrice ?? 0, qty: li?.qty ?? 0 };
    });
    const invoiceValue = items.reduce((s, it) => s + it.costPrice * it.qty, 0);
    const map = new Map<string, number>();
    for (const it of items) {
      const share = invoiceValue > 0 ? (it.costPrice * it.qty) / invoiceValue : 0;
      const allocation = surcharge > 0 ? (share * surcharge) / Math.max(it.qty, 1) : 0;
      map.set(it.lineItemId, it.costPrice + allocation);
    }
    return map;
  }, [previewResult, invoiceTotals, lineItems]);

  const updateItem = (idx: number, patch: Partial<LineItem>) =>
    setLineItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addRow = () =>
    setLineItems((prev) => [
      ...prev,
      { id: uuidv4(), name: "", sku: "", barcode: "", optionValues: [], category: "", qty: 1, costPrice: 0, retailPrice: 0, gstApplicable: true, hidden: false },
    ]);

  // ── Inline Shopify matching (Task 2) ────────────────────────────────────────
  // Recompute suggestions only when a matching-relevant field changes (not on qty/price edits).
  const matchSignature = useMemo(
    () => lineItems
      .map((li) => `${li.id}|${li.name}|${li.sku}|${li.barcode}|${(li.optionValues ?? []).map((o) => o.optionValue).join(",")}`)
      .join("¶"),
    [lineItems]
  );
  const suggestionsByLine = useMemo(() => {
    const map: Record<string, ScoredProduct[]> = {};
    if (catalog.length === 0) return map;
    for (const li of lineItems) {
      if (li.hidden) continue;
      map[li.id] = suggestMatches(li, catalog, 5);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchSignature, catalog]);

  // Confirm a catalog product as the Shopify match for a line item
  const confirmMatch = (lineItemId: string, p: ShopifyProduct) => {
    setConfirmedMappings((prev) => ({
      ...prev,
      [lineItemId]: { variantId: p.variantId, inventoryItemId: p.inventoryItemId, productTitle: p.productTitle },
    }));
  };
  const clearMatch = (lineItemId: string) => {
    setConfirmedMappings((prev) => {
      const next = { ...prev };
      delete next[lineItemId];
      return next;
    });
  };

  // Task 5 — add a brand-new line item straight from the catalog, pre-matched
  const addItemFromCatalog = (p: ShopifyProduct) => {
    const variant = p.variantTitle && p.variantTitle !== "Default Title" ? p.variantTitle : "";
    const name = variant ? `${p.productTitle} — ${variant}` : p.productTitle;
    const newId = uuidv4();
    setLineItems((prev) => [
      ...prev,
      {
        id: newId,
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
      },
    ]);
    confirmMatch(newId, p);
  };

  // Single entry point for the ProductPicker's onSelect — routes to the right action
  const handlePickerSelect = (p: ShopifyProduct) => {
    if (pickerForLine && pickerForLine !== "__add__") {
      confirmMatch(pickerForLine, p);
    } else {
      addItemFromCatalog(p);
    }
    setPickerForLine(null);
  };

  const handleMarkOrdered = async () => {
    setMarkingOrdered(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/purchase-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(), status: "ordered", orderedAt: new Date().toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setPoStatus("ordered");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMarkingOrdered(false);
    }
  };

  const handleManualSearch = async (lineItemId: string) => {
    const q = manualSearchQueries[lineItemId]?.trim();
    if (!q) return;
    setManualSearching((prev) => ({ ...prev, [lineItemId]: true }));
    try {
      const res = await apiFetch(`/api/shopify/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setManualSearchResults((prev) => ({ ...prev, [lineItemId]: data.variants ?? [] }));
    } finally {
      setManualSearching((prev) => ({ ...prev, [lineItemId]: false }));
    }
  };

  function openCreateForm(lineItemId: string, name: string, sku: string, retailPrice: number, category: string) {
    setCreateFormData((prev) => ({
      ...prev,
      [lineItemId]: {
        title: name,
        sku: sku || "",
        barcode: "",
        price: retailPrice > 0 ? retailPrice.toFixed(2) : "",
        productType: category || "",
      },
    }));
    setShowCreateFor((prev) => ({ ...prev, [lineItemId]: true }));
  }

  async function handleCreateProduct(lineItemId: string) {
    const form = createFormData[lineItemId];
    if (!form?.title?.trim()) return;
    setCreating((prev) => ({ ...prev, [lineItemId]: true }));
    try {
      const res = await apiFetch("/api/shopify/create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Creation failed");
      setConfirmedMappings((prev) => ({
        ...prev,
        [lineItemId]: {
          variantId: data.variantId,
          inventoryItemId: data.inventoryItemId,
          productTitle: data.productTitle,
        },
      }));
      setShowCreateFor((prev) => ({ ...prev, [lineItemId]: false }));
      setShowSearchFor((prev) => ({ ...prev, [lineItemId]: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setCreating((prev) => ({ ...prev, [lineItemId]: false }));
    }
  }

  // Prefill the "create product" form from the parsed line item, then open it inline
  const openCreateFor = (li: LineItem) => {
    setCreateFormData((prev) => ({
      ...prev,
      [li.id]: {
        title: [li.name, ...(li.optionValues ?? []).map((o) => o.optionValue)].filter(Boolean).join(" "),
        sku: li.sku || "",
        barcode: li.barcode || "",
        price: li.retailPrice ? String(li.retailPrice) : "",
        productType: li.category || "",
      },
    }));
    setShowCreateFor((prev) => ({ ...prev, [li.id]: true }));
  };

  const removeRow = (idx: number) =>
    setLineItems((prev) => prev.filter((_, i) => i !== idx));

  function buildPayload() {
    return { supplier, invoiceNumber, invoiceDate, currency, exchangeRate: currency !== "AUD" ? exchangeRate : undefined, taxVatNumber, orderNumber, location, paymentTerms, lineItems, shippingCost: Number(shippingCost) || 0, invoiceTotals, gstBase };
  }

  // Session expired → bounce to login instead of showing a cryptic "UNAUTHORIZED"
  function redirectToLoginIf401(res: Response): boolean {
    if (res.status === 401) {
      window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
      return true;
    }
    return false;
  }

  async function saveSupplierNotes() {
    if (!supplier) return;
    const key = encodeURIComponent(supplier.toLowerCase().trim());
    await apiFetch(`/api/suppliers/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: supplier, parseHints: supplierNotes, defaultLocation: location }),
    });
  }

  async function putPO(status: PurchaseOrder["status"]) {
    const res = await apiFetch(`/api/purchase-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildPayload(), status }),
    });
    if (redirectToLoginIf401(res)) throw new Error("Session expired — redirecting to login…");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save purchase order");
    return data as PurchaseOrder;
  }

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Preserve an already-progressed status — never downgrade an approved/ordered PO
      const nextStatus: PurchaseOrder["status"] =
        poStatus === "approved" || poStatus === "ordered" ? poStatus : "awaiting_review";
      await Promise.all([putPO(nextStatus), saveSupplierNotes()]);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setSubmitting(false);
    }
  };

  // Persist edits without leaving the page — works for ANY status (edit later).
  // This is what makes a synced PO re-editable: the bottom Save row is hidden once
  // a syncResult exists, so this header button is the always-available save path.
  const handleSaveStay = async () => {
    setHeaderSaving(true);
    setHeaderSaved(false);
    setError(null);
    try {
      await Promise.all([putPO(poStatus), saveSupplierNotes()]);
      setHeaderSaved(true);
      setTimeout(() => setHeaderSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setHeaderSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      await Promise.all([putPO("awaiting_review"), saveSupplierNotes()]);
      const res = await apiFetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: id, dryRun: true, overrides: confirmedMappings }),
      });
      if (redirectToLoginIf401(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      const result = data as SyncResult;
      setPreviewResult(result);

      // Auto-fill retailPrice and category from Shopify for matched items
      setLineItems((prev) =>
        prev.map((li) => {
          const match = result.results.find(
            (r) => r.lineItemId === li.id && r.status === "synced"
          );
          if (!match) return li;
          return {
            ...li,
            ...(li.retailPrice === 0 && match.shopifyPrice != null ? { retailPrice: match.shopifyPrice } : {}),
            ...(li.category === "" && match.shopifyCategory ? { category: match.shopifyCategory } : {}),
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmSync = async () => {
    setSyncing(true);
    setError(null);
    setDuplicateInvoiceError(null);
    setConflictItems([]);
    try {
      const syncRes = await apiFetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: id, overrides: confirmedMappings }),
      });
      if (redirectToLoginIf401(syncRes)) return;
      const syncData = await syncRes.json();
      if (syncRes.status === 409 || syncData.duplicateInvoice) {
        setDuplicateInvoiceError(syncData.duplicateInvoice);
        return;
      }
      if (!syncRes.ok) throw new Error(syncData.error || "Shopify sync failed");
      const result = syncData as SyncResult;
      const conflicts: ConflictItem[] = (result.results ?? [])
        .filter((r) => r.conflictError)
        .map((r) => ({
          lineItemId: r.lineItemId,
          name: r.name,
          expectedQty: r.conflictError!.expectedQty,
          actualQty: r.conflictError!.actualQty,
          suggestedQty: r.conflictError!.suggestedQty,
        }));
      if (conflicts.length > 0) setConflictItems(conflicts);
      setPreviewResult(null);
      setSyncResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  };

  const inputCls = "w-full rounded border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent";
  const cellCls = "w-full rounded border border-border-1 bg-surface-2 text-text-primary placeholder:text-text-tertiary px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent";
  const isBusy = submitting || syncing || previewing;

  if (!loaded) {
    return (
      <div className="p-10 flex items-center gap-3 text-text-tertiary">
        <div className="w-5 h-5 border-2 border-border-1 border-t-accent rounded-full animate-spin" />
        Loading purchase order…
      </div>
    );
  }

  if (error && !loaded) {
    return <div className="p-10 text-red-600">{error}</div>;
  }

  return (
    <div className={pdfPaneOpen && pdfUrl ? "flex h-screen overflow-hidden" : ""}>
      {/* Product search modal — used for both per-line matching and adding new items */}
      {pickerForLine !== null && (
        <ProductPicker
          catalog={catalog}
          onSelect={handlePickerSelect}
          onClose={() => setPickerForLine(null)}
          initialQuery={
            pickerForLine !== "__add__"
              ? (lineItems.find((li) => li.id === pickerForLine)?.name ?? "")
              : ""
          }
          title={pickerForLine === "__add__" ? "Add a product to this PO" : "Find the Shopify match"}
        />
      )}
      {/* Split-pane PDF viewer */}
      {pdfPaneOpen && pdfUrl && (
        <div className="w-1/2 h-full border-r border-border-1 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-2 bg-surface-1 border-b border-border-1">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Invoice PDF</span>
            <button onClick={() => setPdfPaneOpen(false)} className="text-text-tertiary hover:text-text-secondary text-lg leading-none">&times;</button>
          </div>
          <iframe src={pdfUrl} className="flex-1 w-full" title="Invoice PDF" />
        </div>
      )}

      <div className={`${pdfPaneOpen && pdfUrl ? "flex-1 overflow-y-auto" : ""} p-10 max-w-6xl`}>
      <div className="mb-4"><BackButton /></div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-accent mb-1">Review Purchase Order</h1>
          <p className="text-text-secondary text-sm">
            Check the extracted details, fix anything incorrect, then save or sync directly to Shopify.
          </p>
        </div>
        {/* Always-visible actions */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {loaded && (
            <button
              onClick={handleSaveStay}
              disabled={headerSaving}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded border transition-colors disabled:opacity-60 ${
                headerSaved
                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                  : "border-accent text-accent hover:bg-surface-2"
              }`}
              title="Save changes and stay on this page"
            >
              {headerSaving ? "Saving…" : headerSaved ? "✓ Saved" : "Save changes"}
            </button>
          )}
          {pdfUrl && (
            <button
              onClick={() => setPdfPaneOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 text-sm border px-3 py-2 rounded transition-colors ${pdfPaneOpen ? "border-accent text-accent bg-surface-2" : "border-border-1 text-text-secondary hover:border-accent hover:text-accent"}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              {pdfPaneOpen ? "Close PDF" : "View PDF"}
            </button>
          )}
          <a
            href={`/purchase-orders/${params.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm border border-border-1 text-text-secondary hover:border-accent hover:text-accent px-3 py-2 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download PO
          </a>
          {poStatus !== "approved" && (
            <button
              onClick={handleMarkOrdered}
              disabled={markingOrdered || poStatus === "ordered"}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded border transition-colors disabled:opacity-60 ${
                poStatus === "ordered"
                  ? "border-blue-300 text-blue-700 bg-blue-50 cursor-default"
                  : "border-border-1 text-text-secondary hover:border-accent hover:text-accent"
              }`}
            >
              {poStatus === "ordered" ? "✓ Ordered" : markingOrdered ? "Marking…" : "Mark as Ordered"}
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <h2 className="text-xs font-semibold text-text-tertiary mb-4 uppercase tracking-wide">Header</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Supplier</label>
            <input className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Invoice #</label>
            <input className={inputCls} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Invoice Date</label>
            <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Order #</label>
            <input className={inputCls} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Location</label>
            <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value as PurchaseOrder["location"])}>
              <option value="In-Store Fitzgerald St">In-Store Fitzgerald St</option>
              <option value="Warehouse">Warehouse</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Payment Terms</label>
            <input className={inputCls} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">
              Currency
              <span className="ml-1 text-text-tertiary font-normal">(ISO 4217)</span>
            </label>
            <input className={inputCls} value={currency} maxLength={3} placeholder="AUD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">
              Tax / VAT Number
              <span className="ml-1 text-text-tertiary font-normal">(ABN, GST reg…)</span>
            </label>
            <input className={inputCls} value={taxVatNumber} placeholder="e.g. ABN 12 345 678 901" onChange={(e) => setTaxVatNumber(e.target.value)} />
          </div>
          {currency && currency !== "AUD" && (
            <div>
              <label className="text-xs text-text-secondary mb-1 block">
                Exchange Rate
                <span className="ml-1 text-text-tertiary font-normal">1 {currency} = ? AUD</span>
              </label>
              <input
                type="number"
                step="0.0001"
                min={0}
                className={inputCls}
                value={exchangeRate}
                placeholder="e.g. 1.52"
                onChange={(e) => setExchangeRate(Number(e.target.value) || 1)}
              />
              <p className="text-[11px] text-text-tertiary mt-1">Applied to cost prices when syncing to Shopify.</p>
            </div>
          )}
        </div>
      </div>

      {/* Supplier Notes */}
      <div className="bg-surface-1 border border-border-1 mb-6 overflow-hidden">
        <button
          onClick={() => setNotesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Supplier Notes</span>
            {supplierNotes && (
              <span className="text-xs bg-surface-2 text-accent px-2 py-0.5 rounded-full font-medium">saved</span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-text-tertiary transition-transform ${notesOpen ? "rotate-180" : ""}`}
            viewBox="0 0 20 20" fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        {notesOpen && (
          <div className="px-6 pb-5">
            <p className="text-xs text-text-secondary mb-2">
              Notes about this supplier&apos;s invoices — saved and injected into every future parse from this supplier.
            </p>
            <textarea
              rows={3}
              placeholder={`e.g. "Use Sales amount column for cost price (38% trade discount). SKU is labelled 'Item number'."`}
              className="w-full rounded border border-border-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent resize-none"
              value={supplierNotes}
              onChange={(e) => setSupplierNotes(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Line Items</h2>
            {lineItems.filter((li) => li.hidden).length > 0 && (
              <span className="text-[10px] text-text-tertiary bg-surface-2 px-2 py-0.5 rounded font-medium">
                {lineItems.filter((li) => li.hidden).length} hidden — won&apos;t sync
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerForLine("__add__")}
              className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-dim text-white text-sm font-medium px-3 py-1.5 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              Search &amp; add product
            </button>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 bg-surface-2 hover:bg-surface-2/80 text-accent text-sm font-medium px-3 py-1.5 rounded transition-colors"
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
                <th className="py-2 pr-2">SKU · Barcode</th>
                <th className="py-2 pr-2 w-32">Collection</th>
                <th className="py-2 pr-2 w-20">Qty</th>
                <th className="py-2 pr-2 w-28">Cost Price</th>
                <th className="py-2 pr-2 w-28">Retail Price</th>
                <th className="py-2 pr-2 w-16 text-center">GST</th>
                <th className="py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-text-tertiary text-sm">
                    No items yet — click &ldquo;Add Row&rdquo; to start.
                  </td>
                </tr>
              ) : (
                lineItems.map((li, idx) => (
                  <tr key={li.id} className={`border-b border-border-0 transition-opacity ${li.hidden ? "opacity-40" : ""}`}>
                    {/* Name + option chips */}
                    <td className="py-1.5 pr-2">
                      <input
                        className={`${cellCls} ${li.hidden ? "line-through text-text-tertiary" : ""}`}
                        value={li.name}
                        onChange={(e) => updateItem(idx, { name: e.target.value })}
                      />
                      {li.optionValues && li.optionValues.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {li.optionValues.map((ov, ovIdx) => (
                            <span key={ovIdx} className="text-[10px] bg-surface-2 text-text-secondary px-1.5 py-0.5 rounded font-mono leading-none">
                              {ov.optionName}: {ov.optionValue}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Inline Shopify match (Task 2) */}
                      {!li.hidden && (() => {
                        // Create-new-product form takes over the cell when open
                        if (showCreateFor[li.id]) {
                          return (
                            <CreateProductForm
                              lineItemId={li.id}
                              form={createFormData[li.id]}
                              creating={!!creating[li.id]}
                              onChange={(patch) => setCreateFormData((prev) => ({ ...prev, [li.id]: { ...prev[li.id], ...patch } }))}
                              onSubmit={() => handleCreateProduct(li.id)}
                              onCancel={() => setShowCreateFor((prev) => ({ ...prev, [li.id]: false }))}
                            />
                          );
                        }
                        const matched = confirmedMappings[li.id];
                        if (matched) {
                          return (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-medium min-w-0">
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                                <span className="truncate">{matched.productTitle}</span>
                              </span>
                              <button onClick={() => setPickerForLine(li.id)} className="text-[11px] text-accent hover:underline shrink-0">change</button>
                              <button onClick={() => clearMatch(li.id)} className="text-[11px] text-text-tertiary hover:text-red-500 shrink-0">clear</button>
                            </div>
                          );
                        }
                        const sugg = suggestionsByLine[li.id] ?? [];
                        // Confident pick: the top hit is a strong match AND matches every colour/size
                        // option of this line → it's THE variant, so show only it (no noise).
                        const optVals = (li.optionValues ?? []).map((o) => o.optionValue.toLowerCase().trim()).filter(Boolean);
                        const top = sugg[0];
                        const topVtTokens = (top?.product.variantTitle || "").toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
                        const topExact = !!top && top.score >= 80 && optVals.length > 0 &&
                          optVals.every((v) => v.split(/\s+/).every((w) => topVtTokens.includes(w)));
                        const display = topExact ? [top] : sugg.slice(0, 3);
                        return (
                          <div className="flex flex-col items-start gap-1 mt-1.5 w-full">
                            {sugg.length === 0 ? (
                              <span className="text-[11px] text-text-tertiary">No catalog match</span>
                            ) : (
                              display.map((s) => {
                                const tier = matchTier(s.score);
                                const cls = tier === "strong"
                                  ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                  : tier === "possible"
                                    ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                    : "border-border-1 text-text-secondary hover:bg-surface-2";
                                const vt = s.product.variantTitle && s.product.variantTitle !== "Default Title"
                                  ? s.product.variantTitle
                                  : "";
                                return (
                                  <button
                                    key={s.product.variantId}
                                    onClick={() => confirmMatch(li.id, s.product)}
                                    title={`${s.product.productTitle}${vt ? ` — ${vt}` : ""}${s.product.sku ? ` · ${s.product.sku}` : ""}`}
                                    className={`flex items-baseline gap-2 w-full max-w-2xl text-left text-xs border px-2 py-1 rounded transition-colors ${cls}`}
                                  >
                                    {/* Product name first — must stay readable to confirm the right product */}
                                    <span className="font-medium truncate min-w-0 flex-1">{s.product.productTitle}</span>
                                    {/* Then colour / size */}
                                    {vt && <span className="shrink-0 font-semibold whitespace-nowrap">{vt}</span>}
                                    <span className="shrink-0 opacity-50 tabular-nums text-[10px]">{s.score}</span>
                                  </button>
                                );
                              })
                            )}
                            <div className="flex items-center gap-3">
                              <button onClick={() => setPickerForLine(li.id)} className="text-[11px] text-accent hover:underline">Search…</button>
                              <button onClick={() => openCreateFor(li)} className="text-[11px] text-accent hover:underline">+ Create new product</button>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    {/* SKU (supplier code) + Barcode (EAN) stacked */}
                    <td className="py-1.5 pr-2">
                      <input
                        className={cellCls}
                        value={li.sku}
                        placeholder="Supplier SKU"
                        onChange={(e) => updateItem(idx, { sku: e.target.value })}
                      />
                      <input
                        className={`${cellCls} mt-1 text-[11px] text-text-secondary`}
                        value={li.barcode || ""}
                        placeholder="Barcode / EAN"
                        onChange={(e) => updateItem(idx, { barcode: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        list="category-options"
                        className={cellCls}
                        value={li.category}
                        placeholder="e.g. Helmets (Collection)"
                        onChange={(e) => updateItem(idx, { category: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2"><input type="number" min={0} className={cellCls} value={li.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.01" min={0} className={cellCls} value={li.costPrice} onChange={(e) => updateItem(idx, { costPrice: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.01" min={0} className={cellCls} value={li.retailPrice} onChange={(e) => updateItem(idx, { retailPrice: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2 text-center"><input type="checkbox" checked={li.gstApplicable} onChange={(e) => updateItem(idx, { gstApplicable: e.target.checked })} className="w-4 h-4 accent-[#FF5A00]" /></td>
                    {/* Hide + Delete */}
                    <td className="py-1.5">
                      <div className="flex items-center gap-0.5 justify-center">
                        <button
                          onClick={() => updateItem(idx, { hidden: !li.hidden })}
                          title={li.hidden ? "Show — will sync to Shopify" : "Hide — won't sync to Shopify"}
                          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${li.hidden ? "text-amber-500 hover:text-accent bg-amber-50" : "text-text-tertiary hover:text-text-tertiary"}`}
                          aria-label={li.hidden ? "Show item" : "Hide item"}
                        >
                          {li.hidden ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => removeRow(idx)}
                          className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-red-500 text-xl leading-none rounded transition-colors"
                          aria-label="Remove row"
                        >&times;</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="category-options">
        {catalogCategories.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* Totals */}
      <div className="bg-surface-1 border border-border-1 p-6 mb-6">
        <div className="flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            <div className="flex justify-between text-text-secondary">
              <span>Subtotal (ex GST)</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-text-secondary">
              <span className="flex items-center gap-2">
                GST (10% on {gstBase === "goods_plus_freight" ? "goods + freight" : "goods only"})
                <button
                  onClick={() => setGstBase((b) => (b === "goods_plus_freight" ? "goods" : "goods_plus_freight"))}
                  className="text-[11px] text-accent hover:underline"
                  title="Switch the base GST is calculated on (goods only ↔ goods + freight)"
                >
                  switch ⇄
                </button>
              </span>
              <span>${gst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-text-secondary">
              <span>Shipping</span>
              <input
                type="number" step="0.01" min={0} value={shippingCost}
                onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
                className="w-28 rounded border border-border-1 px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
              />
            </div>
            <div className="flex justify-between text-base font-semibold text-accent border-t border-border-0 pt-2">
              <span>Total (calculated)</span>
              <span>${total.toFixed(2)}</span>
            </div>
            {invoiceTotals?.grandTotal && invoiceTotals.grandTotal > 0 && (() => {
              const diff = Math.abs(total - invoiceTotals.grandTotal);
              const isMatch = diff < 1;
              return (
                <div className={`flex justify-between text-sm pt-1 ${isMatch ? "text-emerald-600" : "text-amber-600"}`}>
                  <span className="flex items-center gap-1">
                    {isMatch ? "✓" : "⚠"} Invoice total ({currency})
                  </span>
                  <span className="font-medium">
                    ${invoiceTotals.grandTotal.toFixed(2)}
                    {!isMatch && <span className="ml-1 text-xs">(Δ ${diff.toFixed(2)})</span>}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {isBulkPO && (
        <div className="mb-5 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <p className="font-semibold">Large PO — {visibleItemCount} items</p>
          <p className="mt-0.5 text-blue-700">
            Syncing more than 50 items at once may approach the 60-second server limit. If the sync times out, try hiding non-essential rows and syncing in smaller batches.
          </p>
        </div>
      )}

      {mathDiscrepancy && (
        <div className="mb-5 p-4 rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm">
          <p className="font-semibold">Mathematical discrepancy — sync blocked</p>
          <p className="mt-0.5 text-red-700">
            Line items sum to <strong>${total.toFixed(2)}</strong> but invoice total is <strong>${invoiceTotals?.grandTotal?.toFixed(2)}</strong> (Δ ${Math.abs(total - (invoiceTotals?.grandTotal ?? 0)).toFixed(2)}). Correct the line items or totals before syncing.
          </p>
          {gstSwitchWouldFix && (
            <button
              onClick={() => setGstBase((b) => (b === "goods_plus_freight" ? "goods" : "goods_plus_freight"))}
              className="mt-2.5 inline-flex items-center gap-1.5 bg-accent hover:bg-accent-dim text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
            >
              ⇄ This invoice charges GST on {gstBase === "goods_plus_freight" ? "goods only" : "goods + freight"} — switch &amp; fix
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {!syncResult && !previewResult && (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleSave}
            disabled={isBusy}
            className="border border-accent text-accent hover:bg-surface-2 disabled:opacity-50 text-sm font-medium px-5 py-2.5 rounded transition-colors"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          {poStatus === "approved" ? (
            <span className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium px-6 py-2.5 rounded">
              ✅ Synced to Shopify
            </span>
          ) : (
            <button
              onClick={handlePreview}
              disabled={isBusy || mathDiscrepancy}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors"
            >
              {previewing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Checking Shopify…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                  Preview Shopify Sync
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Dry-run Preview Panel */}
      {previewResult && !syncResult && (
        <div className="mt-2">
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm font-semibold text-amber-800 mb-1">Preview only — nothing has been written to Shopify yet</p>
            <p className="text-xs text-amber-700">Review the matches below. Confirm any suggested items, then click Confirm to apply the changes.</p>
          </div>
          {/* Stats */}
          {(() => {
            const confirmedCount = Object.keys(confirmedMappings).length;
            const resolvedNotFound = previewResult.results.filter(
              (r) => r.status === "not_found" && confirmedMappings[r.lineItemId]
            ).length;
            const remainingNotFound = previewResult.notFoundCount - resolvedNotFound;
            const willSync = previewResult.successCount + resolvedNotFound;
            return (
              <div className="flex items-center gap-4 mb-4 flex-wrap">
                {willSync > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">
                    ✅ {willSync} will be updated
                  </div>
                )}
                {remainingNotFound > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
                    ⚠️ {remainingNotFound} not found in Shopify
                  </div>
                )}
                {confirmedCount > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg">
                    🔗 {confirmedCount} manually matched
                  </div>
                )}
              </div>
            );
          })()}
          <div className="bg-surface-1 border border-border-1 overflow-hidden mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-surface-1 border-b border-border-1">
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Item</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">SKU</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Shopify Product</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">In Stock</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Qty to Add</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Landed Cost</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.results.map((r) => {
                  const confirmed = confirmedMappings[r.lineItemId];
                  const isConfirmed = r.status === "not_found" && !!confirmed;
                  const lineItem = lineItems.find((li) => li.id === r.lineItemId);
                  // Matching/creating is now done inline in the line-items table above —
                  // the legacy per-row search/create UI in this preview is disabled.
                  const showLegacyMatchUI = false;
                  return (
                    <Fragment key={r.lineItemId}>
                      {/* ── NOT FOUND with suggestions: inline side-by-side layout (legacy, disabled) ── */}
                      {showLegacyMatchUI && r.suggestions && r.suggestions.length > 0 ? (
                        <tr className="border-b border-amber-100">
                          {/* Left: invoice product */}
                          <td colSpan={2} className="px-4 py-3 align-top border-r border-amber-100 bg-amber-50/30 w-64">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">From invoice</p>
                            <p className="text-sm font-semibold text-text-primary leading-tight">{r.name}</p>
                            <p className="text-xs text-text-tertiary font-mono mt-0.5">{r.sku || "No SKU"}</p>
                          </td>
                          {/* Right: suggestions or manual search */}
                          <td colSpan={3} className="px-4 py-3 align-top bg-amber-50/10">
                            {!showSearchFor[r.lineItemId] ? (
                              <>
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">Select Shopify match</p>
                                <div className="flex flex-col gap-1.5">
                                  {(r.suggestions as VariantSuggestion[]).map((s) => (
                                    <button
                                      key={s.variantId}
                                      onClick={() =>
                                        setConfirmedMappings((prev) => ({
                                          ...prev,
                                          [r.lineItemId]: {
                                            variantId: s.variantId,
                                            inventoryItemId: s.inventoryItemId,
                                            productTitle: s.productTitle,
                                          },
                                        }))
                                      }
                                      className="w-full flex items-center justify-between gap-3 bg-surface-1 hover:bg-surface-2 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-accent transition-all text-left group"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate">{s.productTitle}</p>
                                        {(s.sku || s.barcode) && (
                                          <p className="text-xs text-text-tertiary mt-0.5">
                                            {s.sku && `SKU: ${s.sku}`}
                                            {s.sku && s.barcode && " · "}
                                            {s.barcode && `Barcode: ${s.barcode}`}
                                          </p>
                                        )}
                                      </div>
                                      <ConfidenceBadge score={s.score} />
                                      <span className="shrink-0 bg-accent group-hover:bg-accent-dim text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                                        Match →
                                      </span>
                                    </button>
                                  ))}
                                </div>
                                <button
                                  onClick={() => setShowSearchFor((prev) => ({ ...prev, [r.lineItemId]: true }))}
                                  className="mt-2.5 text-xs text-text-tertiary hover:text-accent underline transition-colors"
                                >
                                  Not the right match? Search instead
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Search Shopify</p>
                                  <button
                                    onClick={() => setShowSearchFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                    className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                                  >
                                    ← Back to suggestions
                                  </button>
                                </div>
                                <div className="flex gap-2 mb-2">
                                  <input
                                    type="text"
                                    placeholder="Search by product name…"
                                    value={manualSearchQueries[r.lineItemId] ?? ""}
                                    onChange={(e) => setManualSearchQueries((prev) => ({ ...prev, [r.lineItemId]: e.target.value }))}
                                    onKeyDown={(e) => e.key === "Enter" && handleManualSearch(r.lineItemId)}
                                    className="flex-1 rounded border border-amber-200 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                                  />
                                  <button
                                    onClick={() => handleManualSearch(r.lineItemId)}
                                    disabled={manualSearching[r.lineItemId]}
                                    className="inline-flex items-center gap-1 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                                  >
                                    {manualSearching[r.lineItemId] ? (
                                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                      </svg>
                                    ) : "Search"}
                                  </button>
                                </div>
                                {manualSearchResults[r.lineItemId] !== undefined && (
                                  <>
                                    {manualSearchResults[r.lineItemId].length === 0 ? (
                                      <p className="text-xs text-amber-700 italic mb-2">No results — try a different term.</p>
                                    ) : (
                                      <div className="flex flex-col gap-1.5 mb-2">
                                        {manualSearchResults[r.lineItemId].map((s) => (
                                          <button
                                            key={s.variantId}
                                            onClick={() => setConfirmedMappings((prev) => ({ ...prev, [r.lineItemId]: { variantId: s.variantId, inventoryItemId: s.inventoryItemId, productTitle: s.productTitle } }))}
                                            className="w-full flex items-center justify-between gap-3 bg-surface-1 hover:bg-surface-2 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-accent transition-all text-left group"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate">{s.productTitle}</p>
                                              {(s.sku || s.barcode) && (
                                                <p className="text-xs text-text-tertiary mt-0.5">
                                                  {s.sku && `SKU: ${s.sku}`}{s.sku && s.barcode && " · "}{s.barcode && `Barcode: ${s.barcode}`}
                                                </p>
                                              )}
                                            </div>
                                            <ConfidenceBadge score={s.score} />
                                            <span className="shrink-0 bg-accent group-hover:bg-accent-dim text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">Match →</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {!showCreateFor[r.lineItemId] ? (
                                      <button
                                        onClick={() => openCreateForm(r.lineItemId, r.name, r.sku || "", lineItem?.retailPrice ?? 0, lineItem?.category ?? "")}
                                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-medium"
                                      >
                                        + Create new product in Shopify
                                      </button>
                                    ) : (
                                      <CreateProductForm
                                        lineItemId={r.lineItemId}
                                        form={createFormData[r.lineItemId]}
                                        creating={!!creating[r.lineItemId]}
                                        onChange={(patch) => setCreateFormData((prev) => ({ ...prev, [r.lineItemId]: { ...prev[r.lineItemId], ...patch } }))}
                                        onSubmit={() => handleCreateProduct(r.lineItemId)}
                                        onCancel={() => setShowCreateFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3 align-top text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                          </td>
                        </tr>
                      ) : (
                        /* ── All other rows: standard layout ── */
                        <tr className={`border-b border-border-0 ${isConfirmed ? "bg-emerald-50/30" : ""}`}>
                          <td className="px-4 py-3 text-text-primary">{r.name}</td>
                          <td className="px-4 py-3 text-text-secondary font-mono text-xs">{r.sku || "—"}</td>
                          <td className="px-4 py-3 text-text-secondary">
                            {isConfirmed ? confirmed.productTitle : (r.shopifyProductTitle || "—")}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {r.currentQty != null ? (
                              <span className={r.currentQty <= 0 ? "text-red-500 font-medium" : r.currentQty <= 3 ? "text-amber-600 font-medium" : "text-text-secondary"}>
                                {r.currentQty}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-text-primary">
                            {isConfirmed
                              ? `+${lineItem?.qty ?? r.delta ?? "?"}`
                              : r.delta != null ? `+${r.delta}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-text-secondary text-xs">
                            {(() => {
                              const lc = liveLandedCosts.get(r.lineItemId) ?? r.landedCost;
                              if (!lc) return "—";
                              const avg = r.newAvgCost;
                              const showAvg = avg != null && r.previousUnitCost != null && Math.abs(avg - lc) > 0.005;
                              return (
                                <div>
                                  <span>${lc.toFixed(2)}</span>
                                  {showAvg && (
                                    <span
                                      className="block text-[10px] text-accent"
                                      title={`Weighted average with existing stock (Shopify cost was $${r.previousUnitCost!.toFixed(2)})`}
                                    >
                                      → avg ${avg!.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {(r.status === "synced" || isConfirmed) && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full" title={r.matchedFromCache ? "Matched from saved mapping" : undefined}>
                                ✅ {isConfirmed ? "Will sync (matched)" : r.matchedFromCache ? "Will sync · cached" : "Will sync"}
                              </span>
                            )}
                            {r.status === "not_found" && !isConfirmed && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                            )}
                            {r.status === "error" && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full">❌ Error</span>
                            )}
                          </td>
                        </tr>
                      )}
                      {/* Cost drift badge */}
                      {r.costDrift && (
                        <tr className="border-b border-yellow-50 bg-yellow-50/50">
                          <td colSpan={7} className="px-4 py-1.5 text-xs text-yellow-800">
                            ⚠️ Cost drift: Shopify has ${r.costDrift.historicalCost.toFixed(2)}, invoice shows ${r.costDrift.parsedCost.toFixed(2)} ({r.costDrift.pctChange > 0 ? "+" : ""}{r.costDrift.pctChange}%)
                          </td>
                        </tr>
                      )}
                      {/* Untracked inventory warning */}
                      {r.untrackedInventory && (
                        <tr className="border-b border-border-0 bg-surface-1/60">
                          <td colSpan={7} className="px-4 py-1.5 text-xs text-text-secondary">
                            ℹ️ Inventory not tracked in Shopify — quantity will not be updated for this item.
                          </td>
                        </tr>
                      )}
                      {/* Missing field hint for synced items */}
                      {r.status === "synced" && r.shopifyMissingFields && r.shopifyMissingFields.length > 0 && (
                        <tr className="border-b border-border-0 bg-blue-50/40">
                          <td colSpan={7} className="px-4 py-2">
                            <p className="text-xs text-blue-700">
                              💡 Matched but Shopify product is missing:{" "}
                              {r.shopifyMissingFields.map((f, i) => (
                                <span key={f.field}>
                                  {i > 0 && ", "}
                                  <strong>{f.field}</strong> (suggested value: <code className="bg-blue-100 px-1 rounded">{f.suggestedValue}</code>)
                                </span>
                              ))}
                              {" "}— add it in Shopify for faster matching next time.
                            </p>
                          </td>
                        </tr>
                      )}
                      {/* No suggestions: manual search (legacy, disabled) */}
                      {showLegacyMatchUI && (!r.suggestions || r.suggestions.length === 0) && (
                        <tr className="border-b border-amber-100">
                          <td colSpan={2} className="px-4 py-3 align-top border-r border-amber-100 bg-amber-50/30 w-64">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">From invoice</p>
                            <p className="text-sm font-semibold text-text-primary leading-tight">{r.name}</p>
                            <p className="text-xs text-text-tertiary font-mono mt-0.5">{r.sku || "No SKU"}</p>
                          </td>
                          <td colSpan={3} className="px-4 py-3 align-top bg-amber-50/10">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">Search Shopify manually</p>
                            <div className="flex gap-2 mb-2">
                              <input
                                type="text"
                                placeholder="Search by product name…"
                                value={manualSearchQueries[r.lineItemId] ?? ""}
                                onChange={(e) => setManualSearchQueries((prev) => ({ ...prev, [r.lineItemId]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && handleManualSearch(r.lineItemId)}
                                className="flex-1 rounded border border-amber-200 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                              />
                              <button
                                onClick={() => handleManualSearch(r.lineItemId)}
                                disabled={manualSearching[r.lineItemId]}
                                className="inline-flex items-center gap-1 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                              >
                                {manualSearching[r.lineItemId] ? (
                                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                  </svg>
                                ) : "Search"}
                              </button>
                            </div>
                            {manualSearchResults[r.lineItemId] !== undefined && (
                              <>
                                {manualSearchResults[r.lineItemId].length === 0 ? (
                                  <p className="text-xs text-amber-700 italic mb-2">No results — try a different term.</p>
                                ) : (
                                  <div className="flex flex-col gap-1.5 mb-2">
                                    {manualSearchResults[r.lineItemId].map((s) => (
                                      <button
                                        key={s.variantId}
                                        onClick={() => setConfirmedMappings((prev) => ({ ...prev, [r.lineItemId]: { variantId: s.variantId, inventoryItemId: s.inventoryItemId, productTitle: s.productTitle } }))}
                                        className="w-full flex items-center justify-between gap-3 bg-surface-1 hover:bg-surface-2 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-accent transition-all text-left group"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate">{s.productTitle}</p>
                                          {(s.sku || s.barcode) && (
                                            <p className="text-xs text-text-tertiary mt-0.5">
                                              {s.sku && `SKU: ${s.sku}`}{s.sku && s.barcode && " · "}{s.barcode && `Barcode: ${s.barcode}`}
                                            </p>
                                          )}
                                      </div>
                                      <span className="shrink-0 bg-accent group-hover:bg-accent-dim text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">Match →</span>
                                    </button>
                                  ))}
                                  </div>
                                )}
                                {!showCreateFor[r.lineItemId] ? (
                                  <button
                                    onClick={() => openCreateForm(r.lineItemId, r.name, r.sku || "", lineItem?.retailPrice ?? 0, lineItem?.category ?? "")}
                                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-medium"
                                  >
                                    + Create new product in Shopify
                                  </button>
                                ) : (
                                  <CreateProductForm
                                    lineItemId={r.lineItemId}
                                    form={createFormData[r.lineItemId]}
                                    creating={!!creating[r.lineItemId]}
                                    onChange={(patch) => setCreateFormData((prev) => ({ ...prev, [r.lineItemId]: { ...prev[r.lineItemId], ...patch } }))}
                                    onSubmit={() => handleCreateProduct(r.lineItemId)}
                                    onCancel={() => setShowCreateFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                  />
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {duplicateInvoiceError && (
            <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-300">
              <p className="text-sm font-semibold text-amber-800">
                Duplicate invoice detected — this invoice was already synced. Check PO{" "}
                <a href={`/purchase-orders/${duplicateInvoiceError.originalPoId}/review`} className="underline hover:text-amber-900">
                  {duplicateInvoiceError.originalPoId}
                </a>.
              </p>
              <p className="text-xs text-amber-700 mt-1">Originally synced at: {duplicateInvoiceError.detectedAt}</p>
            </div>
          )}
          {conflictItems.length > 0 && (
            <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-300">
              <p className="text-sm font-semibold text-red-800 mb-2">
                Inventory conflict — quantities changed while you were reviewing. Re-run the sync with the suggested quantities below.
              </p>
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="text-left text-red-700 border-b border-red-200">
                    <th className="py-1 pr-4 font-semibold">Item</th>
                    <th className="py-1 pr-4 font-semibold">Expected on hand</th>
                    <th className="py-1 pr-4 font-semibold">Actual on hand</th>
                    <th className="py-1 font-semibold">Suggested qty to add</th>
                  </tr>
                </thead>
                <tbody>
                  {conflictItems.map((ci) => (
                    <tr key={ci.lineItemId} className="border-b border-red-100 last:border-0">
                      <td className="py-1 pr-4 text-red-900 font-medium">{ci.name}</td>
                      <td className="py-1 pr-4 text-red-700">{ci.expectedQty}</td>
                      <td className="py-1 pr-4 text-red-700">{ci.actualQty}</td>
                      <td className="py-1 text-red-900 font-semibold">+{ci.suggestedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={handleConfirmSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded transition-colors"
              >
                {syncing ? "Re-syncing…" : "Re-sync with suggested quantities →"}
              </button>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => { setPreviewResult(null); setConfirmedMappings({}); }}
              disabled={syncing}
              className="border border-border-1 text-text-secondary hover:bg-surface-2 disabled:opacity-50 text-sm font-medium px-5 py-2.5 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSync}
              disabled={syncing || poStatus === "approved"}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors"
            >
              {syncing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Syncing…
                </>
              ) : poStatus === "approved" ? "Already synced" : "Confirm & Sync to Shopify"}
            </button>
          </div>
        </div>
      )}

      {/* Sync Results Panel */}
      {syncResult && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">
                <span>✅</span>{syncResult.successCount} synced
              </div>
              {syncResult.notFoundCount > 0 && (
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
                  <span>⚠️</span>{syncResult.notFoundCount} not found
                </div>
              )}
              {syncResult.errorCount > 0 && (
                <div className="flex items-center gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 px-4 py-2 rounded-lg">
                  <span>❌</span>{syncResult.errorCount} error{syncResult.errorCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
            <button
              onClick={() => setSyncResult(null)}
              className="text-sm text-text-secondary hover:text-accent border border-border-1 hover:border-accent px-3 py-1.5 rounded transition-colors"
            >
              ← Back to edit
            </button>
          </div>
          <div className="bg-surface-1 border border-border-1 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-surface-1 border-b border-border-1">
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Item</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">SKU / Barcode</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Shopify Product</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">In Stock</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Qty Added</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {syncResult.results.map((r) => (
                  <tr key={r.lineItemId} className="border-b border-border-0 last:border-0">
                    <td className="px-4 py-3 text-text-primary">{r.name}</td>
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">{r.sku || "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{r.shopifyProductTitle || "—"}</td>
                    <td className="px-4 py-3">
                      {r.currentQty != null ? (
                        <span className={r.currentQty <= 0 ? "text-red-500 font-medium" : r.currentQty <= 3 ? "text-amber-600 font-medium" : "text-text-secondary"}>
                          {r.currentQty}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{r.delta != null ? `+${r.delta}` : "—"}</td>
                    <td className="px-4 py-3">
                      {r.status === "synced" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full" title={r.matchedFromCache ? "Matched from saved mapping" : undefined}>
                          ✅ Synced{r.matchedFromCache && <span className="text-emerald-500 ml-0.5">·cached</span>}
                        </span>
                      )}
                      {r.status === "not_found" && <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full" title={r.errorMessage}>⚠️ Not found</span>}
                      {r.status === "error" && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full" title={r.errorMessage}>❌ Error</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {syncResult.notFoundCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3 mb-5">
              Items marked &ldquo;Not found&rdquo; were not in Shopify.{" "}
              <a
                href="https://admin.shopify.com/products/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-medium"
              >
                Create those products in Shopify →
              </a>{" "}
              then click &ldquo;Back to edit&rdquo; and re-sync.
            </p>
          )}
          <div className="flex justify-end">
            <button onClick={() => router.push("/dashboard")} className="bg-accent hover:bg-accent-dim text-white text-sm font-medium px-6 py-2.5 rounded transition-colors">
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
      </div>

    </div>
  );
}
