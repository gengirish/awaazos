"use client";

import { Mic, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { MenuGrid } from "@/components/menu/MenuGrid";
import { VoiceMenuPanel } from "@/components/menu/VoiceMenuPanel";
import { Button } from "@/components/ui/button";
import { MENU_CHANGED_EVENT } from "@/lib/menu-events";
import type { MenuRow } from "@/lib/menu-stock";
import type { StoreVocabulary } from "@/lib/store-vocabulary";

// The item form (react-hook-form, zod, photo upload) is fetched on the first
// "Add item" / "Edit", not with the page: /menu sits at its bundle budget.
const MenuItemForm = dynamic(() => import("@/components/menu/MenuItemForm").then((m) => m.MenuItemForm), {
  ssr: false,
});

type MenuScreenProps = {
  initialItems: MenuRow[];
  voiceLang: string;
  /** Open the voice panel on first render (`/menu?voice=1`). */
  voiceOpen: boolean;
  /** Open the add form with this name on first render (`/menu?add=…`). */
  prefillName?: string;
  /** The store's words (lib/store-vocabulary.ts). */
  vocab: StoreVocabulary;
  /** Offer "Sizes or colours" in the item form (lib/item-variants.ts). */
  sizesEnabled?: boolean;
  /** The viewer may see and set cost prices (lib/item-cost.ts rule 2). */
  canSeeCost?: boolean;
};

/** The header's two actions open things lower down, so the state they share lives here. */
export function MenuScreen({ initialItems, voiceLang, voiceOpen, prefillName, vocab, sizesEnabled, canSeeCost }: MenuScreenProps) {
  const router = useRouter();
  const [items, setItems] = useState<MenuRow[]>(initialItems);
  const [voiceExpanded, setVoiceExpanded] = useState(initialItems.length === 0 || voiceOpen);
  const [formOpen, setFormOpen] = useState(Boolean(prefillName));
  // Mounted from the first open on, so closing still plays the dialog's exit.
  const [formMounted, setFormMounted] = useState(Boolean(prefillName));
  const [defaultName, setDefaultName] = useState(prefillName ?? "");
  const [editing, setEditing] = useState<MenuRow | null>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))], [items]);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // A voice save (VoiceMenuPanel): the list reads the rows itself, because the
  // router.refresh() fired beside that save was sometimes never applied, which
  // left new dishes hidden until a reload (e2e/voice-menu.spec.ts caught it).
  useEffect(() => {
    async function reload() {
      try {
        const res = await fetch("/api/menu", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: MenuRow[] };
        if (body.data) setItems(body.data);
      } catch {
        // Offline: the list catches up on the next page load.
      }
    }
    window.addEventListener(MENU_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MENU_CHANGED_EVENT, reload);
  }, []);

  function openCreate() {
    setDefaultName("");
    setEditing(null);
    setFormMounted(true);
    setFormOpen(true);
  }

  function openEdit(item: MenuRow) {
    setEditing(item);
    setFormMounted(true);
    setFormOpen(true);
  }

  return (
    <>
      <header className="mx-auto mb-6 flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">{vocab.catalogueTitle}</h1>
          <p className="text-sm text-muted-foreground">Add items, set their order, and mark what is sold out.</p>
        </div>
        {items.length > 0 || !voiceExpanded ? (
          <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
            {/* While the menu is empty, the empty state has the only "Add item". */}
            {items.length > 0 ? (
              <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={openCreate}>
                <Plus aria-hidden="true" />
                Add item
              </Button>
            ) : null}
            {!voiceExpanded ? (
              <Button
                ref={expandRef}
                type="button"
                className="min-h-11 gap-2"
                aria-expanded={false}
                onClick={() => {
                  setVoiceExpanded(true);
                  requestAnimationFrame(() => micRef.current?.focus());
                }}
              >
                <Mic aria-hidden="true" />
                Add {vocab.items} by voice
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <main id="main-menu" className="mx-auto max-w-5xl space-y-6">
        <VoiceMenuPanel
          voiceLang={voiceLang}
          categories={categories}
          itemCount={initialItems.length}
          expanded={voiceExpanded}
          onCollapse={() => {
            setVoiceExpanded(false);
            requestAnimationFrame(() => expandRef.current?.focus());
          }}
          micRef={micRef}
          defaultOpen={voiceOpen}
          vocab={vocab}
        />
        <MenuGrid
          items={items}
          setItems={setItems}
          initialItems={initialItems}
          onAdd={openCreate}
          onEdit={openEdit}
          vocab={vocab}
        />
        {formMounted ? (
          <MenuItemForm
            open={formOpen}
            onOpenChange={setFormOpen}
            item={editing}
            onSaved={() => router.refresh()}
            defaultName={defaultName}
            categories={categories}
            vocab={vocab}
            sizesEnabled={sizesEnabled}
            canSeeCost={canSeeCost}
          />
        ) : null}
      </main>
    </>
  );
}
