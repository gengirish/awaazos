"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioOption } from "@/components/ui/radio-option";
import {
  FOOD_TYPE_LABEL,
  FOOD_TYPES,
  HIGHLIGHT_LABEL_MAX,
  HIGHLIGHT_LABEL_SUGGESTIONS,
  HIGHLIGHT_VALUE_MAX,
  HIGHLIGHTS_MAX,
  ITEM_DETAILS_MAX,
  storedHighlights,
  type FoodType,
  type Highlight,
} from "@/lib/item-highlights";
import type { StoreVocabulary } from "@/lib/store-vocabulary";

/**
 * The detail sheet's text in the item form (docs/PRODUCT_PAGE_PLAN.md step 4,
 * rules in lib/item-highlights.ts): highlights as label / value rows, the longer
 * details text, and for a food store the veg / non-veg / egg mark. Controlled:
 * MenuItemForm holds the values and sends them with the item (the server
 * normalises and refuses, never cuts).
 */

export type ItemDetailDraft = { highlights: Highlight[]; details: string; foodType: FoodType | null };

export function itemDetailDraftFrom(item?: { highlights?: unknown; details?: string | null; foodType?: FoodType | null } | null): ItemDetailDraft {
  return {
    highlights: storedHighlights(item?.highlights),
    details: item?.details ?? "",
    foodType: item?.foodType ?? null,
  };
}

const TEXTAREA =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm";

export function ItemDetailFields({
  value,
  onChange,
  vocab,
  error,
}: {
  value: ItemDetailDraft;
  onChange: (next: ItemDetailDraft) => void;
  vocab: Pick<StoreVocabulary, "kind" | "item">;
  /** A refusal from the last save, shown under the highlights. */
  error?: string | null;
}) {
  const uid = useId();
  const kind = vocab.kind;
  const rows = value.highlights;
  const set = (patch: Partial<ItemDetailDraft>) => onChange({ ...value, ...patch });
  const setRow = (i: number, patch: Partial<Highlight>) =>
    set({ highlights: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const used = new Set(rows.map((r) => r.label.trim().toLowerCase()));
  const suggestions = HIGHLIGHT_LABEL_SUGGESTIONS[kind].filter((s) => !used.has(s.toLowerCase()));
  const roomLeft = rows.length < HIGHLIGHTS_MAX;

  function addRow(label = "") {
    if (!roomLeft) return;
    set({ highlights: [...rows, { label, value: "" }] });
    // Focus the new value (or label) box once React has rendered it.
    requestAnimationFrame(() => {
      document.getElementById(`${uid}-${rows.length}-${label ? "value" : "label"}`)?.focus();
    });
  }

  return (
    <div className="space-y-4">
      {kind === "food" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">Veg or non-veg (optional)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <RadioOption
              size="compact"
              name={`${uid}-food`}
              label="Not said"
              checked={value.foodType === null}
              onChange={() => set({ foodType: null })}
            />
            {FOOD_TYPES.map((t) => (
              <RadioOption
                key={t}
                size="compact"
                name={`${uid}-food`}
                label={FOOD_TYPE_LABEL[t]}
                checked={value.foodType === t}
                onChange={() => set({ foodType: t })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Shown as the green or brown mark next to the name.</p>
        </fieldset>
      ) : null}

      <div className="space-y-2" role="group" aria-labelledby={`${uid}-hl`}>
        <p className="text-sm font-medium leading-none" id={`${uid}-hl`}>
          Highlights (optional)
        </p>
        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={i} className="flex items-start gap-2" data-testid="highlight-row">
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                  <Input
                    id={`${uid}-${i}-label`}
                    aria-label={`Highlight ${i + 1} label`}
                    placeholder={kind === "food" ? "e.g. Serves" : "e.g. Fabric"}
                    maxLength={HIGHLIGHT_LABEL_MAX}
                    value={row.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                  />
                  <Input
                    id={`${uid}-${i}-value`}
                    aria-label={`Highlight ${i + 1} value`}
                    placeholder={kind === "food" ? "e.g. 2 people" : "e.g. Cotton blend"}
                    maxLength={HIGHLIGHT_VALUE_MAX}
                    value={row.value}
                    onChange={(e) => setRow(i, { value: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  onClick={() => set({ highlights: rows.filter((_, j) => j !== i) })}
                  aria-label={`Remove highlight ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {roomLeft ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button key={s} type="button" variant="outline" size="sm" className="min-h-11" onClick={() => addRow(s)}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                {s}
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => addRow()}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Other
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Up to {HIGHLIGHTS_MAX}, shown as a short list when a buyer opens the {vocab.item}.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor={`${uid}-details`} className="text-sm font-medium leading-none">
          Details (optional)
        </label>
        <textarea
          id={`${uid}-details`}
          rows={4}
          maxLength={ITEM_DETAILS_MAX}
          placeholder={
            kind === "food"
              ? "e.g. Made fresh in the morning with cold-pressed groundnut oil. Keeps 2 days in the fridge."
              : "e.g. Hand-knotted on silk thread. Each bead is a little different. Avoid water and perfume."
          }
          className={TEXTAREA}
          value={value.details}
          onChange={(e) => set({ details: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          The longer story, shown when a buyer opens it. {value.details.length}/{ITEM_DETAILS_MAX}
        </p>
      </div>
    </div>
  );
}
