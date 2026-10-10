"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { STORE_NAME_MAX, storeNameSchema } from "@/lib/store-name";

/** Rename the store (`Vendor.name`). The /s/[slug] link does not change. */
export type StoreNameClientProps = {
  initialName: string;
  isOwner: boolean;
};

export function StoreNameClient({ initialName, isOwner }: StoreNameClientProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== savedName;

  function save() {
    const parsed = storeNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a store name.");
      return;
    }
    const value = parsed.data;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: value }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const fieldMsg = data.details?.name?.[0];
          if (fieldMsg) setError(fieldMsg);
          toast.error(fieldMsg ?? data.error ?? "Could not save.");
          return;
        }
        setName(value);
        setSavedName(value);
        toast.success("Store name saved.");
        // The settings header and other server-rendered spots show the name.
        router.refresh();
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !pending && isOwner) save();
      }}
    >
      {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change this.</p>}
      <label htmlFor="store-name" className="text-sm font-medium">
        Store name
      </label>
      <input
        id="store-name"
        autoComplete="organization"
        maxLength={STORE_NAME_MAX}
        value={name}
        disabled={!isOwner}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby="store-name-hint"
        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p
        id="store-name-hint"
        aria-live="polite"
        className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ?? "Shown on your store page and receipts. Your store link and QR code stay the same."}
      </p>
      <button
        type="submit"
        disabled={!isOwner || !dirty || pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && dirty ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
    </form>
  );
}
