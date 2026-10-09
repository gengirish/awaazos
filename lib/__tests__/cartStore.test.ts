import { beforeEach, describe, expect, it } from "vitest";

import { useCartStore } from "@/lib/cartStore";

describe("cartStore", () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
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

  it("removeItem can be undone into its old position", () => {
    const { addItem, removeItem, undoRemove } = useCartStore.getState();
    addItem({ menuItemId: "a", name: "Chai", emoji: "☕", priceInPaise: 1000 });
    addItem({ menuItemId: "b", name: "Samosa", emoji: "🥟", priceInPaise: 1500, qty: 2 });
    addItem({ menuItemId: "c", name: "Vada", emoji: "🍩", priceInPaise: 1200 });
    removeItem("b");
    expect(useCartStore.getState().items.map((i) => i.menuItemId)).toEqual(["a", "c"]);
    undoRemove();
    expect(useCartStore.getState().items.map((i) => [i.menuItemId, i.qty])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ]);
    expect(useCartStore.getState().lastRemoved).toBeNull();
  });

  it("undoRemove does not duplicate a line that was re-added", () => {
    const { addItem, removeItem, undoRemove } = useCartStore.getState();
    addItem({ menuItemId: "a", name: "Chai", emoji: "☕", priceInPaise: 1000 });
    removeItem("a");
    addItem({ menuItemId: "a", name: "Chai", emoji: "☕", priceInPaise: 1000 });
    undoRemove();
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it("setItemsFromVoice records which items voice touched", () => {
    const { addItem, setItemsFromVoice } = useCartStore.getState();
    addItem({ menuItemId: "a", name: "Chai", emoji: "☕", priceInPaise: 1000 });
    setItemsFromVoice([{ menuItemId: "b", name: "Samosa", priceInPaise: 1500, qty: 2 }]);
    expect(useCartStore.getState().voiceAddedIds).toEqual(["b"]);
  });

  it("clearCart resets voice and undo markers", () => {
    const s = useCartStore.getState();
    s.addItem({ menuItemId: "a", name: "Chai", emoji: "☕", priceInPaise: 1000 });
    s.setItemsFromVoice([{ menuItemId: "b", name: "Samosa", priceInPaise: 1500, qty: 1 }]);
    s.setVoiceReview({ lowConfidence: true, unmatched: ["pakoda"] });
    s.removeItem("a");
    s.clearCart();
    expect(useCartStore.getState()).toMatchObject({
      items: [],
      voiceAddedIds: [],
      voiceReview: null,
      lastRemoved: null,
    });
  });
});
