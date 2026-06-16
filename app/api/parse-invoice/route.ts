import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { waitUntil } from "@vercel/functions";
import { adminDb } from "@/lib/firebaseAdmin";
import { recordInvoiceUsage, checkAndRecordFreeUsage } from "@/lib/stripe/usageTracking";
import type { PurchaseOrder } from "@/lib/types";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export const runtime = "nodejs";
export const maxDuration = 60;

async function getSupplierHints(merchantId: string): Promise<string> {
  try {
    const snap = await Promise.race([
      adminDb.collection("suppliers").where("merchantId", "==", merchantId).get(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (!snap) return "";
    const hints: string[] = [];
    // snap is a FirebaseFirestore.QuerySnapshot — forEach works directly
    snap.forEach((d) => {
      const s = d.data() as { name?: string; parseHints?: string };
      if (s.parseHints?.trim()) hints.push(`  - Supplier "${s.name}": ${s.parseHints.trim()}`);
    });
    return hints.length
      ? `\n\nKNOWN SUPPLIER-SPECIFIC RULES:\n${hints.join("\n")}`
      : "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log("[parse-invoice] Request received");

    const merchantId = req.headers.get("x-merchant-id");
    if (!merchantId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    // ── Free tier gate ────────────────────────────────────────────────────────
    const merchantSnap = await adminDb.collection("merchants").doc(merchantId).get();
    const merchantPlan: string = merchantSnap.exists
      ? ((merchantSnap.data()?.plan as string) ?? "free")
      : "free";

    if (merchantPlan === "free") {
      const { allowed, used, limit } = await checkAndRecordFreeUsage(merchantId);
      if (!allowed) {
        return NextResponse.json(
          {
            error: `Free plan limit reached (${limit} invoices/month). Upgrade to continue uploading.`,
            limitReached: true,
            used,
            limit,
          },
          { status: 402 }
        );
      }
    }
    // ── End free tier gate ────────────────────────────────────────────────────

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF exceeds the 10 MB limit" }, { status: 413 });
    }

    console.log("[parse-invoice] File received:", file.name, file.size, "bytes");

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const base64Data = pdfBuffer.toString("base64");

    console.log("[parse-invoice] Fetching supplier hints");
    const supplierHints = await getSupplierHints(merchantId);

    console.log("[parse-invoice] Calling Claude API");
    const client = new Anthropic();
    const aiResponse = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Data },
          },
          {
            type: "text",
            text: `Extract all purchase order information from this supplier invoice PDF. Return ONLY valid JSON with no markdown, no explanation, no code fences. Use this exact structure:

{
  "supplier": "",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "currency": "AUD",
  "taxVatNumber": "",
  "orderNumber": "",
  "paymentTerms": "",
  "totals": {
    "subtotal": 0,
    "taxTotal": 0,
    "freightShipping": 0,
    "insurance": 0,
    "customsTariffs": 0,
    "brokerageFees": 0,
    "grandTotal": 0
  },
  "lineItems": [
    {
      "name": "",
      "sku": "",
      "barcode": "",
      "optionValues": [{ "optionName": "", "optionValue": "" }],
      "category": "",
      "qty": 0,
      "costPrice": 0,
      "retailPrice": 0,
      "gstApplicable": true
    }
  ]
}

--- SUPPLIER / HEADER ---
- supplier: the company ISSUING the invoice (the buyer is never the supplier)
- invoiceNumber: the invoice number/ID field — NOT a "Ref", "Customer PO", or "Order No" field
- invoiceDate: YYYY-MM-DD
- currency: ISO 4217 code (AUD, USD, EUR, GBP, NZD, CAD, JPY…). Default "AUD" if supplier appears Australian and currency not stated
- taxVatNumber: ABN, GST registration, VAT number, or tax ID. Empty string if absent
- orderNumber: buyer's PO or order reference. Leave empty if generic ("Stock", "N/A", "None")
- paymentTerms: payment terms stated on invoice (e.g. "30 days EOM", "45NET")

--- TOTALS ---
- totals.subtotal: total goods before tax and shipping
- totals.taxTotal: total GST / VAT charged
- totals.freightShipping: freight or delivery charge. 0 if not present
- totals.insurance: cargo insurance. 0 if not present
- totals.customsTariffs: customs duties. 0 if not present
- totals.brokerageFees: customs brokerage fees. 0 if not present
- totals.grandTotal: final total payable
- Do NOT include freight as a line item

--- QUANTITY ---
- Use delivered/shipped quantity: "Ship Qty" > "Supply Qty" > "Shipped" > "Qty" > "Order Qty"

--- COST PRICE ---
- Final unit price ex-GST after discounts: "Net Price Excl. GST" > "Unit Price ex GST" > "Unit Price"
- If Discount column exists: costPrice = line Subtotal / Qty
- NEVER use List Price or RRP as costPrice when a net price exists

--- RETAIL PRICE ---
- "List Price" column → retailPrice (ex-GST)
- "RRP inc GST" column → retailPrice (as-is, GST-inclusive)
- No RRP column → retailPrice = 0

--- SKU ---
- Supplier's product code: "Item Code", "Part Style No.", "Item #", "Code", "Article", "Style"

--- BARCODE ---
- EAN-13 or UPC-A if in a SEPARATE barcode column. Never duplicate the sku into barcode

--- ITEM NAME AND OPTIONS ---
- name: BASE product name ONLY — no size/colour variants in this field
- optionValues: all variant attributes as structured array
  · "Trek FX 3 Disc - Large - Matte Black" → name: "Trek FX 3 Disc", optionValues: [{"optionName":"Size","optionValue":"Large"},{"optionName":"Colour","optionValue":"Matte Black"}]
  · "SMILEY 3.0 ACE LED blue S" → name: "SMILEY 3.0 ACE LED", optionValues: [{"optionName":"Colour","optionValue":"Blue"},{"optionName":"Size","optionValue":"S"}]
- No variants → optionValues: []

--- CATEGORY ---
- Extract from invoice or infer: Helmets, Apparel, Components, Accessories, Bikes, Footwear, Electronics, Tools, Nutrition

--- GST ---
- gstApplicable: true for all standard goods. false ONLY if explicitly marked GST-free${supplierHints}`,
          },
        ],
      }],
    });

    console.log("[parse-invoice] Claude responded");

    const textBlock = aiResponse.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from AI");
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[parse-invoice] Invalid JSON from Claude:", raw.slice(0, 200));
      throw new Error("AI returned invalid JSON — please try again");
    }

    console.log("[parse-invoice] Parsed OK, supplier:", parsed.supplier, "items:", (parsed.lineItems as unknown[])?.length);

    const poId = uuidv4();
    const now = new Date().toISOString();
    const totals = parsed.totals as Record<string, unknown> | undefined;

    const po: PurchaseOrder = {
      id: poId,
      merchantId,
      supplier: (parsed.supplier as string) || "",
      invoiceNumber: (parsed.invoiceNumber as string) || "",
      invoiceDate: (parsed.invoiceDate as string) || "",
      currency: (parsed.currency as string) || "AUD",
      taxVatNumber: (parsed.taxVatNumber as string) || "",
      orderNumber: (parsed.orderNumber as string) || "",
      location: "In-Store Fitzgerald St",
      paymentTerms: (parsed.paymentTerms as string) || "",
      invoiceTotals: totals ? {
        subtotal: Number(totals.subtotal) || 0,
        taxTotal: Number(totals.taxTotal) || 0,
        freightShipping: Number(totals.freightShipping) || 0,
        insurance: Number(totals.insurance) || 0,
        customsTariffs: Number(totals.customsTariffs) || 0,
        brokerageFees: Number(totals.brokerageFees) || 0,
        grandTotal: Number(totals.grandTotal) || 0,
      } : undefined,
      lineItems: (Array.isArray(parsed.lineItems) ? parsed.lineItems : []).map((li) => {
        const l = li as Record<string, unknown>;
        return {
          id: uuidv4(),
          name: (l.name as string) || "",
          sku: (l.sku as string) || "",
          barcode: (l.barcode as string) || "",
          optionValues: Array.isArray(l.optionValues)
            ? (l.optionValues as Record<string, unknown>[]).map((ov) => ({
                optionName: (ov.optionName as string) || "",
                optionValue: (ov.optionValue as string) || "",
              }))
            : [],
          category: (l.category as string) || "",
          qty: Number(l.qty) || 0,
          costPrice: Number(l.costPrice) || 0,
          retailPrice: Number(l.retailPrice) || 0,
          gstApplicable: (l.gstApplicable as boolean) ?? true,
          hidden: false,
        };
      }),
      shippingCost: totals ? Number(totals.freightShipping) || 0 : 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    console.log("[parse-invoice] Saving to Firestore, poId:", poId);
    await adminDb.collection("purchaseOrders").doc(poId).set(po);
    console.log("[parse-invoice] Saved to Firestore OK");

    // Track usage + Stripe overage in background (non-blocking).
    // Free-tier merchants are already counted in the gate above — skip here.
    if (merchantPlan !== "free") {
      waitUntil(
        recordInvoiceUsage().catch((err) =>
          console.error("[parse-invoice] Usage tracking failed:", err)
        )
      );
    }

    // Upsert supplier in background — use waitUntil so Vercel doesn't freeze before the write completes
    if (parsed.supplier) {
      const supplierName = parsed.supplier as string;
      const nameKey = supplierName.toLowerCase().trim();
      // Tenant-scoped doc id — see app/api/suppliers/[name]/route.ts
      const docId = `${merchantId}__${nameKey}`;
      waitUntil(
        adminDb.collection("suppliers").doc(docId).set(
          { merchantId, name: supplierName, lastSeen: now },
          { merge: true }
        ).catch(() => {})
      );
    }

    console.log("[parse-invoice] Done, returning id:", poId);
    return NextResponse.json({ id: poId });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[parse-invoice] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
