import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only PDF, PNG, or JPEG files are supported" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");
    const isPdf = file.type === "application/pdf";

    const fileBlock = isPdf
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: file.type as "image/png" | "image/jpeg" | "image/webp", data: base64Data } } as const);

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: `Extract all purchase order information from this supplier invoice. Return ONLY valid JSON with no markdown, no explanation, no code fences.

{
  "supplier": "",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "currency": "AUD",
  "totals": { "subtotal": 0, "taxTotal": 0, "freightShipping": 0, "grandTotal": 0 },
  "lineItems": [
    { "name": "", "sku": "", "qty": 0, "costPrice": 0, "retailPrice": 0 }
  ]
}

Rules:
- sku: use the supplier's product/item code
- qty: use delivered/shipped quantity
- costPrice: net unit price ex-GST after discounts
- retailPrice: RRP/list price if shown, else 0
- Do NOT include freight as a line item`,
          },
        ],
      }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    const parsed = JSON.parse(raw);
    return NextResponse.json({ ok: true, parsed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
