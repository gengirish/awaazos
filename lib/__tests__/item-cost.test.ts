import { describe, expect, it } from "vitest";

import { canSeeCost, costLine, hideCost, marginPaise, parseCostInput, rowsForRole, unitCostFor } from "@/lib/item-cost";
import { costInRupeesSchema, takeCostField } from "@/lib/item-cost-schema";
import { sizeDraftsFrom, sizeDraftsToBody } from "@/lib/item-variants-form";
import { itemVariantsSchema } from "@/lib/item-variants-schema";

describe("cost price: who sees it", () => {
  it("is for MANAGER and OWNER only", () => {
    expect(canSeeCost("CASHIER")).toBe(false);
    expect(canSeeCost("MANAGER")).toBe(true);
    expect(canSeeCost("OWNER")).toBe(true);
  });

  it("nulls every cost on a row, sizes included, for anyone else", () => {
    const row = { id: "i1", costInPaise: 25000, variants: [{ id: "v1", costInPaise: 30000 }] };
    expect(hideCost(row)).toEqual({ id: "i1", costInPaise: null, variants: [{ id: "v1", costInPaise: null }] });
    expect(rowsForRole([row], "CASHIER")).toEqual([hideCost(row)]);
    expect(rowsForRole([row], "MANAGER")).toEqual([row]);
    // A row without sizes stays without them.
    expect(hideCost({ costInPaise: 100 })).toEqual({ costInPaise: null });
  });
});

describe("cost price: arithmetic", () => {
  it("a size uses its own cost, else the item's, else none", () => {
    expect(unitCostFor(25000, 30000)).toBe(30000);
    expect(unitCostFor(25000, null)).toBe(25000);
    expect(unitCostFor(25000)).toBe(25000);
    expect(unitCostFor(null, null)).toBeNull();
    // A size's cost of 0 is a cost, not "use the item's".
    expect(unitCostFor(25000, 0)).toBe(0);
  });

  it("margin is price minus cost, and none without a cost", () => {
    expect(marginPaise(40000, 25000)).toBe(15000);
    expect(marginPaise(40000, 45000)).toBe(-5000);
    expect(marginPaise(40000, null)).toBeNull();
  });

  it("labels the card line, naming a loss", () => {
    expect(costLine(40000, 25000)).toBe("Cost ₹250.00 · Margin ₹150.00");
    expect(costLine(40000, 45000)).toContain("Loss");
    expect(costLine(40000, null)).toBeNull();
  });
});

describe("cost price: what a seller types", () => {
  it("blank means none recorded", () => {
    expect(parseCostInput("  ")).toEqual({ paise: null });
  });

  it("takes rupees with up to 2 decimals, and 0", () => {
    expect(parseCostInput("250")).toEqual({ paise: 25000 });
    expect(parseCostInput("₹1,250.50")).toEqual({ paise: 125050 });
    expect(parseCostInput("0")).toEqual({ paise: 0 });
  });

  it("refuses anything else", () => {
    expect(parseCostInput("12.345")).toEqual({ error: "Use at most 2 decimal places" });
    expect(parseCostInput("abc")).toHaveProperty("error");
    expect(parseCostInput("-5")).toHaveProperty("error");
    expect(parseCostInput("100001")).toHaveProperty("error");
  });
});

describe("cost price: on the wire", () => {
  it("takes costInRupees out of a body as paise", () => {
    expect(takeCostField({ name: "Kurti", costInRupees: 250.5 })).toEqual({ cost: 25050, rest: { name: "Kurti" } });
    expect(takeCostField({ costInRupees: null })).toEqual({ cost: null, rest: {} });
    expect(takeCostField({ name: "Kurti" })).toEqual({ cost: undefined, rest: { name: "Kurti" } });
    expect(takeCostField(null)).toEqual({ cost: undefined, rest: null });
  });

  it("refuses a bad cost", () => {
    expect(() => takeCostField({ costInRupees: -1 })).toThrow();
    expect(() => takeCostField({ costInRupees: "250" })).toThrow();
    expect(() => takeCostField({ costInRupees: 1.234 })).toThrow();
    expect(costInRupeesSchema.safeParse(100_000).success).toBe(true);
    expect(costInRupeesSchema.safeParse(100_000.01).success).toBe(false);
  });

  it("a size row may carry its own cost", () => {
    const body = { variants: [{ label: "M", costInRupees: 300 }, { label: "L", costInRupees: null }, { label: "XL" }] };
    expect(itemVariantsSchema.parse(body).variants.map((v) => v.costInRupees)).toEqual([300, null, undefined]);
    expect(itemVariantsSchema.safeParse({ variants: [{ label: "M", costInRupees: -1 }] }).success).toBe(false);
  });
});

describe("cost price: the form's size rows", () => {
  const saved = {
    id: "v1",
    label: "M",
    priceInPaise: null,
    costInPaise: 30000,
    isAvailable: true,
    sortOrder: 0,
    stockQty: null,
    lowStockAt: null,
    stockLeft: null,
    stockSetAside: null,
  };

  it("shows a saved cost and sends it back only when the viewer may set it", () => {
    const drafts = sizeDraftsFrom([saved]);
    expect(drafts[0].cost).toBe("300");
    expect(sizeDraftsToBody(drafts, { cost: true })).toEqual({
      body: { variants: [{ id: "v1", label: "M", priceInRupees: null, isAvailable: true, costInRupees: 300 }] },
    });
    // A cashier's rows carry no cost; the body leaves the saved one alone.
    expect(sizeDraftsToBody(sizeDraftsFrom([{ ...saved, costInPaise: null }]))).toEqual({
      body: { variants: [{ id: "v1", label: "M", priceInRupees: null, isAvailable: true }] },
    });
  });

  it("a blank cost clears it, a bad one is the row's error", () => {
    const [d] = sizeDraftsFrom([saved]);
    expect(sizeDraftsToBody([{ ...d, cost: "" }], { cost: true })).toEqual({
      body: { variants: [{ id: "v1", label: "M", priceInRupees: null, isAvailable: true, costInRupees: null }] },
    });
    expect(sizeDraftsToBody([{ ...d, cost: "1.234" }], { cost: true })).toEqual({
      error: { index: 0, field: "cost", message: "Use at most 2 decimal places" },
    });
  });
});
