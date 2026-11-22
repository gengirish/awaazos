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
import { MENU_CATEGORY_MAX } from "@/lib/menu-category";

type RenameCategoryDialogProps = {
  /** The category being renamed, exactly as stored; null keeps the dialog closed. */
  category: string | null;
  onClose: () => void;
  /** After a rename, so the list reads its rows again. */
  onRenamed: () => void;
};

/**
 * Rename one category on every item that has it (PATCH /api/menu/categories).
 * A category is the free text on each item, so this is the only place to change
 * it for all of them at once. Typing an existing name merges the two.
 */
export function RenameCategoryDialog({ category, onClose, onRenamed }: RenameCategoryDialogProps) {
  const uid = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kept after close, so the title doesn't blank out during the exit animation.
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (category === null) return;
    setShown(category);
    setName(category);
    setError(null);
  }, [category]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (category === null) return;
    const to = name.trim();
    if (!to) {
      setError("Enter a name");
      return;
    }
    if (to.length > MENU_CATEGORY_MAX) {
      setError(`At most ${MENU_CATEGORY_MAX} characters`);
      return;
    }
    if (to === category) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/menu/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: category, to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issue = Array.isArray(json?.issues) ? json.issues[0]?.message : null;
        setError(typeof issue === "string" ? issue : "Could not rename. Try again.");
        return;
      }
      const updated = typeof json?.data?.updated === "number" ? json.data.updated : 0;
      toast.success(updated === 1 ? `Renamed to “${to}” (1 item)` : `Renamed to “${to}” (${updated} items)`);
      onRenamed();
      onClose();
    } catch {
      setError("Could not rename. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputId = `${uid}-name`;
  const errorId = `${uid}-error`;

  return (
    <ResponsiveDialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Rename category</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Every item in “{shown}” moves to the new name. Use a name you already have to merge the two.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="space-y-2">
            <label htmlFor={inputId} className="block text-sm font-medium">
              New name
            </label>
            <Input
              id={inputId}
              autoComplete="off"
              enterKeyHint="done"
              maxLength={MENU_CATEGORY_MAX}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className="h-11"
            />
            {error ? (
              <p id={errorId} className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving}>
              {saving ? "Saving…" : "Rename"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
