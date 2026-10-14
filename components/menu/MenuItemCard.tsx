"use client";

import type { MenuItem } from "@prisma/client";
import Image from "next/image";
import { ArrowDown, ArrowUp, CircleCheck, CircleSlash, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ShowOnlineSwitch } from "@/components/menu/ShowOnlineSwitch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/currency";
import { cn } from "@/lib/utils";

export type MenuMoveDirection = "up" | "down";

export type MenuItemCardProps = {
  item: MenuItem;
  onEdit: (item: MenuItem) => void;
  onChanged: () => void;
  /** Reorder by one place. Leave out to hide the Move buttons. */
  onMove?: (item: MenuItem, direction: MenuMoveDirection) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
};

/**
 * Always there on touch screens. With a mouse the card is dragged instead, so
 * the buttons stay out of sight until the card is hovered or one has keyboard focus.
 */
const MOVE_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background text-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group-hover/card:opacity-100 pointer-coarse:opacity-100 disabled:cursor-not-allowed disabled:text-muted-foreground/50 motion-reduce:transition-none";

export function MenuItemCard({ item, onEdit, onChanged, onMove, canMoveUp = false, canMoveDown = false }: MenuItemCardProps) {
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
          {/* Only the dish itself is dimmed when sold out; the controls stay at full contrast. */}
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
              <p className="text-sm text-muted-foreground">{formatINR(item.priceInPaise)}</p>
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
        <div className="flex flex-wrap items-center gap-2">
          {/* One control for "can it be ordered": the state is the label, with its own icon. */}
          <button
            type="button"
            role="switch"
            aria-checked={item.isAvailable}
            aria-label={`Selling ${item.name}`}
            disabled={saving}
            onClick={() => void toggleSelling()}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
              item.isAvailable
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {item.isAvailable ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <CircleSlash className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {item.isAvailable ? "Selling" : "Sold out"}
          </button>
          {item.isPopular ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Popular</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <ShowOnlineSwitch
            checked={item.showOnline}
            onCheckedChange={toggleShowOnline}
            label={`Show ${item.name} online`}
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
