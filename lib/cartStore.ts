import { create } from "zustand";

export type CartLine = {
  menuItemId: string;
  name: string;
  emoji: string;
  priceInPaise: number;
  qty: number;
};

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
};

type CartState = {
  items: CartLine[];
  /** Menu item ids the most recent voice order added or bumped. */
  voiceAddedIds: string[];
  voiceReview: VoiceReview | null;
  /** The last line removed with `removeItem`, for a one-step undo. */
  lastRemoved: { line: CartLine; index: number } | null;
  addItem: (item: Omit<CartLine, "qty"> & { qty?: number }) => void;
  incQty: (menuItemId: string) => void;
  decQty: (menuItemId: string) => void;
  removeItem: (menuItemId: string) => void;
  undoRemove: () => void;
  /** Empties the cart and every voice / undo marker that refers to it. */
  clearCart: () => void;
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
      const idx = state.items.findIndex((i) => i.menuItemId === item.menuItemId);
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
            name: item.name,
            emoji: item.emoji,
            priceInPaise: item.priceInPaise,
            qty,
          },
        ],
      };
    });
  },

  incQty: (menuItemId) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.menuItemId === menuItemId ? { ...i, qty: i.qty + 1 } : i,
      ),
    }));
  },

  decQty: (menuItemId) => {
    set((state) => {
      const next: CartLine[] = [];
      for (const i of state.items) {
        if (i.menuItemId !== menuItemId) {
          next.push(i);
          continue;
        }
        const q = i.qty - 1;
        if (q > 0) next.push({ ...i, qty: q });
      }
      return { items: next };
    });
  },

  removeItem: (menuItemId) => {
    set((state) => {
      const index = state.items.findIndex((i) => i.menuItemId === menuItemId);
      if (index < 0) return {};
      return {
        items: state.items.filter((i) => i.menuItemId !== menuItemId),
        lastRemoved: { line: state.items[index]!, index },
        voiceAddedIds: state.voiceAddedIds.filter((id) => id !== menuItemId),
      };
    });
  },

  undoRemove: () => {
    set((state) => {
      const removed = state.lastRemoved;
      if (!removed) return {};
      // Re-added by a tap since the remove: nothing to restore.
      if (state.items.some((i) => i.menuItemId === removed.line.menuItemId)) {
        return { lastRemoved: null };
      }
      const next = [...state.items];
      next.splice(Math.min(removed.index, next.length), 0, removed.line);
      return { items: next, lastRemoved: null };
    });
  },

  clearCart: () => set({ items: [], voiceAddedIds: [], voiceReview: null, lastRemoved: null }),

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
      const byId = new Map<string, CartLine>();
      for (const line of state.items) {
        byId.set(line.menuItemId, { ...line });
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
