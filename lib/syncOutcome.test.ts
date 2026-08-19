import { describe, expect, it } from "vitest";
import { landedInShopify, statusAfterSync } from "./syncOutcome";

// Regression tests for the 2026-08-18 "ghost approved" bug: an invoice whose
// lines all came back not_found produced zero errors and zero writes, and the
// old rule (errorCount === 0) promoted it to "approved" anyway.

describe("statusAfterSync", () => {
  it("does not approve a sync that wrote nothing, even with no errors", () => {
    // The exact shape of the bug.
    expect(statusAfterSync({ successCount: 0, notFoundCount: 4, errorCount: 0 } as never)).toBe(
      "awaiting_review"
    );
  });

  it("approves a clean sync that wrote at least one line", () => {
    expect(statusAfterSync({ successCount: 4, errorCount: 0 })).toBe("approved");
  });

  it("keeps a partial success open for another pass", () => {
    expect(statusAfterSync({ successCount: 3, errorCount: 1 })).toBe("awaiting_review");
  });

  it("does not approve an empty invoice", () => {
    expect(statusAfterSync({ successCount: 0, errorCount: 0 })).toBe("awaiting_review");
  });
});

describe("landedInShopify", () => {
  it("is false when nothing was written — this is what re-opens the retry", () => {
    expect(landedInShopify({ successCount: 0 })).toBe(false);
  });

  it("is false for a purchase order that never synced", () => {
    expect(landedInShopify(undefined)).toBe(false);
    expect(landedInShopify(null)).toBe(false);
  });

  it("is true once a line has been written", () => {
    expect(landedInShopify({ successCount: 1 })).toBe(true);
  });
});
