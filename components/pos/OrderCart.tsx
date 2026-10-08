"use client";

import { Minus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/currency";
import { useCartStore } from "@/lib/cartStore";
import { cn } from "@/lib/utils";

export type PosSettings = {
  taxEnabled: boolean;
  taxPercent: string;
};

export type OrderCartProps = {
  settings: PosSettings;
  onCollectPayment: (totals: {
    subtotalPaise: number;
    taxPaise: number;
    totalPaise: number;
  }) => void;
};

export function OrderCart({ settings, onCollectPayment }: OrderCartProps) {
  const items = useCartStore((s) => s.items);
  const incQty = useCartStore((s) => s.incQty);
  const decQty = useCartStore((s) => s.decQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const getSubtotalPaise = useCartStore((s) => s.getSubtotalPaise);

  const subtotalPaise = getSubtotalPaise();
  const taxBps = settings.taxEnabled ? Math.round(Number(settings.taxPercent) * 100) : 0;
  const taxPaise = settings.taxEnabled ? Math.floor((subtotalPaise * taxBps) / 10000) : 0;
  const totalPaise = subtotalPaise + taxPaise;

  return (
    <section
      aria-labelledby="cart-heading"
      aria-live="polite"
      aria-atomic="false"
      className="rounded-lg border bg-card text-card-foreground shadow-xs"
    >
      <div className="border-b px-4 py-3">
        <h2 id="cart-heading" className="font-display text-lg font-semibold">
          Cart
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Tap items or use voice to build an order.</p>
      ) : (
        <ul className="divide-y">
          {items.map((line) => (
            <li key={line.menuItemId} className="flex items-center gap-2 px-4 py-3">
              <span className="text-xl" aria-hidden>
                {line.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{line.name}</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatINR(line.priceInPaise)} each
                </p>
              </div>
              <div className="flex items-center gap-1">
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
                <span className="min-w-[2ch] text-center font-mono text-sm tabular-nums">{line.qty}</span>
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
                  onClick={() => removeItem(line.menuItemId)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 border-t px-4 py-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums text-foreground">{formatINR(subtotalPaise)}</span>
        </div>
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
        <Button
          type="button"
          className={cn("h-14 w-full text-base font-semibold")}
          disabled={items.length === 0}
          onClick={() => onCollectPayment({ subtotalPaise, taxPaise, totalPaise })}
        >
          Collect payment
        </Button>
      </div>
    </section>
  );
}
