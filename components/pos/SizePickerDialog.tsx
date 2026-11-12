"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatINR } from "@/lib/currency";
import { stockLabel } from "@/lib/inventory";
import { cn } from "@/lib/utils";

/** One size or colour as the till gets it (app/(vendor)/pos/page.tsx). */
export type PosSize = {
  id: string;
  label: string;
  /** What it sells for: its own price, else the item's (lib/item-variants.ts rule 3). */
  priceInPaise: number;
  /** Derived stock left, null when not counted. A label only: the counter never refuses. */
  stockLeft: number | null;
  lowStockAt: number | null;
};

/**
 * "Which size?" for a tile whose item comes in sizes or colours. Tapping a size
 * adds one of it to the cart and closes; the cashier taps the tile again for
 * another. Sold-out sizes stay tappable, as the counter never refuses a sale
 * over stock (lib/inventory.ts rule 5).
 */
export function SizePickerDialog({
  item,
  qtyByVariant,
  onPick,
  onClose,
}: {
  item: { name: string; sizes: PosSize[] } | null;
  qtyByVariant: ReadonlyMap<string, number>;
  onPick: (size: PosSize) => void;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{item?.name ?? ""}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Pick the size or colour to add one to the cart.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <ul className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3">
            {(item?.sizes ?? []).map((size) => {
              const stock = stockLabel(size.stockLeft, size.lowStockAt);
              const short = size.stockLeft != null && size.stockLeft <= 0;
              const inCart = qtyByVariant.get(size.id) ?? 0;
              return (
                <li key={size.id}>
                  <button
                    type="button"
                    onClick={() => onPick(size)}
                    className={cn(
                      "flex min-h-16 w-full flex-col items-center justify-center gap-0.5 rounded-md border border-input px-2 py-2 text-center ring-offset-background hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      inCart > 0 && "border-2 border-primary bg-primary/5",
                    )}
                  >
                    {/* Name first, so the accessible name is "M ₹599.00 …". */}
                    <span className="break-words text-base font-semibold text-foreground">{size.label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatINR(size.priceInPaise)}
                    </span>
                    {stock ? (
                      <span className={cn("text-xs text-muted-foreground", short && "font-semibold text-destructive")}>
                        {stock}
                      </span>
                    ) : null}
                    {inCart > 0 ? <span className="text-xs font-medium text-primary">{inCart} in cart</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
