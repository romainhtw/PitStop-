import { adminDb } from "@/lib/firebaseAdmin";

const COLLECTIONS_WITH_MERCHANT_ID = [
  "shopifyProducts",
  "purchaseOrders",
  "suppliers",
  "supplierSkuMappings",
  "supplierNameMappings",
  "merchantUsage",
  "auditLogs",
];

export async function purgeShopData(shop: string): Promise<void> {
  for (const col of COLLECTIONS_WITH_MERCHANT_ID) {
    try {
      const snap = await adminDb
        .collection(col)
        .where("merchantId", "==", shop)
        .get();

      // Batch-delete in chunks of 400 (Firestore limit is 500 per batch)
      const CHUNK = 400;
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const batch = adminDb.batch();
        snap.docs.slice(i, i + CHUNK).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error(`[purgeShopData] failed to purge collection "${col}" for shop ${shop}:`, err);
    }
  }

  // Delete the shop document itself
  try {
    await adminDb.collection("shops").doc(shop).delete();
  } catch (err) {
    console.error(`[purgeShopData] failed to delete shops/${shop}:`, err);
  }
}
