const API_VERSION = "2025-04";

export function shopifyGraphqlUrl(): string {
  return `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
}

// Full-jitter exponential backoff: sleep random(0, min(cap_ms, base_ms * 2^attempt))
function jitterDelay(attempt: number, baseMs = 500, capMs = 8000): Promise<void> {
  const ceiling = Math.min(capMs, baseMs * Math.pow(2, attempt));
  const ms = Math.random() * ceiling;
  return new Promise((r) => setTimeout(r, ms));
}

export async function shopifyFetch<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  maxRetries = 4
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(shopifyGraphqlUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
      },
      body: JSON.stringify({ query, variables }),
    });

    // 429 or 5xx — back off and retry
    if (res.status === 429 || res.status >= 500) {
      if (attempt < maxRetries) {
        await jitterDelay(attempt);
        continue;
      }
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };

    // GraphQL-level throttle (leaky bucket exhausted)
    const throttled = json.errors?.some(
      (e) => e.extensions?.code === "THROTTLED" || e.message?.toLowerCase().includes("throttled")
    );
    if (throttled && attempt < maxRetries) {
      await jitterDelay(attempt);
      continue;
    }

    return json;
  }

  throw new Error("Shopify API: max retries exceeded");
}

export function toLocationGid(envVal: string | undefined): string {
  if (!envVal) return "";
  return envVal.startsWith("gid://")
    ? envVal
    : `gid://shopify/Location/${envVal}`;
}

