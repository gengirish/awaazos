"use client";

import { Plus, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_VARIANTS_PER_ITEM, VARIANT_LABEL_MAX } from "@/lib/item-variants";
import { newSizeDraft, type SizeDraft, type SizeDraftError } from "@/lib/item-variants-form";

/**
 * The item form's "Sizes or colours" rows (lib/item-variants-form.ts): a name,
 * an optional price and an optional count per row. Controlled; the form saves
 * them after the item itself.
 */
export function ItemSizesEditor({
  drafts,
  onChange,
  error,
}: {
  drafts: SizeDraft[];
  onChange: (next: SizeDraft[]) => void;
  error: SizeDraftError | null;
}) {
  const uid = useId();
  const helpId = `${uid}-help`;

  function update(index: number, patch: Partial<SizeDraft>) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  return (
    <fieldset className="space-y-2" aria-describedby={helpId}>
      <legend className="text-sm font-medium">Sizes or colours (optional)</legend>
      <p id={helpId} className="text-xs text-muted-foreground">
        {drafts.length > 0
          ? "Buyers pick one. Each has its own count, which includes any packed for orders not handed over yet. A blank price means the same as the item."
          : "For one product in S, M, L, or in red and blue. Each gets its own stock."}
      </p>
      {drafts.length > 0 ? (
        <ul className="space-y-2">
          {drafts.map((d, i) => {
            const rowError = error?.index === i ? error : null;
            const errorId = `${uid}-${d.key}-error`;
            const name = d.label.trim() || `row ${i + 1}`;
            return (
              <li key={d.key} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Name
                    <Input
                      value={d.label}
                      maxLength={VARIANT_LABEL_MAX}
                      placeholder={i === 0 ? "e.g. M" : undefined}
                      autoComplete="off"
                      aria-invalid={rowError?.field === "label" ? true : undefined}
                      aria-describedby={rowError?.field === "label" ? errorId : undefined}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Price (₹)
                    <Input
                      value={d.price}
                      inputMode="decimal"
                      placeholder="Same"
                      autoComplete="off"
                      aria-invalid={rowError?.field === "price" ? true : undefined}
                      aria-describedby={rowError?.field === "price" ? errorId : undefined}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
                    In stock
                    <Input
                      value={d.stock}
                      inputMode="numeric"
                      placeholder="Not set"
                      autoComplete="off"
                      aria-invalid={rowError?.field === "stock" ? true : undefined}
                      aria-describedby={rowError?.field === "stock" ? errorId : undefined}
                      onChange={(e) => update(i, { stock: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${name}`}
                    onClick={() => onChange(drafts.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                {rowError ? (
                  <p id={errorId} className="text-xs text-destructive">
                    {rowError.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {drafts.length < MAX_VARIANTS_PER_ITEM ? (
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onChange([...drafts, newSizeDraft()])}>
          <Plus aria-hidden="true" />
          Add a size or colour
        </Button>
      ) : null}
    </fieldset>
  );
}
