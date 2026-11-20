"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import type { PainReelLink, PainReelStore } from "@/lib/pain-reels";

const FIELD =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const ROW_LABEL: Record<PainReelStore, string> = {
  kitchen: "Home kitchens",
  jewellery: "Jewellery and other products",
};

type Props = {
  reels: readonly PainReelLink[];
  /** The lead's row, listed first. */
  store: PainReelStore;
  value: string | null;
  onChange: (reel: PainReelLink | null) => void;
};

/**
 * "Add a video" under an outreach message: picks one pain-point Reel, whose page link
 * the caller adds to the text (withReelLink in lib/outreach-message.ts). The lead's
 * store type comes first; the other row stays pickable. Nothing renders when no Reel
 * is published.
 */
export function ReelPicker({ reels, store, value, onChange }: Props) {
  const id = useId();
  if (reels.length === 0) return null;
  const rows: PainReelStore[] = store === "kitchen" ? ["kitchen", "jewellery"] : ["jewellery", "kitchen"];

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Add a video</Label>
      <select
        id={id}
        className={FIELD}
        value={value ?? ""}
        onChange={(e) => onChange(reels.find((r) => r.id === e.target.value) ?? null)}
      >
        <option value="">No video</option>
        {rows.map((row) => (
          <optgroup key={row} label={ROW_LABEL[row]}>
            {reels
              .filter((r) => r.store === row)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">Adds the video&apos;s page link as the last line.</p>
    </div>
  );
}
