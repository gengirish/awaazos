import { describe, expect, it } from "vitest";

import { orderedBadgeText, orderedStep } from "@/lib/item-ordered-count";

describe("orderedStep", () => {
  it("shows nothing below 10", () => {
    expect(orderedStep(0)).toBeNull();
    expect(orderedStep(9)).toBeNull();
  });

  it("rounds down to a step, never the exact number", () => {
    expect(orderedStep(10)).toBe(10);
    expect(orderedStep(24)).toBe(10);
    expect(orderedStep(25)).toBe(25);
    expect(orderedStep(37)).toBe(25);
    expect(orderedStep(50)).toBe(50);
    expect(orderedStep(99)).toBe(50);
    expect(orderedStep(100)).toBe(100);
    expect(orderedStep(5000)).toBe(100);
  });
});

describe("orderedBadgeText", () => {
  it("reads 'Ordered N+ times' and nothing for a missing count", () => {
    expect(orderedBadgeText(37)).toBe("Ordered 25+ times");
    expect(orderedBadgeText(120)).toBe("Ordered 100+ times");
    expect(orderedBadgeText(3)).toBeNull();
    expect(orderedBadgeText(undefined)).toBeNull();
    expect(orderedBadgeText(null)).toBeNull();
  });
});
