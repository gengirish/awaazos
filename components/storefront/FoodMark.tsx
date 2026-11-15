import { FOOD_TYPE_LABEL, type FoodType } from "@/lib/item-highlights";
import { cn } from "@/lib/utils";

/**
 * The food mark on a kitchen's item (lib/item-highlights.ts rule 4): the FSSAI
 * symbols, a square with a filled dot for veg and with a filled triangle for
 * non-veg (the 2022 symbol), and a dot in a yellow square for egg. Shape and
 * words carry it, never colour alone: `label="visible"` prints the word,
 * `label="sr"` gives it to screen readers only, and `label="none"` draws the
 * symbol alone for a caller that says the word itself (a row's trigger says it
 * after the item's name, so the button's name still starts with the name).
 */
const COLOUR: Record<FoodType, string> = {
  VEG: "text-green-700",
  NON_VEG: "text-amber-900",
  EGG: "text-yellow-700",
};

export function FoodMark({ type, label, className }: { type: FoodType; label: "visible" | "sr" | "none"; className?: string }) {
  const words = FOOD_TYPE_LABEL[type];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} data-food-mark={type}>
      <svg viewBox="0 0 16 16" className={cn("h-4 w-4", COLOUR[type])} aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {type === "NON_VEG" ? (
          <path d="M8 3.8 12.2 11.4H3.8Z" fill="currentColor" />
        ) : (
          <circle cx="8" cy="8" r="3.6" fill="currentColor" />
        )}
      </svg>
      {label === "visible" ? (
        <span className="text-xs font-semibold text-foreground">{words}</span>
      ) : label === "sr" ? (
        <span className="sr-only">{words}</span>
      ) : null}
    </span>
  );
}
