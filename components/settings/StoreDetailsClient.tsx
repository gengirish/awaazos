"use client";

import type { StallType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { STALL_TYPES } from "@/lib/constants";
import { STALL_TYPE_OTHER_MAX, STALL_TYPE_OTHER_MESSAGE, stallTypeOtherSchema } from "@/lib/stall-type";

const FIELD =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const LOCATION_MAX = 80;

export type StoreDetailsClientProps = {
  initialStallType: StallType;
  initialStallTypeOther: string | null;
  initialCity: string | null;
  initialState: string | null;
  isOwner: boolean;
};

type Values = { stallType: StallType; stallTypeOther: string; city: string; state: string };

/**
 * What the store sells and where it is: the "Home bakery · Sahakar Nagar,
 * Bengaluru" line under the store name on /s/[slug]. "Other" asks for the
 * seller's own words (lib/stall-type.ts). City and state are optional; a blank
 * one is cleared, so a wrong place can be removed rather than only replaced.
 */
export function StoreDetailsClient({
  initialStallType,
  initialStallTypeOther,
  initialCity,
  initialState,
  isOwner,
}: StoreDetailsClientProps) {
  const router = useRouter();
  const initial: Values = {
    stallType: initialStallType,
    stallTypeOther: initialStallTypeOther ?? "",
    city: initialCity ?? "",
    state: initialState ?? "",
  };
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    values.stallType !== saved.stallType ||
    (values.stallType === "OTHER" && values.stallTypeOther.trim() !== saved.stallTypeOther) ||
    values.city.trim() !== saved.city ||
    values.state.trim() !== saved.state;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === "stallType" || key === "stallTypeOther") setOtherError(null);
  }

  function save() {
    let stallTypeOther: string | undefined;
    if (values.stallType === "OTHER") {
      const parsed = stallTypeOtherSchema.safeParse(values.stallTypeOther);
      if (!parsed.success) {
        setOtherError(STALL_TYPE_OTHER_MESSAGE);
        return;
      }
      stallTypeOther = parsed.data;
    }
    const next: Values = {
      stallType: values.stallType,
      stallTypeOther: stallTypeOther ?? "",
      city: values.city.trim(),
      state: values.state.trim(),
    };
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            stallType: next.stallType,
            ...(stallTypeOther !== undefined ? { stallTypeOther } : {}),
            city: next.city || null,
            state: next.state || null,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const otherMsg = data.details?.stallTypeOther?.[0];
          if (otherMsg) setOtherError(otherMsg);
          const firstMsg = otherMsg ?? Object.values(data.details ?? {}).flat()[0];
          toast.error(firstMsg ?? data.error ?? "Could not save.");
          return;
        }
        setValues(next);
        setSaved(next);
        toast.success("Store details saved.");
        router.refresh();
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !pending && isOwner) save();
      }}
    >
      {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change this.</p>}
      <div className="space-y-2">
        <label htmlFor="store-type" className="text-sm font-medium">
          What do you sell?
        </label>
        <select
          id="store-type"
          className={FIELD}
          value={values.stallType}
          disabled={!isOwner}
          onChange={(e) => set("stallType", e.target.value as StallType)}
        >
          {STALL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {values.stallType === "OTHER" ? (
        <div className="space-y-2">
          <label htmlFor="store-type-other" className="text-sm font-medium">
            Describe your business
          </label>
          <input
            id="store-type-other"
            className={FIELD}
            maxLength={STALL_TYPE_OTHER_MAX}
            placeholder="Pickles & podis"
            value={values.stallTypeOther}
            disabled={!isOwner}
            onChange={(e) => set("stallTypeOther", e.target.value)}
            aria-invalid={otherError ? true : undefined}
            aria-describedby="store-type-other-hint"
          />
          <p
            id="store-type-other-hint"
            aria-live="polite"
            className={`text-xs ${otherError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {otherError ?? `Shown on your store page in place of a type, in up to ${STALL_TYPE_OTHER_MAX} characters.`}
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="store-city" className="text-sm font-medium">
            Area and city
          </label>
          <input
            id="store-city"
            className={FIELD}
            autoComplete="address-level2"
            maxLength={LOCATION_MAX}
            placeholder="Sahakar Nagar, Bengaluru"
            value={values.city}
            disabled={!isOwner}
            onChange={(e) => set("city", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="store-state" className="text-sm font-medium">
            State
          </label>
          <input
            id="store-state"
            className={FIELD}
            autoComplete="address-level1"
            maxLength={LOCATION_MAX}
            placeholder="Karnataka"
            value={values.state}
            disabled={!isOwner}
            onChange={(e) => set("state", e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown under your store name. Leave a field blank to hide it.
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
