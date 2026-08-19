import { describe, expect, it } from "vitest";
import type { PurchaseOrder } from "./types";
import { findStuckInvoices } from "./stuckInvoices";

const NOW = Date.parse("2026-08-18T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function po(over: Partial<PurchaseOrder>): PurchaseOrder {
  return {
    id: "po-1",
    supplier: "FE Sports",
    invoiceNumber: "INV-1",
    invoiceDate: daysAgo(1),
    orderNumber: "",
    location: "Warehouse",
    paymentTerms: "",
    lineItems: [],
    shippingCost: 0,
    status: "awaiting_review",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...over,
  } as PurchaseOrder;
}

const sync = (over: Partial<PurchaseOrder["syncResult"]>) =>
  ({
    syncedAt: daysAgo(0),
    results: [],
    successCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    ...over,
  }) as NonNullable<PurchaseOrder["syncResult"]>;

describe("findStuckInvoices", () => {
  it("flags the invoice that reported success while writing nothing", () => {
    // Jack's case: the sync ran, every line missed, Shopify got nothing.
    const stuck = findStuckInvoices(
      [po({ status: "approved", syncResult: sync({ successCount: 0, notFoundCount: 4 }) })],
      NOW
    );
    expect(stuck).toHaveLength(1);
    expect(stuck[0].reason).toBe("never_landed");
    expect(stuck[0].detail).toContain("4 lines");
  });

  it("flags it the same day — this is not something to notice a week later", () => {
    const stuck = findStuckInvoices(
      [po({ syncResult: sync({ successCount: 0, syncedAt: daysAgo(0) }) })],
      NOW
    );
    expect(stuck).toHaveLength(1);
  });

  it("leaves a healthy synced invoice alone", () => {
    const stuck = findStuckInvoices(
      [po({ status: "approved", syncResult: sync({ successCount: 6 }) })],
      NOW
    );
    expect(stuck).toEqual([]);
  });

  it("gives a partly-matched invoice a week of grace, then flags it", () => {
    const partial = (days: number) =>
      po({ syncResult: sync({ successCount: 3, notFoundCount: 2, syncedAt: daysAgo(days) }) });

    expect(findStuckInvoices([partial(6)], NOW)).toEqual([]);
    const stuck = findStuckInvoices([partial(7)], NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].reason).toBe("unmatched_lines");
  });

  it("flags an invoice imported long ago and never sent", () => {
    expect(findStuckInvoices([po({ createdAt: daysAgo(13) })], NOW)).toEqual([]);
    const stuck = findStuckInvoices([po({ createdAt: daysAgo(14) })], NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].reason).toBe("never_synced");
  });

  it("ignores drafts — an unfinished invoice is not a failure", () => {
    expect(findStuckInvoices([po({ status: "draft", createdAt: daysAgo(90) })], NOW)).toEqual([]);
  });

  it("puts the worst first so the banner leads with it", () => {
    const stuck = findStuckInvoices(
      [
        po({ id: "old", createdAt: daysAgo(30) }),
        po({ id: "ghost", syncResult: sync({ successCount: 0, notFoundCount: 1 }) }),
      ],
      NOW
    );
    expect(stuck.map((s) => s.id)).toEqual(["ghost", "old"]);
  });

  it("survives a malformed date instead of throwing on the dashboard", () => {
    expect(() => findStuckInvoices([po({ createdAt: "not a date" })], NOW)).not.toThrow();
  });
});
