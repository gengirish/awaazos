"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Settings that only matter for pre-order Drops: the FSSAI number shown to
 * buyers, and whether buyers may pay on delivery instead of upfront.
 */
export type HomeKitchenClientProps = {
  initialFssaiNumber: string | null;
  initialAcceptPayOnDelivery: boolean;
  hasUpiId: boolean;
};

const FSSAI = /^\d{14}$/;

export function HomeKitchenClient({
  initialFssaiNumber,
  initialAcceptPayOnDelivery,
  hasUpiId,
}: HomeKitchenClientProps) {
  const [fssai, setFssai] = useState(initialFssaiNumber ?? "");
  const [savedFssai, setSavedFssai] = useState(initialFssaiNumber ?? "");
  const [payOnDelivery, setPayOnDelivery] = useState(initialAcceptPayOnDelivery);
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

  function togglePayOnDelivery(next: boolean) {
    if (pending) return;
    startTransition(async () => {
      if (await patch({ acceptPayOnDelivery: next })) {
        setPayOnDelivery(next);
        toast.success(next ? "Customers can pay on delivery." : "Customers must pay upfront by UPI.");
      }
    });
  }

  return (
    <div className="space-y-6">
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
          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-base tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p id="fssai-hint" className={`text-xs ${fssaiError ? "text-destructive" : "text-muted-foreground"}`}>
          {fssaiError ?? "14 digits. Shown on your storefront so customers know your kitchen is registered."}
        </p>
        <button
          type="button"
          onClick={saveFssai}
          disabled={!fssaiDirty || pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && fssaiDirty ? "Saving…" : fssaiDirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="pay-on-delivery-toggle" className="text-sm font-medium">
            Allow pay on delivery
          </label>
          <p className="text-xs text-muted-foreground">
            {payOnDelivery
              ? "Customers can pre-order now and pay cash or UPI when the food arrives."
              : "Customers must pay by UPI when they place a pre-order."}
          </p>
          {!payOnDelivery && !hasUpiId ? (
            <p className="text-xs text-amber-600">
              You have no UPI ID saved, so customers have no way to pay. Turn this on or add a UPI ID.
            </p>
          ) : null}
        </div>
        <button
          id="pay-on-delivery-toggle"
          type="button"
          role="switch"
          aria-checked={payOnDelivery}
          onClick={() => togglePayOnDelivery(!payOnDelivery)}
          disabled={pending}
          className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">{payOnDelivery ? "Turn off pay on delivery" : "Turn on pay on delivery"}</span>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              payOnDelivery ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
                payOnDelivery ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