export const FIND_VARIANT_QUERY = /* GraphQL */ `
  query FindVariant($query: String!) {
    productVariants(first: 1, query: $query) {
      edges {
        node {
          id
          sku
          barcode
          price
          product {
            title
            productType
            collections(first: 5) {
              edges { node { title } }
            }
          }
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

const FIND_VARIANT_WITH_INVENTORY_QUERY = /* GraphQL */ `
  query FindVariantWithInventory($query: String!, $locationId: ID!) {
    productVariants(first: 1, query: $query) {
      edges {
        node {
          id
          sku
          barcode
          price
          product {
            title
            productType
            collections(first: 5) {
              edges { node { title } }
            }
          }
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

const BATCH_ADJUST_MUTATION = /* GraphQL */ `
  mutation BatchAdjust($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        changes { name delta quantityAfterChange }
      }
      userErrors { field message }
    }
  }
`;

interface BatchAdjustData {
  inventoryAdjustQuantities: {
    inventoryAdjustmentGroup: {
      id: string;
      reason: string;
      referenceDocumentUri: string;
      changes: Array<{ name: string; delta: number; quantityAfterChange: number }>;
    } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

export interface BatchAdjustChange {
  inventoryItemId: string;
  locationId: string;
  delta: number;
}

export async function batchAdjustInventory(
  changes: BatchAdjustChange[],
  reason: string,
  referenceDocumentUri: string
): Promise<{ userErrors: Array<{ field: string; message: string }>; groupId?: string }> {
  if (changes.length === 0) return { userErrors: [] };

  const CHUNK = 250;
  const allErrors: Array<{ field: string; message: string }> = [];
  let groupId: string | undefined;

  for (let i = 0; i < changes.length; i += CHUNK) {
    const chunk = changes.slice(i, i + CHUNK);
    const result = await shopifyFetch<BatchAdjustData>(BATCH_ADJUST_MUTATION, {
      input: { name: "available", reason, referenceDocumentUri, changes: chunk },
    });
    const data = result?.data?.inventoryAdjustQuantities;
    if (data?.userErrors?.length) allErrors.push(...data.userErrors);
    if (data?.inventoryAdjustmentGroup?.id) groupId = data.inventoryAdjustmentGroup.id;
  }

  return { userErrors: allErrors, groupId };
}

export const ADJUST_INVENTORY_MUTATION = /* GraphQL */ `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        changes {
          name
          delta
          item {
            id
          }
          location {
            id
          }
        }
      }
    }
  }
`;

interface ShopifyVariantNode {
  id: string;
  sku: string;
  barcode: string;
  price?: string;
  product: {
    title: string;
    productType?: string;
    collections?: { edges: Array<{ node: { title: string } }> };
  };
  inventoryItem: {
    id: string;
    inventoryLevel?: { quantities: Array<{ quantity: number }> } | null;
  };
}

interface FindVariantData {
  productVariants: {
    edges: Array<{ node: ShopifyVariantNode }>;
  };
}

export async function findVariantBySku(
  sku: string,
  locationGid?: string
): Promise<ShopifyVariantNode | null> {
  if (!sku) return null;

  const query = locationGid ? FIND_VARIANT_WITH_INVENTORY_QUERY : FIND_VARIANT_QUERY;

  for (const searchField of [`sku:${sku}`, `barcode:${sku}`]) {
    const variables: Record<string, string> = { query: searchField };
    if (locationGid) variables.locationId = locationGid;
    const result = await shopifyFetch<FindVariantData>(query, variables);
    const edges = result?.data?.productVariants?.edges ?? [];
    if (edges.length > 0) return edges[0].node;
  }

  return null;
}

const SEARCH_BY_TITLE_QUERY = /* GraphQL */ `
  query SearchByTitle($q: String!) {
    products(first: 10, query: $q) {
      nodes {
        title
        variants(first: 5) {
          nodes {
            id
            sku
            barcode
            inventoryItem { id }
          }
        }
      }
    }
  }
`;

interface SearchProductsData {
  products: {
    nodes: Array<{
      title: string;
      variants: {
        nodes: Array<{
          id: string;
          sku: string;
          barcode: string;
          inventoryItem: { id: string };
        }>;
      };
    }>;
  };
}

const SIZE_WORDS = new Set(["xs","s","m","l","xl","xxl","2xl","3xl","4xl","small","medium","large","one","size"]);
const COLOR_WORDS = new Set(["black","white","red","blue","green","yellow","purple","pink","orange","grey","gray","silver","gold","rose","royal","shiny","matte","dark","light","navy","teal","coral","beige","cream","brown","maroon","violet","indigo","lime","aqua","cyan","magenta","pearl","chrome","gloss","satin"]);

function extractCoreModel(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const hasAlpha = tokens.some((t) => /[a-z]/.test(t));

  const core = tokens.filter((t) => {
    if (t.length <= 1) return false;
    if (SIZE_WORDS.has(t) || COLOR_WORDS.has(t)) return false;
    // Keep model numbers (2+ digit pure numbers) when there's a brand name present
    if (/^\d{2,}$/.test(t)) return hasAlpha;
    return true;
  });

  return core.slice(0, 4).join(" ");
}

export async function fetchVariantsByQuery(q: string): Promise<ShopifyVariantNode[]> {
  const result = await shopifyFetch<SearchProductsData>(SEARCH_BY_TITLE_QUERY, { q });
  const products = result?.data?.products?.nodes ?? [];
  const variants: ShopifyVariantNode[] = [];
  for (const p of products) {
    for (const v of p.variants.nodes) {
      variants.push({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        inventoryItem: v.inventoryItem,
        product: { title: p.title },
      });
    }
  }
  return variants;
}

export async function searchVariantsByTitle(name: string): Promise<ShopifyVariantNode[]> {
  if (!name) return [];

  const coreQuery = extractCoreModel(name);
  if (!coreQuery) return [];

  // Search with title: prefix (exact match), then without (broader)
  const [exact, broad] = await Promise.all([
    fetchVariantsByQuery(`title:${coreQuery}`),
    fetchVariantsByQuery(coreQuery),
  ]);

  // Merge, deduplicate by variantId, cap at 10
  const seen = new Set<string>();
  const merged: ShopifyVariantNode[] = [];
  for (const v of [...exact, ...broad]) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      merged.push(v);
      if (merged.length >= 10) break;
    }
  }
  return merged;
}

// Full catalog: active + draft + archived (no status restriction).
// Client requirement — Jack needs to count/order products regardless of Shopify status.
export const CATALOG_QUERY = /* GraphQL */ `
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active OR status:draft OR status:archived") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          productType
          status
          tags
          updatedAt
          collections(first: 10) {
            edges {
              node {
                title
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryItem { id }
              }
            }
          }
        }
      }
    }
  }
`;

interface CatalogData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    edges: Array<{
      node: {
        id: string;
        title: string;
        productType: string;
        status: string;
        tags: string[];
        updatedAt: string;
        collections: { edges: Array<{ node: { title: string } }> };
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              sku: string;
              barcode: string;
              price: string;
              compareAtPrice: string | null;
              inventoryItem: { id: string };
            };
          }>;
        };
      };
    }>;
  };
}

export interface CatalogVariant {
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
  collections: string[];
  status: string;
  tags: string[];
  shopifyUpdatedAt: string;
}

