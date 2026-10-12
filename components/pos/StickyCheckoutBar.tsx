"use client";

import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { UNDO_TOAST_ID } from "@/components/pos/OrderCart";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/lib/cartStore";
import { formatINR } from "@/lib/currency";
import { computeCartTotals, type PosTaxSettings } from "@/lib/pos-totals";

/** Element id of the cart wrapper in `PosShell`; "View cart" scrolls to it. */
export const POS_CART_ANCHOR_ID = "pos-cart";

export type StickyCheckoutBarProps = {
  settings: PosTaxSettings;
  onCollectPayment: (totals: { subtotalPaise: number; taxPaise: number; totalPaise: number }) => void;
};

/**
 * Phone-only checkout bar pinned just above the app shell's tab bar on /pos
 * (`md:hidden`; `--app-bottom-inset` is set by `.app-shell` in globals.css,
 * and the tab bar below it owns the safe-area inset). Below md
 * this holds the only visible "Collect payment" button; OrderCart's own button
 * takes over at md and up. Always rendered on phones so the thumb target never
 * moves — disabled while the cart is empty.
 */
export function StickyCheckoutBar({ settings, onCollectPayment }: StickyCheckoutBarProps) {
  const items = useCartStore((s) => s.items);
  const { subtotalPaise, taxPaise, totalPaise, itemCount } = computeCartTotals(items, settings);
  const empty = items.length === 0;

  const viewCart = () => {
    const el = document.getElementById(POS_CART_ANCHOR_ID);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  return (
    <div
      className="fixed inset-x-0 bottom-[var(--app-bottom-inset,0px)] z-40 border-t border-border bg-background/95 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm supports-backdrop-filter:bg-background/80 md:hidden"
      data-testid="sticky-checkout-bar"
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <button
          type="button"
          onClick={viewCart}
          className="flex min-h-12 min-w-[44px] shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-foreground ring-offset-background hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ShoppingBag className="h-4 w-4" aria-hidden />
          View cart ({itemCount})
        </button>
        <Button
          type="button"
          className="h-12 flex-1 text-base font-semibold"
          disabled={empty}
          onClick={() => {
            // An Undo left over from the cart must not put a line back into an order being paid.
            toast.dismiss(UNDO_TOAST_ID);
            onCollectPayment({ subtotalPaise, taxPaise, totalPaise });
          }}
        >
          Collect payment
          <span className="font-mono tabular-nums"> · {formatINR(totalPaise)}</span>
        </Button>
      </div>
    </div>
  );
}
