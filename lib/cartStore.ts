import { create } from "zustand";

import { cartLineKey } from "@/lib/item-variants";

export type CartLine = {
  menuItemId: string;
  /** The size or colour picked (lib/item-variants.ts); absent for an item without sizes. */
  variantId?: string | null;
  /** "Cotton kurti – M" for a size, so the cart and the bill read the same. */
  name: string;
  emoji: string;
  priceInPaise: number;
  qty: number;
};

/** One cart line per item, or per item and size: `cartLineKey`. */
export function lineKey(line: Pick<CartLine, "menuItemId" | "variantId">): string {
  return cartLineKey(line.menuItemId, line.variantId);
}

export type VoiceCartItem = {
  menuItemId: string;
  name: string;
  priceInPaise: number;
  qty: number;
};

/**
 * What the last voice order needs the cashier to check. Lives in the store (not
 * in the mic component) so it survives the mic resetting and shows beside the
 * cart until the next voice order or a cleared cart.
 */
export type VoiceReview = {
  lowConfidence: boolean;
  /** Spoken words that matched no menu item. */
  unmatched: string[];
  /** Items voice heard that come in sizes: left out, the cashier taps the size. */
  needsSize?: string[];
};

type CartState = {
  items: CartLine[];
  /** Line keys (`lineKey`) the most recent voice order added or bumped. */
  voiceAddedIds: string[];
  voiceReview: VoiceReview | null;
  /** The last line removed with `removeItem`, for a one-step undo. */
  lastRemoved: { line: CartLine; index: number } | null;
  addItem: (item: Omit<CartLine, "qty"> & { qty?: number }) => void;
  /** These take a line key (`lineKey`): the item id for an item without sizes. */
  incQty: (key: string) => void;
  decQty: (key: string) => void;
  removeItem: (key: string) => void;
  undoRemove: () => void;
  /** Empties the cart and every voice / undo marker that refers to it. */
  clearCart: () => void;
  /** Put back the lines of a sale that was undone (lib/pos-undo.ts). */
  restoreItems: (items: CartLine[]) => void;
  setVoiceReview: (review: VoiceReview | null) => void;
  setItemsFromVoice: (parsed: VoiceCartItem[]) => void;
  getSubtotalPaise: () => number;
  getItemCount: () => number;
};

function lineTotalPaise(line: CartLine): number {
  return line.priceInPaise * line.qty;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  voiceAddedIds: [],
  voiceReview: null,
  lastRemoved: null,

  addItem: (item) => {
    const qty = item.qty ?? 1;
    set((state) => {
      const key = lineKey(item);
      const idx = state.items.findIndex((i) => lineKey(i) === key);
      if (idx >= 0) {
        const next = [...state.items];
        const cur = next[idx]!;
        next[idx] = { ...cur, qty: cur.qty + qty };
        return { items: next };
      }
      return {
        items: [
          ...state.items,
          {
            menuItemId: item.menuItemId,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            name: item.name,
            emoji: item.emoji,
            priceInPaise: item.priceInPaise,
            qty,
          },
        ],
      };
    });
  },

  incQty: (key) => {
    set((state) => ({
      items: state.items.map((i) => (lineKey(i) === key ? { ...i, qty: i.qty + 1 } : i)),
    }));
  },

  decQty: (key) => {
    set((state) => {
      const next: CartLine[] = [];
      for (const i of state.items) {
        if (lineKey(i) !== key) {
          next.push(i);
          continue;
        }
        const q = i.qty - 1;
        if (q > 0) next.push({ ...i, qty: q });
      }
      return { items: next };
    });
  },

  removeItem: (key) => {
    set((state) => {
      const index = state.items.findIndex((i) => lineKey(i) === key);
      if (index < 0) return {};
      return {
        items: state.items.filter((i) => lineKey(i) !== key),
        lastRemoved: { line: state.items[index]!, index },
        voiceAddedIds: state.voiceAddedIds.filter((id) => id !== key),
      };
    });
  },

  undoRemove: () => {
    set((state) => {
      const removed = state.lastRemoved;
      if (!removed) return {};
      // Re-added by a tap since the remove: nothing to restore.
      const key = lineKey(removed.line);
      if (state.items.some((i) => lineKey(i) === key)) {
        return { lastRemoved: null };
      }
      const next = [...state.items];
      next.splice(Math.min(removed.index, next.length), 0, removed.line);
      return { items: next, lastRemoved: null };
    });
  },

  clearCart: () => set({ items: [], voiceAddedIds: [], voiceReview: null, lastRemoved: null }),

  restoreItems: (items) =>
    set({ items: items.map((l) => ({ ...l })), voiceAddedIds: [], voiceReview: null, lastRemoved: null }),

  setVoiceReview: (review) => set({ voiceReview: review }),

  setItemsFromVoice: (parsed) => {
    const defaultEmoji = "🍽️";
    const voiceMerged = new Map<string, VoiceCartItem>();
    for (const p of parsed) {
      const prev = voiceMerged.get(p.menuItemId);
      if (prev) {
        voiceMerged.set(p.menuItemId, {
          ...prev,
          qty: prev.qty + p.qty,
          name: p.name || prev.name,
          priceInPaise: p.priceInPaise,
        });
      } else {
        voiceMerged.set(p.menuItemId, { ...p });
      }
    }
    set((state) => {
      // Keyed by line: a voice line (never a size) merges into the item's own
      // line, not into a "Kurti – M" line of the same item.
      const byId = new Map<string, CartLine>();
      for (const line of state.items) {
        byId.set(lineKey(line), { ...line });
      }
      for (const p of Array.from(voiceMerged.values())) {
        const prev = byId.get(p.menuItemId);
        if (prev) {
          byId.set(p.menuItemId, {
            ...prev,
            qty: prev.qty + p.qty,
            name: p.name || prev.name,
            priceInPaise: p.priceInPaise,
          });
        } else {
          byId.set(p.menuItemId, {
            menuItemId: p.menuItemId,
            name: p.name,
            emoji: defaultEmoji,
            priceInPaise: p.priceInPaise,
            qty: p.qty,
          });
        }
      }
      return {
        items: Array.from(byId.values()),
        voiceAddedIds: Array.from(voiceMerged.keys()),
      };
    });
  },

  getSubtotalPaise: () => {
    let s = 0;
    for (const line of get().items) {
      s += lineTotalPaise(line);
    }
    return s;
  },

  getItemCount: () => get().items.reduce((n, i) => n + i.qty, 0),
}));