/** Fetch ONE page (250 products) of catalog variants. Used by the paginated sync to stay under the 60s serverless limit. */
export async function fetchVariantsPage(
  cursor?: string
): Promise<{ variants: CatalogVariant[]; nextCursor: string | null }> {
  const vars: Record<string, unknown> = cursor ? { cursor } : {};
  const page: { data?: CatalogData } = await shopifyFetch<CatalogData>(CATALOG_QUERY, vars);
  const products = page?.data?.products;
  if (!products) return { variants: [], nextCursor: null };

  const variants: CatalogVariant[] = [];
  for (const { node: p } of products.edges) {
    for (const { node: v } of p.variants.edges) {
      variants.push({
        variantId: v.id,
        productId: p.id,
        productTitle: p.title,
        variantTitle: v.title === "Default Title" ? "" : v.title,
        sku: v.sku || "",
        barcode: v.barcode || "",
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
        inventoryItemId: v.inventoryItem.id,
        productType: p.productType || "",
        collections: p.collections.edges.map((e) => e.node.title),
        status: p.status,
        tags: p.tags,
        shopifyUpdatedAt: p.updatedAt,
      });
    }
  }
  return { variants, nextCursor: products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null };
}

export async function fetchAllVariants(): Promise<CatalogVariant[]> {
  const all: CatalogVariant[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { variants, nextCursor } = await fetchVariantsPage(cursor);
    all.push(...variants);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return all;
}

export const REGISTER_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      userErrors { field message }
      webhookSubscription { id topic }
    }
  }
`;

interface AdjustInventoryData {
  inventoryAdjustQuantities: {
    userErrors: Array<{ field: string; message: string }>;
    inventoryAdjustmentGroup: {
      changes: Array<{
        name: string;
        delta: number;
        item: { id: string };
        location: { id: string };
      }>;
    } | null;
  };
}

export async function adjustInventory(
  inventoryItemId: string,
  locationId: string,
  delta: number
): Promise<{ userErrors: Array<{ field: string; message: string }> }> {
  const result = await shopifyFetch<AdjustInventoryData>(
    ADJUST_INVENTORY_MUTATION,
    {
      input: {
        reason: "received",
        name: "available",
        changes: [
          {
            inventoryItemId,
            locationId,
            delta,
          },
        ],
      },
    }
  );

  return {
    userErrors:
      result?.data?.inventoryAdjustQuantities?.userErrors ?? [],
  };
}

const FETCH_INVENTORY_LEVELS_QUERY = /* GraphQL */ `
  query FetchInventoryLevels($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        tracked
        unitCost { amount currencyCode }
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["on_hand"]) {
            name
            quantity
          }
        }
      }
    }
  }
`;

interface FetchInventoryLevelsData {
  nodes: Array<{
    id: string;
    tracked?: boolean;
    unitCost?: { amount: string; currencyCode: string } | null;
    inventoryLevel?: {
      quantities: Array<{ name: string; quantity: number }>;
    } | null;
  }>;
}

export interface InventoryLevelResult {
  inventoryItemId: string;
  onHandQty: number;
  unitCost: number | null;
  tracked: boolean;
}

export async function fetchInventoryLevels(
  inventoryItemIds: string[],
  locationGid: string
): Promise<InventoryLevelResult[]> {
  if (inventoryItemIds.length === 0) return [];
  const result = await shopifyFetch<FetchInventoryLevelsData>(
    FETCH_INVENTORY_LEVELS_QUERY,
    { ids: inventoryItemIds, locationId: locationGid }
  );
  return (result?.data?.nodes ?? []).map((node) => ({
    inventoryItemId: node.id,
    onHandQty: node.inventoryLevel?.quantities?.find((q) => q.name === "on_hand")?.quantity ?? 0,
    unitCost: node.unitCost ? parseFloat(node.unitCost.amount) : null,
    tracked: node.tracked ?? true,
  }));
}

const CHECK_LOCATION_QUERY = /* GraphQL */ `
  query CheckLocation($id: ID!) {
    location(id: $id) {
      id
      isActive
      fulfillsOnlineOrders
    }
  }
