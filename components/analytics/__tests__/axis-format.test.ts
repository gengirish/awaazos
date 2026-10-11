import { describe, expect, it } from "vitest";

import { formatAxisINR, sharePercent } from "../axis-format";

describe("formatAxisINR", () => {
  it("shows whole rupees below a thousand", () => {
    expect(formatAxisINR(0)).toBe("₹0");
    expect(formatAxisINR(85_000)).toBe("₹850");
    expect(formatAxisINR(99_999)).toBe("₹999");
  });

  it("shortens thousands, lakhs and crores to one decimal", () => {
    expect(formatAxisINR(1_00_000)).toBe("₹1k");
    expect(formatAxisINR(1_50_000)).toBe("₹1.5k");
    expect(formatAxisINR(12_00_000)).toBe("₹12k");
    expect(formatAxisINR(99_99_900)).toBe("₹99.9k");
    expect(formatAxisINR(1_00_00_000)).toBe("₹1L");
    expect(formatAxisINR(2_45_00_000)).toBe("₹2.4L");
    expect(formatAxisINR(1_25_00_00_000)).toBe("₹1.2Cr");
  });

  it("copes with the fractional and negative ticks a chart can produce", () => {
    expect(formatAxisINR(2_50_050.5)).toBe("₹2.5k");
    expect(formatAxisINR(-500)).toBe("₹0");
    expect(formatAxisINR(Number.NaN)).toBe("₹0");
  });

  it("stays short enough for a 48px axis", () => {
    for (const paise of [0, 99_900, 1_50_000, 99_99_900, 9_99_99_900, 99_99_99_99_900]) {
      expect(formatAxisINR(paise).length).toBeLessThanOrEqual(7);
    }
  });
});

describe("sharePercent", () => {
  it("rounds to the nearest whole percent", () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
    expect(sharePercent(5000, 5000)).toBe(100);
  });

  it("is 0 when there is nothing to share", () => {
    expect(sharePercent(0, 0)).toBe(0);
    expect(sharePercent(0, 100)).toBe(0);
  });
});
