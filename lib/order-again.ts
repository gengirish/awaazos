import type { CartScope } from "@/lib/storefront-order";

/**
 * "Order again" on the buyer's order page and account page. Pure and
 * client-safe; lib/order-again-server.ts reads what the store sells today.
 *
 * It fills the buyer's normal saved cart and sends them to the store page, so
 * nothing here places an order or carries a price: checkout re-reads prices,
 * stock and cut-off as it does for any cart. An order's names and prices are
 * snapshots, so a line matches today's catalogue through `menuItemId` only.
 *
 * The cart goes to whatever can take the most of the order: the everyday menu,
 * or an open drop (the menu beats a drop on a tie, then the soonest cut-off).
 */

export type OrderAgainItem = { menuItemId: string | null; name: string; qty: number };

export type OrderableNow = {
  /** Menu item ids orderable from the everyday menu; empty when it takes no orders. */
  menu: ReadonlySet<string>;
  /** Open drops, soonest cut-off first; menu item id → drop item id, for items still in stock. */
  drops: readonly { dropId: string; items: ReadonlyMap<string, string> }[];
};

export type OrderAgainPlan = {
  scope: CartScope;
  /** Cart lines for `scope`: menu item ids for the menu, drop item ids for a drop. */
  lines: Record<string, number>;
  /** Names from the old order that can't be ordered right now. */
  unavailable: string[];
};

/** Handed over, cancelled or lapsed: offered only then, so it never competes with paying for a live order. */
export function orderIsOver(state: string, fulfilmentStatus: string | null): boolean {
  return fulfilmentStatus === "DELIVERED" || state === "CANCELLED" || state === "EXPIRED";
}

/** Null when nothing from the order can be ordered right now. */
export function planOrderAgain(items: readonly OrderAgainItem[], orderable: OrderableNow): OrderAgainPlan | null {
  const targets: { scope: CartScope; idFor: (menuItemId: string) => string | undefined }[] = [
    { scope: { kind: "menu" }, idFor: (id) => (orderable.menu.has(id) ? id : undefined) },
    ...orderable.drops.map((drop) => ({
      scope: { kind: "drop", dropId: drop.dropId } as CartScope,
      idFor: (id: string) => drop.items.get(id),
    })),
  ];

  let best: OrderAgainPlan | null = null;
  let bestCount = 0;
  for (const target of targets) {
    const lines: Record<string, number> = {};
    const unavailable: string[] = [];
    let count = 0;
    for (const item of items) {
      const id = item.menuItemId ? target.idFor(item.menuItemId) : undefined;
      if (id) {
        lines[id] = (lines[id] ?? 0) + item.qty;
        count++;
      } else if (!unavailable.includes(item.name)) {
        unavailable.push(item.name);
      }
    }
    if (count > bestCount) {
      best = { scope: target.scope, lines, unavailable };
      bestCount = count;
    }
  }
  return best;
}

/** The old order's lines on top of a cart already saved: nothing is lost, and tapping twice doesn't double. */
export function mergeOrderAgainLines(
  existing: Readonly<Record<string, number>>,
  lines: Readonly<Record<string, number>>,
): Record<string, number> {
  const out = { ...existing };
  for (const [id, qty] of Object.entries(lines)) out[id] = Math.max(out[id] ?? 0, qty);
  return out;
}

/** "2 × Samosa, 1 × Chai +3 more", for one row of the buyer's order history. */
export function orderItemsSummary(items: readonly { name: string; qty: number }[], shown = 2): string {
  const named = items
    .slice(0, shown)
    .map((i) => `${i.qty} × ${i.name}`)
    .join(", ");
  return items.length > shown ? `${named} +${items.length - shown} more` : named;
}
