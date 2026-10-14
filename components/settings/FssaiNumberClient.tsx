"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

/** The FSSAI number shown to buyers on the storefront. */
export type FssaiNumberClientProps = {
  initialFssaiNumber: string | null;
};

const FSSAI = /^\d{14}$/;

export function FssaiNumberClient({ initialFssaiNumber }: FssaiNumberClientProps) {
  const [fssai, setFssai] = useState(initialFssaiNumber ?? "");
  const [savedFssai, setSavedFssai] = useState(initialFssaiNumber ?? "");
  const [fssaiError, setFssaiError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fssaiDirty = fssai.trim() !== savedFssai;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: Record<string, string[] | undefined>;
        };
        const fieldMsg = data.details?.fssaiNumber?.[0];
        if (fieldMsg) setFssaiError(fieldMsg);
        toast.error(fieldMsg ?? data.error ?? "Could not save.");
        return false;
      }
      return true;
    } catch {
      toast.error("Network error — please try again.");
      return false;
    }
  }

  function saveFssai() {
    const value = fssai.trim();
    if (value && !FSSAI.test(value)) {
      setFssaiError("FSSAI number must be exactly 14 digits.");
      return;
    }
    setFssaiError(null);
    startTransition(async () => {
      if (await patch({ fssaiNumber: value })) {
        setSavedFssai(value);
        toast.success(value ? "FSSAI number saved." : "FSSAI number removed.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="fssai-number" className="text-sm font-medium">
        FSSAI number <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="fssai-number"
        inputMode="numeric"
        autoComplete="off"
        maxLength={14}
        value={fssai}
        onChange={(e) => {
          setFssai(e.target.value.replace(/\D/g, ""));
          setFssaiError(null);
        }}
        aria-invalid={fssaiError ? true : undefined}
        aria-describedby="fssai-hint"
        className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-base tabular-nums ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <p id="fssai-hint" className={`text-xs ${fssaiError ? "text-destructive" : "text-muted-foreground"}`}>
        {fssaiError ?? "14 digits. Shown on your store page so customers know your kitchen is registered."}
      </p>
      <button
        type="button"
        onClick={saveFssai}
        disabled={!fssaiDirty || pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && fssaiDirty ? "Saving…" : fssaiDirty ? "Save" : "Saved"}
      </button>
    </div>
  );
}
