"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIstTimeRange } from "@/lib/drops-time";
import {
  MAX_MENU_SLOT_RULES,
  menuSlotRuleSchema,
  slotRuleDaysLabel,
  WEEKDAY_NAMES,
  type MenuSlotRule,
} from "@/lib/menu-slots";

/** Monday first, the way a week reads here. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/** "12:00"–"14:00" → "12–2 pm", through the same formatter checkout uses. */
function timeRangeLabel(start: string, end: string): string {
  const day = "2026-01-05";
  return formatIstTimeRange(new Date(`${day}T${start}:00+05:30`), new Date(`${day}T${end}:00+05:30`));
}

/**
 * Settings → Online orders → Pickup and delivery times: the weekly slots buyers
 * pick from at checkout for menu orders (lib/menu-slots.ts). Each rule is some
 * days and one window. The whole list is saved at once (PATCH /api/vendor
 * `menuSlots`); an empty list means checkout asks no "when".
 */
export function MenuSlotsClient({ initialSlots, isOwner }: { initialSlots: MenuSlotRule[]; isOwner: boolean }) {
  const formId = useId();
  const [slots, setSlots] = useState(initialSlots);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("14:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = !isOwner || pending;
  const full = slots.length >= MAX_MENU_SLOT_RULES;

  function save(next: MenuSlotRule[], done: string) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ menuSlots: next }),
        });
        if (!res.ok) {
          toast.error("Could not save the times. Try again.");
          return;
        }
        setSlots(next);
        toast.success(done);
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || full) return;
    const parsed = menuSlotRuleSchema.safeParse({ days, start, end });
    if (!parsed.success) {
      setError(days.length === 0 ? "Pick at least one day." : "The end time has to be after the start time.");
      return;
    }
    setError(null);
    save([...slots, parsed.data], `${slotRuleDaysLabel(parsed.data.days)} · ${timeRangeLabel(start, end)} added.`);
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
    setError(null);
  }

  return (
    <div className="space-y-4">
      {slots.length > 0 ? (
        <ul className="divide-y rounded-md border" aria-label="Saved times">
          {slots.map((r, i) => {
            const label = `${slotRuleDaysLabel(r.days)} · ${timeRangeLabel(r.start, r.end)}`;
            return (
              <li key={`${r.start}-${r.end}-${r.days.join("")}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <p className="min-w-0 text-sm font-medium">{label}</p>
                {isOwner ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => save(slots.filter((_, j) => j !== i), `${label} removed.`)}
                    disabled={disabled}
                    aria-label={`Remove ${label}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No times set. Customers order without picking a time, and you agree one with them.
        </p>
      )}

      {isOwner && !full ? (
        <form onSubmit={add} className="space-y-3" noValidate aria-labelledby={`${formId}-title`}>
          <p id={`${formId}-title`} className="text-sm font-medium">
            Add a time
          </p>
          <fieldset>
            <legend className="mb-2 text-sm text-muted-foreground">Days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK.map((d) => (
                <label
                  key={d}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-checked:border-primary has-checked:bg-primary/10"
                >
                  <input
                    type="checkbox"
                    checked={days.includes(d)}
                    onChange={() => toggleDay(d)}
                    disabled={disabled}
                    className="h-4 w-4 accent-primary"
                  />
                  {WEEKDAY_NAMES[d]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-start`}>From</Label>
              <Input
                id={`${formId}-start`}
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setError(null);
                }}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-end`}>To</Label>
              <Input
                id={`${formId}-end`}
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${formId}-hint`}
                disabled={disabled}
              />
            </div>
          </div>
          <p
            id={`${formId}-hint`}
            aria-live="polite"
            className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error ??
              "Customers see the next 7 days of these times, from an hour ahead. Add another for lunch and dinner."}
          </p>
          <Button type="submit" variant="outline" disabled={disabled || days.length === 0}>
            <Plus className="h-4 w-4" aria-hidden />
            {pending ? "Saving…" : "Add time"}
          </Button>
        </form>
      ) : null}
      {isOwner && full ? (
        <p className="text-sm text-muted-foreground">You can save up to {MAX_MENU_SLOT_RULES} times.</p>
      ) : null}
      {!isOwner ? <p className="text-sm text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
