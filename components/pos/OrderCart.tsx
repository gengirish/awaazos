"use client";

import { AlertTriangle, Mic, Minus, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";
import { discountLabel, offerNudgeText } from "@/lib/offers";
import { computeCartTotals, toPayTotals, type PayTotals, type PosTaxSettings } from "@/lib/pos-totals";
import { cn } from "@/lib/utils";

export type PosSettings = PosTaxSettings;

export type OrderCartProps = {
  settings: PosSettings;
  onCollectPayment: (totals: PayTotals) => void;
};

/** Ask before clearing more lines than this (a slip on a long order is costly). */
const CONFIRM_CLEAR_ABOVE_LINES = 2;

/** One shared id: each remove replaces the previous Undo toast (the store keeps one `lastRemoved`). */
export const UNDO_TOAST_ID = "cart-undo";

export function OrderCart({ settings, onCollectPayment }: OrderCartProps) {
  const items = useCartStore((s) => s.items);
  const incQty = useCartStore((s) => s.incQty);
  const decQty = useCartStore((s) => s.decQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const undoRemove = useCartStore((s) => s.undoRemove);
  const clearCart = useCartStore((s) => s.clearCart);
  const voiceAddedIds = useCartStore((s) => s.voiceAddedIds);
  const voiceReview = useCartStore((s) => s.voiceReview);
  const setVoiceReview = useCartStore((s) => s.setVoiceReview);

  const totals = computeCartTotals(items, settings);
  const { subtotalPaise, discountPaise, taxPaise, totalPaise, itemCount } = totals;

  const showReview = voiceReview !== null && (voiceReview.lowConfidence || voiceReview.unmatched.length > 0);

  // `lines` outlives `open` so the sheet's text holds still while it closes.
  const [confirmClear, setConfirmClear] = useState({ open: false, lines: 0 });

  const clearNow = () => {
    toast.dismiss(UNDO_TOAST_ID);
    clearCart();
  };

  const onClear = () => {
    if (items.length > CONFIRM_CLEAR_ABOVE_LINES) {
      setConfirmClear({ open: true, lines: items.length });
      return;
    }
    clearNow();
  };

  const onRemove = (menuItemId: string, name: string) => {
    removeItem(menuItemId);
    // The store keeps only one `lastRemoved`, so a fixed id makes each remove
    // replace the previous toast — an older "Undo" can never restore the wrong line.
    toast(`Removed ${name}`, {
      id: UNDO_TOAST_ID,
      action: { label: "Undo", onClick: () => undoRemove() },
      // sonner sets `height: 24px` but no min-height, so min-h/min-w lift the
      // action to the 44×44 tap-target floor without !important.
      classNames: { actionButton: "min-h-11 min-w-11" },
    });
  };

  return (
    <section
      aria-labelledby="cart-heading"
      aria-live="polite"
      aria-atomic="false"
      className="rounded-lg border bg-card text-card-foreground shadow-xs"
    >
      <div className="flex min-h-[60px] items-center justify-between gap-2 border-b px-4 py-2">
        <h2 id="cart-heading" className="font-display text-lg font-semibold">
          Cart
        </h2>
        {items.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="h-11 min-w-11 gap-1.5 px-3 text-muted-foreground hover:text-destructive"
              aria-label="Clear cart"
              onClick={onClear}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span aria-hidden>Clear</span>
            </Button>
          </div>
        ) : null}
      </div>

      {showReview && voiceReview ? (
        <div
          role="status"
          className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="mt-3 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5 py-2 text-sm">
            {voiceReview.lowConfidence ? (
              <p className="font-medium">Check this order — voice wasn&apos;t sure</p>
            ) : null}
            {voiceReview.unmatched.length > 0 ? (
              <p className={cn(!voiceReview.lowConfidence && "font-medium")}>
                Not on menu: {voiceReview.unmatched.join(", ")}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-11 min-w-11 shrink-0 px-3"
            onClick={() => setVoiceReview(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Tap items or use voice to build an order.</p>
      ) : (
        <ul className="divide-y">
          {items.map((line) => {
            const fromVoice = voiceAddedIds.includes(line.menuItemId);
            const lineTotal = line.priceInPaise * line.qty;
            return (
              <li
                key={line.menuItemId}
                // Phones: a three-row grid. The name gets the full width (two
                // lines, then clamps); line total and "qty × price" stack on the
                // left under it, with the 44px controls on the right. The two
                // wrappers are `contents` there, so their children are the grid
                // items. From md it is the original single flex row.
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-3 md:flex md:gap-2",
                  fromVoice && "border-l-4 border-l-primary bg-primary/5 pl-3",
                )}
              >
                <span className="col-start-1 row-start-1 self-start text-xl md:self-auto" aria-hidden>
                  {line.emoji}
                </span>
                <div className="contents md:block md:min-w-0 md:flex-1">
                  <p className="col-span-2 col-start-2 row-start-1 flex min-w-0 items-start gap-1.5 font-medium text-foreground md:items-center">
                    <span className="max-md:line-clamp-2 max-md:break-words md:truncate">{line.name}</span>
                    {fromVoice ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-primary/40 px-1.5 text-[11px] font-medium uppercase leading-4 tracking-wide text-primary max-md:mt-1">
                        <Mic className="h-3 w-3" aria-hidden />
                        <span className="sr-only">added by </span>
                        voice
                      </span>
                    ) : null}
                  </p>
                  <p className="col-span-2 col-start-1 row-start-3 self-start font-mono text-xs tabular-nums text-muted-foreground md:self-auto">
                    {line.qty} × {formatINR(line.priceInPaise)}
                  </p>
                </div>
                <div className="contents md:flex md:flex-col md:items-end md:gap-1">
                  <span className="col-span-2 col-start-1 row-start-2 self-end font-mono text-sm font-semibold tabular-nums text-foreground max-md:mt-2 md:self-auto">
                    <span className="sr-only">Line total </span>
                    {formatINR(lineTotal)}
                  </span>
                  <div className="col-start-3 row-span-2 row-start-2 flex items-center gap-1 max-md:mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label={`Decrease ${line.name}`}
                      onClick={() => decQty(line.menuItemId)}
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </Button>
                    <span className="min-w-[2.5ch] text-center font-mono text-base font-bold tabular-nums">
                      <span className="sr-only">Quantity </span>
                      {line.qty}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label={`Increase ${line.name}`}
                      onClick={() => incQty(line.menuItemId)}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => onRemove(line.menuItemId, line.name)}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2 border-t px-4 py-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums text-foreground">{formatINR(subtotalPaise)}</span>
        </div>
        {discountPaise > 0 ? (
          <div className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-muted-foreground">{discountLabel(totals.offer?.name)}</span>
            <span className="shrink-0 font-mono tabular-nums text-foreground">−{formatINR(discountPaise)}</span>
          </div>
        ) : null}
        {totals.nudge ? (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
            {offerNudgeText(totals.nudge)}
          </p>
        ) : null}
        {settings.taxEnabled ? (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax ({settings.taxPercent}%)</span>
            <span className="font-mono tabular-nums text-foreground">{formatINR(taxPaise)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t pt-2 text-base font-semibold">
          <span className="text-foreground">Total</span>
          <span className="font-mono tabular-nums text-foreground">{formatINR(totalPaise)}</span>
        </div>
        {/* Phones get this from StickyCheckoutBar (md:hidden); one visible button per breakpoint. */}
        <Button
          type="button"
          className="hidden h-14 w-full text-base font-semibold md:inline-flex"
          disabled={items.length === 0}
          onClick={() => {
            // A stale Undo must not put a line back into an order being paid for.
            toast.dismiss(UNDO_TOAST_ID);
            onCollectPayment(toPayTotals(totals));
          }}
        >
          Collect payment
        </Button>
      </div>
      {/* Portalled to <body>, so it is not announced as a cart update. */}
      <ConfirmDialog
        open={confirmClear.open}
        onOpenChange={(open) => setConfirmClear((c) => ({ ...c, open }))}
        title="Clear the cart?"
        description={`All ${confirmClear.lines} items will be removed from this order.`}
        confirmLabel="Clear cart"
        onConfirm={clearNow}
      />
    </section>
  );
}
