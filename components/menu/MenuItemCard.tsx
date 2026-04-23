"use client";

import type { MenuItem } from "@prisma/client";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/currency";

export type MenuItemCardProps = {
  item: MenuItem;
  onEdit: (item: MenuItem) => void;
  onChanged: () => void;
};

export function MenuItemCard({ item, onEdit, onChanged }: MenuItemCardProps) {
  async function toggleAvailable(next: boolean) {
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Update failed");
        return;
      }
      onChanged();
    } catch {
      toast.error("Update failed");
    }
  }

  async function softDelete() {
    if (!window.confirm(`Remove “${item.name}” from the menu? It will be marked unavailable.`)) return;
    try {
      const res = await fetch(`/api/menu/${item.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "Delete failed");
        return;
      }
      toast.success("Item removed");
      onChanged();
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <Card className={`border ${item.isAvailable ? "opacity-100" : "opacity-60"}`}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className="text-2xl leading-none" aria-hidden>
              {item.emoji}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-foreground">{item.name}</p>
              <p className="text-sm text-muted-foreground">{formatINR(item.priceInPaise)}</p>
              <p className="text-xs text-muted-foreground">{item.category}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={item.isAvailable}
              onChange={(e) => toggleAvailable(e.target.checked)}
              aria-label={`${item.isAvailable ? "Mark unavailable" : "Mark available"} for ${item.name}`}
            />
            <span>{item.isAvailable ? "Available" : "Unavailable"}</span>
          </label>
          {item.isPopular ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Popular</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 flex-1"
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.name}`}
          >
            <Pencil className="mr-1 h-4 w-4" aria-hidden />
            Edit
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-11 flex-1"
            onClick={softDelete}
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
