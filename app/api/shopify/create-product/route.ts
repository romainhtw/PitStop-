import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch, getPrimaryLocationGid } from "@/lib/shopify";
import { requireShop } from "@/lib/shopify/requireShop";
import { hasBillingAccess } from "@/lib/shopify/billing";

export const runtime = "nodejs";

/**
 * Two-step product creation (Shopify 2024-04+ removed `variants` from ProductInput):
 *   1. productCreate — creates the product + its default variant
 *   2. productVariantsBulkUpdate — sets price / sku / barcode / tracking on that variant
 */
const CREATE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation CreateProduct($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        variants(first: 1) {
          edges { node { id inventoryItem { id } } }
        }
      }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANT_MUTATION = /* GraphQL */ `
  mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

// Activates the new inventory item at a location so the variant is actually
// stocked and shows up in inventory. Without this, a tracked variant is not
// stocked anywhere and never appears in inventory (and later set/adjust fails).
const INVENTORY_ACTIVATE_MUTATION = /* GraphQL */ `
  mutation InventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

interface InventoryActivateData {
  inventoryActivate: {
    inventoryLevel: { id: string } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface CreateProductData {
  productCreate: {
    product: {
      id: string;
      title: string;
      variants: { edges: Array<{ node: { id: string; inventoryItem: { id: string } } }> };
    } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface UpdateVariantData {
  productVariantsBulkUpdate: {
    productVariants: Array<{ id: string; inventoryItem: { id: string } }> | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

export async function POST(req: NextRequest) {
  const shop = await requireShop(req);
  if (!shop) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!(await hasBillingAccess(shop))) return NextResponse.json({ error: "SUBSCRIPTION_REQUIRED" }, { status: 402 });

  const body = (await req.json()) as {
    title: string;
    sku?: string;
    barcode?: string;
    price?: string;
    productType?: string;
    options?: Array<{ name?: string; value?: string }>;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // Variant options (Size, Colour, …) — drop blanks, dedupe by name. Each option
  // gets the single value from this invoice line so the created variant is named
  // (e.g. "Size: M / Colour: Red") instead of "Default Title".
  const cleanOptions = (body.options ?? [])
    .map((o) => ({ name: (o.name ?? "").trim(), value: (o.value ?? "").trim() }))
    .filter((o) => o.name && o.value)
    .filter((o, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === o.name.toLowerCase()) === i)
    .slice(0, 3); // Shopify allows max 3 options per product

  // ── Step 1: create the product (default variant auto-created) ──────────────
  const productInput: Record<string, unknown> = {
    title: body.title.trim(),
    status: "ACTIVE",
  };
  if (body.productType) productInput.productType = body.productType;
  if (cleanOptions.length > 0) {
    productInput.productOptions = cleanOptions.map((o) => ({ name: o.name, values: [{ name: o.value }] }));
  }

  const created = await shopifyFetch<CreateProductData>(shop, CREATE_PRODUCT_MUTATION, { input: productInput });

  const createErrors = created?.data?.productCreate?.userErrors ?? [];
  if (createErrors.length > 0) {
    return NextResponse.json({ error: createErrors.map((e) => e.message).join(", ") }, { status: 422 });
  }
  const product = created?.data?.productCreate?.product;
  const variant = product?.variants?.edges?.[0]?.node;
  if (!product || !variant) {
    const gqlErr = (created as { errors?: Array<{ message: string }> })?.errors?.map((e) => e.message).join(", ");
    return NextResponse.json({ error: gqlErr || "Product creation failed" }, { status: 500 });
  }

  // ── Step 2: set price / sku / barcode / tracking on the default variant ────
  const variantInput: Record<string, unknown> = {
    id: variant.id,
    price: body.price && Number(body.price) > 0 ? body.price : "0.00",
    inventoryItem: { tracked: true, ...(body.sku ? { sku: body.sku } : {}) },
  };
  if (body.barcode) variantInput.barcode = body.barcode;

  const updated = await shopifyFetch<UpdateVariantData>(shop, UPDATE_VARIANT_MUTATION, {
    productId: product.id,
    variants: [variantInput],
  });
  const updErrors = updated?.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (updErrors.length > 0) {
    console.error("[create-product] variant update errors:", updErrors);
  }

  // ── Step 3: stock the item at the primary location so it appears in inventory ──
  const inventoryItemId = variant.inventoryItem.id;
  const locationGid = await getPrimaryLocationGid(shop);
  if (locationGid) {
    const activated = await shopifyFetch<InventoryActivateData>(shop, INVENTORY_ACTIVATE_MUTATION, {
      inventoryItemId,
      locationId: locationGid,
    });
    const actErrors = activated?.data?.inventoryActivate?.userErrors ?? [];
    if (actErrors.length > 0) {
      console.error("[create-product] inventory activate errors:", actErrors);
    }
  } else {
    console.error("[create-product] no primary location found — item not stocked");
  }

  return NextResponse.json({
    variantId: variant.id,
    inventoryItemId,
    productTitle: product.title,
    warning: updErrors.length > 0
      ? `Product created, but SKU/barcode/price may not have saved: ${updErrors.map((e) => e.message).join("; ")}`
      : undefined,
  });
}
