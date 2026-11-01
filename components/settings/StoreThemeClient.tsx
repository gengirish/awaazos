"use client";

import { Check } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  STORE_THEME_LABELS,
  STORE_THEMES,
  storeTheme,
  storeThemeAttribute,
  type StoreTheme,
} from "@/lib/store-theme";
import { cn } from "@/lib/utils";

/**
 * The store colour (`VendorSettings.theme`): one tap on a swatch saves it
 * through `PATCH /api/vendor { theme }` (OWNER). Each swatch is painted by the
 * same `[data-theme]` block the store page uses, so what the seller picks is
 * exactly what buyers get; the chosen one is marked with a ring and a tick,
 * never by colour alone.
 */
export type StoreThemeClientProps = {
  initialTheme: string | null | undefined;
  isOwner: boolean;
};

export function StoreThemeClient({ initialTheme, isOwner }: StoreThemeClientProps) {
  const [theme, setTheme] = useState<StoreTheme>(() => storeTheme(initialTheme));
  const [pending, startTransition] = useTransition();
  const groupName = useId();
  const hintId = useId();
  const disabled = !isOwner || pending;

  function pick(next: StoreTheme) {
    if (next === theme) return;
    const previous = theme;
    setTheme(next);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ theme: next }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setTheme(previous);
          toast.error(data.error ?? "Could not save.");
          return;
        }
        toast.success(`Store colour: ${STORE_THEME_LABELS[next]}.`);
      } catch {
        setTheme(previous);
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <fieldset disabled={disabled} aria-describedby={hintId} aria-busy={pending || undefined}>
      <legend className="text-sm font-medium">Store colour</legend>
      <div className="mt-2 flex flex-wrap gap-3">
        {STORE_THEMES.map((id) => {
          const checked = id === theme;
          return (
            <label
              key={id}
              data-theme={storeThemeAttribute(id)}
              className={cn(
                "flex min-w-14 cursor-pointer flex-col items-center gap-1.5 text-xs font-medium text-muted-foreground",
                "has-focus-visible:[&>span:first-of-type]:ring-2 has-focus-visible:[&>span:first-of-type]:ring-ring has-focus-visible:[&>span:first-of-type]:ring-offset-2",
                disabled && "cursor-not-allowed opacity-60",
                checked && "text-foreground",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={id}
                checked={checked}
                onChange={() => pick(id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground ring-offset-background transition-shadow",
                  checked && "ring-2 ring-foreground ring-offset-2",
                )}
              >
                {checked ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
              </span>
              {STORE_THEME_LABELS[id]}
            </label>
          );
        })}
      </div>
      <p id={hintId} className="mt-2 text-xs text-muted-foreground">
        {isOwner
          ? "The colour of the buttons and links on your store page. Pick the one closest to your logo."
          : "Only the owner can change this."}
      </p>
    </fieldset>
  );
}
