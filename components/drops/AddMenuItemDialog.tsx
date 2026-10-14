"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { paiseToRupees, rupeesToPaise } from "@/lib/currency";

/** The menu row the drop form needs for a dish added from here. */
export type AddedMenuItem = {
  id: string;
  name: string;
  emoji: string;
  priceInPaise: number;
  isAvailable: boolean;
};

type ApiBody = {
  data?: Partial<AddedMenuItem>;
  error?: string;
  issues?: { path: (string | number)[]; message: string }[];
};

/** "120" / "12.50" → paise, or null if it isn't a rupee amount above zero. */
function priceToPaise(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  try {
    const paise = rupeesToPaise(Number(t));
    return paise > 0 ? paise : null;
  } catch {
    return null;
  }
}

function failureMessage(status: number, body: ApiBody): string {
  if (status === 400) return body.issues?.[0]?.message ?? "Check the name and price, then try again.";
  if (status === 402) {
    return body.error === "billing_locked"
      ? "Adding dishes is paused until you subscribe."
      : "Your plan doesn't allow another menu item.";
  }
  if (status === 409) return "A dish with this name is already on your menu.";
  if (status === 401 || status === 403) return "You don't have permission to add menu items.";
  return "Could not add this dish. Please try again.";
}

export type AddMenuItemDialogProps = {
  /** What the cook said; she can correct it before saving. */
  spokenName: string;
  onClose: () => void;
  onAdded: (item: AddedMenuItem) => void;
};

/**
 * Add a spoken dish that isn't on the menu yet, without leaving the drop form.
 * Saves through `POST /api/menu` (the same path as the menu page). Mount it
 * only while it is open: its fields start from the props.
 *
 * Deliberately not a `<form>`: it opens from inside the drop form, and a submit
 * event in a portal still bubbles through React to that form's handler.
 */
export function AddMenuItemDialog({ spokenName, onClose, onAdded }: AddMenuItemDialogProps) {
  const [name, setName] = useState(spokenName);
  // Rupees as typed; converted to paise only on save.
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    const cleanName = name.trim();
    const paise = priceToPaise(price);
    const next = {
      name: cleanName ? undefined : "Enter the dish name",
      price: paise === null ? "Enter a price in rupees, e.g. 120" : undefined,
    };
    setErrors(next);
    setFailure(null);
    if (next.name || paise === null) return;

    setSaving(true);
    try {
      const res = await fetch("/api/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: cleanName, priceInRupees: paiseToRupees(paise) }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiBody;
      const d = body.data;
      if (!res.ok || !d?.id) {
        setFailure(failureMessage(res.status, body));
        return;
      }
      onAdded({
        id: d.id,
        name: d.name ?? cleanName,
        emoji: d.emoji ?? "",
        priceInPaise: d.priceInPaise ?? paise,
        isAvailable: d.isAvailable ?? true,
      });
    } catch {
      setFailure("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function saveOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void save();
  }

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add to your menu</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            It is saved to your menu and ticked for this drop. You can add a photo and more on the Menu page later.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="add-dish-name" className="text-sm font-medium">
              Dish name
            </label>
            <Input
              id="add-dish-name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={saveOnEnter}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "add-dish-name-error" : undefined}
            />
            {errors.name ? (
              <p id="add-dish-name-error" className="text-xs text-destructive">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="add-dish-price" className="text-sm font-medium">
              Price (₹)
            </label>
            <Input
              id="add-dish-price"
              inputMode="decimal"
              placeholder="120"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={saveOnEnter}
              aria-invalid={errors.price ? true : undefined}
              aria-describedby={errors.price ? "add-dish-price-error" : undefined}
            />
            {errors.price ? (
              <p id="add-dish-price-error" className="text-xs text-destructive">
                {errors.price}
              </p>
            ) : null}
          </div>
          {failure ? (
            <Notice role="alert" tone="danger" icon>
              {failure}
            </Notice>
          ) : null}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {saving ? "Adding…" : "Add dish"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
