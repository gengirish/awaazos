"use client";

import type { MenuItem } from "@prisma/client";
import { UtensilsCrossed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MenuItemCard, type MenuMoveDirection } from "@/components/menu/MenuItemCard";
import { MenuItemForm } from "@/components/menu/MenuItemForm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type MenuGridProps = {
  initialItems: MenuItem[];
  /** Open the add form with this name on first render (`/menu?add=…`). */
  prefillName?: string;
};

/** One request for the whole order (POST /api/menu/reorder). False when it did not save. */
async function saveOrder(rows: MenuItem[]): Promise<boolean> {
  try {
    const res = await fetch("/api/menu/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: rows.map((row) => row.id) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function MenuGrid({ initialItems, prefillName }: MenuGridProps) {
  const router = useRouter();
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [formOpen, setFormOpen] = useState(Boolean(prefillName));
  const [defaultName, setDefaultName] = useState(prefillName ?? "");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Reorder saves run one at a time; taps made meanwhile collapse into one more save.
  const savingOrder = useRef(false);
  const queuedOrder = useRef<MenuItem[] | null>(null);
  // The Move button to put focus back on once the cards have swapped places.
  const refocusMove = useRef<{ id: string; direction: MenuMoveDirection } | null>(null);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))], [items]);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Moving a card re-inserts its DOM node, which drops focus in some browsers.
  // At an end of the list that button is now disabled, so its twin takes over.
  useEffect(() => {
    const target = refocusMove.current;
    if (!target) return;
    refocusMove.current = null;
    const button = (direction: MenuMoveDirection) =>
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-move="${target.id}:${direction}"]`);
    const same = button(target.direction);
    (same && !same.disabled ? same : button(target.direction === "up" ? "down" : "up"))?.focus();
  }, [items]);

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
    setItems(next);
    if (savingOrder.current) {
      queuedOrder.current = next;
      return;
    }
    savingOrder.current = true;
    let order = next;
    let ok = true;
    try {
      for (;;) {
        ok = await saveOrder(order);
        const queued = queuedOrder.current;
        queuedOrder.current = null;
        if (!ok || !queued) break;
        order = queued;
      }
    } finally {
      savingOrder.current = false;
    }
    if (ok) {
      toast.success("Order updated", { id: "menu-order" });
    } else {
      // Back to what the server has (the refresh below confirms it).
      setItems(initialItems);
      toast.error("Could not save order", { id: "menu-order" });
    }
    refresh();
  }

  function move(item: MenuItem, direction: MenuMoveDirection) {
    const from = items.findIndex((x) => x.id === item.id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    refocusMove.current = { id: item.id, direction };
    void applyReorder(next);
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
      {items.length === 0 ? (
        // The only "Add item" on the page while the menu is empty.
        <EmptyState
          icon={UtensilsCrossed}
          title="No items yet"
          description="Add your first item here, or use Add dishes by voice above to say several with their prices."
          action={
            <Button type="button" className="min-h-11" onClick={openCreate}>
              Add item
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button type="button" className="min-h-11" onClick={openCreate}>
              Add item
            </Button>
          </div>
          {items.length > 1 ? (
            <>
              <p className="text-sm text-muted-foreground pointer-coarse:hidden">
                Drag cards to reorder. Order is saved when you drop.
              </p>
              <p className="hidden text-sm text-muted-foreground pointer-coarse:block">
                Use the arrows on a card to move it up or down. The order is saved as you go.
              </p>
            </>
          ) : null}
          <div ref={gridRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => onDragStart(e, item.id)}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, item.id)}
                className="pointer-fine:cursor-grab pointer-fine:active:cursor-grabbing"
              >
                <MenuItemCard
                  item={item}
                  onEdit={openEdit}
                  onChanged={refresh}
                  onMove={move}
                  canMoveUp={index > 0}
                  canMoveDown={index < items.length - 1}
                />
              </div>
            ))}
          </div>
        </>
      )}
      <MenuItemForm
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        onSaved={refresh}
        defaultName={defaultName}
        categories={categories}
      />
    </div>
  );
}
