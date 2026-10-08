"use client";

import type { MenuItem } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { MenuItemCard } from "@/components/menu/MenuItemCard";
import { MenuItemForm } from "@/components/menu/MenuItemForm";
import { Button } from "@/components/ui/button";

type MenuGridProps = {
  initialItems: MenuItem[];
  /** Open the add form with this name on first render (`/menu?add=…`). */
  prefillName?: string;
};

export function MenuGrid({ initialItems, prefillName }: MenuGridProps) {
  const router = useRouter();
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [formOpen, setFormOpen] = useState(Boolean(prefillName));
  const [defaultName, setDefaultName] = useState(prefillName ?? "");
  const [editing, setEditing] = useState<MenuItem | null>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  function openCreate() {
    setDefaultName("");
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setFormOpen(true);
  }

  async function applyReorder(next: MenuItem[]) {
    const prev = items;
    setItems(next);
    try {
      const results = await Promise.all(
        next.map((row, index) =>
          fetch(`/api/menu/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: index }),
          }),
        ),
      );
      if (results.some((r) => !r.ok)) throw new Error("reorder");
      toast.success("Order updated");
      refresh();
    } catch {
      setItems(prev);
      toast.error("Could not save order");
    }
  }

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, dropId: string) {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("text/plain");
    if (!dragId || dragId === dropId) return;
    const from = items.findIndex((x) => x.id === dragId);
    const to = items.findIndex((x) => x.id === dropId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void applyReorder(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" className="min-h-11" onClick={openCreate}>
          Add item
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Drag cards to reorder. Order is saved when you drop.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => onDragStart(e, item.id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, item.id)}
            className="cursor-grab active:cursor-grabbing"
            aria-label={`${item.name}, drag to reorder`}
          >
            <MenuItemCard item={item} onEdit={openEdit} onChanged={refresh} />
          </div>
        ))}
      </div>
      <MenuItemForm
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        onSaved={refresh}
        defaultName={defaultName}
      />
    </div>
  );
}
