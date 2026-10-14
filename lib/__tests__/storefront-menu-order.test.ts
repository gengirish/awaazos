import { describe, expect, it } from "vitest";

import {
  MAX_LINE_QTY,
  fulfilmentOptionsLabel,
  orderErrorMessage,
  orderStatusLabel,
  toMenuOrderLines,
} from "@/lib/storefront-order";
import { storefrontMenuOrderSchema } from "@/lib/zod-drops";

describe("toMenuOrderLines", () => {
  it("maps the cart to menuItemId + qty only — never a price", () => {
    const lines = toMenuOrderLines({ a: 2, b: 1 });
    expect(lines).toEqual([
      { menuItemId: "a", qty: 2 },
      { menuItemId: "b", qty: 1 },
    ]);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["menuItemId", "qty"]);
  });

  it("drops empty, negative and fractional lines and clamps to the schema ceiling", () => {
    expect(toMenuOrderLines({ a: 0, b: -1, c: 1.5, d: 500 })).toEqual([{ menuItemId: "d", qty: MAX_LINE_QTY }]);
    expect(toMenuOrderLines({})).toEqual([]);
  });

  it("produces items the menu-order schema accepts", () => {
    const parsed = storefrontMenuOrderSchema.safeParse({
      items: toMenuOrderLines({ m1: 3, m2: 120 }),
      customerName: "Asha",
      customerPhone: "+919876543210",
      fulfilmentType: "PICKUP",
      paymentMethod: "CASH",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("fulfilmentOptionsLabel", () => {
  it("labels each mode", () => {
    expect(fulfilmentOptionsLabel(["DELIVERY", "PICKUP"])).toBe("Delivery or pickup");
    expect(fulfilmentOptionsLabel(["DELIVERY"])).toBe("Delivery only");
    expect(fulfilmentOptionsLabel(["PICKUP"])).toBe("Pickup only");
  });
});

describe("orderErrorMessage — menu orders", () => {
  it("has copy for menu_orders_disabled that doesn't mention drops or plans", () => {
    const msg = orderErrorMessage({ error: "menu_orders_disabled" });
    expect(msg).toMatch(/stopped taking online orders/);
    expect(msg).not.toMatch(/plan|upgrade|pre-order|drop/i);
  });

  it("distinguishes a menu item_not_found from a drop one", () => {
    expect(orderErrorMessage({ error: "item_not_found", menuItemId: "m1" }, "Masala chai")).toBe(
      "Masala chai isn't available right now. We've removed it from your cart — please check and try again.",
    );
    expect(orderErrorMessage({ error: "item_not_found", dropItemId: "d1" }, "Laddu")).toMatch(
      /no longer available/,
    );
    expect(orderErrorMessage({ error: "item_not_found", menuItemId: "m1" })).toMatch(/^One item isn't available/);
  });
});

describe("orderStatusLabel — menu orders", () => {
  it("drops the stock wording on an expired menu order", () => {
    expect(orderStatusLabel("EXPIRED", "PLACED", { menuOrder: true }).label).toBe("Expired — please order again");
    expect(orderStatusLabel("EXPIRED", "PLACED").label).toBe("Expired — items released, please order again");
    expect(orderStatusLabel("PAY_ON_DELIVERY", "PLACED", { menuOrder: true }).label).toBe("Pay on delivery");
  });
});
