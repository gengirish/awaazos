"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  isValidStoreTagline,
  normaliseStoreTagline,
  STORE_TAGLINE_MAX,
  STORE_TAGLINE_MESSAGE,
} from "@/lib/store-tagline";

/** One line under the store name on the store page (`VendorSettings.tagline`). */
export type StoreTaglineClientProps = {
  initialTagline: string | null;
  isOwner: boolean;
  /** Placeholder that fits what the store sells. */
  example: string;
};

export function StoreTaglineClient({ initialTagline, isOwner, example }: StoreTaglineClientProps) {
  const [tagline, setTagline] = useState(initialTagline ?? "");
  const [saved, setSaved] = useState(initialTagline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normalised = normaliseStoreTagline(tagline);
  const dirty = (normalised ?? "") !== saved;
  const disabled = !isOwner || pending;

  function save() {
    if (!isValidStoreTagline(normalised)) {
      setError(STORE_TAGLINE_MESSAGE);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tagline: normalised }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const fieldMsg = data.details?.tagline?.[0];
          if (fieldMsg) setError(fieldMsg);
          toast.error(fieldMsg ?? data.error ?? "Could not save.");
          return;
        }
        setSaved(normalised ?? "");
        setTagline(normalised ?? "");
        toast.success(normalised ? "Tagline saved." : "Tagline removed.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="store-tagline" className="text-sm font-medium">
        Tagline <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="store-tagline"
        type="text"
        autoComplete="off"
        maxLength={STORE_TAGLINE_MAX}
        placeholder={example}
        value={tagline}
        disabled={disabled}
        onChange={(e) => {
          setTagline(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby="store-tagline-hint"
        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p
        id="store-tagline-hint"
        aria-live="polite"
        className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ??
          `One line under your store name, and the text under your link when it is shared. ${tagline.length}/${STORE_TAGLINE_MAX}`}
      </p>
      <button
        type="button"
        onClick={save}
        disabled={!dirty || disabled}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && dirty ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
      {!isOwner ? <p className="text-xs text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
