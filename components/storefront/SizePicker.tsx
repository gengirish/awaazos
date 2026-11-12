"use client";

import { RadioOption } from "@/components/ui/radio-option";
import type { StoreSize } from "@/lib/item-variants";

/** Up to this many sizes are a row of options; more are a drop-down (design-system.mdc). */
const SIZE_OPTIONS_MAX = 5;

/**
 * Pick one size / colour of an item (lib/item-variants.ts). Up to
 * SIZE_OPTIONS_MAX are a row of options, more a native drop-down (the phone's
 * own picker, and no extra script on the store page). A sold-out size can't be
 * picked and says so in words. Under it: which sizes are already in the cart.
 */
export function SizePicker({
  itemId,
  itemName,
  sizes,
  pickedId,
  onPick,
  inCart,
  priceNote,
}: {
  /** Unique per list: names the radio group (a drop item id, or a menu item id). */
  itemId: string;
  itemName: string;
  sizes: StoreSize[];
  pickedId: string | null;
  onPick: (variantId: string) => void;
  inCart: string[];
  priceNote: string | null;
}) {
  const legend = `${itemName}: size or colour`;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {sizes.length <= SIZE_OPTIONS_MAX ? (
        <fieldset>
          <legend className="sr-only">{legend}</legend>
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((v) => {
              const soldOut = v.stock?.soldOut ?? false;
              return (
                <RadioOption
                  key={v.id}
                  name={`size-${itemId}`}
                  value={v.id}
                  size="compact"
                  inputClassName="sr-only"
                  className="min-w-11 px-3"
                  checked={v.id === pickedId}
                  disabled={soldOut}
                  onChange={() => onPick(v.id)}
                  label={
                    soldOut ? (
                      <>
                        <span className="line-through" aria-hidden="true">
                          {v.label}
                        </span>
                        <span className="sr-only">{`${v.label}, sold out`}</span>
                      </>
                    ) : (
                      v.label
                    )
                  }
                />
              );
            })}
          </div>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          <span className="sr-only">{legend}</span>
          <select
            value={pickedId ?? ""}
            onChange={(e) => onPick(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sizes.map((v) => {
              const soldOut = v.stock?.soldOut ?? false;
              return (
                <option key={v.id} value={v.id} disabled={soldOut}>
                  {soldOut ? `${v.label} (sold out)` : v.label}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {priceNote ? <span className="text-xs text-muted-foreground">{priceNote}</span> : null}
      {inCart.length > 0 ? (
        <span className="text-xs font-semibold text-primary">In cart: {inCart.join(", ")}</span>
      ) : null}
    </div>
  );
}