`;

interface CheckLocationData {
  location: { id: string; isActive: boolean; fulfillsOnlineOrders: boolean } | null;
}

export async function checkLocation(locationGid: string): Promise<{ isActive: boolean; fulfillsOnlineOrders: boolean; checked: boolean }> {
  const result = await shopifyFetch<CheckLocationData>(CHECK_LOCATION_QUERY, { id: locationGid });
  const loc = result?.data?.location;
  // If loc is null (e.g. token lacks read_locations scope), treat as unverifiable — don't block sync
  if (!loc) return { isActive: false, fulfillsOnlineOrders: false, checked: false };
  return { isActive: loc.isActive, fulfillsOnlineOrders: loc.fulfillsOnlineOrders, checked: true };
}

const SET_INVENTORY_BATCH_MUTATION = /* GraphQL */ `
  mutation InventorySetBatch($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        createdAt
        reason
        referenceDocumentUri
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

interface SetInventoryData {
  inventorySetQuantities: {
    inventoryAdjustmentGroup: { id: string; createdAt: string; referenceDocumentUri?: string } | null;
    userErrors: Array<{ field: string; message: string; code?: string }>;
  };
}

export interface BatchSetItem {
  inventoryItemId: string;
  quantity: number;        // absolute target qty (Q_initial + Q_parsed)
  changeFromQuantity: number; // Q_initial captured before review
}

export async function batchSetInventory(
  items: BatchSetItem[],
  locationGid: string,
  referenceDocumentUri: string
): Promise<{ userErrors: Array<{ field: string; message: string; code?: string }>; groupId?: string }> {
  if (items.length === 0) return { userErrors: [] };

  // Shopify inventorySetQuantities accepts max 250 per call — chunk if needed
  const CHUNK = 250;
  const allErrors: Array<{ field: string; message: string; code?: string }> = [];
  let groupId: string | undefined;

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const result = await shopifyFetch<SetInventoryData>(SET_INVENTORY_BATCH_MUTATION, {
      input: {
        name: "on_hand",
        reason: "received",
        referenceDocumentUri,
        quantities: chunk.map((it) => ({
          inventoryItemId: it.inventoryItemId,
          locationId: locationGid,
          quantity: it.quantity,
          // Shopify's field is `compareQuantity` (compare-and-set). The old name
          // `changeFromQuantity` is invalid here → Shopify errored silently.
          compareQuantity: it.changeFromQuantity,
        })),
      },
    });
    // Surface top-level GraphQL errors too — not just userErrors — so a rejected
    // write can never be reported as success.
    if (result?.errors?.length) {
      allErrors.push(...result.errors.map((e) => ({ field: "", message: e.message })));
    }
    const data = result?.data?.inventorySetQuantities;
    if (data?.userErrors?.length) allErrors.push(...data.userErrors);
    if (data?.inventoryAdjustmentGroup?.id) groupId = data.inventoryAdjustmentGroup.id;
    // No adjustment group + no errors = nothing actually happened → flag it
    if (!data?.inventoryAdjustmentGroup?.id && !(data?.userErrors?.length) && !(result?.errors?.length)) {
      allErrors.push({ field: "", message: "Shopify did not confirm the inventory update (no adjustment created)." });
    }
  }

  return { userErrors: allErrors, groupId };
}

const UPDATE_ITEM_COST_MUTATION = /* GraphQL */ `
  mutation UpdateItemCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id }
      userErrors { field message }
    }
  }
`;

export async function updateInventoryItemCost(
  inventoryItemId: string,
  cost: number
): Promise<void> {
  await shopifyFetch(UPDATE_ITEM_COST_MUTATION, {
    id: inventoryItemId,
    input: { cost: cost.toFixed(4) },
  });
}

const MOVE_INVENTORY_MUTATION = /* GraphQL */ `
  mutation MoveInventory($input: InventoryMoveQuantitiesInput!) {
    inventoryMoveQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        createdAt
        reason
        changes {
          name
          delta
          quantityAfterChange
          item { id }
          location { id name }
        }
      }
      userErrors { field message }
    }
  }
`;

interface MoveInventoryData {
  inventoryMoveQuantities: {
    inventoryAdjustmentGroup: {
      id: string;
      createdAt: string;
      reason: string;
      changes: Array<{
        name: string;
        delta: number;
        quantityAfterChange: number;
        item: { id: string };
        location: { id: string; name: string };
      }>;
    } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

export interface TransferChange {
  inventoryItemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
}

export async function moveInventory(
  changes: TransferChange[]
): Promise<{ userErrors: Array<{ field: string; message: string }>; groupId?: string }> {
  if (changes.length === 0) return { userErrors: [] };

  const result = await shopifyFetch<MoveInventoryData>(MOVE_INVENTORY_MUTATION, {
    input: {
      reason: "correction",
      changes: changes.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        fromLocationId: c.fromLocationId,
        toLocationId: c.toLocationId,
        quantity: c.quantity,
      })),
    },
  });

  const data = result?.data?.inventoryMoveQuantities;
  return {
    userErrors: data?.userErrors ?? [],
    groupId: data?.inventoryAdjustmentGroup?.id,
  };
}
