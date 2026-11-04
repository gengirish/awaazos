"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLAN_PRICES_PAISE } from "@/lib/constants";
import { formatINR, formatINRCompact, paiseToRupees, rupeesToPaise } from "@/lib/currency";
import {
  CUSTOM_PRICE_MAX_RUPEES,
  CUSTOM_PRICE_MIN_RUPEES,
  isValidCustomPriceRupees,
  storeChargePaise,
} from "@/lib/subscription";

type Props = {
  vendorId: string;
  vendorName: string;
  customPricePaise: number | null;
  /** Its subscription is collecting, so a new price waits until it subscribes again. */
  hasLiveSubscription: boolean;
};

const RANGE_ERROR = `Enter whole rupees from ${CUSTOM_PRICE_MIN_RUPEES} to ${CUSTOM_PRICE_MAX_RUPEES}.`;

const LIST_PAISE = PLAN_PRICES_PAISE.STARTER;

function confirmText(rupees: number | null): string {
  if (rupees === null) {
    return `They go back to the list price, ${formatINRCompact(LIST_PAISE)} a month + GST, when they next subscribe.`;
  }
  return `${formatINRCompact(rupeesToPaise(rupees))} a month + GST. They will see it on their billing page and in reminder emails.`;
}

/**
 * One store's own monthly price on /admin/vendors. The server validates again
 * (PATCH /api/admin/vendors/[id]/price); this previews what the owner would pay.
 */
export function StorePriceForm({ vendorId, vendorName, customPricePaise, hasLiveSubscription }: Props) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(customPricePaise === null ? "" : String(paiseToRupees(customPricePaise)));
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What the dialog asks about; null = the list price. Kept after closing, so
  // its text doesn't change during the closing animation.
  const [confirmRupees, setConfirmRupees] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rupees = Number(value);
  const valid = value.trim() !== "" && isValidCustomPriceRupees(rupees);

  function ask(next: number | null) {
    setSaved(false);
    setError(null);
    setConfirmRupees(next);
    setConfirmOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/vendors/${encodeURIComponent(vendorId)}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyRupees: confirmRupees }),
      });
      if (!res.ok) {
        setError(res.status === 400 ? RANGE_ERROR : "Could not save. Try again.");
        return;
      }
      if (confirmRupees === null) setValue("");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground">
        {customPricePaise === null
          ? `On the list price, ${formatINRCompact(LIST_PAISE)} a month + GST.`
          : `Store price: ${formatINRCompact(customPricePaise)} a month + GST (list price ${formatINRCompact(LIST_PAISE)}).`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <Label htmlFor={inputId}>Store price, ₹ a month before GST</Label>
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={CUSTOM_PRICE_MIN_RUPEES}
            max={CUSTOM_PRICE_MAX_RUPEES}
            step={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              setSaved(false);
            }}
            className="mt-1 sm:w-40"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            if (valid) ask(rupees);
            else setError(RANGE_ERROR);
          }}
        >
          Save price
        </Button>
        {customPricePaise !== null ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => ask(null)}>
            Back to list price
          </Button>
        ) : null}
      </div>
      {valid ? (
        <p className="text-xs text-muted-foreground">
          They would pay {formatINR(storeChargePaise("monthly", rupeesToPaise(rupees)))} a month or{" "}
          {formatINR(storeChargePaise("yearly", rupeesToPaise(rupees)))} a year, including GST.
        </p>
      ) : null}
      {hasLiveSubscription ? (
        <p className="text-xs text-muted-foreground">
          This store has a live subscription, which keeps the price it was made at. A new price applies only if they
          subscribe again.
        </p>
      ) : null}
      <div aria-live="polite">
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Change the price for ${vendorName}?`}
        description={confirmText(confirmRupees)}
        confirmLabel="Save price"
        destructive={false}
        onConfirm={() => void save()}
      />
    </div>
  );
}
