"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StockStepper, type StockSaved } from "@/components/menu/StockStepper";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatINR } from "@/lib/currency";
import type { MenuRow } from "@/lib/menu-stock";
import { cn } from "@/lib/utils";

export type MenuMoveDirection = "up" | "down";

export type MenuItemCardProps = {
  item: MenuRow;
  onEdit: (item: MenuRow) => void;
  onChanged: () => void;
  /** A stock change saved from the card (tracked items only). */
  onStockSaved?: (id: string, saved: StockSaved) => void;
  /** Reorder by one place. Leave out to hide the Move buttons. */
  onMove?: (item: MenuRow, direction: MenuMoveDirection) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
};

/**
 * Always there on touch screens. With a mouse the card is dragged instead, so
 * the buttons stay out of sight until the card is hovered or one has keyboard focus.
 */
const MOVE_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background text-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group-hover/card:opacity-100 pointer-coarse:opacity-100 disabled:cursor-not-allowed disabled:text-muted-foreground/50 motion-reduce:transition-none";

export function MenuItemCard({
  item,
  onEdit,
  onChanged,
  onStockSaved,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
}: MenuItemCardProps) {
  const [saving, setSaving] = useState(false);

  async function patch(body: { isAvailable: boolean } | { showOnline: boolean }): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Update failed");
        return false;
      }
      onChanged();
      return true;
    } catch {
      toast.error("Update failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleSelling() {
    const next = !item.isAvailable;
    if (await patch({ isAvailable: next })) {
      toast.success(next ? `${item.name} is back on sale.` : `${item.name} marked sold out.`);
    }
  }

  async function toggleShowOnline(next: boolean) {
    if (await patch({ showOnline: next })) {
      toast.success(next ? `${item.name} is back on your online store.` : `${item.name} is now counter only.`);
    }
  }

  return (
    <Card className="group/card border">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          {/* Only the item itself is dimmed when sold out; the controls stay at full contrast. */}
          <div className={cn("flex min-w-0 flex-1 items-start gap-2", !item.isAvailable && "opacity-60")}>
            {/*
              Decorative: the item name is already rendered as text right next
              to it — an alt here would only duplicate the name.
            */}
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt=""
                aria-hidden
                width={56}
                height={56}
                sizes="56px"
                className="h-14 w-14 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="text-2xl leading-none" aria-hidden>
                {item.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-foreground">{item.name}</p>
              {item.description ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {formatINR(item.priceInPaise)}
                {item.unit ? ` / ${item.unit}` : null}
              </p>
              <p className="text-xs text-muted-foreground">{item.category}</p>
              {item.hsnCode ? <p className="text-xs text-muted-foreground">HSN/SAC: {item.hsnCode}</p> : null}
            </div>
          </div>
          {onMove ? (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className={MOVE_BUTTON}
                disabled={!canMoveUp}
                onClick={() => onMove(item, "up")}
                aria-label={`Move ${item.name} up`}
                data-move={`${item.id}:up`}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className={MOVE_BUTTON}
                disabled={!canMoveDown}
                onClick={() => onMove(item, "down")}
                aria-label={`Move ${item.name} down`}
                data-move={`${item.id}:down`}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Switch
            checked={item.isAvailable}
            aria-label={`Selling ${item.name}`}
            disabled={saving}
            onCheckedChange={() => void toggleSelling()}
          />
          {/* The word stays next to the switch, so a sold-out dish reads at a glance. */}
          <span aria-hidden="true" className={item.isAvailable ? undefined : "font-semibold text-muted-foreground"}>
            {item.isAvailable ? "Selling" : "Sold out"}
          </span>
          {item.isPopular ? (
            <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Popular</span>
          ) : null}
        </div>
        {/* Only once the seller tracks stock for this item (lib/inventory.ts rule 1). */}
        {item.stockQty !== null ? (
          <StockStepper item={item} onSaved={(id, saved) => onStockSaved?.(id, saved)} />
        ) : null}
        <div className="flex items-center gap-1 text-sm">
          <Switch
            checked={item.showOnline}
            onCheckedChange={toggleShowOnline}
            aria-label={`Show ${item.name} online`}
            disabled={saving}
          />
          <span aria-hidden="true">Show online</span>
          {!item.showOnline ? (
            <span className="ml-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              Counter only
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 w-full"
          onClick={() => onEdit(item)}
          aria-label={`Edit ${item.name}`}
        >
          <Pencil className="mr-1 h-4 w-4" aria-hidden />
          Edit
        </Button>
      </CardContent>
    </Card>
  );
}
