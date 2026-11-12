/**
 * The item form's "Sizes or colours" rows (rules in lib/item-variants.ts):
 * what the seller types, and the PUT /api/menu/[id]/variants body built from
 * it. Pure and client-safe, seller screens only.
 *
 * Like the item's own "In stock now" (lib/menu-stock.ts), a size's count is
 * sent only when the seller changed it: sending one records a fresh count.
 */

import { paiseToRupees } from "@/lib/currency";
import {
  MAX_VARIANTS_PER_ITEM,
  normaliseVariantLabel,
  VARIANT_LABEL_MAX,
  type VariantRow,
} from "@/lib/item-variants";
import { onShelfCount, parseStockInput } from "@/lib/menu-stock";
import { paiseToRupeeInput, parseRupeeInput } from "@/lib/menu-voice";

/** One row as typed. `key` is ours (React key, DOM ids); `id` is the saved variant's. */
export type SizeDraft = {
  key: string;
  id?: string;
  label: string;
  /** Blank = the item's price. */
  price: string;
  /** Blank = not tracked. */
  stock: string;
  /** `stock` as first shown, to tell whether the seller changed it. */
  initialStock: string;
  isAvailable: boolean;
};

export type SizeDraftField = "label" | "price" | "stock";
export type SizeDraftError = { index: number; field: SizeDraftField; message: string };

/** A saved variant's "In stock" as first shown: the pieces on the shelf, or blank. */
function shelfText(v: VariantRow): string {
  if (v.stockQty === null) return "";
  if (v.stockLeft === null) return String(v.stockQty);
  return String(onShelfCount(v));
}

export function sizeDraftsFrom(variants: readonly VariantRow[] | undefined): SizeDraft[] {
  return (variants ?? []).map((v) => ({
    key: v.id,
    id: v.id,
    label: v.label,
    price: v.priceInPaise === null ? "" : paiseToRupeeInput(v.priceInPaise),
    stock: shelfText(v),
    initialStock: shelfText(v),
    isAvailable: v.isAvailable,
  }));
}

let nextKey = 0;
export function newSizeDraft(): SizeDraft {
  nextKey += 1;
  return { key: `new-${nextKey}`, label: "", price: "", stock: "", initialStock: "", isAvailable: true };
}

export type VariantsBody = {
  variants: {
    id?: string;
    label: string;
    priceInRupees: number | null;
    isAvailable: boolean;
    stockQty?: number | null;
  }[];
};

/** The PUT body, or the first row problem to show beside its field. */
export function sizeDraftsToBody(drafts: readonly SizeDraft[]): { body: VariantsBody } | { error: SizeDraftError } {
  if (drafts.length > MAX_VARIANTS_PER_ITEM) {
    return { error: { index: MAX_VARIANTS_PER_ITEM, field: "label", message: `At most ${MAX_VARIANTS_PER_ITEM}` } };
  }
  const seen = new Set<string>();
  const variants: VariantsBody["variants"] = [];
  for (const [index, d] of drafts.entries()) {
    const label = normaliseVariantLabel(d.label);
    if (!label) return { error: { index, field: "label", message: "Name each size or colour" } };
    if (label.length > VARIANT_LABEL_MAX) {
      return { error: { index, field: "label", message: `At most ${VARIANT_LABEL_MAX} characters` } };
    }
    if (seen.has(label.toLowerCase())) return { error: { index, field: "label", message: "Each name only once" } };
    seen.add(label.toLowerCase());

    let priceInRupees: number | null = null;
    if (d.price.trim() !== "") {
      const price = parseRupeeInput(d.price);
      if ("error" in price) return { error: { index, field: "price", message: price.error } };
      priceInRupees = paiseToRupees(price.paise);
    }

    const stock = parseStockInput(d.stock);
    if ("error" in stock) return { error: { index, field: "stock", message: stock.error } };
    const changed = d.id === undefined ? stock.value !== null : d.stock.trim() !== d.initialStock;

    variants.push({
      ...(d.id ? { id: d.id } : {}),
      label,
      priceInRupees,
      isAvailable: d.isAvailable,
      ...(changed ? { stockQty: stock.value } : {}),
    });
  }
  return { body: { variants } };
}

/** Seller-facing copy for a refused PUT /api/menu/[id]/variants. */
export function variantsErrorMessage(code: unknown): string {
  if (code === "item_in_drop") {
    return "This item is in a drop that hasn't ended. Add sizes or colours once the drop is over.";
  }
  return typeof code === "string" && code !== "Invalid input" ? code : "Could not save the sizes or colours";
}
