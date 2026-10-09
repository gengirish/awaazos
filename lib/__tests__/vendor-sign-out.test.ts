import { describe, expect, it } from "vitest";

import { pendingSalesMessage, salesCountLabel } from "@/lib/vendor-sign-out";

describe("salesCountLabel", () => {
  it("uses the singular for exactly one sale", () => {
    expect(salesCountLabel(1)).toBe("1 sale");
  });

  it("uses the plural otherwise", () => {
    expect(salesCountLabel(2)).toBe("2 sales");
    expect(salesCountLabel(12)).toBe("12 sales");
  });
});

describe("pendingSalesMessage", () => {
  it("names the count, the store and what to do, singular", () => {
    expect(pendingSalesMessage(1, "Sharma Chaat")).toBe(
      "1 sale from this device hasn't synced yet. It'll stay saved on this device and sync the next " +
        "time someone signs in to Sharma Chaat here. To be safe, go online and let it sync before signing out.",
    );
  });

  it("pluralises the verb with the noun", () => {
    const msg = pendingSalesMessage(3, "Sharma Chaat");
    expect(msg).toBe(
      "3 sales from this device haven't synced yet. They'll stay saved on this device and sync the next " +
        "time someone signs in to Sharma Chaat here. To be safe, go online and let them sync before signing out.",
    );
  });

  it("falls back to a generic store name when none is known", () => {
    expect(pendingSalesMessage(2)).toContain("signs in to this store here");
    expect(pendingSalesMessage(2, "   ")).toContain("signs in to this store here");
  });
});
