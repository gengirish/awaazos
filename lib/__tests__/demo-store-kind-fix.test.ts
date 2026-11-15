import { describe, expect, it } from "vitest";

import { isPlateFallback, planDemoKindFix } from "@/lib/demo-store-kind-fix";

const item = (id: string, name: string, emoji: string | null, imageUrl: string | null = null) => ({
  id,
  name,
  emoji,
  imageUrl,
});

describe("isPlateFallback", () => {
  it("treats the plate with or without the variation selector, and no emoji, as the fallback", () => {
    expect(isPlateFallback("🍽️")).toBe(true);
    expect(isPlateFallback("🍽")).toBe(true);
    expect(isPlateFallback(null)).toBe(true);
    expect(isPlateFallback("💍")).toBe(false);
  });
});

describe("planDemoKindFix", () => {
  const general = { stallType: "GENERAL" as const, stallTypeOther: null };

  it("re-files a kitchen-filed jewellery store and re-picks plate items without photos", () => {
    const plan = planDemoKindFix(general, "jewellery_accessories", [
      item("a", "Tulip bracelet", "🍽️"),
      item("b", "Organza bow clip", "🍽️"),
      item("c", "Promise chain", "🍽️", "https://blob/photo.jpg"),
      item("d", "Mystery box", "🍽️"),
    ]);
    expect(plan.stallType).toBe("OTHER");
    expect(plan.stallTypeOther).toBe("Jewellery & accessories");
    expect(plan.storeChanges).toBe(true);
    expect(plan.items).toEqual([
      { id: "a", name: "Tulip bracelet", from: "🍽️", to: "💍" },
      { id: "b", name: "Organza bow clip", from: "🍽️", to: "🎀" },
      { id: "d", name: "Mystery box", from: "🍽️", to: "🛍️" },
    ]);
  });

  it("keeps an emoji the seller chose", () => {
    const plan = planDemoKindFix(general, "jewellery_accessories", [item("a", "Tulip bracelet", "🌷")]);
    expect(plan.items).toEqual([]);
  });

  it("finds nothing to do on a second run", () => {
    const plan = planDemoKindFix(
      { stallType: "OTHER", stallTypeOther: "Jewellery & accessories" },
      "jewellery_accessories",
      [item("a", "Tulip bracelet", "💍")],
    );
    expect(plan.storeChanges).toBe(false);
    expect(plan.items).toEqual([]);
  });
});
