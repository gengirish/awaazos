"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatINR, paiseToRupees } from "@/lib/currency";
import { parseCostInput } from "@/lib/item-cost";
import { parseStockInput, type MenuRow } from "@/lib/menu-stock";
import { paiseToRupeeInput } from "@/lib/menu-voice";
import { purchaseTotalPaise } from "@/lib/stock-purchase";

/** The sizes of this item whose stock is counted; empty for an item without sizes. */
function trackedSizes(item: MenuRow) {
  return (item.variants ?? []).filter((v) => v.stockQty !== null);
}

/** Whether "Received stock" has anything to add to (lib/stock-purchase.ts rule 3). */
export function canReceiveStock(item: MenuRow): boolean {
  return (item.variants?.length ?? 0) > 0 ? trackedSizes(item).length > 0 : item.stockQty !== null;
}

type ReceiveStockDialogProps = {
  /** The item being received; null keeps the dialog closed. */
  item: MenuRow | null;
  onClose: () => void;
  /** After a save, so the list reloads its counts and cost. */
  onSaved: () => void;
};

/**
 * "Received stock" (lib/stock-purchase.ts): how many pieces came in, per size
 * when the item has sizes, and what each cost. One save adds them to the count
 * and keeps a dated purchase record. For MANAGER and up; a cashier's card has
 * no button for it.
 */
export function ReceiveStockDialog({ item, onClose, onSaved }: ReceiveStockDialogProps) {
  const uid = useId();
  // Keyed by size id; "" is the item itself when it has no sizes.
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const [costText, setCostText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setQtyText({});
    setCostText(item.costInPaise != null ? paiseToRupeeInput(item.costInPaise) : "");
    setError(null);
    setCostError(null);
  }, [item]);

  const sizes = item ? trackedSizes(item) : [];
  const rows = sizes.length > 0 ? sizes.map((v) => ({ key: v.id, label: v.label })) : [{ key: "", label: "" }];

  let pieces = 0;
  for (const row of rows) {
    const parsed = parseStockInput(qtyText[row.key] ?? "");
    if ("value" in parsed && parsed.value) pieces += parsed.value;
  }
  const cost = parseCostInput(costText);
  const total = "paise" in cost ? purchaseTotalPaise(pieces, cost.paise) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const lines: { variantId?: string; qty: number }[] = [];
    for (const row of rows) {
      const parsed = parseStockInput(qtyText[row.key] ?? "");
      if ("error" in parsed) {
        setError(row.label ? `${row.label}: ${parsed.error}` : parsed.error);
        return;
      }
      if (parsed.value) lines.push(row.key ? { variantId: row.key, qty: parsed.value } : { qty: parsed.value });
    }
    if (lines.length === 0) {
      setError("Enter how many came in");
      return;
    }
    if ("error" in cost) {
      setCostError(cost.error);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/menu/${item.id}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          ...(cost.paise !== null ? { costInRupees: paiseToRupees(cost.paise) } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json?.error === "stock_not_tracked" ? "Stock isn't tracked for this item" : "Could not save");
        return;
      }
      toast.success(`${item.name}: ${pieces} added to stock`);
      onSaved();
      onClose();
    } catch {
      toast.error("Could not save");
    } finally {
      setSaving(false);
    }
  }

  const errorId = `${uid}-error`;
  const costId = `${uid}-cost`;
  const costHelpId = `${uid}-cost-help`;
  const costErrorId = `${uid}-cost-error`;

  return (
    <ResponsiveDialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Received stock</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {item?.name}: enter the new pieces that came in. They are added to what you have.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="space-y-4">
            <fieldset className="space-y-2" aria-describedby={error ? errorId : undefined}>
              <legend className="text-sm font-medium">How many came in?</legend>
              <div className={sizes.length > 0 ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : undefined}>
                {rows.map((row) => {
                  const id = `${uid}-qty-${row.key}`;
                  return (
                    <div key={row.key} className="space-y-1">
                      {row.label ? (
                        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
                          {row.label}
                        </label>
                      ) : null}
                      <Input
                        id={id}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={row.label ? undefined : "How many came in?"}
                        aria-invalid={error ? true : undefined}
                        value={qtyText[row.key] ?? ""}
                        onChange={(e) => {
                          setQtyText((prev) => ({ ...prev, [row.key]: e.target.value }));
                          setError(null);
                        }}
                        className="h-11"
                      />
                    </div>
                  );
                })}
              </div>
              {error ? (
                <p id={errorId} className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
            <div className="space-y-2">
              <label htmlFor={costId} className="block text-sm font-medium">
                Cost of each (₹, optional)
              </label>
              <Input
                id={costId}
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 250"
                value={costText}
                aria-invalid={costError ? true : undefined}
                aria-describedby={costError ? `${costErrorId} ${costHelpId}` : costHelpId}
                onChange={(e) => {
                  setCostText(e.target.value);
                  setCostError(null);
                }}
                className="h-11"
              />
              {costError ? (
                <p id={costErrorId} className="text-sm font-medium text-destructive">
                  {costError}
                </p>
              ) : null}
              <p id={costHelpId} className="text-xs text-muted-foreground">
                {total !== null && pieces > 0
                  ? `${pieces} for ${formatINR(total)} in all. This becomes the cost price from now on; past bills keep theirs.`
                  : "This becomes the cost price from now on; past bills keep theirs."}
              </p>
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving}>
              Add to stock
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
