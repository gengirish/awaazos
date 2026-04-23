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

type CartState = {
  items: CartLine[];
  addItem: (item: Omit<CartLine, "qty"> & { qty?: number }) => void;
  incQty: (menuItemId: string) => void;
  decQty: (menuItemId: string) => void;
  removeItem: (menuItemId: string) => void;
  clearCart: () => void;
  setItemsFromVoice: (parsed: VoiceCartItem[]) => void;
  getSubtotalPaise: () => number;
  getItemCount: () => number;
};

function lineTotalPaise(line: CartLine): number {
  return line.priceInPaise * line.qty;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

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
    set((state) => ({
      items: state.items.filter((i) => i.menuItemId !== menuItemId),
    }));
  },

  clearCart: () => set({ items: [] }),

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
      return { items: Array.from(byId.values()) };
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
