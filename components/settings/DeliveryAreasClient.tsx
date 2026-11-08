"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deliveryAreaFeeLabel,
  deliveryAreaKey,
  deliveryFeeInputToPaise,
  DELIVERY_AREA_NAME_MAX,
  MAX_DELIVERY_AREAS,
  toDeliveryArea,
  type DeliveryArea,
} from "@/lib/delivery-areas";

/**
 * Settings → Online orders → Delivery areas: the localities a store delivers to
 * (lib/delivery-areas.ts), each with an optional fee of its own. The whole list
 * is saved at once (PATCH /api/vendor `deliveryAreas`); an empty list means
 * "anywhere", as before.
 */
export function DeliveryAreasClient({ initialAreas, isOwner }: { initialAreas: DeliveryArea[]; isOwner: boolean }) {
  const formId = useId();
  const [areas, setAreas] = useState(initialAreas);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = !isOwner || pending;
  const full = areas.length >= MAX_DELIVERY_AREAS;

  function save(next: DeliveryArea[], done: string, onSaved?: () => void) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ deliveryAreas: next }),
        });
        if (!res.ok) {
          toast.error("Could not save the areas. Try again.");
          return;
        }
        setAreas(next);
        onSaved?.();
        toast.success(done);
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || full) return;
    // Empty: the usual fee.
    const feePaise = deliveryFeeInputToPaise(fee);
    if (feePaise === undefined) {
      setError("Enter a fee up to ₹1,000, like 30 or 0 for free. Leave it empty for your usual fee.");
      return;
    }
    const area = toDeliveryArea({ name, feePaise });
    if (!area) {
      setError("Enter the area's name, like Kondapur.");
      return;
    }
    if (areas.some((a) => deliveryAreaKey(a.name) === deliveryAreaKey(area.name))) {
      setError(`${area.name} is already on the list.`);
      return;
    }
    setError(null);
    save([...areas, area], `${area.name} added.`, () => {
      setName("");
      setFee("");
    });
  }

  return (
    <div className="space-y-4">
      {areas.length > 0 ? (
        <ul className="divide-y rounded-md border" aria-label="Delivery areas">
          {areas.map((a, i) => (
            <li key={a.name} className="flex items-center justify-between gap-3 px-3 py-2">
              <p className="min-w-0 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground"> · {deliveryAreaFeeLabel(a)}</span>
              </p>
              {isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => save(areas.filter((_, j) => j !== i), `${a.name} removed.`)}
                  disabled={disabled}
                  aria-label={`Remove ${a.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No areas set. Customers type their locality, and you deliver anywhere at your usual fee.
        </p>
      )}

      {isOwner && !full ? (
        <form onSubmit={add} className="space-y-3" noValidate aria-labelledby={`${formId}-title`}>
          <p id={`${formId}-title`} className="text-sm font-medium">
            Add an area
          </p>
          <div className="grid grid-cols-1 gap-3 sm:max-w-md sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>Area</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                maxLength={DELIVERY_AREA_NAME_MAX}
                placeholder="Kondapur"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-fee`}>Fee in ₹ (optional)</Label>
              <Input
                id={`${formId}-fee`}
                inputMode="decimal"
                value={fee}
                onChange={(e) => {
                  setFee(e.target.value);
                  setError(null);
                }}
                placeholder="0"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${formId}-hint`}
                disabled={disabled}
                className="font-mono"
              />
            </div>
          </div>
          <p
            id={`${formId}-hint`}
            aria-live="polite"
            className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error ?? "0 is free delivery. Empty uses the fee you set for the menu or the drop."}
          </p>
          <Button type="submit" variant="outline" disabled={disabled || !name.trim()}>
            <Plus className="h-4 w-4" aria-hidden />
            {pending ? "Saving…" : "Add area"}
          </Button>
        </form>
      ) : null}
      {isOwner && full ? (
        <p className="text-sm text-muted-foreground">You can save up to {MAX_DELIVERY_AREAS} areas.</p>
      ) : null}
      {!isOwner ? <p className="text-sm text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
