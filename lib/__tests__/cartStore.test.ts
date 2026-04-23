import { beforeEach, describe, expect, it } from "vitest";

import { useCartStore } from "@/lib/cartStore";

describe("cartStore", () => {
  beforeEach(() => {
    useCartStore.setState({ items: [] });
  });

  it("addItem increments qty when item already in cart", () => {
    const { addItem } = useCartStore.getState();
    addItem({
      menuItemId: "a",
      name: "Bhel",
      emoji: "🥙",
      priceInPaise: 1950,
    });
    addItem({
      menuItemId: "a",
      name: "Bhel",
      emoji: "🥙",
      priceInPaise: 1950,
      qty: 2,
    });
    expect(useCartStore.getState().items).toEqual([
      { menuItemId: "a", name: "Bhel", emoji: "🥙", priceInPaise: 1950, qty: 3 },
    ]);
  });

  it("decQty removes item when qty reaches 0", () => {
    const { addItem, decQty } = useCartStore.getState();
    addItem({
      menuItemId: "x",
      name: "Chai",
      emoji: "☕",
      priceInPaise: 1000,
      qty: 1,
    });
    decQty("x");
    expect(useCartStore.getState().items).toEqual([]);
  });

  it("getSubtotalPaise sums correctly with mixed qtys (₹19.50 × 3 = 5850 paise)", () => {
    const { addItem, getSubtotalPaise } = useCartStore.getState();
    addItem({
      menuItemId: "a",
      name: "Item",
      emoji: "🍽️",
      priceInPaise: 1950,
      qty: 3,
    });
    expect(getSubtotalPaise()).toBe(5850);
  });

  it("setItemsFromVoice merges duplicate menuItemIds by summing qty", () => {
    const { setItemsFromVoice } = useCartStore.getState();
    setItemsFromVoice([
      { menuItemId: "m1", name: "Samosa", priceInPaise: 3000, qty: 2 },
      { menuItemId: "m1", name: "Samosa", priceInPaise: 3000, qty: 1 },
    ]);
    expect(useCartStore.getState().items).toEqual([
      { menuItemId: "m1", name: "Samosa", emoji: "🍽️", priceInPaise: 3000, qty: 3 },
    ]);
  });

  it("setItemsFromVoice adds to existing cart lines", () => {
    const { addItem, setItemsFromVoice } = useCartStore.getState();
    addItem({
      menuItemId: "m1",
      name: "Samosa",
      emoji: "🥟",
      priceInPaise: 3000,
      qty: 1,
    });
    setItemsFromVoice([{ menuItemId: "m1", name: "Samosa", priceInPaise: 3000, qty: 2 }]);
    expect(useCartStore.getState().items).toEqual([
      { menuItemId: "m1", name: "Samosa", emoji: "🥟", priceInPaise: 3000, qty: 3 },
    ]);
  });

  it("clearCart empties", () => {
    const { addItem, clearCart, getItemCount } = useCartStore.getState();
    addItem({
      menuItemId: "a",
      name: "A",
      emoji: "🍽️",
      priceInPaise: 100,
      qty: 5,
    });
    expect(getItemCount()).toBe(5);
    clearCart();
    expect(useCartStore.getState().items).toEqual([]);
    expect(getItemCount()).toBe(0);
  });
});
