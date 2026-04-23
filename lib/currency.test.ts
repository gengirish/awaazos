import { describe, expect, it } from "vitest";

import { formatINR, rupeesToPaise, sumPaise } from "./currency";

describe("currency", () => {
  it("rupeesToPaise throws on more than 2 decimal places", () => {
    expect(() => rupeesToPaise(20.555)).toThrow(/at most 2 decimal/);
  });

  it("formatINR uses en-IN grouping (amounts are paise)", () => {
    expect(formatINR(200_000)).toBe("₹2,000.00");
    expect(formatINR(123456789)).toBe("₹12,34,567.89");
  });

  it("sumPaise sums integers", () => {
    expect(sumPaise([100, 200, 300])).toBe(600);
  });
});
