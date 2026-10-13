"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { INSTAGRAM_HANDLE_MESSAGE, normaliseInstagramHandle } from "@/lib/instagram";

/** The Instagram handle linked from the storefront header. Saving it publishes it. */
export type InstagramHandleClientProps = {
  initialHandle: string | null;
  isOwner: boolean;
};

export function InstagramHandleClient({ initialHandle, isOwner }: InstagramHandleClientProps) {
  const [handle, setHandle] = useState(initialHandle ?? "");
  const [saved, setSaved] = useState(initialHandle ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normalised = normaliseInstagramHandle(handle);
  const dirty = normalised !== saved;
  const disabled = !isOwner || pending;

  function save() {
    if (normalised === null) {
      setError(INSTAGRAM_HANDLE_MESSAGE);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ instagramHandle: normalised }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const fieldMsg = data.details?.instagramHandle?.[0];
          if (fieldMsg) setError(fieldMsg);
          toast.error(fieldMsg ?? data.error ?? "Could not save.");
          return;
        }
        setSaved(normalised);
        setHandle(normalised);
        toast.success(normalised ? "Instagram username saved." : "Instagram username removed.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="instagram-handle" className="text-sm font-medium">
        Instagram username <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <div className="flex min-h-11 w-full items-center rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <span aria-hidden="true" className="pl-3 text-base text-muted-foreground">
          @
        </span>
        <input
          id="instagram-handle"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          value={handle}
          disabled={disabled}
          onChange={(e) => {
            setHandle(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="instagram-handle-hint"
          className="min-h-11 w-full min-w-0 rounded-md bg-transparent px-1.5 text-base focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <p
        id="instagram-handle-hint"
        aria-live="polite"
        className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ?? "Your username or profile link. Customers tap it on your store page to open your Instagram."}
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
