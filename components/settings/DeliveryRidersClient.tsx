"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deliveryRiderSchema,
  MAX_DELIVERY_RIDERS,
  RIDER_NAME_MAX,
  type DeliveryRider,
} from "@/lib/delivery-riders";
import { formatIndianMobile } from "@/lib/phone";

/**
 * Settings → Online orders → Delivery riders: the people who deliver for the
 * seller. Each saved rider becomes a "Send to <name>" button on delivery
 * orders, which opens WhatsApp to that rider with the order filled in.
 * The whole list is saved at once (PATCH /api/vendor `deliveryRiders`).
 */
export function DeliveryRidersClient({
  initialRiders,
  isOwner,
}: {
  initialRiders: DeliveryRider[];
  isOwner: boolean;
}) {
  const formId = useId();
  const [riders, setRiders] = useState(initialRiders);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = !isOwner || pending;
  const full = riders.length >= MAX_DELIVERY_RIDERS;

  function save(next: DeliveryRider[], done: string, after?: () => void) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ deliveryRiders: next }),
        });
        if (!res.ok) {
          toast.error("Could not save riders. Try again.");
          return;
        }
        setRiders(next);
        after?.();
        toast.success(done);
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || full) return;
    const parsed = deliveryRiderSchema.safeParse({ name, phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the name and number.");
      return;
    }
    if (riders.some((r) => r.phone === parsed.data.phone)) {
      setError("That number is already saved.");
      return;
    }
    setError(null);
    save([...riders, parsed.data], `${parsed.data.name} saved.`, () => {
      setName("");
      setPhone("");
    });
  }

  function remove(rider: DeliveryRider) {
    if (disabled) return;
    save(
      riders.filter((r) => r.phone !== rider.phone),
      `${rider.name} removed.`,
    );
  }

  return (
    <div className="space-y-4">
      {riders.length > 0 ? (
        <ul className="divide-y rounded-md border" aria-label="Saved riders">
          {riders.map((r) => (
            <li key={r.phone} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{formatIndianMobile(r.phone)}</p>
              </div>
              {isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(r)}
                  disabled={disabled}
                  aria-label={`Remove ${r.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No riders saved yet.</p>
      )}

      {isOwner && !full ? (
        <form onSubmit={add} className="space-y-3" noValidate aria-labelledby={`${formId}-title`}>
          <p id={`${formId}-title`} className="text-sm font-medium">
            Add a rider
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>Name</Label>
              <Input
                id={`${formId}-name`}
                autoComplete="off"
                maxLength={RIDER_NAME_MAX}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-phone`}>WhatsApp number</Label>
              <Input
                id={`${formId}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={20}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${formId}-hint`}
                className="tabular-nums"
                disabled={disabled}
              />
            </div>
          </div>
          <p
            id={`${formId}-hint`}
            aria-live="polite"
            className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error ?? "Your own delivery person, or a friend who delivers for you. Up to 5."}
          </p>
          <Button type="submit" variant="outline" disabled={disabled || !name.trim() || !phone.trim()}>
            <Plus className="h-4 w-4" aria-hidden />
            {pending ? "Saving…" : "Add rider"}
          </Button>
        </form>
      ) : null}
      {isOwner && full ? (
        <p className="text-xs text-muted-foreground">You can save up to {MAX_DELIVERY_RIDERS} riders.</p>
      ) : null}
      {!isOwner ? <p className="text-xs text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
