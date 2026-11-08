"use client";

import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { UNDO_TOAST_ID } from "@/components/pos/OrderCart";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/lib/cartStore";
import { formatINR } from "@/lib/currency";
import { computeCartTotals, toPayTotals, type PayTotals, type PosTaxSettings } from "@/lib/pos-totals";

/** Element id of the cart wrapper in `PosShell`; "View cart" scrolls to it. */
export const POS_CART_ANCHOR_ID = "pos-cart";

export type StickyCheckoutBarProps = {
  settings: PosTaxSettings;
  onCollectPayment: (totals: PayTotals) => void;
};

/**
 * Phone-only checkout bar pinned just above the app shell's tab bar on /pos
 * (`md:hidden`; `--app-bottom-inset` is set by `.app-shell` in globals.css,
 * and the tab bar below it owns the safe-area inset). Below md
 * this holds the only visible "Collect payment" button; OrderCart's own button
 * takes over at md and up. Always rendered on phones so the thumb target never
 * moves — disabled while the cart is empty.
 *
 * Width budget at 360px: 328px inside the padding. The cart button is icon +
 * count only so the pay button gets the rest, and inside the pay button the
 * label is what gives way (ellipsis) — the amount never shrinks or clips.
 */
export function StickyCheckoutBar({ settings, onCollectPayment }: StickyCheckoutBarProps) {
  const items = useCartStore((s) => s.items);
  const totals = computeCartTotals(items, settings);
  const { totalPaise, itemCount } = totals;
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
      <div className="mx-auto flex max-w-lg items-center gap-2">
        <button
          type="button"
          onClick={viewCart}
          aria-label={`View cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
          className="flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-md border border-input px-2.5 text-sm font-medium text-foreground ring-offset-background hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-mono tabular-nums">{itemCount}</span>
        </button>
        <Button
          type="button"
          className="h-12 min-w-0 flex-1 gap-0 px-3 text-base font-semibold"
          disabled={empty}
          onClick={() => {
            // An Undo left over from the cart must not put a line back into an order being paid.
            toast.dismiss(UNDO_TOAST_ID);
            onCollectPayment(toPayTotals(totals));
          }}
        >
          <span className="min-w-0 truncate">Collect payment</span>
          <span className="shrink-0 whitespace-pre">
            {" · "}
            <span className="font-mono tabular-nums">{formatINR(totalPaise)}</span>
          </span>
        </Button>
      </div>
    </div>
  );
}
