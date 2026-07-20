export type POStatus = "draft" | "awaiting_review" | "ordered" | "approved";

export interface LineItemOptionValue {
  optionName: string;
  optionValue: string;
}

export interface InvoiceTotals {
  subtotal: number;
  taxTotal: number;
  freightShipping: number;
  insurance: number;
  customsTariffs: number;
  brokerageFees: number;
  grandTotal: number;
}

export interface LineItem {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  optionValues?: LineItemOptionValue[];
  category: string;
  qty: number;
  costPrice: number;
  retailPrice: number;
  gstApplicable: boolean;
  hidden?: boolean;
  // Whether this line shares in the shipping/landed-cost allocation. Undefined =
  // included (default). Set false to exclude it from the even shipping split.
  shipIncluded?: boolean;
}

export interface VariantSuggestion {
  variantId: string;
  inventoryItemId: string;
  productTitle: string;
  sku?: string;
  barcode?: string;
  score?: number;
}

export interface LineSyncResult {
  lineItemId: string;
  sku: string;
  name: string;
  status: "synced" | "not_found" | "error";
  shopifyVariantId?: string;
  inventoryItemId?: string;
  shopifyProductTitle?: string;
  delta?: number;
  errorMessage?: string;
  suggestions?: VariantSuggestion[];
  shopifyMissingFields?: { field: string; suggestedValue: string }[];
  shopifyPrice?: number;
  currentQty?: number;
  shopifyCategory?: string;
  matchedFromCache?: boolean;
  costDrift?: { historicalCost: number; parsedCost: number; pctChange: number };
  landedCost?: number;
  // Moving average cost (Task 7) — captured so a PO delete can reverse its exact contribution
  previousUnitCost?: number; // Shopify unit cost before this PO applied
  appliedUnitCost?: number;  // per-unit landed cost this PO contributed
  newAvgCost?: number;       // weighted-average cost written to Shopify after this PO
  initialQty?: number;
  conflictError?: { expectedQty: number; actualQty: number; suggestedQty: number };
  untrackedInventory?: boolean;
}

export interface SyncResult {
  syncedAt: string;
  results: LineSyncResult[];
  successCount: number;
  notFoundCount: number;
  errorCount: number;
  costErrorCount?: number;
  duplicateInvoice?: { detectedAt: string; originalPoId: string };
  locationInactive?: boolean;
}

export interface InventoryEntry {
  id: string;
  merchantId?: string;
  productTitle: string;
  variantId: string;
  sku: string;
  barcode: string;
  location: string;
  qtyAdded: number;
  costPrice: number;
  retailPrice: number;
  poId: string;
  invoiceNumber: string;
  supplier: string;
  syncedAt: string;
}

export interface SupplierProfile {
  id: string;
  merchantId?: string;
  name: string;
  parseHints: string;
  defaultLocation: PurchaseOrder["location"] | "";
  approvedPOCount: number;
  lastSeen: string;
  updatedAt: string;
  leadTimeDays?: number;
  safetyStockDays?: number;
}

export interface ShopifyProduct {
  merchantId?: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  price: number;
  compareAtPrice: number | null;
  inventoryItemId: string;
  productType: string;
  collections?: string[];
  status: string;
  tags: string[];
  shopifyUpdatedAt: string;
  syncedAt: string;
  onHandQtyStore?: number;
  onHandQtyWarehouse?: number;
  unitCost?: number | null;
}

export interface PurchaseOrder {
  id: string;
  merchantId?: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency?: string;
  exchangeRate?: number;
  taxVatNumber?: string;
  orderNumber: string;
  location: string;
  paymentTerms: string;
  lineItems: LineItem[];
  shippingCost: number;
  invoiceTotals?: InvoiceTotals;
  /** Which base the supplier used for GST: goods only, or goods + freight. Detected from the invoice, user-overridable. */
  gstBase?: "goods" | "goods_plus_freight";
  status: POStatus;
  orderedAt?: string;
  pdfUrl?: string;
  syncResult?: SyncResult;
  /** Per-inventoryItemId snapshot of costs BEFORE this PO was applied — used to restore on delete */
  costSnapshot?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}
