import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";

interface UpdateVariantPriceData {
  productVariantUpdate: {
    productVariant: { id: string; price: string } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

const UPDATE_VARIANT_PRICE_MUTATION = /* GraphQL */ `
  mutation UpdateVariantPrice($input: ProductVariantInput!) {
    productVariantUpdate(input: $input) {
      productVariant { id price }
      userErrors { field message }
    }
  }
`;

export async function POST(req: NextRequest) {
  try {
    if (
      !process.env.SHOPIFY_STORE_DOMAIN ||
      !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
    ) {
      return NextResponse.json(
        { error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as {
      updates: { variantId: string; price: number }[];
    };

    if (!body.updates || !Array.isArray(body.updates)) {
      return NextResponse.json(
        { error: "updates array is required" },
        { status: 400 }
      );
    }

    let updated = 0;
    const errors: string[] = [];

    // Sequential to avoid Shopify rate limits
    for (const { variantId, price } of body.updates) {
      try {
        const result = await shopifyFetch<UpdateVariantPriceData>(
          UPDATE_VARIANT_PRICE_MUTATION,
          {
            input: {
              id: variantId,
              price: price.toFixed(2),
            },
          }
        );

        if (result.errors && result.errors.length > 0) {
          errors.push(
            `${variantId}: ${result.errors.map((e) => e.message).join(", ")}`
          );
          continue;
        }

        const userErrors =
          result.data?.productVariantUpdate?.userErrors ?? [];
        if (userErrors.length > 0) {
          errors.push(
            `${variantId}: ${userErrors.map((e) => e.message).join(", ")}`
          );
        } else {
          updated++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${variantId}: ${message}`);
      }
    }

    return NextResponse.json({ updated, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
